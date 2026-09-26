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

/** @type {{ books: any[], activeBookId: string|null, sort: string }} */
const state = {
  books: [],
  activeBookId: null,
  sort: localStorage.getItem(SORT_KEY) || "collection",
};

const audio = document.getElementById("audio");
const els = {
  onboarding: document.getElementById("onboarding"),
  shelf: document.getElementById("shelf"),
  book: document.getElementById("book"),
  chapterList: document.getElementById("chapter-list"),
  playerBar: document.getElementById("player-bar"),
  capabilityHint: document.getElementById("capability-hint"),
  fileInputDir: document.getElementById("file-input-dir"),
  fileInputFiles: document.getElementById("file-input-files"),
};

/** @type {{ bookId: string, chapterIndex: number } | null} */
let playback = null;
let seekDragging = false;
const objectUrls = new Set();

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

function saveProgress(bookId, chapterId, positionSeconds, chapterDurationSeconds) {
  const all = loadProgress();
  const previous = all[bookId];
  let duration = null;
  if (Number.isFinite(chapterDurationSeconds) && chapterDurationSeconds > 0) {
    duration = chapterDurationSeconds;
  } else if (previous?.chapterId === chapterId) {
    duration = previous.chapterDurationSeconds ?? null;
  }
  all[bookId] = {
    chapterId,
    positionSeconds: Math.round(Math.max(0, positionSeconds) * 100) / 100,
    chapterDurationSeconds: duration,
    updatedAt: new Date().toISOString(),
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
 * @param {FileSystemDirectoryHandle} dir
 * @param {string[]} prefix
 */
async function walkDirectory(dir, prefix = []) {
  /** @type {{ path: string, file: File }[]} */
  const out = [];
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue;
    const next = [...prefix, name];
    if (handle.kind === "directory") {
      if (SKIP_FOLDERS.has(name.toLowerCase()) || name.startsWith("_")) continue;
      out.push(...(await walkDirectory(handle, next)));
    } else if (handle.kind === "file") {
      const file = await handle.getFile();
      out.push({ path: next.join("/"), file });
    }
  }
  return out;
}

/**
 * Build audiobooks from flat path+file list.
 * @param {{ path: string, file: File }[]} entries
 */
function buildLibrary(entries) {
  const usable = entries.filter((e) => {
    const parts = pathParts(e.path);
    if (shouldSkipPath(parts)) return false;
    const ext = extOf(e.file.name);
    return AUDIO_EXT.has(ext) || COVER_EXT.has(ext);
  });

  /** @type {Map<string, { collectionFolder: string, bookFolder: string, files: { path: string, file: File }[] }>} */
  const groups = new Map();

  for (const entry of usable) {
    const parts = pathParts(entry.path);
    const listenIdx = parts.map((p) => p.toLowerCase()).lastIndexOf("listen");
    let collectionFolder;
    let bookFolder;
    let rest;

    if (listenIdx >= 0) {
      collectionFolder =
        listenIdx > 0 ? parts[listenIdx - 1] : "Library";
      rest = parts.slice(listenIdx + 1);
      if (rest.length === 0) continue;
      if (rest.length === 1) {
        // audio directly in listen/ → one book named after collection
        bookFolder = collectionFolder === "Immune" ? "immune" : collectionFolder;
      } else {
        bookFolder = rest[0];
      }
    } else if (parts.length >= 2) {
      // relative pick without "listen" in path: Collection/Book/file
      collectionFolder = parts[0];
      bookFolder = parts[1];
      rest = parts.slice(1);
    } else {
      // flat file pick — put into a single "Imported" book
      collectionFolder = "Imported";
      bookFolder = "imported";
      rest = parts;
    }

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

async function pickWithDirectoryPicker() {
  const handle = await window.showDirectoryPicker({ mode: "read" });
  const entries = await walkDirectory(handle);
  return buildLibrary(entries);
}

function pickWithInput(input) {
  return new Promise((resolve, reject) => {
    input.value = "";
    input.onchange = () => {
      const files = [...(input.files || [])];
      if (!files.length) {
        reject(new Error("No files selected"));
        return;
      }
      const entries = files.map((file) => ({
        path: file.webkitRelativePath || file.name,
        file,
      }));
      resolve(buildLibrary(entries));
    };
    input.click();
  });
}

async function loadLibrary(mode) {
  try {
    let books;
    if (mode === "directory" && typeof window.showDirectoryPicker === "function") {
      books = await pickWithDirectoryPicker();
    } else if (mode === "directory") {
      books = await pickWithInput(els.fileInputDir);
    } else {
      books = await pickWithInput(els.fileInputFiles);
    }

    if (!books.length) {
      alert(
        "No audiobooks found. Pick the Library folder (or 門羅-WhatIf / Immune) that contains a listen/ folder with mp3 / m4b / m4a files."
      );
      return;
    }

    // Drop previous object URLs only after a successful scan.
    revokeAllUrls();
    // Re-bind URLs for the new file set (previous revoke cleared the tracker).
    for (const book of books) {
      for (const ch of book.chapters) {
        ch.url = fileUrl(ch.file);
      }
      if (book.coverFile) book.coverUrl = fileUrl(book.coverFile);
      else book.coverUrl = null;
    }

    state.books = books;
    state.activeBookId = null;
    audio.pause();
    audio.removeAttribute("src");
    playback = null;
    render();
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    alert(err?.message || "Could not open the folder.");
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
  body.querySelector(".meta").textContent = `${book.author} · ${book.chapters.length} chapters`;
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
  state.activeBookId = bookId;
  render();
}

function renderBook() {
  const book = state.books.find((b) => b.id === state.activeBookId);
  if (!book) return;
  setCover(document.getElementById("book-cover"), book);
  document.getElementById("book-collection").textContent = book.collectionTitle;
  document.getElementById("book-title").textContent = book.title;
  document.getElementById("book-author").textContent = book.author;
  document.getElementById("book-subtitle").textContent = book.subtitle || "";

  const progress = loadProgress()[book.id];
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
    const saved =
      progress?.chapterId === ch.id
        ? formatClock(progress.positionSeconds)
        : "";
    btn.querySelector(".ch-time").textContent = saved;
    btn.addEventListener("click", () => playChapter(book.id, i, { resumeIfSame: true }));
    li.appendChild(btn);
    els.chapterList.appendChild(li);
  });
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

  if (hasBooks && !state.activeBookId) renderShelf();
  if (state.activeBookId) renderBook();
  updatePlayerBar();
}

function findBook(id) {
  return state.books.find((b) => b.id === id);
}

async function playChapter(bookId, chapterIndex, { resumeIfSame = false, forceStart = false } = {}) {
  const book = findBook(bookId);
  if (!book) return;
  const chapter = book.chapters[chapterIndex];
  if (!chapter) return;

  const same =
    playback?.bookId === bookId && playback.chapterIndex === chapterIndex;
  if (same && resumeIfSame && !forceStart) {
    if (audio.paused) await audio.play().catch(() => {});
    updatePlayerBar();
    return;
  }

  playback = { bookId, chapterIndex };
  audio.src = chapter.url;

  const progress = loadProgress()[bookId];
  const shouldResume =
    !forceStart &&
    progress?.chapterId === chapter.id &&
    Number.isFinite(progress.positionSeconds);

  const onMeta = () => {
    if (shouldResume) {
      audio.currentTime = Math.min(
        progress.positionSeconds,
        Math.max(0, (audio.duration || 0) - 0.25)
      );
    } else {
      audio.currentTime = 0;
    }
    audio.removeEventListener("loadedmetadata", onMeta);
  };
  audio.addEventListener("loadedmetadata", onMeta);

  try {
    await audio.play();
  } catch (err) {
    console.warn("play blocked", err);
  }

  els.playerBar.classList.remove("hidden");
  updatePlayerBar();
  if (state.activeBookId === bookId) renderBook();
}

function persistCurrent() {
  if (!playback) return;
  const book = findBook(playback.bookId);
  const chapter = book?.chapters[playback.chapterIndex];
  if (!chapter) return;
  saveProgress(
    book.id,
    chapter.id,
    audio.currentTime || 0,
    Number.isFinite(audio.duration) ? audio.duration : null
  );
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
  if (!seekDragging) {
    const seek = document.getElementById("player-seek");
    seek.value = String(dur > 0 ? Math.round((pos / dur) * 1000) : 0);
  }

  document.getElementById("btn-prev").disabled = playback.chapterIndex <= 0;
  document.getElementById("btn-next").disabled =
    playback.chapterIndex >= book.chapters.length - 1;
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
  const hasDirPicker = typeof window.showDirectoryPicker === "function";
  els.capabilityHint.textContent = hasDirPicker
    ? "This browser can open a whole folder. On iPhone Safari, use “Choose audio files” and select the files inside listen/ (Download Now in Files first)."
    : "This browser needs the file picker. On iPhone: Files → download listen/ → Choose audio files → select the chapter files.";
}

function bind() {
  const pickDirectory = () => loadLibrary("directory");
  const pickFiles = () => loadLibrary("files");

  document.getElementById("btn-change").addEventListener("click", () => {
    // Prefer folder; on iPhone-class browsers fall back to multi-file pick.
    if (typeof window.showDirectoryPicker === "function") pickDirectory();
    else pickFiles();
  });
  document.getElementById("btn-pick-main").addEventListener("click", pickDirectory);
  document.getElementById("btn-pick-files").addEventListener("click", pickFiles);
  document.getElementById("btn-back").addEventListener("click", () => {
    state.activeBookId = null;
    render();
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
  document.getElementById("btn-prev").addEventListener("click", () => {
    if (!playback || playback.chapterIndex <= 0) return;
    playChapter(playback.bookId, playback.chapterIndex - 1, { forceStart: true });
  });
  document.getElementById("btn-next").addEventListener("click", () => {
    if (!playback) return;
    const book = findBook(playback.bookId);
    if (!book || playback.chapterIndex >= book.chapters.length - 1) return;
    playChapter(playback.bookId, playback.chapterIndex + 1, { forceStart: true });
  });

  const seek = document.getElementById("player-seek");
  seek.addEventListener("pointerdown", () => {
    seekDragging = true;
  });
  seek.addEventListener("pointerup", () => {
    seekDragging = false;
  });
  seek.addEventListener("input", () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
    updatePlayerBar();
  });
  seek.addEventListener("change", () => {
    persistCurrent();
    seekDragging = false;
  });

  audio.addEventListener("timeupdate", () => {
    updatePlayerBar();
    if (!audio.paused) {
      // throttle-ish via seconds bucket
      const t = Math.floor(audio.currentTime);
      if (audio._lastSavedSec !== t) {
        audio._lastSavedSec = t;
        persistCurrent();
        if (state.activeBookId && !state.activeBookId) {
          /* noop */
        }
      }
    }
  });
  audio.addEventListener("pause", () => {
    persistCurrent();
    updatePlayerBar();
  });
  audio.addEventListener("play", updatePlayerBar);
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

  if ("mediaSession" in navigator) {
    audio.addEventListener("play", () => {
      if (!playback) return;
      const book = findBook(playback.bookId);
      const chapter = book?.chapters[playback.chapterIndex];
      if (!book || !chapter) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: chapter.title,
        artist: book.author,
        album: book.title,
      });
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        document.getElementById("btn-prev").click();
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        document.getElementById("btn-next").click();
      });
      navigator.mediaSession.setActionHandler("play", () => audio.play());
      navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    });
  }
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

setupCapabilityHint();
document.getElementById("btn-sort").textContent = `Sort: ${state.sort}`;
bind();
render();
registerSW();
