import { IMMUNE_CARDS } from "./immune-cards.js?v=17";

const AUDIO_EXT = new Set(["mp3", "m4a", "m4b", "aac"]);
const COVER_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const SKIP_FOLDERS = new Set(["ebooks", "_source"]);

const KNOWN_COLLECTIONS = {
  "門羅-WhatIf": { id: "munroe", title: "Munroe", author: "Randall Munroe" },
  Immune: { id: "immune", title: "Immune", author: "Philipp Dettmer" },
};

const KNOWN_BOOKS = {
  "what-if-1": {
    title: "What If?",
    subtitle: "Serious Scientific Answers to Absurd Hypothetical Questions",
    author: "Randall Munroe",
  },
  "what-if-2": {
    title: "What If? 2",
    subtitle: "Additional Serious Scientific Answers to Absurd Hypothetical Questions",
    author: "Randall Munroe",
  },
  "how-to": {
    title: "How To",
    subtitle: "Absurd Scientific Advice for Common Real-World Problems",
    author: "Randall Munroe",
  },
  immune: {
    title: "Immune",
    subtitle: "A Journey into the Mysterious System That Keeps You Alive",
    author: "Philipp Dettmer",
  },
};

const PROGRESS_KEY = "librarylisten.progress.v1";
const SORT_KEY = "librarylisten.shelfSort";
const RATE_KEY = "librarylisten.rate";
const RATES = [1, 1.25, 1.5];
const LIBRARY_KEY = "librarylisten.library.v1";
const DB_NAME = "library-listen";
const COVER_KEY = "__cover__";

/** @type {{ books: any[], activeBookId: string|null, sort: string }} */
const state = {
  books: [],
  activeBookId: null,
  bookPane: "audio",
  sort: localStorage.getItem(SORT_KEY) || "collection",
};

const audio = document.getElementById("audio");
const els = {
  onboarding: document.getElementById("onboarding"),
  shelf: document.getElementById("shelf"),
  book: document.getElementById("book"),
  chapterList: document.getElementById("chapter-list"),
  conceptList: document.getElementById("concept-list"),
  playerBar: document.getElementById("player-bar"),
  capabilityHint: document.getElementById("capability-hint"),
  fileInputDir: document.getElementById("file-input-dir"),
  fileInputFiles: document.getElementById("file-input-files"),
};

/** @type {{ bookId: string, chapterIndex: number } | null} */
let playback = null;
let seekDragging = false;
let playToken = 0;
let ignoreSeekInput = 0;
let detachChapterMeta = null;
/** @type {{ token: number, resumeAt: number, until: number } | null} */
let resumeGuard = null;
const SKIP_SECONDS = 30;
let playbackRate = loadRate();
const objectUrls = new Set();
/** Books copied into IndexedDB: bookId -> Map(chapterId | COVER_KEY -> Blob) */
const offlineIndex = new Map();
/** @type {FileSystemDirectoryHandle | null} */
let savedDirHandle = null;
let savingBookId = null;

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("handles");
        req.result.createObjectStore("offline");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

async function idb(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function loadOfflineIndex() {
  offlineIndex.clear();
  const rows = (await idb("offline", "readonly", (s) => s.getAll())) || [];
  for (const row of rows) {
    if (!offlineIndex.has(row.bookId)) offlineIndex.set(row.bookId, new Map());
    offlineIndex.get(row.bookId).set(row.chapterId, row.blob);
  }
}

function isBookOffline(book) {
  const saved = offlineIndex.get(book.id);
  return !!saved && book.chapters.every((ch) => saved.has(ch.id));
}

function isBookPlayable(book) {
  return book.chapters.every((ch) => !!ch.file);
}

function saveLibrarySnapshot() {
  const snapshot = state.books.map((b) => ({
    id: b.id,
    collectionId: b.collectionId,
    collectionTitle: b.collectionTitle,
    folder: b.folder,
    title: b.title,
    subtitle: b.subtitle,
    author: b.author,
    chapters: b.chapters.map((ch) => ({ id: ch.id, title: ch.title })),
  }));
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
}

/** Rebuild the shelf from the last scan; audio comes only from saved-on-device copies. */
function restoreLibrarySnapshot() {
  let snapshot = [];
  try {
    snapshot = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(snapshot)) return [];
  return snapshot.map((b) => {
    const saved = offlineIndex.get(b.id);
    return {
      ...b,
      coverFile: saved?.get(COVER_KEY) || null,
      coverUrl: null,
      chapters: b.chapters.map((ch, index) => ({
        id: ch.id,
        index,
        title: ch.title,
        file: saved?.get(ch.id) || null,
        fromDevice: !!saved?.has(ch.id),
        url: null,
      })),
    };
  });
}

function attachUrls(books) {
  revokeAllUrls();
  for (const book of books) {
    for (const ch of book.chapters) ch.url = ch.file ? fileUrl(ch.file) : null;
    book.coverUrl = book.coverFile ? fileUrl(book.coverFile) : null;
  }
}

async function saveBookOffline(book) {
  if (savingBookId || !isBookPlayable(book)) return;
  savingBookId = book.id;
  try {
    await navigator.storage?.persist?.().catch(() => false);
    const items = book.chapters.map((ch) => [ch.id, ch.file]);
    if (book.coverFile) items.push([COVER_KEY, book.coverFile]);
    const saved = new Map();
    for (let i = 0; i < items.length; i += 1) {
      const [chapterId, blob] = items[i];
      updateOfflineButton(book, `Saving ${i + 1}/${items.length}…`);
      await idb("offline", "readwrite", (s) =>
        s.put({ bookId: book.id, chapterId, blob }, [book.id, chapterId])
      );
      saved.set(chapterId, blob);
    }
    offlineIndex.set(book.id, saved);
  } catch (err) {
    console.error(err);
    await removeBookOffline(book).catch(() => {});
    alert(
      err?.name === "QuotaExceededError"
        ? "Not enough storage on this device to save the whole book."
        : "Could not save this book on the device.\n\nIf this is iCloud: Download Now on listen/ first, then try again. Private Browsing cannot save books."
    );
  } finally {
    savingBookId = null;
    render();
  }
}

async function removeBookOffline(book) {
  await idb("offline", "readwrite", (s) =>
    s.delete(IDBKeyRange.bound([book.id], [book.id, []]))
  );
  offlineIndex.delete(book.id);
}

function updateOfflineButton(book, busyLabel) {
  const btn = document.getElementById("btn-offline");
  const status = document.getElementById("book-offline-status");
  if (!btn || !status) return;
  const offline = isBookOffline(book);
  btn.disabled = !!savingBookId || (!offline && !isBookPlayable(book));
  if (busyLabel) {
    btn.textContent = busyLabel;
  } else if (offline) {
    btn.textContent = "Remove from device";
  } else {
    btn.textContent = "Save to this device";
  }
  if (offline) {
    status.textContent = "Saved on this device — plays without picking the folder again.";
  } else if (!isBookPlayable(book)) {
    status.textContent = "Reconnect the Library folder to play this book.";
  } else {
    const bytes = book.chapters.reduce((n, ch) => n + (ch.file?.size || 0), 0);
    status.textContent = `Save a copy (${formatBytes(bytes)}) so it opens after the app restarts.`;
  }
}

function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

async function rememberDirectory(handle) {
  savedDirHandle = handle;
  await idb("handles", "readwrite", (s) => s.put(handle, "library")).catch(() => {});
}

async function loadSavedDirectory() {
  if (typeof window.showDirectoryPicker !== "function") return null;
  try {
    return (await idb("handles", "readonly", (s) => s.get("library"))) || null;
  } catch {
    return null;
  }
}

function loadRate() {
  try {
    const n = Number(localStorage.getItem(RATE_KEY));
    if (RATES.includes(n)) return n;
  } catch {
    /* private mode */
  }
  return 1;
}

function rateLabel(rate) {
  if (rate === 1) return "1.0×";
  if (rate === 1.25) return "1.25×";
  return "1.5×";
}

function applyPlaybackRate() {
  audio.preservesPitch = true;
  audio.webkitPreservesPitch = true;
  if (audio.playbackRate !== playbackRate) audio.playbackRate = playbackRate;
  const btn = document.getElementById("btn-rate");
  if (!btn) return;
  const label = rateLabel(playbackRate);
  btn.textContent = label;
  btn.setAttribute("aria-label", `Playback speed ${label}`);
}

function cycleRate() {
  const index = RATES.indexOf(playbackRate);
  playbackRate = RATES[(index + 1) % RATES.length];
  try {
    localStorage.setItem(RATE_KEY, String(playbackRate));
  } catch {
    /* private mode */
  }
  applyPlaybackRate();
  updatePositionState();
}

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function slug(value) {
  const folded = value.normalize("NFKD").replace(/\p{M}/gu, "");
  const cleaned = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "collection";
}

function humanize(value) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function collectionMeta(folder) {
  return (
    KNOWN_COLLECTIONS[folder] || {
      id: slug(folder),
      title: humanize(folder),
      author: "Unknown",
    }
  );
}

function bookMeta(folder, collectionAuthor) {
  const key = folder.toLowerCase();
  return (
    KNOWN_BOOKS[folder] ||
    KNOWN_BOOKS[key] || {
      title: humanize(folder),
      subtitle: null,
      author: collectionAuthor,
    }
  );
}

function titleFromFilename(fileName) {
  const base = fileName.replace(/\.[^.]+$/, "");
  const part = base.match(/(?:^|[-_\s])part\s*0*(\d+)$/i);
  if (part) return `Part ${String(Number(part[1])).padStart(2, "0")}`;
  const numbered = base.replace(/^\s*\d+\s*[-.)]+\s*/, "").trim();
  return numbered || base;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function relativeTime(iso) {
  if (!iso) return "";
  const elapsed = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "yesterday";
  return `${Math.floor(hours / 24)}d ago`;
}

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
  } catch {
    return {};
  }
}

function chapterProgress(bookId, chapterId) {
  const book = loadProgress()[bookId];
  if (!book || !chapterId) return null;
  const saved = book.chapters?.[chapterId];
  if (saved && Number.isFinite(saved.positionSeconds)) return saved;
  if (book.chapterId === chapterId && Number.isFinite(book.positionSeconds)) {
    return {
      positionSeconds: book.positionSeconds,
      chapterDurationSeconds: book.chapterDurationSeconds ?? null,
      updatedAt: book.updatedAt,
    };
  }
  return null;
}

function resumeSeconds(saved) {
  if (!saved || !Number.isFinite(saved.positionSeconds)) return 0;
  const pos = saved.positionSeconds;
  const dur = saved.chapterDurationSeconds;
  if (dur > 0 && pos >= dur - 2) return 0;
  return pos;
}

function saveProgress(bookId, chapterId, positionSeconds, chapterDurationSeconds) {
  const all = loadProgress();
  const previous = all[bookId] || {};
  const chapters = { ...(previous.chapters || {}) };
  // Keep the old single-slot chapter when switching, so Part 3 is not wiped by Part 2.
  if (
    previous.chapterId &&
    previous.chapterId !== chapterId &&
    !chapters[previous.chapterId] &&
    Number.isFinite(previous.positionSeconds)
  ) {
    chapters[previous.chapterId] = {
      positionSeconds: previous.positionSeconds,
      chapterDurationSeconds: previous.chapterDurationSeconds ?? null,
      updatedAt: previous.updatedAt || new Date().toISOString(),
    };
  }
  const prevChapter = chapters[chapterId] || {};
  let duration = null;
  if (Number.isFinite(chapterDurationSeconds) && chapterDurationSeconds > 0) {
    duration = chapterDurationSeconds;
  } else {
    duration =
      prevChapter.chapterDurationSeconds ??
      (previous.chapterId === chapterId ? previous.chapterDurationSeconds : null) ??
      null;
  }
  const pos = Math.round(Math.max(0, positionSeconds) * 100) / 100;
  const now = new Date().toISOString();
  chapters[chapterId] = {
    positionSeconds: pos,
    chapterDurationSeconds: duration,
    updatedAt: now,
  };
  all[bookId] = {
    chapterId,
    positionSeconds: pos,
    chapterDurationSeconds: duration,
    updatedAt: now,
    chapters,
  };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}

function revokeAllUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

function fileUrl(file) {
  const url = URL.createObjectURL(file);
  objectUrls.add(url);
  return url;
}

function normalizeRelPath(path) {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function pathParts(path) {
  return normalizeRelPath(path)
    .split("/")
    .filter((p) => p && p !== ".");
}

function shouldSkipPath(parts) {
  return parts.some(
    (p) => p.startsWith("_") || SKIP_FOLDERS.has(p.toLowerCase())
  );
}

/**
 * Walk a directory handle (File System Access API).
 * Skip unreadable / not-downloaded iCloud files instead of failing the whole scan.
 * @param {FileSystemDirectoryHandle} dir
 * @param {string[]} prefix
 */
async function walkDirectory(dir, prefix = []) {
  /** @type {{ path: string, file: File }[]} */
  const out = [];
  let skipped = 0;
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue;
    const next = [...prefix, name];
    if (handle.kind === "directory") {
      if (SKIP_FOLDERS.has(name.toLowerCase()) || name.startsWith("_")) continue;
      try {
        const nested = await walkDirectory(handle, next);
        out.push(...nested.entries);
        skipped += nested.skipped;
      } catch {
        skipped += 1;
      }
    } else if (handle.kind === "file") {
      try {
        const file = await handle.getFile();
        // Cloud-only placeholders often come through as empty.
        if (!file || (AUDIO_EXT.has(extOf(file.name)) && file.size === 0)) {
          skipped += 1;
          continue;
        }
        out.push({ path: next.join("/"), file });
      } catch {
        skipped += 1;
      }
    }
  }
  return { entries: out, skipped };
}

/**
 * Guess collection/book folders from a relative path.
 * Supports Library/Collection/listen/Book/file and shorter picks.
 */
function locateBookPath(parts) {
  const listenIdx = parts.map((p) => p.toLowerCase()).lastIndexOf("listen");
  if (listenIdx >= 0) {
    const collectionFolder = listenIdx > 0 ? parts[listenIdx - 1] : "Library";
    const rest = parts.slice(listenIdx + 1);
    if (rest.length === 0) return null;
    if (rest.length === 1) {
      const bookFolder = collectionFolder === "Immune" ? "immune" : slug(collectionFolder);
      return { collectionFolder, bookFolder };
    }
    return { collectionFolder, bookFolder: rest[0] };
  }
  // Picked a collection root that contains book folders of audio (no listen/ segment).
  if (parts.length >= 2) {
    return { collectionFolder: parts[0], bookFolder: parts[1] };
  }
  return { collectionFolder: "Imported", bookFolder: "imported" };
}

/**
 * Build audiobooks from flat path+file list.
 * @param {{ path: string, file: File }[]} entries
 */
function buildLibrary(entries) {
  const usable = entries.filter((e) => {
    const parts = pathParts(e.path || e.file?.name || "");
    if (shouldSkipPath(parts)) return false;
    const ext = extOf(e.file.name);
    if (!(AUDIO_EXT.has(ext) || COVER_EXT.has(ext))) return false;
    if (AUDIO_EXT.has(ext) && e.file.size === 0) return false;
    return true;
  });

  /** @type {Map<string, { collectionFolder: string, bookFolder: string, files: { path: string, file: File }[] }>} */
  const groups = new Map();

  for (const entry of usable) {
    const parts = pathParts(entry.path || entry.file.name);
    const located = locateBookPath(parts);
    if (!located) continue;
    const { collectionFolder, bookFolder } = located;

    const key = `${collectionFolder}::${bookFolder}`;
    if (!groups.has(key)) {
      groups.set(key, { collectionFolder, bookFolder, files: [] });
    }
    groups.get(key).files.push(entry);
  }

  const books = [];
  for (const group of groups.values()) {
    const collection = collectionMeta(group.collectionFolder);
    const meta = bookMeta(group.bookFolder, collection.author);
    const audioFiles = group.files
      .filter((f) => AUDIO_EXT.has(extOf(f.file.name)))
      .sort((a, b) =>
        a.file.name.localeCompare(b.file.name, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    if (!audioFiles.length) continue;

    const coverEntry = group.files.find((f) => {
      const ext = extOf(f.file.name);
      if (!COVER_EXT.has(ext)) return false;
      const n = f.file.name.toLowerCase();
      return n.includes("cover") || n.includes("folder") || true;
    });
    // Prefer names that look like covers
    const covers = group.files.filter((f) => COVER_EXT.has(extOf(f.file.name)));
    covers.sort((a, b) => {
      const score = (name) => {
        const n = name.toLowerCase();
        if (n.includes("cover")) return 0;
        if (n.includes("folder")) return 1;
        return 2;
      };
      return score(a.file.name) - score(b.file.name);
    });
    const coverFile = covers[0]?.file || coverEntry?.file || null;

    const chapters = audioFiles.map((f, index) => ({
      id: f.file.name,
      index,
      title: titleFromFilename(f.file.name),
      file: f.file,
      url: null,
    }));

    const id = `${collection.id}/${slug(group.bookFolder)}`;
    books.push({
      id,
      collectionId: collection.id,
      collectionTitle: collection.title,
      folder: group.bookFolder,
      title: meta.title,
      subtitle: meta.subtitle,
      author: meta.author,
      coverFile,
      coverUrl: null,
      chapters,
    });
  }

  return books.sort((a, b) => {
    const c = a.collectionTitle.localeCompare(b.collectionTitle);
    if (c) return c;
    return a.title.localeCompare(b.title);
  });
}

async function scanDirectoryHandle(handle) {
  const { entries, skipped } = await walkDirectory(handle);
  return { books: buildLibrary(entries), entries, skipped, handle };
}

async function pickWithDirectoryPicker() {
  const handle = await window.showDirectoryPicker({ mode: "read", id: "library" });
  return scanDirectoryHandle(handle);
}

/** Re-open the remembered folder; must run inside a user gesture unless already granted. */
async function reopenSavedDirectory({ prompt }) {
  const handle = savedDirHandle;
  if (!handle?.queryPermission) return null;
  let permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted" && prompt) {
    permission = await handle.requestPermission({ mode: "read" });
  }
  if (permission !== "granted") return null;
  return scanDirectoryHandle(handle);
}

function pickWithInput(input) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onWindowFocus);
      input.onchange = null;
      fn(value);
    };

    input.onchange = () => {
      const files = [...(input.files || [])];
      if (!files.length) {
        finish(reject, Object.assign(new Error("No files selected"), { name: "AbortError" }));
        return;
      }
      const entries = files.map((file) => ({
        path: file.webkitRelativePath || file.name,
        file,
      }));
      finish(resolve, {
        books: buildLibrary(entries),
        entries,
        skipped: entries.filter((e) => AUDIO_EXT.has(extOf(e.file.name)) && e.file.size === 0).length,
      });
    };

    // User cancelled the sheet — focus returns without a change event.
    const onWindowFocus = () => {
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          finish(reject, Object.assign(new Error("Cancelled"), { name: "AbortError" }));
        }
      }, 700);
    };
    window.addEventListener("focus", onWindowFocus);
    try {
      input.value = "";
    } catch {
      /* iOS may ignore */
    }
    input.click();
  });
}

function setScanning(active) {
  document.body.classList.toggle("is-scanning", active);
  const hint = els.capabilityHint;
  if (!hint) return;
  if (active) {
    hint.dataset.prev = hint.textContent || "";
    hint.textContent = "Scanning Library… if this is iCloud, wait for Download Now to finish.";
  } else if (hint.dataset.prev != null) {
    hint.textContent = hint.dataset.prev;
    delete hint.dataset.prev;
  }
}

function emptyLibraryMessage(entries, skipped) {
  const audio = (entries || []).filter((e) => AUDIO_EXT.has(extOf(e.file.name)));
  const samples = audio
    .slice(0, 3)
    .map((e) => e.path || e.file.name)
    .join("\n");
  let msg =
    "No audiobooks found.\n\n" +
    `Files seen: ${entries?.length || 0} (audio: ${audio.length}` +
    (skipped ? `, skipped/unread: ${skipped}` : "") +
    ").\n\n" +
    "Pick the Library folder (or 門羅-WhatIf / Immune / 上學不容易) that contains listen/ with mp3/m4b.\n" +
    "On iPhone/iPad: in Files, tap Download Now on listen/ first.";
  if (samples) msg += `\n\nSample paths:\n${samples}`;
  return msg;
}

/**
 * @param {"directory" | "files" | "reconnect" | "auto"} mode
 *   reconnect: remembered folder (with permission prompt), else the picker.
 *   auto: remembered folder only if permission is already granted; silent otherwise.
 */
async function loadLibrary(mode) {
  const silent = mode === "auto";
  setScanning(true);
  try {
    let result = null;
    if (!savedDirHandle && silent) return;
    // No await before the file input on iOS, or Safari drops the tap gesture.
    if (savedDirHandle && (mode === "reconnect" || mode === "auto")) {
      result = await reopenSavedDirectory({ prompt: mode === "reconnect" }).catch(() => null);
      if (!result && silent) return;
    }
    if (!result) {
      if (mode === "files") {
        result = await pickWithInput(els.fileInputFiles);
      } else if (typeof window.showDirectoryPicker === "function") {
        result = await pickWithDirectoryPicker();
      } else {
        result = await pickWithInput(els.fileInputDir);
      }
    }

    const scanned = result.books || [];
    const entries = result.entries || [];
    const skipped = result.skipped || 0;

    if (!scanned.length) {
      if (!silent) alert(emptyLibraryMessage(entries, skipped));
      return;
    }
    if (result.handle) await rememberDirectory(result.handle);

    // Books saved on this device stay on the shelf even if this pick did not include them.
    const scannedIds = new Set(scanned.map((b) => b.id));
    const kept = state.books.filter((b) => !scannedIds.has(b.id) && isBookOffline(b));
    const books = [...scanned, ...kept];

    const keepPlayback =
      !!playback && !audio.paused && books.some((b) => b.id === playback.bookId);
    if (!keepPlayback) {
      audio.pause();
      audio.removeAttribute("src");
      playback = null;
    }
    const currentSrc = keepPlayback ? audio.src : null;
    if (currentSrc) objectUrls.delete(currentSrc);
    attachUrls(books);
    if (currentSrc) {
      const book = findBookIn(books, playback.bookId);
      const ch = book?.chapters[playback.chapterIndex];
      if (ch) {
        objectUrls.delete(ch.url);
        URL.revokeObjectURL(ch.url);
        ch.url = currentSrc;
        objectUrls.add(currentSrc);
      }
    }

    state.books = books;
    if (!silent) state.activeBookId = null;
    saveLibrarySnapshot();
    render();
  } catch (err) {
    if (silent || err?.name === "AbortError") return;
    console.error(err);
    alert(
      (err?.message || "Could not open the folder.") +
        "\n\nIf this is iCloud: Download Now on the Library/listen folders, then try again."
    );
  } finally {
    setScanning(false);
  }
}

function sortedBooks() {
  const books = [...state.books];
  const progress = loadProgress();
  if (state.sort === "title") {
    return books.sort((a, b) => a.title.localeCompare(b.title));
  }
  if (state.sort === "author") {
    return books.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
  }
  if (state.sort === "recent") {
    return books.sort((a, b) => {
      const ta = progress[a.id]?.updatedAt || "";
      const tb = progress[b.id]?.updatedAt || "";
      return tb.localeCompare(ta) || a.title.localeCompare(b.title);
    });
  }
  return books.sort(
    (a, b) =>
      a.collectionTitle.localeCompare(b.collectionTitle) ||
      a.title.localeCompare(b.title)
  );
}

function progressLine(book) {
  const p = loadProgress()[book.id];
  if (!p) return { line: "Not started", fraction: null };
  const chapter =
    book.chapters.find((c) => c.id === p.chapterId) || book.chapters[0];
  if (!chapter) return { line: "Not started", fraction: null };
  const pos = p.positionSeconds || 0;
  const dur = p.chapterDurationSeconds;
  let line = `${chapter.title} · ${formatClock(pos)}`;
  if (dur > 0) line += ` / ${formatClock(dur)}`;
  if (p.updatedAt) line += ` · ${relativeTime(p.updatedAt)}`;
  const fraction = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : null;
  return { line, fraction };
}

const COVER_PALETTES = [
  ["#6b3f1f", "#1c1410"],
  ["#2f4f4f", "#121c1c"],
  ["#4a3b6b", "#16121f"],
  ["#3d4f2f", "#12180f"],
  ["#6b2f3a", "#1c1014"],
  ["#2f456b", "#10161f"],
];

function coverPalette(bookId) {
  let h = 0;
  for (const ch of bookId || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_PALETTES[h % COVER_PALETTES.length];
}

function coverInitials(book) {
  const title = (book?.title || "?").trim();
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return title.slice(0, 2).toUpperCase();
}

function setCover(el, book) {
  if (!el) return;
  el.querySelector(".cover-initials")?.remove();
  el.style.removeProperty("--cover-a");
  el.style.removeProperty("--cover-b");

  if (book?.coverUrl) {
    el.style.backgroundImage = `url("${book.coverUrl}")`;
    el.classList.add("has-image");
    el.classList.remove("placeholder");
    return;
  }

  el.style.backgroundImage = "";
  el.classList.remove("has-image");
  el.classList.add("placeholder");
  const [a, b] = coverPalette(book?.id);
  el.style.setProperty("--cover-a", a);
  el.style.setProperty("--cover-b", b);
  const mark = document.createElement("span");
  mark.className = "cover-initials";
  mark.textContent = coverInitials(book);
  el.appendChild(mark);
}

function renderShelf() {
  const books = sortedBooks();
  els.shelf.innerHTML = "";
  if (!books.length) return;

  if (state.sort === "collection") {
    let last = null;
    for (const book of books) {
      if (book.collectionTitle !== last) {
        last = book.collectionTitle;
        const h = document.createElement("h3");
        h.className = "shelf-group-title";
        h.textContent = last;
        els.shelf.appendChild(h);
      }
      els.shelf.appendChild(bookCard(book));
    }
  } else {
    for (const book of books) els.shelf.appendChild(bookCard(book));
  }
}

function bookCard(book) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "book-card";
  const cover = document.createElement("div");
  cover.className = "cover";
  setCover(cover, book);
  const body = document.createElement("div");
  const { line, fraction } = progressLine(book);
  body.innerHTML = `
    <p class="title"></p>
    <p class="meta"></p>
    <p class="progress"></p>
    <div class="progress-track"><span></span></div>
  `;
  body.querySelector(".title").textContent = book.title;
  let meta = `${book.author} · ${book.chapters.length} chapters`;
  if (isBookOffline(book)) meta += " · on device";
  else if (!isBookPlayable(book)) meta += " · reconnect to play";
  body.querySelector(".meta").textContent = meta;
  btn.classList.toggle("unavailable", !isBookPlayable(book));
  body.querySelector(".progress").textContent = line;
  const bar = body.querySelector(".progress-track > span");
  if (fraction == null) {
    body.querySelector(".progress-track").style.display = "none";
  } else {
    bar.style.width = `${Math.round(fraction * 100)}%`;
  }
  btn.append(cover, body);
  btn.addEventListener("click", () => openBook(book.id));
  return btn;
}

function openBook(bookId) {
  if (state.activeBookId !== bookId) state.bookPane = "audio";
  state.activeBookId = bookId;
  render();
}

function isImmuneBook(book) {
  return book?.collectionId === "immune" || String(book?.id || "").startsWith("immune/");
}

function renderConceptCards() {
  if (els.conceptList.childElementCount) return;
  const note = document.createElement("p");
  note.className = "concept-note";
  note.textContent =
    "配合聽 Immune 的原創筆記，講的是免疫學常識。不是書的原文，也不是書裡的插圖。音檔照常播放。";
  els.conceptList.appendChild(note);
  for (const card of IMMUNE_CARDS) {
    const article = document.createElement("article");
    article.className = "concept-card";
    const img = document.createElement("img");
    img.src = `./concepts/immune/${card.file}`;
    img.alt = card.alt;
    img.width = 800;
    img.height = 800;
    const heading = document.createElement("h3");
    heading.textContent = card.title;
    const en = document.createElement("p");
    en.className = "concept-en";
    en.textContent = card.en;
    const zh = document.createElement("p");
    zh.textContent = card.zh;
    article.append(img, heading, en, zh);
    els.conceptList.appendChild(article);
  }
}

function renderBook() {
  const book = state.books.find((b) => b.id === state.activeBookId);
  if (!book) return;
  setCover(document.getElementById("book-cover"), book);
  document.getElementById("book-collection").textContent = book.collectionTitle;
  document.getElementById("book-title").textContent = book.title;
  document.getElementById("book-author").textContent = book.author;
  document.getElementById("book-subtitle").textContent = book.subtitle || "";
  updateOfflineButton(book);

  els.chapterList.innerHTML = "";
  book.chapters.forEach((ch, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const active =
      playback?.bookId === book.id && playback.chapterIndex === i;
    if (active) btn.classList.add("active");
    btn.innerHTML = `
      <span class="idx">${String(i + 1).padStart(2, "0")}</span>
      <span class="ch-title"></span>
      <span class="ch-time"></span>
    `;
    btn.querySelector(".ch-title").textContent = ch.title;
    const saved = chapterProgress(book.id, ch.id);
    const shown = saved?.positionSeconds || 0;
    btn.querySelector(".ch-time").textContent =
      shown > 0.5 ? formatClock(shown) : "";
    btn.addEventListener("click", () => playChapter(book.id, i, { resumeIfSame: true }));
    li.appendChild(btn);
    els.chapterList.appendChild(li);
  });

  const concepts = isImmuneBook(book);
  const showConcepts = concepts && state.bookPane === "concepts";
  document.getElementById("book-tabs").classList.toggle("hidden", !concepts);
  document.getElementById("tab-audio").setAttribute("aria-pressed", showConcepts ? "false" : "true");
  document.getElementById("tab-concepts").setAttribute("aria-pressed", showConcepts ? "true" : "false");
  els.chapterList.classList.toggle("hidden", showConcepts);
  els.conceptList.classList.toggle("hidden", !showConcepts);
  if (showConcepts) renderConceptCards();
}

function render() {
  const hasBooks = state.books.length > 0;
  els.onboarding.classList.toggle("hidden", hasBooks && !state.activeBookId);
  // Keep onboarding hidden when shelf or book shown
  if (hasBooks) els.onboarding.classList.add("hidden");
  els.shelf.classList.toggle("hidden", !hasBooks || !!state.activeBookId);
  els.book.classList.toggle("hidden", !state.activeBookId);
  document.getElementById("btn-sort").classList.toggle("hidden", !hasBooks);
  document.getElementById("btn-change").classList.toggle("hidden", !hasBooks);
  updateChangeButtonLabel();

  if (hasBooks && !state.activeBookId) renderShelf();
  if (state.activeBookId) renderBook();
  updatePlayerBar();
}

function findBookIn(books, id) {
  return books.find((b) => b.id === id);
}

function findBook(id) {
  return findBookIn(state.books, id);
}

function resumeTarget(seconds) {
  const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (dur > 0) return Math.min(seconds, Math.max(0, dur - 0.25));
  return Math.max(0, seconds);
}

function applyPlaybackPosition(seconds) {
  try {
    audio.currentTime = seconds;
  } catch {
    /* not seekable yet */
  }
}

function beginResumeGuard(token, resumeAt) {
  if (!(resumeAt > 0.5)) {
    resumeGuard = null;
    return;
  }
  resumeGuard = {
    token,
    resumeAt,
    until: performance.now() + 3000,
  };
}

function clearResumeGuard() {
  resumeGuard = null;
}

/** Re-seek when the engine snaps near 0 after a resume (common with blob/Safari). */
function maybeFixResumeSnap() {
  if (!resumeGuard || resumeGuard.token !== playToken) {
    clearResumeGuard();
    return;
  }
  if (performance.now() > resumeGuard.until) {
    clearResumeGuard();
    return;
  }
  const target = resumeGuard.resumeAt;
  const t = audio.currentTime || 0;
  if (t + 1.0 < target) {
    applyPlaybackPosition(resumeTarget(target));
    return;
  }
  // Close enough — stop guarding so normal progress saves resume.
  if (t >= target - 0.75) clearResumeGuard();
}

function clampTime(seconds) {
  const dur = Number.isFinite(audio.duration) ? audio.duration : null;
  let next = Math.max(0, seconds);
  if (dur != null && dur > 0) next = Math.min(next, dur);
  return next;
}

function seekWithin(seconds) {
  if (!playback) return;
  applyPlaybackPosition(clampTime(seconds));
  persistCurrent();
  updatePlayerBar();
}

function seekBy(delta) {
  seekWithin((audio.currentTime || 0) + delta);
}

function skipToPrevious() {
  if (!playback) return;
  if ((audio.currentTime || 0) > 3) {
    seekWithin(0);
    return;
  }
  if (playback.chapterIndex <= 0) return;
  playChapter(playback.bookId, playback.chapterIndex - 1, { forceStart: true });
}

function skipToNext() {
  if (!playback) return;
  const book = findBook(playback.bookId);
  if (!book || playback.chapterIndex >= book.chapters.length - 1) return;
  playChapter(playback.bookId, playback.chapterIndex + 1, { forceStart: true });
}

function coverMime(file) {
  if (file?.type) return file.type;
  const ext = extOf(file?.name || "");
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function updatePositionState() {
  if (!("mediaSession" in navigator)) return;
  if (typeof navigator.mediaSession.setPositionState !== "function") return;
  if (!playback) return;
  const dur = audio.duration;
  if (!Number.isFinite(dur) || dur <= 0) return;
  const pos = Math.min(Math.max(0, audio.currentTime || 0), dur);
  try {
    navigator.mediaSession.setPositionState({
      duration: dur,
      playbackRate: audio.playbackRate || 1,
      position: pos,
    });
  } catch {
    /* some browsers reject the state while metadata is in flux */
  }
}

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !playback) return;
  const book = findBook(playback.bookId);
  const chapter = book?.chapters[playback.chapterIndex];
  if (!book || !chapter) return;
  const base = {
    title: chapter.title,
    artist: book.author,
    album: book.title,
  };
  const assign = (metadata) => {
    navigator.mediaSession.metadata = metadata;
  };
  try {
    if (book.coverUrl) {
      assign(
        new MediaMetadata({
          ...base,
          artwork: [
            {
              src: book.coverUrl,
              sizes: "512x512",
              type: coverMime(book.coverFile),
            },
          ],
        })
      );
    } else {
      assign(new MediaMetadata(base));
    }
  } catch {
    try {
      assign(new MediaMetadata(base));
    } catch {
      /* ignore */
    }
  }
  try {
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  } catch {
    /* ignore */
  }
  updatePositionState();
}

async function playChapter(bookId, chapterIndex, { resumeIfSame = false, forceStart = false } = {}) {
  const book = findBook(bookId);
  if (!book) return;
  const chapter = book.chapters[chapterIndex];
  if (!chapter) return;
  if (!chapter.url) {
    loadLibrary("reconnect");
    return;
  }

  const same =
    playback?.bookId === bookId && playback.chapterIndex === chapterIndex;
  if (same && resumeIfSame && !forceStart) {
    if (audio.paused) await audio.play().catch(() => {});
    updatePlayerBar();
    updateMediaSession();
    return;
  }

  if (playback) persistCurrent();

  const token = ++playToken;
  playback = { bookId, chapterIndex };
  detachChapterMeta?.();

  const saved = chapterProgress(bookId, chapter.id);
  const resumeAt = forceStart ? 0 : resumeSeconds(saved);
  const shouldResume = resumeAt > 0.5;

  const applyPosition = () => {
    if (token !== playToken) return;
    applyPlaybackPosition(shouldResume ? resumeTarget(resumeAt) : 0);
  };

  if (shouldResume) beginResumeGuard(token, resumeAt);
  else clearResumeGuard();

  // Listener before src so a cached file cannot miss loadedmetadata.
  const onMeta = () => {
    detach();
    applyPosition();
    maybeFixResumeSnap();
  };
  const detach = () => {
    audio.removeEventListener("loadedmetadata", onMeta);
    if (detachChapterMeta === detach) detachChapterMeta = null;
  };
  detachChapterMeta = detach;
  audio.addEventListener("loadedmetadata", onMeta);
  audio.src = chapter.url;
  applyPlaybackRate();
  if (audio.readyState >= 1) applyPosition();

  const onPlaying = () => {
    audio.removeEventListener("playing", onPlaying);
    if (token !== playToken) return;
    maybeFixResumeSnap();
  };
  audio.addEventListener("playing", onPlaying);

  try {
    // No await before play(): iOS drops the user-gesture if we wait.
    const pending = audio.play();
    if (pending) await pending;
  } catch (err) {
    console.warn("play blocked", err);
  }
  if (token !== playToken) return;

  maybeFixResumeSnap();
  // One more pass shortly after play — engines often snap after the first frame.
  if (shouldResume) {
    window.setTimeout(() => {
      if (token === playToken) maybeFixResumeSnap();
    }, 120);
    window.setTimeout(() => {
      if (token === playToken) maybeFixResumeSnap();
    }, 400);
  }

  els.playerBar.classList.remove("hidden");
  updatePlayerBar();
  updateMediaSession();
  if (state.activeBookId === bookId) renderBook();
}

function persistCurrent() {
  if (!playback) return;
  // While correcting a resume snap, do not overwrite the good saved position.
  if (resumeGuard && resumeGuard.token === playToken) {
    const t = audio.currentTime || 0;
    if (t + 1.0 < resumeGuard.resumeAt) return;
  }
  const book = findBook(playback.bookId);
  const chapter = book?.chapters[playback.chapterIndex];
  if (!chapter) return;
  saveProgress(
    book.id,
    chapter.id,
    audio.currentTime || 0,
    Number.isFinite(audio.duration) ? audio.duration : null
  );
  updateChapterTimes();
}

function updateChapterTimes() {
  if (!state.activeBookId) return;
  const book = findBook(state.activeBookId);
  if (!book) return;
  const buttons = els.chapterList.querySelectorAll("button");
  book.chapters.forEach((ch, i) => {
    const el = buttons[i]?.querySelector(".ch-time");
    if (!el) return;
    const saved = chapterProgress(book.id, ch.id);
    const shown = saved?.positionSeconds || 0;
    el.textContent = shown > 0.5 ? formatClock(shown) : "";
  });
}

function writeSeekBar(pos, dur) {
  const seek = document.getElementById("player-seek");
  ignoreSeekInput += 1;
  if (dur > 0) {
    seek.max = String(Math.round(dur * 1000));
    seek.value = String(Math.round(pos * 1000));
  } else {
    seek.max = "1000";
    seek.value = "0";
  }
  ignoreSeekInput -= 1;
}

function updatePlayerBar() {
  if (!playback) {
    els.playerBar.classList.add("hidden");
    return;
  }
  const book = findBook(playback.bookId);
  const chapter = book?.chapters[playback.chapterIndex];
  if (!book || !chapter) return;

  els.playerBar.classList.remove("hidden");
  setCover(document.getElementById("player-cover"), book);
  document.getElementById("player-title").textContent = book.title;
  document.getElementById("player-chapter").textContent = chapter.title;
  document
    .getElementById("btn-play")
    .classList.toggle("is-paused", audio.paused);

  const pos = audio.currentTime || 0;
  const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
  document.getElementById("player-pos").textContent = formatClock(pos);
  document.getElementById("player-dur").textContent = formatClock(dur);
  if (!seekDragging) writeSeekBar(pos, dur);

  const atStart = (audio.currentTime || 0) <= 3;
  document.getElementById("btn-prev").disabled = playback.chapterIndex <= 0 && atStart;
  document.getElementById("btn-next").disabled =
    playback.chapterIndex >= book.chapters.length - 1;
  updatePositionState();
}

function cycleSort() {
  const order = ["collection", "title", "author", "recent"];
  const i = order.indexOf(state.sort);
  state.sort = order[(i + 1) % order.length];
  localStorage.setItem(SORT_KEY, state.sort);
  document.getElementById("btn-sort").textContent = `Sort: ${state.sort}`;
  if (!state.activeBookId) renderShelf();
}

function setupCapabilityHint() {
  const pickMain = document.getElementById("btn-pick-main");
  const pickFilesBtn = document.getElementById("btn-pick-files");
  pickMain?.classList.remove("hidden");
  pickFilesBtn?.classList.remove("primary");
  pickFilesBtn?.classList.add("ghost");

  if (typeof window.showDirectoryPicker === "function") {
    els.capabilityHint.textContent =
      "Choose Library folder, then pick Library or a collection (門羅-WhatIf / Immune). On iPhone/iPad, pick the folder in Files after Download Now.";
  } else {
    els.capabilityHint.textContent =
      "Choose Library folder to select a folder (works in Files on iPhone/iPad and desktop). Or use Choose audio files to pick files one by one.";
  }
}

function updateChangeButtonLabel() {
  const btn = document.getElementById("btn-change");
  if (!btn) return;
  if (state.books.some((b) => !isBookPlayable(b))) {
    btn.textContent = "Reconnect Library";
    btn.title = "Pick the Library folder again to play every book";
  } else {
    btn.textContent = "Change folder";
    btn.title = "Pick a different Library folder";
  }
}

function bindMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const setHandler = (name, fn) => {
    try {
      navigator.mediaSession.setActionHandler(name, fn);
    } catch {
      /* this action is not supported */
    }
  };
  setHandler("play", () => {
    audio.play().catch(() => {});
  });
  setHandler("pause", () => audio.pause());
  setHandler("previoustrack", () => skipToPrevious());
  setHandler("nexttrack", () => skipToNext());
  setHandler("seekbackward", (details) => {
    seekBy(-(details?.seekOffset || SKIP_SECONDS));
  });
  setHandler("seekforward", (details) => {
    seekBy(details?.seekOffset || SKIP_SECONDS);
  });
  setHandler("seekto", (details) => {
    if (typeof details?.seekTime === "number" && Number.isFinite(details.seekTime)) {
      seekWithin(details.seekTime);
    }
  });
}

function bind() {
  const pickDirectory = () => loadLibrary("directory");
  const pickFiles = () => loadLibrary("files");

  // Always try a real folder chooser first (showDirectoryPicker or webkitdirectory).
  // Do not special-case iPhone/iPad — folder pick works there via Files.
  document.getElementById("btn-change").addEventListener("click", () => {
    const needsReconnect = state.books.some((b) => !isBookPlayable(b));
    loadLibrary(needsReconnect ? "reconnect" : "directory");
  });
  document.getElementById("btn-pick-main").addEventListener("click", pickDirectory);
  document.getElementById("btn-offline").addEventListener("click", async () => {
    const book = findBook(state.activeBookId);
    if (!book || savingBookId) return;
    if (isBookOffline(book)) {
      if (!confirm(`Remove the saved copy of “${book.title}” from this device?`)) return;
      await removeBookOffline(book).catch(() => {});
      for (const ch of book.chapters) {
        if (!ch.fromDevice) continue;
        ch.file = null;
        ch.url = null;
        ch.fromDevice = false;
      }
      render();
      return;
    }
    await saveBookOffline(book);
  });
  document.getElementById("btn-pick-files").addEventListener("click", pickFiles);
  document.getElementById("btn-back").addEventListener("click", () => {
    state.activeBookId = null;
    render();
  });
  document.getElementById("tab-audio").addEventListener("click", () => {
    state.bookPane = "audio";
    renderBook();
  });
  document.getElementById("tab-concepts").addEventListener("click", () => {
    state.bookPane = "concepts";
    renderBook();
  });
  document.getElementById("btn-sort").addEventListener("click", cycleSort);
  document.getElementById("btn-play").addEventListener("click", async () => {
    if (!playback) {
      const first = state.books[0];
      if (!first) return;
      const p = loadProgress()[first.id];
      const idx = Math.max(
        0,
        first.chapters.findIndex((c) => c.id === p?.chapterId)
      );
      await playChapter(first.id, idx === -1 ? 0 : idx, { resumeIfSame: true });
      return;
    }
    if (audio.paused) await audio.play().catch(() => {});
    else audio.pause();
    updatePlayerBar();
  });
  document.getElementById("btn-prev").addEventListener("click", () => skipToPrevious());
  document.getElementById("btn-next").addEventListener("click", () => skipToNext());
  document.getElementById("btn-back30").addEventListener("click", () => seekBy(-SKIP_SECONDS));
  document.getElementById("btn-fwd30").addEventListener("click", () => seekBy(SKIP_SECONDS));
  document.getElementById("btn-rate").addEventListener("click", () => cycleRate());

  const seek = document.getElementById("player-seek");
  seek.addEventListener("pointerdown", () => {
    seekDragging = true;
  });
  seek.addEventListener("pointerup", () => {
    seekDragging = false;
  });
  seek.addEventListener("input", () => {
    if (ignoreSeekInput) return;
    const dur = audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const max = Number(seek.max);
    if (!Number.isFinite(max) || Math.abs(max - dur * 1000) > 50) return;
    audio.currentTime = Number(seek.value) / 1000;
    updatePlayerBar();
  });
  seek.addEventListener("change", () => {
    persistCurrent();
    seekDragging = false;
  });

  audio.addEventListener("timeupdate", () => {
    maybeFixResumeSnap();
    updatePlayerBar();
    if (!audio.paused) {
      // throttle-ish via seconds bucket
      const t = Math.floor(audio.currentTime);
      if (audio._lastSavedSec !== t) {
        audio._lastSavedSec = t;
        persistCurrent();
      }
    }
  });
  audio.addEventListener("pause", () => {
    persistCurrent();
    updatePlayerBar();
    updateMediaSession();
  });
  audio.addEventListener("play", () => {
    applyPlaybackRate();
    updatePlayerBar();
    updateMediaSession();
  });
  audio.addEventListener("durationchange", updatePlayerBar);
  audio.addEventListener("ended", () => {
    persistCurrent();
    if (!playback) return;
    const book = findBook(playback.bookId);
    if (!book) return;
    const next = playback.chapterIndex + 1;
    if (next < book.chapters.length) {
      playChapter(book.id, next, { forceStart: true });
    } else {
      updatePlayerBar();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistCurrent();
  });

  bindMediaSession();
  applyPlaybackRate();
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function showPlayableBooks(books) {
  const playable = books.filter(isBookPlayable);
  attachUrls(playable);
  state.books = playable;
  state.activeBookId = null;
  render();
  return playable.length > 0;
}

async function restoreSession() {
  try {
    await loadOfflineIndex();
  } catch {
    /* IndexedDB unavailable (private mode) */
  }
  savedDirHandle = await loadSavedDirectory();
  if (savedDirHandle) {
    await loadLibrary("auto");
    if (state.books.some(isBookPlayable)) return;
  }
  const restored = restoreLibrarySnapshot();
  if (showPlayableBooks(restored)) return;
  if (restored.length && els.capabilityHint) {
    els.capabilityHint.textContent =
      "Pick the Library folder again to keep listening. Your progress is still here.";
  }
}

setupCapabilityHint();
document.getElementById("btn-sort").textContent = `Sort: ${state.sort}`;
bind();
render();
registerSW();
restoreSession();
