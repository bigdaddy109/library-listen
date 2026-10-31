import { IMMUNE_CARDS } from "./immune-cards.js?v=64";
import { SLEEP_CHAPTER, nearestSleepMinute, nextSleepChoice } from "./sleep.js?v=64";
import {
  bookHasAudio,
  bookScreenTabs,
  listenShelfBooks,
  extOf,
  bookHasDriveMedia,
  booksFromLibrarySnapshot,
  buildLibrary,
  emptyLibraryMessage,
  applyShelfRestorePlan,
  planShelfRestore,
  readLibraryShell,
  stampLibraryShell,
  LIBRARY_SNAPSHOT_KEY,
  isBookPlayable,
  isImmuneBook,
  mergeLibraryScans,
  latestProgressKind,
  loadProgress,
  chapterProgress,
  saveProgress,
  shelfBadge,
} from "./library.js?v=64";
import {
  DRIVE_MEDIA_ERROR_MESSAGE,
  DRIVE_UNAUTHORIZED_MESSAGE,
  attachDriveMedia,
  classifyDriveError,
  clearDriveSession,
  downloadDriveFile,
  driveMediaUrl,
  fetchDriveUser,
  formatDriveWalkErrors,
  finishDrivePlaybackAuthRetry,
  driveChromeAfterSignIn,
  freshAccessToken,
  getAccessToken,
  isPopupWindowFailure,
  shouldSurfacePopupFailure,
  hydrateDriveCovers,
  isDriveFile,
  isDriveMediaPath,
  isGoogleClientConfigured,
  isPickerConfigured,
  loadDriveEntries,
  loadDriveSession,
  openGooglePicker,
  planDrivePlaybackAuthRetry,
  playbackFailureLine,
  publishDriveToken,
  refreshGoogleToken,
  restoreDriveFile,
  saveDriveSession,
  setDriveTokenAppliedListener,
  signInWithGoogle,
  resumeLocalGisRedirect,
  isLocalGisHost,
  isIosLikeClient,
  gisUsesRedirect,
  signOutGoogle,
  sourceDialogActions,
  tokenForChapterFetch,
} from "./drive.js?v=64";
import {
  chapterHitLine,
  emptySearchMessage,
  filterBooks,
  matchingChapterTitles,
  shelfCountLabel,
  trimQuery,
} from "./search.js?v=64";
import {
  applyAudiobookMarkers,
  chapterIndexAtTime,
  chapterRelativePosition,
  chapterStart,
  filePositionFromDisplay,
  isAudiobook,
  liveChapterDuration,
  offlineChapterBlob,
  partDurationSeconds,
  playbackDisplayClock,
  resolvedChapterDuration,
  restoreChapterFields,
  resumeFileSeconds,
  snapshotChapter,
  uniqueChapterFiles,
} from "./markers.js?v=64";
import { shouldOfferSaveWhileListening } from "./save-prompt.js?v=64";
import { demoCatalog, seriesMeta } from "./shelf/catalog.js?v=64";
import { coverSvg } from "./shelf/covers.js?v=64";
import { isIOSDevice, lockScreenActions, svgCoverToPngUrl, ARTWORK_SIZE } from "./media-session.js?v=64";
import {
  closeRiceBook,
  initRiceShelf,
  isRiceShelfPage,
  setRiceShelfLibrary,
} from "./shelf/shelf.js?v=64";

const SORT_KEY = "librarylisten.shelfSort";
const RATE_KEY = "librarylisten.rate";
const OPEN_INTENT_KEY = "librarylisten.open.v1";
const RATES = [1, 1.25, 1.5];
const LIBRARY_KEY = LIBRARY_SNAPSHOT_KEY;
const DB_NAME = "library-listen";
const COVER_KEY = "__cover__";
/** @type {{ books: any[], activeBookId: string|null, sort: string, query: string }} */
const state = {
  books: [],
  activeBookId: null,
  bookPane: "audio",
  sort: localStorage.getItem(SORT_KEY) || "collection",
  query: "",
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
  driveStatus: document.getElementById("drive-status"),
  sourceSheet: document.getElementById("source-sheet"),
  sourceSheetTitle: document.getElementById("source-sheet-title"),
  sourceSheetCopy: document.getElementById("source-sheet-copy"),
  sourceSheetList: document.getElementById("source-sheet-list"),
  btnSheetPicker: document.getElementById("btn-sheet-picker"),
  btnSheetGoogle: document.getElementById("btn-sheet-google"),
  btnSheetReload: document.getElementById("btn-sheet-reload"),
  btnSheetSignout: document.getElementById("btn-sheet-signout"),
  btnSheetCancel: document.getElementById("btn-sheet-cancel"),
  shelfTools: document.getElementById("shelf-tools"),
  shelfQuery: document.getElementById("shelf-query"),
  clearSearch: document.getElementById("btn-clear-search"),
  shelfCount: document.getElementById("shelf-count"),
  libraryStatus: document.getElementById("library-status"),
};

/** @type {{ bookId: string, chapterIndex: number } | null} */
let playback = null;
let seekDragging = false;
let playToken = 0;
let ignoreSeekInput = 0;
/** Last finite file duration from audio metadata. A later 0 does not freeze the total. */
let heldFileDuration = 0;
let clockFrame = 0;
let detachChapterMeta = null;
/** @type {{ token: number, resumeAt: number, until: number } | null} */
let resumeGuard = null;
const SKIP_SECONDS = 30;
let playbackRate = loadRate();
const objectUrls = new Set();
/** Books copied into IndexedDB: bookId -> Map(chapterId | COVER_KEY -> Blob) */
const offlineIndex = new Map();
/** @type {{ bookId: string, pub: any, index: number, urls: string[], token: number } | null} */
/** @type {((folder: { id: string, name: string } | null) => void) | null} */
let folderSheetResolve = null;
/** @type {HTMLElement | null} */
let sheetReturnFocus = null;
let savingBookId = null;
/** @type {number | null} epoch ms when sleep timer should pause playback */
let sleepUntil = null;
let sleepTick = null;
/** Stop at the end of the current chapter instead of a clock time. */
let sleepAtChapterEnd = false;
/** Offer Save-to-device banner after a Drive library load */
let offerSaveBanner = false;
/** bookIds already asked to save this session */
const savePrompted = new Set();
let toastTimer = null;
let swReloading = false;
/** Last file position heard, so a 401 can replay the same spot after currentTime drops. */
let driveFilePosition = 0;
/** @type {{ key: string, attempts: number, pending: boolean, position: number } | null} */
let driveAuthRetryState = null;
/** Last non-OK status from the Drive media proxy, for the status line. */
let lastDriveMediaHttp = 0;
/** @type {Promise<void> | null} */
let driveAuthRecovering = null;
/** @type {Promise<unknown> | null} */
let driveTokenRefresh = null;
let driveTokenCheckAt = 0;
const SW_CHECK_MS = 60_000;
const APP_VERSION = new URL(import.meta.url).searchParams.get("v") || "";

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("offline")) {
          req.result.createObjectStore("offline");
        }
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
  if (!saved) return false;
  const chapters = book.chapters || [];
  if (!chapters.length) return false;
  return chapters.every((ch) => !!offlineChapterBlob(saved, ch));
}

function chapterStreamsFromDrive(chapter) {
  const url = String(chapter?.url || "");
  if (url.startsWith("blob:")) return false;
  if (isDriveMediaPath(url)) return true;
  return !!(chapter?.driveId || chapter?.file?.driveId);
}

function ensureChapterPlayableUrl(chapter) {
  if (chapter?.url) return chapter.url;
  const driveId = chapter?.driveId || chapter?.file?.driveId;
  if (!driveId) return null;
  if (!chapter.file) {
    chapter.file = restoreDriveFile({
      driveId,
      name: String(chapter.id || "audio").split("#")[0],
      size: chapter.size,
      type: chapter.type,
    });
  }
  chapter.driveId = driveId;
  chapter.url = driveMediaUrl(
    driveId,
    undefined,
    chapter.file?.name || String(chapter.id || "").split("#")[0],
    chapter.file?.size || chapter.size
  );
  return chapter.url;
}

function saveLibrarySnapshot() {
  const snapshot = state.books.map((b) => ({
    id: b.id,
    collectionId: b.collectionId,
    collectionTitle: b.collectionTitle,
    collectionFolder: b.collectionFolder || null,
    folder: b.folder,
    title: b.title,
    subtitle: b.subtitle,
    author: b.author,
    kind: b.kind,
    source: b.source || null,
    coverDriveId: b.coverFile?.driveId || b.coverDriveId || null,
    ebook: b.ebook
      ? {
          id: b.ebook.id,
          name: b.ebook.name || b.ebook.file?.name,
          driveId: b.ebook.file?.driveId || b.ebook.driveId || null,
          size: b.ebook.file?.size || null,
          type: b.ebook.file?.type || null,
        }
      : null,
    chapters: b.chapters.map((ch) => ({
      ...snapshotChapter(ch),
      driveId: ch.file?.driveId || ch.driveId || null,
      size: ch.file?.size || null,
      type: ch.file?.type || null,
    })),
  }));
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(snapshot));
    stampLibraryShell(libraryStore(), APP_VERSION);
  } catch {
    /* quota / private mode */
  }
}

function libraryStore() {
  try {
    return localStorage;
  } catch {
    return null;
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
    const coverDrive = b.coverDriveId
      ? restoreDriveFile({ driveId: b.coverDriveId, name: "cover", type: "image/jpeg" })
      : null;
    return {
      ...b,
      source: b.source || (b.coverDriveId || b.ebook?.driveId ? "drive" : null),
      coverFile: saved?.get(COVER_KEY) || coverDrive,
      coverUrl: null,
      kind: b.kind,
      ebook: b.ebook
        ? {
            id: b.ebook.id,
            name: b.ebook.name,
            driveId: b.ebook.driveId || null,
            file: restoreDriveFile({
              driveId: b.ebook.driveId,
              name: b.ebook.name,
              size: b.ebook.size,
              type: b.ebook.type,
            }),
            fromDevice: false,
          }
        : null,
      chapters: b.chapters.map((ch, index) => {
        const offline = offlineChapterBlob(saved, ch);
        // Keep Drive stubs even before GIS returns a token so the shelf
        // still lists the last full scan (not only recently-played blobs).
        const file =
          offline ||
          restoreDriveFile({
            driveId: ch.driveId,
            name: String(ch.id || "").split("#")[0],
            size: ch.size,
            type: ch.type,
            durationMillis: ch.durationMillis,
          });
        return {
          id: ch.id,
          index,
          title: ch.title,
          file,
          driveId: ch.driveId || file?.driveId || null,
          fromDevice: !!offline,
          url: null,
          ...restoreChapterFields(ch, index),
        };
      }),
    };
  });
}

function fileIsBlob(file) {
  return typeof Blob !== "undefined" && file instanceof Blob;
}

function attachUrls(books) {
  revokeAllUrls();
  attachDriveMedia(books);
  const seen = new WeakMap();
  const urlFor = (file) => {
    if (!file) return null;
    if (isDriveFile(file) && !fileIsBlob(file)) return null;
    if (seen.has(file)) return seen.get(file);
    const url = fileUrl(file);
    seen.set(file, url);
    return url;
  };
  for (const book of books) {
    for (const ch of book.chapters) {
      const local = urlFor(ch.file);
      if (local) ch.url = local;
    }
    book.coverUrl = urlFor(book.coverFile) || book.coverUrl;
  }
}

function blobsToSave(book) {
  const items = uniqueChapterFiles(book.chapters || []).map(({ key, file }) => [key, file]);
  if (book.coverFile) items.push([COVER_KEY, book.coverFile]);
  return items;
}

function isBookOpenable(book) {
  return isBookPlayable(book);
}

async function materializeFile(file) {
  if (!file) return null;
  if (fileIsBlob(file)) return file;
  if (isDriveFile(file)) return downloadDriveFile(file);
  return file;
}

async function saveBookOffline(book) {
  if (savingBookId) return;
  const items = blobsToSave(book);
  if (!items.length) return;
  savingBookId = book.id;
  try {
    await navigator.storage?.persist?.().catch(() => false);
    const saved = new Map();
    for (let i = 0; i < items.length; i += 1) {
      const [chapterId, raw] = items[i];
      updateOfflineButton(book, `Saving ${i + 1}/${items.length}…`);
      const blob = await materializeFile(raw);
      if (!blob) continue;
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
        : "Could not save this book on the device. Private Browsing cannot save books."
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
  btn.disabled = !!savingBookId || (!offline && !blobsToSave(book).length);
  if (busyLabel) {
    btn.textContent = busyLabel;
  } else if (offline) {
    btn.textContent = "Remove from device";
  } else {
    btn.textContent = "Save to this device";
  }
  if (offline) {
    status.textContent = "Saved on this device — plays without a connection.";
  } else if (!isBookOpenable(book)) {
    status.textContent = "Sign in with Google again to play this book.";
  } else {
    const bytes = blobsToSave(book).reduce((n, [, file]) => n + (file?.size || 0), 0);
    status.textContent = `Save a copy (${formatBytes(bytes)}) so it opens after the app restarts.`;
  }
}

function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
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

function revokeAllUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

function fileUrl(file) {
  const url = URL.createObjectURL(file);
  objectUrls.add(url);
  return url;
}

async function booksFromEntries(entries) {
  const books = buildLibrary(entries);
  await applyAudiobookMarkers(books);
  return books;
}

function setScanning(active) {
  document.body.classList.toggle("is-scanning", active);
  const hint = els.capabilityHint;
  if (!hint) return;
  if (active) {
    hint.dataset.prev = hint.textContent || "";
    hint.textContent = "Scanning the Drive Library…";
  } else if (hint.dataset.prev != null) {
    hint.textContent = hint.dataset.prev;
    delete hint.dataset.prev;
  }
}

function showLibraryStatus(message) {
  const el = els.libraryStatus;
  if (!el) return;
  const text = String(message || "").trim();
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle("hidden", !text);
}

function hideLibraryStatus() {
  showLibraryStatus("");
}

function clearPlayerDriveError() {
  const playerEl = document.getElementById("player-drive-error");
  if (playerEl) playerEl.textContent = "";
  els.playerBar?.classList.remove("has-drive-error");
}

function readDriveChrome() {
  const playerEl = document.getElementById("player-drive-error");
  return {
    statusText: els.driveStatus?.textContent || "",
    statusIsError: !!els.driveStatus?.classList.contains("drive-error"),
    playerText: playerEl?.textContent || "",
    playerIsError: !!els.playerBar?.classList.contains("has-drive-error"),
  };
}

function writeDriveChrome(chrome) {
  const el = els.driveStatus;
  if (el) {
    el.textContent = chrome.statusText || "";
    el.classList.toggle("drive-error", !!chrome.statusIsError && !!chrome.statusText);
  }
  const playerEl = document.getElementById("player-drive-error");
  if (playerEl) playerEl.textContent = chrome.playerText || "";
  els.playerBar?.classList.toggle("has-drive-error", !!chrome.playerIsError && !!chrome.playerText);
}

/** Drop "Failed to open popup window" from the status line and the player bar. */
function clearStalePopupError() {
  const next = driveChromeAfterSignIn(readDriveChrome(), { signedIn: true });
  writeDriveChrome(next);
  if (!next.statusText) updateDriveStatus();
}

function clearDriveError() {
  const el = els.driveStatus;
  if (el) {
    el.classList.remove("drive-error");
    el.textContent = "";
  }
  clearPlayerDriveError();
  updateDriveStatus();
}

function showPlaybackFailure(line) {
  const text = String(line || "").trim();
  if (!text) return;
  const el = els.driveStatus;
  if (el) {
    el.textContent = text;
    el.classList.add("drive-error");
    el.hidden = false;
  }
  const playerEl = document.getElementById("player-drive-error");
  if (playerEl) {
    playerEl.textContent = text;
    els.playerBar?.classList.add("has-drive-error");
  }
}

function showDriveError(err) {
  const classified = classifyDriveError(err);
  if (
    isPopupWindowFailure(err) &&
    !shouldSurfacePopupFailure(err, { promptOpened: true, signedIn: !!freshAccessToken() })
  ) {
    clearStalePopupError();
    return classified;
  }
  if (classified.kind === "abort" || classified.kind === "coop" || classified.silent) {
    return classified;
  }
  const text = classified.message;
  const el = els.driveStatus;
  if (el) {
    el.textContent = text;
    el.classList.add("drive-error");
    el.hidden = false;
  }
  const playerEl = document.getElementById("player-drive-error");
  if (playerEl) {
    playerEl.textContent = text;
    els.playerBar?.classList.add("has-drive-error");
  }
  return classified;
}

function updateDriveStatus() {
  const el = els.driveStatus;
  if (!el) return;
  if (el.classList.contains("drive-error") && el.textContent) return;
  const session = loadDriveSession();
  if (session?.email || session?.folderName) {
    const who = session.email || "Google";
    el.textContent = `${who} · ${session.folderName || "Library"}`;
  } else if (!isGoogleClientConfigured()) {
    el.textContent =
      "Google Drive sign-in needs a Web Client ID in docs/drive.js (see README). Local folder pick still works.";
  } else {
    el.textContent = "";
  }
}

function firstSheetControl() {
  const root = els.sourceSheet;
  if (!root) return null;
  const nodes = root.querySelectorAll("button");
  for (const node of nodes) {
    if (node.hidden || node.classList.contains("hidden") || node.disabled) continue;
    const details = node.closest("details");
    if (details && !details.open) {
      const summary = details.querySelector("summary");
      if (!summary?.contains(node)) continue;
    }
    return node;
  }
  return els.btnSheetCancel;
}

function closeSourceSheet(folder = null, { restoreFocus = true } = {}) {
  const resolve = folderSheetResolve;
  folderSheetResolve = null;
  els.sourceSheet?.classList.add("hidden");
  if (els.sourceSheet) els.sourceSheet.hidden = true;
  if (els.sourceSheetList) els.sourceSheetList.innerHTML = "";
  const back = sheetReturnFocus;
  if (restoreFocus) sheetReturnFocus = null;
  if (restoreFocus && back && typeof back.focus === "function") {
    try {
      back.focus();
    } catch {
      /* element may have been removed */
    }
  }
  resolve?.(folder);
}

function setSheetActions({ google, picker, signout, reload } = {}) {
  els.btnSheetGoogle?.classList.toggle("hidden", !google);
  els.btnSheetReload?.classList.toggle("hidden", !reload);
  els.btnSheetPicker?.classList.toggle("hidden", !picker);
  els.btnSheetSignout?.classList.toggle("hidden", !signout);
}

function openSourceSheet({ title, copy, folders = [], actions = {} } = {}) {
  closeSourceSheet(null, { restoreFocus: false });
  if (!sheetReturnFocus && document.activeElement instanceof HTMLElement) {
    sheetReturnFocus = document.activeElement;
  }
  if (els.sourceSheetTitle) els.sourceSheetTitle.textContent = title || "Library source";
  if (els.sourceSheetCopy) els.sourceSheetCopy.textContent = copy || "";
  if (els.sourceSheetList) {
    els.sourceSheetList.innerHTML = "";
    for (const folder of folders) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = folder.label || folder.name || "Library";
      btn.addEventListener("click", () => closeSourceSheet(folder));
      li.appendChild(btn);
      els.sourceSheetList.appendChild(li);
    }
  }
  setSheetActions(actions);
  els.sourceSheet?.classList.remove("hidden");
  if (els.sourceSheet) els.sourceSheet.hidden = false;
  queueMicrotask(() => firstSheetControl()?.focus());
  return new Promise((resolve) => {
    folderSheetResolve = resolve;
  });
}

async function pickDriveFolderWithPicker() {
  const folder = await openGooglePicker();
  if (folder) closeSourceSheet(folder);
  return folder;
}

async function loadFromDrive({ silent } = {}) {
  if (!isGoogleClientConfigured()) {
    const err = Object.assign(
      new Error(
        "Google sign-in is not configured yet.\n\nPaste a Web application Client ID into GOOGLE_OAUTH_CLIENT_ID in docs/drive.js. Setup steps are in the README."
      ),
      { name: "DriveConfigError" }
    );
    if (!silent) showDriveError(err);
    else showDriveError(err, { silent: true });
    return null;
  }
  let token = getAccessToken();
  if (!token) {
    try {
      token = silent ? await refreshGoogleToken() : await signInWithGoogle();
    } catch (err) {
      if (silent || err?.name === "AbortError" || classifyDriveError(err).kind === "abort") {
        if (silent && err && classifyDriveError(err).kind !== "abort") {
          showDriveError(err, { silent: true });
        }
        return null;
      }
      throw err;
    }
  }
  await publishDriveToken(token);
  const session = loadDriveSession();
  const walked = await loadDriveEntries({
    token,
    folderId: session?.folderId,
    folderName: session?.folderName,
    pickWithPicker:
      silent || session?.folderId
        ? undefined
        : async () => {
            if (!isPickerConfigured()) return null;
            return openGooglePicker(token);
          },
  });
  const books = await booksFromEntries(walked.entries);
  await hydrateDriveCovers(books, token);
  const email = (await fetchDriveUser(token)) || session?.email || "";
  saveDriveSession({
    folderId: walked.folder.id,
    folderName: walked.folder.name,
    email,
  });
  updateDriveStatus();
  return {
    books,
    entries: walked.entries,
    skipped: walked.skipped,
    walkErrors: walked.walkErrors,
    driveFolder: walked.folder,
  };
}

/**
 * @param {"drive" | "drive-auto"} mode
 *   drive-auto: silent GIS refresh of the shared Library folder.
 */
async function loadLibrary(mode) {
  const silent = mode === "drive-auto";
  if (!silent) hideLibraryStatus();
  setScanning(true);
  try {
    const result = await loadFromDrive({ silent });
    if (!result) return;

    const scanned = result.books || [];
    const entries = result.entries || [];
    const skipped = result.skipped || 0;
    const walkNote = formatDriveWalkErrors(result.walkErrors);

    if (!scanned.length) {
      const emptyNote = silent ? "" : emptyLibraryMessage(entries, skipped);
      const message = [emptyNote, walkNote].filter(Boolean).join("\n\n");
      if (message) showLibraryStatus(message);
      return;
    }
    clearDriveError();

    // Keep offline copies and the last Drive scan when this pass is a
    // partial page / recently-played reconnect, not a smaller library.
    const previous = mergeLibraryScans(state.books, restoreLibrarySnapshot(), {
      keep: () => true,
    });
    const books = mergeLibraryScans(scanned, previous, {
      keep: (book) => isBookOffline(book) || bookHasDriveMedia(book),
    });

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
    if (!silent) {
      state.activeBookId = null;
      offerSaveBanner = books.some((b) => isBookOpenable(b) && !isBookOffline(b));
    }
    if (walkNote) showLibraryStatus(walkNote);
    else if (!silent) hideLibraryStatus();
    saveLibrarySnapshot();
    render();
  } catch (err) {
    const classified = classifyDriveError(err);
    if (classified.kind === "abort" || err?.name === "AbortError") return;
    if (silent) {
      showDriveError(err, { silent: true });
      return;
    }
    console.error(err);
    showDriveError(err);
  } finally {
    setScanning(false);
  }
}

function sortedBooks() {
  const books = [...filterBooks(listenShelfBooks(state.books), state.query)];
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
  if (latestProgressKind(p) === "text") {
    const fraction = Number.isFinite(p.text?.fraction) ? clamp01(p.text.fraction) : null;
    let line = p.text?.label || "Reading";
    if (fraction != null) line += ` · ${Math.round(fraction * 100)}%`;
    if (p.text?.updatedAt) line += ` · ${relativeTime(p.text.updatedAt)}`;
    return { line, fraction };
  }
  const chapter =
    book.chapters.find((c) => c.id === p.chapterId) || book.chapters[0];
  if (!chapter) return { line: "Not started", fraction: null };
  const pos = chapterRelativePosition(chapter, p.positionSeconds || 0);
  const dur = resolvedChapterDuration(chapter, p.chapterDurationSeconds);
  let line = `${chapter.title} · ${formatClock(pos)}`;
  if (dur > 0) line += ` / ${formatClock(dur)}`;
  if (p.updatedAt) line += ` · ${relativeTime(p.updatedAt)}`;
  const fraction = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : null;
  return { line, fraction };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
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

function mostRecentResume() {
  const progress = loadProgress();
  let best = null;
  for (const book of state.books) {
    const p = progress[book.id];
    if (!p?.updatedAt) continue;
    if (latestProgressKind(p) === "text") continue; /* listen-only: skip old text resumes */
    if (!isBookPlayable(book) || !p.chapterId) continue;
    const chapterIndex = book.chapters.findIndex((c) => c.id === p.chapterId);
    if (chapterIndex < 0) continue;
    const saved = chapterProgress(book.id, p.chapterId);
    const filePos = Number.isFinite(saved?.positionSeconds)
      ? saved.positionSeconds
      : p.positionSeconds || 0;
    const pos = chapterRelativePosition(book.chapters[chapterIndex], filePos);
    if (pos < 0.5 && chapterIndex === 0) continue;
    if (!best || p.updatedAt > best.updatedAt) {
      best = {
        kind: "audio",
        book,
        chapterIndex,
        chapter: book.chapters[chapterIndex],
        pos,
        updatedAt: p.updatedAt,
      };
    }
  }
  return best;
}

function showToast(message, { ms = 2600 } = {}) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.add("hidden");
  }, ms);
}

function continueCard(resume) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "continue-card";
  const cover = document.createElement("div");
  cover.className = "cover";
  setCover(cover, resume.book);
  const body = document.createElement("div");
  body.innerHTML = `
    <p class="continue-label"></p>
    <p class="title"></p>
    <p class="progress"></p>
  `;
  body.querySelector(".continue-label").textContent = "Continue listening";
  body.querySelector(".title").textContent = resume.book.title;
  body.querySelector(".progress").textContent =
    `${resume.chapter.title} · ${formatClock(resume.pos)}` +
    (resume.updatedAt ? ` · ${relativeTime(resume.updatedAt)}` : "");
  btn.append(cover, body);
  btn.addEventListener("click", () => {
    openBook(resume.book.id, { pane: "audio" });
    playChapter(resume.book.id, resume.chapterIndex, { resumeIfSame: true });
  });
  return btn;
}

function saveBanner(targetBook) {
  const row = document.createElement("div");
  row.className = "save-banner";
  const text = document.createElement("p");
  text.textContent = targetBook
    ? `Save “${targetBook.title}” on this phone so it opens after a restart?`
    : "Save books on this phone so they open after a restart?";
  const actions = document.createElement("div");
  actions.className = "cta-row";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "primary";
  saveBtn.textContent = targetBook ? "Save this book" : "Save";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "ghost";
  dismiss.textContent = "Not now";
  saveBtn.addEventListener("click", async () => {
    const book = targetBook || mostRecentResume()?.book || state.books.find(isBookOpenable);
    if (!book) return;
    offerSaveBanner = false;
    openBook(book.id);
    await saveBookOffline(book);
    showToast(`Saved “${book.title}” on this device`);
  });
  dismiss.addEventListener("click", () => {
    offerSaveBanner = false;
    render();
  });
  actions.append(saveBtn, dismiss);
  row.append(text, actions);
  return row;
}

function syncSearchUi(matchCount) {
  const show = state.books.length > 0 && !state.activeBookId;
  els.shelfTools?.classList.toggle("hidden", !show);
  if (els.shelfQuery && els.shelfQuery.value !== state.query) {
    els.shelfQuery.value = state.query;
  }
  els.clearSearch?.classList.toggle("hidden", !trimQuery(state.query));
  if (els.shelfCount) {
    els.shelfCount.textContent = show ? shelfCountLabel(matchCount, state.query) : "";
  }
}

function renderRiceBanners() {
  const host = document.getElementById("shelf-banners");
  if (!host) return;
  host.innerHTML = "";
  if (!state.books.length || state.activeBookId) return;
  const resume = mostRecentResume();
  if (resume) host.appendChild(continueCard(resume));
  if (offerSaveBanner) {
    const unsaved =
      (resume && !isBookOffline(resume.book) && resume.book) ||
      state.books.find((b) => isBookOpenable(b) && !isBookOffline(b));
    if (unsaved) host.appendChild(saveBanner(unsaved));
    else offerSaveBanner = false;
  }
}

function renderShelf() {
  if (!els.shelf) return;
  const books = sortedBooks();
  els.shelf.innerHTML = "";
  syncSearchUi(books.length);

  if (!books.length) {
    if (trimQuery(state.query)) {
      const empty = document.createElement("p");
      empty.className = "shelf-empty";
      empty.textContent = emptySearchMessage(state.query);
      els.shelf.appendChild(empty);
    }
    return;
  }

  const searching = !!trimQuery(state.query);
  const resume = searching ? null : mostRecentResume();
  if (resume) els.shelf.appendChild(continueCard(resume));

  if (!searching && offerSaveBanner) {
    const unsaved =
      (resume && !isBookOffline(resume.book) && resume.book) ||
      state.books.find((b) => isBookOpenable(b) && !isBookOffline(b));
    if (unsaved) els.shelf.appendChild(saveBanner(unsaved));
    else offerSaveBanner = false;
  }

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
  const badge = shelfBadge(book);
  body.innerHTML = `
    <p class="title-row"><span class="title"></span><span class="shelf-badge"></span></p>
    <p class="meta"></p>
    <p class="progress"></p>
    <div class="progress-track"><span></span></div>
    <p class="chapter-hits hidden"></p>
  `;
  body.querySelector(".title").textContent = book.title;
  const badgeEl = body.querySelector(".shelf-badge");
  badgeEl.textContent = badge;
  badgeEl.classList.add(`shelf-badge-${badge.toLowerCase()}`);
  const hasAudio = bookHasAudio(book);
  let meta = book.author;
  if (hasAudio) meta += ` · ${book.chapters.length} chapters`;
  if (isBookOffline(book)) meta += " · on device";
  else if (hasAudio && !isBookPlayable(book)) meta += " · reconnect to play";
  body.querySelector(".meta").textContent = meta;
  btn.classList.toggle("unavailable", !isBookOpenable(book));
  body.querySelector(".progress").textContent = line;
  const bar = body.querySelector(".progress-track > span");
  if (fraction == null) {
    body.querySelector(".progress-track").style.display = "none";
  } else {
    bar.style.width = `${Math.round(fraction * 100)}%`;
  }
  const hitLine = chapterHitLine(matchingChapterTitles(book, state.query));
  const hitsEl = body.querySelector(".chapter-hits");
  if (hitLine) {
    hitsEl.textContent = hitLine;
    hitsEl.classList.remove("hidden");
  }
  btn.append(cover, body);
  btn.addEventListener("click", () => openBook(book.id));
  return btn;
}

function resolvedBookPane(book, pane = state.bookPane) {
  const tabs = bookScreenTabs(book);
  if (tabs.includes(pane)) return pane;
  return tabs[0] || "audio";
}

function cacheImmuneConcepts() {
  const urls = IMMUNE_CARDS.map(
    (card) => new URL(`./concepts/immune/${card.file}`, import.meta.url).href
  );
  const post = (worker) => {
    try {
      worker?.postMessage({ type: "librarylisten.cache-concepts", urls });
    } catch {
      /* service worker not ready */
    }
  };
  if (!navigator.serviceWorker) return;
  if (navigator.serviceWorker.controller) post(navigator.serviceWorker.controller);
  navigator.serviceWorker.ready.then((reg) => post(reg.active)).catch(() => {});
}

function openBook(bookId, { pane } = {}) {
  const book = findBook(bookId);
  if (state.activeBookId !== bookId) {
    state.bookPane = resolvedBookPane(book, pane || "audio");
  } else if (pane) {
    state.bookPane = resolvedBookPane(book, pane);
  }
  state.activeBookId = bookId;
  if (isImmuneBook(book)) cacheImmuneConcepts();
  render();
}

function renderConceptCards() {
  if (els.conceptList.childElementCount) return;
  const note = document.createElement("p");
  note.className = "concept-note";
  note.textContent =
    "Original notes for the main cast, in listening order. Not the book's text, and not its illustrations. Audio keeps playing.";
  els.conceptList.appendChild(note);
  for (const card of IMMUNE_CARDS) {
    const article = document.createElement("article");
    article.className = "concept-card";
    const img = document.createElement("img");
    img.src = new URL(`./concepts/immune/${card.file}`, import.meta.url).href;
    img.alt = card.alt;
    img.width = 800;
    img.height = 800;
    const heading = document.createElement("h3");
    heading.textContent = card.title;
    const body = document.createElement("p");
    body.textContent = card.body;
    article.append(img, heading, body);
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
  document
    .querySelector(".offline-row")
    ?.classList.toggle("hidden", !bookHasAudio(book));

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
    btn.querySelector(".ch-time").textContent = formatPartDuration(ch);
    btn.addEventListener("click", () => playChapter(book.id, i, { resumeIfSame: true }));
    li.appendChild(btn);
    els.chapterList.appendChild(li);
  });

  const tabs = bookScreenTabs(book);
  const pane = resolvedBookPane(book);
  if (state.bookPane !== pane) state.bookPane = pane;
  const showConcepts = pane === "concepts";
  document.getElementById("book-tabs").classList.toggle("hidden", tabs.length === 0);
  const tabAudio = document.getElementById("tab-audio");
  const tabConcepts = document.getElementById("tab-concepts");
  tabAudio?.classList.toggle("hidden", !tabs.includes("audio"));
  tabConcepts?.classList.toggle("hidden", !tabs.includes("concepts"));
  tabAudio?.setAttribute("aria-pressed", pane === "audio" ? "true" : "false");
  tabConcepts?.setAttribute("aria-pressed", showConcepts ? "true" : "false");
  els.chapterList.classList.toggle("hidden", showConcepts || !book.chapters.length);
  els.conceptList.classList.toggle("hidden", !showConcepts);
  if (showConcepts) renderConceptCards();
}

function render() {
  const hasBooks = state.books.length > 0;
  const rice = isRiceShelfPage();
  els.onboarding?.classList.toggle("hidden", hasBooks || !!state.activeBookId);
  const loadHint = document.getElementById("load-hint");
  if (loadHint) loadHint.hidden = hasBooks;
  if (hasBooks) els.onboarding?.classList.add("hidden");
  if (rice) {
    document.getElementById("app")?.classList.toggle("is-reading", !!state.activeBookId);
    if (!state.activeBookId) {
      setRiceShelfLibrary(hasBooks ? state.books : demoCatalog(), hasBooks ? "library" : "demo");
      renderRiceBanners();
    } else {
      closeRiceBook();
    }
  } else {
    els.shelf?.classList.toggle("hidden", !hasBooks || !!state.activeBookId);
    if (hasBooks && !state.activeBookId) renderShelf();
  }
  els.book?.classList.toggle("hidden", !state.activeBookId);
  const sortBtn = document.getElementById("btn-sort");
  if (sortBtn) sortBtn.classList.toggle("hidden", rice || !hasBooks);
  document.getElementById("btn-change")?.classList.toggle("hidden", !hasBooks);
  updateChangeButtonLabel();
  if (!rice && (!hasBooks || state.activeBookId)) syncSearchUi(0);

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
  syncChapterFromTime({ toast: false });
  persistCurrent();
  updatePlayerBar();
}

function seekDisplay(seconds) {
  const ctx = currentChapter();
  seekWithin(ctx ? filePositionFromDisplay(ctx.chapter, seconds) : seconds);
}

function seekBy(delta) {
  seekWithin((audio.currentTime || 0) + delta);
}

function skipToPrevious() {
  if (!playback) return;
  const ctx = currentChapter();
  const display = ctx ? chapterRelativePosition(ctx.chapter, audio.currentTime || 0) : audio.currentTime || 0;
  if (display > 3) {
    seekWithin(ctx ? chapterStart(ctx.chapter) : 0);
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

function currentChapter() {
  if (!playback) return null;
  const book = findBook(playback.bookId);
  const chapter = book?.chapters[playback.chapterIndex];
  if (!book || !chapter) return null;
  return { book, chapter };
}

function formatPartDuration(ch) {
  const active = currentChapter();
  const playing = !!active && active.chapter.id === ch.id;
  const seconds = partDurationSeconds(ch, {
    elementDuration: playing ? audio.duration : null,
    currentTime: playing ? audio.currentTime : null,
  });
  return seconds > 0 ? formatClock(seconds) : "";
}

function displayClock() {
  const ctx = currentChapter();
  const chapter = ctx?.chapter || null;
  const clock = playbackDisplayClock({
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    mediaDuration: audio.duration,
    heldDuration: heldFileDuration,
    chapter,
    durationMillis: chapter?.durationMillis ?? chapter?.file?.durationMillis ?? null,
  });
  if (clock.heldDuration > 0) heldFileDuration = clock.heldDuration;
  return clock;
}

function paintPlaybackClock() {
  if (!playback) return;
  const { pos, dur } = displayClock();
  const posText = formatClock(pos);
  const durText = formatClock(dur);
  const posEl = document.getElementById("player-pos");
  const durEl = document.getElementById("player-dur");
  const posChanged = !posEl || posEl.textContent !== posText;
  const durChanged = !durEl || durEl.textContent !== durText;
  if (posEl) posEl.textContent = posText;
  if (durEl) durEl.textContent = durText;
  if (!seekDragging && (posChanged || durChanged)) {
    writeSeekBar(pos, dur);
    updatePositionState();
  }
}

function stopPlaybackClock() {
  if (!clockFrame) return;
  cancelAnimationFrame(clockFrame);
  clockFrame = 0;
}

function startPlaybackClock() {
  if (clockFrame || !playback || audio.paused || audio.ended) return;
  const tick = () => {
    paintPlaybackClock();
    if (!playback || audio.paused || audio.ended) {
      clockFrame = 0;
      return;
    }
    clockFrame = requestAnimationFrame(tick);
  };
  clockFrame = requestAnimationFrame(tick);
}

function updatePositionState() {
  if (!("mediaSession" in navigator)) return;
  if (typeof navigator.mediaSession.setPositionState !== "function") return;
  if (!playback) return;
  const { pos, dur } = displayClock();
  if (!(dur > 0)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: dur,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(Math.max(0, pos), dur),
    });
  } catch {
    /* some browsers reject the state while metadata is in flux */
  }
}

/** bookId → PNG blob URL (or the pending render) of the generated cover. */
const generatedArtwork = new Map();

function generatedArtworkFor(book) {
  const known = generatedArtwork.get(book.id);
  if (known !== undefined) return known;
  const pending = svgCoverToPngUrl(coverSvg(book), { background: seriesMeta(book).paper })
    .catch(() => "")
    .then((url) => {
      generatedArtwork.set(book.id, url);
      if (url && playback?.bookId === book.id) updateMediaSession();
      return url;
    });
  generatedArtwork.set(book.id, pending);
  return pending;
}

function artworkFor(book) {
  if (book.coverUrl) {
    return [{ src: book.coverUrl, sizes: "512x512", type: coverMime(book.coverFile) }];
  }
  const generated = generatedArtworkFor(book);
  if (typeof generated !== "string" || !generated) return null;
  return [{ src: generated, sizes: `${ARTWORK_SIZE}x${ARTWORK_SIZE}`, type: "image/png" }];
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
    const artwork = artworkFor(book);
    assign(new MediaMetadata(artwork ? { ...base, artwork } : base));
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

async function playChapter(
  bookId,
  chapterIndex,
  { resumeIfSame = false, forceStart = false, startAt = null, authRetry = false } = {}
) {
  const book = findBook(bookId);
  if (!book) return;
  const chapter = book.chapters[chapterIndex];
  if (!chapter) return;
  if (!ensureChapterPlayableUrl(chapter)) {
    loadLibrary("reconnect");
    return;
  }

  if (!authRetry) {
    driveAuthRetryState = null;
    driveFilePosition = 0;
    lastDriveMediaHttp = 0;
  }
  // Fresh token, or none yet: no await before audio.play() — iOS drops the gesture.
  // A stored token inside the skew window is refreshed with prompt "" first.
  // No stored token still starts playback; a 401 refreshes and replays once.
  if (chapterStreamsFromDrive(chapter) && getAccessToken() && !freshAccessToken()) {
    try {
      const token = await tokenForChapterFetch();
      await publishDriveToken(token);
    } catch (err) {
      if (classifyDriveError(err).kind === "abort") return;
      showDriveError(err);
      return;
    }
  }

  const hasStartAt = Number.isFinite(startAt);
  const same =
    playback?.bookId === bookId && playback.chapterIndex === chapterIndex;
  if (same && resumeIfSame && !forceStart && !authRetry && !hasStartAt) {
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
  const start = chapterStart(chapter);
  const seekTo = hasStartAt ? Math.max(0, startAt) : forceStart ? start : resumeFileSeconds(saved, chapter);
  const shouldResume = seekTo > 0.5;

  const applyPosition = () => {
    if (token !== playToken) return;
    applyPlaybackPosition(shouldResume ? resumeTarget(seekTo) : start);
  };

  if (shouldResume) beginResumeGuard(token, seekTo);
  else clearResumeGuard();

  if (authRetry) {
    audio.removeAttribute("src");
    try {
      audio.load();
    } catch {
      /* element not ready */
    }
  }

  const alreadyLoaded = audio.src === chapter.url && audio.readyState >= 1;
  if (!alreadyLoaded) {
    heldFileDuration = 0;
    // Listener before src so a cached file cannot miss loadedmetadata.
    const onMeta = () => {
      detach();
      if (Number.isFinite(audio.duration) && audio.duration > 0) heldFileDuration = audio.duration;
      applyPosition();
      maybeFixResumeSnap();
      updatePlayerBar();
      updateChapterTimes();
    };
    const detach = () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      if (detachChapterMeta === detach) detachChapterMeta = null;
    };
    detachChapterMeta = detach;
    audio.addEventListener("loadedmetadata", onMeta);
    audio.src = chapter.url;
  }
  applyPlaybackRate();
  if (alreadyLoaded || audio.readyState >= 1) applyPosition();

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
  startPlaybackClock();
  if (state.activeBookId === bookId) renderBook();
  maybeOfferSaveWhileListening(book);
}

function maybeOfferSaveWhileListening(book) {
  if (
    !shouldOfferSaveWhileListening({
      book,
      isPlayable: !!book && isBookPlayable(book),
      isOffline: !!book && isBookOffline(book),
      phone: isIOSDevice(navigator),
    })
  ) {
    return;
  }
  if (savePrompted.has(book.id) || savingBookId) return;
  savePrompted.add(book.id);
  window.setTimeout(() => {
    if (playback?.bookId !== book.id || savingBookId) return;
    if (
      !shouldOfferSaveWhileListening({
        book,
        isPlayable: isBookPlayable(book),
        isOffline: isBookOffline(book),
        phone: isIOSDevice(navigator),
      })
    ) {
      return;
    }
    if (!confirm(`Save “${book.title}” on this phone so it still plays after a restart?`)) return;
    saveBookOffline(book).then(() => {
      showToast(`Saved “${book.title}” on this device`);
    });
  }, 12000);
}

function clearSleepClock() {
  sleepUntil = null;
  if (sleepTick) {
    window.clearInterval(sleepTick);
    sleepTick = null;
  }
}

function clearSleepTimer() {
  sleepAtChapterEnd = false;
  clearSleepClock();
  updateSleepButton();
}

function remainingSleepLabel() {
  if (sleepAtChapterEnd) return "End of chapter";
  if (!sleepUntil) return "Sleep";
  const left = Math.max(0, sleepUntil - Date.now());
  const mins = Math.ceil(left / 60000);
  if (mins <= 0) return "Sleep";
  return `${mins}m`;
}

function updateSleepButton() {
  const btn = document.getElementById("btn-sleep");
  if (!btn) return;
  const label = remainingSleepLabel();
  const on = sleepAtChapterEnd || !!sleepUntil;
  btn.textContent = label;
  btn.classList.toggle("is-on", on);
  btn.setAttribute(
    "aria-label",
    sleepAtChapterEnd ? "Stop at the end of this chapter" : sleepUntil ? `Sleep timer ${label} left` : "Sleep timer off"
  );
}

function pauseForSleep(message) {
  clearSleepTimer();
  audio.pause();
  persistCurrent();
  showToast(message);
  updatePlayerBar();
}

function finishChapterSleep() {
  const book = playback ? findBook(playback.bookId) : null;
  const index = playback?.chapterIndex ?? 0;
  const chapter = book?.chapters?.[index];
  const following = book?.chapters?.[index + 1];
  sleepAtChapterEnd = false;
  if (chapter && following && isAudiobook(book)) {
    const boundary = Number.isFinite(chapter.end) ? chapter.end : chapterStart(following);
    const hold = Math.max(chapterStart(chapter), boundary - 0.05);
    if ((audio.currentTime || 0) > hold) applyPlaybackPosition(hold);
  }
  audio.pause();
  persistCurrent();
  updateSleepButton();
  showToast("Stopped at the end of this chapter");
  updatePlayerBar();
}

function cycleSleepTimer() {
  const remaining = sleepUntil ? Math.ceil((sleepUntil - Date.now()) / 60000) : 0;
  const current = sleepAtChapterEnd ? SLEEP_CHAPTER : nearestSleepMinute(remaining);
  const next = nextSleepChoice(current);
  if (next === SLEEP_CHAPTER) {
    clearSleepClock();
    sleepAtChapterEnd = true;
    updateSleepButton();
    showToast("Stops at the end of this chapter");
    return;
  }
  sleepAtChapterEnd = false;
  if (!next) {
    clearSleepTimer();
    showToast("Sleep timer off");
    return;
  }
  sleepUntil = Date.now() + next * 60 * 1000;
  if (sleepTick) window.clearInterval(sleepTick);
  sleepTick = window.setInterval(() => {
    if (!sleepUntil) return;
    if (Date.now() >= sleepUntil) {
      pauseForSleep("Sleep timer — paused");
      return;
    }
    updateSleepButton();
  }, 15000);
  updateSleepButton();
  showToast(`Sleep in ${next} minutes`);
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
  const reported =
    Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : heldFileDuration;
  saveProgress(
    book.id,
    chapter.id,
    audio.currentTime || 0,
    liveChapterDuration(chapter, reported > 0 ? reported : null)
  );
  updateChapterTimes();
}

function syncChapterFromTime({ toast = false } = {}) {
  if (!playback) return;
  const book = findBook(playback.bookId);
  if (!isAudiobook(book)) return;
  const next = chapterIndexAtTime(book.chapters, audio.currentTime || 0);
  if (next < 0 || next === playback.chapterIndex) return;
  if (sleepAtChapterEnd && next > playback.chapterIndex) {
    finishChapterSleep();
    return;
  }
  const crossedForward = next > playback.chapterIndex;
  playback = { bookId: playback.bookId, chapterIndex: next };
  persistCurrent();
  updateMediaSession();
  if (state.activeBookId === book.id) renderBook();
  if (toast && crossedForward && !audio.paused) {
    showToast(`Next: ${book.chapters[next].title}`);
  }
}

function updateChapterTimes() {
  if (!state.activeBookId) return;
  const book = findBook(state.activeBookId);
  if (!book) return;
  const buttons = els.chapterList.querySelectorAll("button");
  book.chapters.forEach((ch, i) => {
    const el = buttons[i]?.querySelector(".ch-time");
    if (!el) return;
    el.textContent = formatPartDuration(ch);
  });
}

function writeSeekBar(pos, dur) {
  const seek = document.getElementById("player-seek");
  if (!seek) return;
  const max = dur > 0 ? String(Math.round(dur * 1000)) : "1000";
  const value = dur > 0 ? String(Math.round(pos * 1000)) : "0";
  if (seek.max === max && seek.value === value) return;
  ignoreSeekInput += 1;
  seek.max = max;
  seek.value = value;
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
  const playBtn = document.getElementById("btn-play");
  playBtn.classList.toggle("is-paused", audio.paused);
  playBtn.setAttribute("aria-label", audio.paused ? "Play" : "Pause");

  paintPlaybackClock();
  const { pos } = displayClock();

  const atStart = pos <= 3;
  document.getElementById("btn-prev").disabled = playback.chapterIndex <= 0 && atStart;
  document.getElementById("btn-next").disabled =
    playback.chapterIndex >= book.chapters.length - 1;
  updateSleepButton();
  updatePositionState();
}

function cycleSort() {
  const order = ["collection", "title", "author", "recent"];
  const i = order.indexOf(state.sort);
  state.sort = order[(i + 1) % order.length];
  localStorage.setItem(SORT_KEY, state.sort);
  const sortBtn = document.getElementById("btn-sort");
  if (sortBtn) sortBtn.textContent = `Sort: ${state.sort}`;
  if (!state.activeBookId) render();
}

function setupCapabilityHint() {
  if (els.capabilityHint) {
    els.capabilityHint.textContent = isGoogleClientConfigured()
      ? "Sign in with Google to load the shared Drive Library."
      : "Google sign-in is not configured yet. Paste a Client ID into docs/drive.js.";
  }
  updateDriveStatus();
}

function libraryNeedsReconnect() {
  return state.books.some(
    (b) =>
      bookHasAudio(b) && !isBookPlayable(b)
  );
}

function updateChangeButtonLabel() {
  const btn = document.getElementById("btn-change");
  if (!btn) return;
  if (libraryNeedsReconnect()) {
    btn.textContent = "Reconnect Drive";
    btn.title = "Sign in with Google again to stream from the shared Library";
  } else {
    btn.textContent = "Library";
    btn.title = "Reload the Drive library or sign out";
  }
}

function showChangeSourceSheet() {
  const session = loadDriveSession();
  const signedIn = !!(session || getAccessToken());
  openSourceSheet({
    title: "Library source",
    copy: session?.email
      ? `Signed in as ${session.email}. Reload the Drive library or sign out.`
      : signedIn
        ? "Signed in to Google. Reload the Drive library or sign out."
        : "Sign in with Google to load the shared Library folder.",
    actions: sourceDialogActions({ signedIn }),
  }).then((folder) => {
    if (!folder?.id) return;
    saveDriveSession({
      folderId: folder.id,
      folderName: folder.name,
      email: session?.email || "",
    });
    loadLibrary(getAccessToken() ? "drive-auto" : "drive");
  });
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
  const handlers = {
    play: () => {
      audio.play().catch(() => {});
    },
    pause: () => audio.pause(),
    previoustrack: () => skipToPrevious(),
    nexttrack: () => skipToNext(),
    seekbackward: (details) => seekBy(-(details?.seekOffset || SKIP_SECONDS)),
    seekforward: (details) => seekBy(details?.seekOffset || SKIP_SECONDS),
    seekto: (details) => {
      if (typeof details?.seekTime === "number" && Number.isFinite(details.seekTime)) {
        seekDisplay(details.seekTime);
      }
    },
  };
  const { register, clear } = lockScreenActions({ ios: isIOSDevice(navigator) });
  for (const name of register) setHandler(name, handlers[name]);
  for (const name of clear) setHandler(name, null);
}

function bind() {
  document.getElementById("btn-google")?.addEventListener("click", () => {
    closeSourceSheet(null);
    loadLibrary("drive");
  });
  document.getElementById("btn-change")?.addEventListener("click", () => {
    showChangeSourceSheet();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.sourceSheet || els.sourceSheet.hidden) return;
    event.preventDefault();
    closeSourceSheet(null);
  });
  els.btnSheetGoogle?.addEventListener("click", () => {
    closeSourceSheet(null);
    loadLibrary("drive");
  });
  els.btnSheetReload?.addEventListener("click", () => {
    closeSourceSheet(null);
    loadLibrary("drive");
  });
  els.btnSheetPicker?.addEventListener("click", () => {
    Promise.resolve()
      .then(async () => {
        if (!getAccessToken()) {
          const token = await signInWithGoogle();
          await publishDriveToken(token);
        }
        return pickDriveFolderWithPicker();
      })
      .catch((err) => {
        if (err?.name === "AbortError" || classifyDriveError(err).kind === "abort") return;
        console.error(err);
        showDriveError(err);
      });
  });
  els.btnSheetCancel?.addEventListener("click", () => closeSourceSheet(null));
  els.btnSheetSignout?.addEventListener("click", async () => {
    await signOutGoogle();
    await publishDriveToken("");
    clearDriveSession();
    closeSourceSheet(null);
    clearPlayerDriveError();
    if (els.driveStatus) {
      els.driveStatus.classList.remove("drive-error");
      els.driveStatus.textContent = "";
    }
    updateDriveStatus();
    showToast("Signed out of Google");
  });
  els.sourceSheet?.addEventListener("click", (event) => {
    if (event.target === els.sourceSheet) closeSourceSheet(null);
  });
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
  document.getElementById("btn-sort")?.addEventListener("click", cycleSort);
  if (!isRiceShelfPage()) {
    els.shelfQuery?.addEventListener("input", () => {
      state.query = els.shelfQuery.value;
      if (!state.activeBookId) renderShelf();
    });
    els.clearSearch?.addEventListener("click", () => {
      state.query = "";
      if (els.shelfQuery) els.shelfQuery.value = "";
      if (!state.activeBookId) renderShelf();
    });
  }
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
  document.getElementById("btn-sleep").addEventListener("click", () => cycleSleepTimer());

  const seek = document.getElementById("player-seek");
  seek.addEventListener("pointerdown", () => {
    seekDragging = true;
  });
  seek.addEventListener("pointerup", () => {
    seekDragging = false;
  });
  seek.addEventListener("input", () => {
    if (ignoreSeekInput) return;
    const { dur } = displayClock();
    if (!Number.isFinite(dur) || dur <= 0) return;
    const max = Number(seek.max);
    if (!Number.isFinite(max) || Math.abs(max - dur * 1000) > 50) return;
    const ctx = currentChapter();
    const fileTime = ctx
      ? filePositionFromDisplay(ctx.chapter, Number(seek.value) / 1000)
      : Number(seek.value) / 1000;
    applyPlaybackPosition(clampTime(fileTime));
    syncChapterFromTime({ toast: false });
    updatePlayerBar();
  });
  seek.addEventListener("change", () => {
    persistCurrent();
    seekDragging = false;
  });

  audio.addEventListener("timeupdate", () => {
    noteDriveFilePosition();
    noteDriveRetryPlaying();
    maybeRefreshDriveToken();
    maybeFixResumeSnap();
    syncChapterFromTime({ toast: true });
    updatePlayerBar();
    if (sleepUntil && Date.now() >= sleepUntil) {
      pauseForSleep("Sleep timer — paused");
      return;
    }
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
    stopPlaybackClock();
    persistCurrent();
    updatePlayerBar();
    updateMediaSession();
  });
  audio.addEventListener("play", () => {
    applyPlaybackRate();
    updatePlayerBar();
    updateMediaSession();
    startPlaybackClock();
  });
  audio.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) heldFileDuration = audio.duration;
    updatePlayerBar();
    updateChapterTimes();
  });
  audio.addEventListener("durationchange", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) heldFileDuration = audio.duration;
    updatePlayerBar();
    updateChapterTimes();
  });
  audio.addEventListener("error", () => {
    const src = audio.currentSrc || audio.src || "";
    if (!isDriveMediaPath(src)) return;
    const book = playback ? findBook(playback.bookId) : null;
    const http = lastDriveMediaHttp >= 400 ? lastDriveMediaHttp : 0;
    showPlaybackFailure(
      playbackFailureLine({
        title: book?.title,
        status: http,
        mediaError: http ? null : audio.error,
      })
    );
    if (http === 401) recoverDrivePlaybackAuth();
  });
  audio.addEventListener("ended", () => {
    stopPlaybackClock();
    persistCurrent();
    if (!playback) return;
    const book = findBook(playback.bookId);
    if (!book) return;
    if (sleepAtChapterEnd) {
      finishChapterSleep();
      return;
    }
    const next = playback.chapterIndex + 1;
    if (next < book.chapters.length) {
      const nextChapter = book.chapters[next];
      showToast(`Next: ${nextChapter.title}`);
      playChapter(book.id, next, { forceStart: true });
    } else {
      showToast("End of book");
      updatePlayerBar();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistCurrent();
  });

  bindMediaSession();
  applyPlaybackRate();
}

/** Reload into a new shell, but never cut off a chapter that is playing. */
function reloadWhenIdle() {
  if (!audio.paused && !audio.ended) {
    audio.addEventListener("pause", () => location.reload(), { once: true });
    return;
  }
  location.reload();
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let lastCheck = 0;
  /* A home-screen app resumed from the background never navigates, so it
     would keep an old shell forever without these foreground checks. */
  const checkForUpdate = () => {
    const now = Date.now();
    if (now - lastCheck < SW_CHECK_MS) return;
    lastCheck = now;
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {});
  };
  const swUrl = new URL("./sw.js", import.meta.url).href;
  /* Localhost and iOS must not keep a cached popup client. Desktop Pages
     stays cache-first aside from the shell version bump. */
  const swOptions = gisUsesRedirect(location.hostname, navigator) ? { updateViaCache: "none" } : undefined;
  navigator.serviceWorker
    .register(swUrl, swOptions)
    .then((reg) => {
      lastCheck = Date.now();
      return reg.update();
    })
    .catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) checkForUpdate();
  });
  window.addEventListener("focus", checkForUpdate);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || swReloading) return;
    swReloading = true;
    reloadWhenIdle();
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === DRIVE_MEDIA_ERROR_MESSAGE) {
      lastDriveMediaHttp = Number(event.data.status) || 0;
      const book = playback ? findBook(playback.bookId) : null;
      showPlaybackFailure(
        playbackFailureLine({
          title: book?.title,
          status: lastDriveMediaHttp,
        })
      );
      if (lastDriveMediaHttp === 401) recoverDrivePlaybackAuth();
      return;
    }
    if (event.data?.type !== DRIVE_UNAUTHORIZED_MESSAGE) return;
    lastDriveMediaHttp = 401;
    recoverDrivePlaybackAuth();
  });
}

function noteDriveFilePosition() {
  const t = audio.currentTime;
  if (Number.isFinite(t) && t > 0) driveFilePosition = t;
}

function drivePlaybackPosition() {
  const live = audio.currentTime;
  if (Number.isFinite(live) && live > 0.5) return live;
  if (driveFilePosition > 0) return driveFilePosition;
  return Number.isFinite(live) ? Math.max(0, live) : 0;
}

function maybeRefreshDriveToken() {
  if (!playback || audio.paused) return;
  const now = Date.now();
  if (now - driveTokenCheckAt < 15000) return;
  driveTokenCheckAt = now;
  const book = findBook(playback.bookId);
  const chapter = book?.chapters?.[playback.chapterIndex];
  if (!getAccessToken() || !chapterStreamsFromDrive(chapter) || freshAccessToken(now)) return;
  if (driveTokenRefresh) return;
  driveTokenRefresh = tokenForChapterFetch()
    .then((token) => publishDriveToken(token))
    .catch((err) => {
      if (classifyDriveError(err).kind === "abort") return;
      /* A real 401 replays once, then shows the inline message. */
    })
    .finally(() => {
      driveTokenRefresh = null;
    });
}

function noteDriveRetryPlaying() {
  if (!driveAuthRetryState || audio.paused) return;
  if ((audio.currentTime || 0) <= 0.2) return;
  driveAuthRetryState = finishDrivePlaybackAuthRetry(driveAuthRetryState, { ok: true });
  clearDriveError();
}

function recoverDrivePlaybackAuth() {
  if (driveAuthRecovering) return driveAuthRecovering;
  const plan = planDrivePlaybackAuthRetry(driveAuthRetryState, {
    bookId: playback?.bookId,
    chapterIndex: playback?.chapterIndex,
    position: drivePlaybackPosition(),
  });
  if (plan.state) driveAuthRetryState = plan.state;
  if (plan.action === "ignore") return Promise.resolve();
  if (plan.action !== "retry") {
    if (!audio.paused && (audio.readyState || 0) >= 2) return Promise.resolve();
    showDriveError({ name: "DriveAuthError", status: 401 });
    return Promise.resolve();
  }
  driveAuthRecovering = (async () => {
    try {
      const token = await refreshGoogleToken();
      await publishDriveToken(token);
      await playChapter(plan.bookId, plan.chapterIndex, {
        startAt: plan.position,
        authRetry: true,
      });
      driveAuthRetryState = finishDrivePlaybackAuthRetry(driveAuthRetryState, { ok: false });
      if (audio.error && isDriveMediaPath(audio.currentSrc || audio.src || "")) {
        showDriveError({ name: "DriveAuthError", status: 401 });
      }
    } catch (err) {
      driveAuthRetryState = finishDrivePlaybackAuthRetry(driveAuthRetryState, { ok: false });
      if (classifyDriveError(err).kind === "abort") return;
      showDriveError(err?.name ? err : { name: "DriveAuthError", status: 401 });
    } finally {
      driveAuthRecovering = null;
    }
  })();
  return driveAuthRecovering;
}

function showRestoredBooks(books) {
  const listed = booksFromLibrarySnapshot(books);
  attachUrls(listed);
  state.books = listed;
  state.activeBookId = null;
  render();
  return listed.length > 0;
}

async function restoreSession() {
  try {
    await loadOfflineIndex();
  } catch {
    /* IndexedDB unavailable (private mode) */
  }
  const store = libraryStore();
  const hasDriveSession = !!(loadDriveSession()?.folderId && isGoogleClientConfigured());
  const plan = planShelfRestore({
    savedShell: readLibraryShell(store),
    currentShell: APP_VERSION,
    hasDriveSession,
  });
  if (plan.invalidateSnapshot) applyShelfRestorePlan(store, plan);
  if (hasDriveSession) {
    await loadLibrary("drive-auto");
    if (state.books.length || plan.forceDriveRescan) return;
  }
  if (!plan.useSnapshot) return;
  const restored = restoreLibrarySnapshot();
  if (showRestoredBooks(restored)) return;
  if (restored.length && els.capabilityHint) {
    els.capabilityHint.textContent =
      "Sign in with Google again to keep listening. Your progress is still here.";
  }
}

function consumeOpenIntent() {
  const params = new URLSearchParams(location.search);
  let bookId = params.get("open");
  let pane = params.get("pane");
  if (bookId) {
    params.delete("open");
    params.delete("pane");
    const rest = params.toString();
    history.replaceState({}, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
  } else {
    try {
      const raw = sessionStorage.getItem(OPEN_INTENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        bookId = parsed?.bookId;
        pane = parsed?.pane;
        sessionStorage.removeItem(OPEN_INTENT_KEY);
      }
    } catch {
      /* private mode / bad JSON */
    }
  }
  if (!bookId || !findBook(bookId)) return;
  openBook(bookId, { pane: "audio" });
}

setDriveTokenAppliedListener(() => {
  clearStalePopupError();
  queueMicrotask(() => clearStalePopupError());
  setTimeout(() => clearStalePopupError(), 0);
});

setupCapabilityHint();
const versionEl = document.getElementById("app-version");
const shellWhere = isIosLikeClient(navigator)
  ? "mobile"
  : isLocalGisHost(location.hostname)
    ? "localhost"
    : "live";
const shellLabel = `v${APP_VERSION || "64"} · ${shellWhere}`;
if (versionEl) versionEl.textContent = shellLabel;
const shellBuild = document.getElementById("shell-build");
if (shellBuild) shellBuild.textContent = shellLabel;
const sortBtn = document.getElementById("btn-sort");
if (sortBtn) sortBtn.textContent = `Sort: ${state.sort}`;
if (isRiceShelfPage()) {
  initRiceShelf({
    onOpenBook(book) {
      openBook(book.id, { pane: "audio" });
      if (!isBookPlayable(book)) return;
      const p = loadProgress()[book.id];
      const idx = Math.max(
        0,
        book.chapters.findIndex((c) => c.id === p?.chapterId)
      );
      playChapter(book.id, idx === -1 ? 0 : idx, { resumeIfSame: true });
    },
    onNeedLibrary() {
      showChangeSourceSheet();
    },
  });
}
bind();
render();
registerSW();
Promise.resolve()
  .then(() => resumeLocalGisRedirect())
  .then((token) => (token ? loadLibrary("drive") : restoreSession()))
  .catch((err) => {
    showDriveError(err);
    return restoreSession();
  })
  .then(() => consumeOpenIntent());
