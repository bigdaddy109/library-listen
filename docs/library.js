/** Pure library scan, title, and progress helpers. Safe to import from Node tests. */

export const AUDIO_EXT = new Set(["mp3", "m4a", "m4b", "aac"]);
export const COVER_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
export const EPUB_EXT = new Set(["epub"]);
export const SKIP_FOLDERS = new Set(["_source"]);

export const KNOWN_COLLECTIONS = {
  "門羅-WhatIf": { id: "munroe", title: "Munroe", author: "Randall Munroe" },
  Immune: { id: "immune", title: "Immune", author: "Philipp Dettmer" },
};

export const KNOWN_BOOKS = {
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

export const PROGRESS_KEY = "librarylisten.progress.v1";
/** IndexedDB offline row key for the paired EPUB blob (same store as chapters). */
export const EBOOK_OFFLINE_KEY = "__ebook__";

export function extOf(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function slug(value) {
  const folded = value.normalize("NFKD").replace(/\p{M}/gu, "");
  const cleaned = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "collection";
}

export function humanize(value) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function knownCollectionFolders(known = KNOWN_COLLECTIONS) {
  return Object.keys(known || {});
}

/**
 * Copy for an empty scan. Folder names come from KNOWN_COLLECTIONS so a
 * preview-only title (上學不容易 on /shelf/) is not listed until that
 * folder is a known player collection.
 */
export function emptyLibraryMessage(entries, skipped, known = KNOWN_COLLECTIONS) {
  const list = Array.isArray(entries) ? entries : [];
  const audio = list.filter((e) => AUDIO_EXT.has(extOf(e?.file?.name || "")));
  const samples = audio
    .slice(0, 3)
    .map((e) => e.path || e.file?.name)
    .filter(Boolean)
    .join("\n");
  const folders = knownCollectionFolders(known);
  const folderHint = folders.length ? ` (or ${folders.join(" / ")})` : "";
  let msg =
    "No audiobooks found.\n\n" +
    `Files seen: ${list.length} (audio: ${audio.length}` +
    (skipped ? `, skipped/unread: ${skipped}` : "") +
    ").\n\n" +
    `Pick the Library folder${folderHint} that contains listen/ with mp3/m4b.\n` +
    "On iPhone/iPad: in Files, tap Download Now on listen/ first.\n" +
    "Or 用 Google 登入 and open the shared Drive Library.";
  if (samples) msg += `\n\nSample paths:\n${samples}`;
  return msg;
}

export function collectionMeta(folder) {
  return (
    KNOWN_COLLECTIONS[folder] || {
      id: slug(folder),
      title: humanize(folder),
      author: "Unknown",
    }
  );
}

export function bookMeta(folder, collectionAuthor) {
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

export function titleFromFilename(fileName) {
  const base = fileName.replace(/\.[^.]+$/, "");
  const part = base.match(/(?:^|[-_\s])part\s*0*(\d+)$/i);
  if (part) return `Part ${String(Number(part[1])).padStart(2, "0")}`;
  const numbered = base.replace(/^\s*\d+\s*[-.)]+\s*/, "").trim();
  return numbered || base;
}

export function normalizeRelPath(path) {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function pathParts(path) {
  return normalizeRelPath(path)
    .split("/")
    .filter((p) => p && p !== ".");
}

export function shouldSkipPath(parts) {
  return parts.some((p) => p.startsWith("_") || SKIP_FOLDERS.has(p.toLowerCase()));
}

export function ebookFolderIndex(parts) {
  return parts.map((p) => p.toLowerCase()).lastIndexOf("ebooks");
}

export function isUnderEbookFolder(parts) {
  return ebookFolderIndex(parts) >= 0;
}

export function pairingKey(collectionFolder, bookFolder) {
  return `${collectionFolder}::${slug(bookFolder)}`;
}

/**
 * Pair Library/ebooks/<book>.epub (or ebooks/<book>/file.epub) to a listen book.
 * Collection-scoped siblings use Collection/ebooks/ next to Collection/listen/.
 */
export function locateEbookPath(parts) {
  const ebookIdx = ebookFolderIndex(parts);
  if (ebookIdx < 0) return null;
  const collectionFolder = ebookIdx > 0 ? parts[ebookIdx - 1] : "Library";
  const rest = parts.slice(ebookIdx + 1);
  if (rest.length === 0) return null;
  if (rest.length === 1) {
    const name = rest[0];
    if (!EPUB_EXT.has(extOf(name))) return null;
    const stem = name.replace(/\.[^.]+$/, "");
    return { collectionFolder, bookFolder: slug(stem) };
  }
  return { collectionFolder, bookFolder: slug(rest[0]) };
}

export function bookHasAudio(book) {
  return (book?.chapters || []).length > 0;
}

export function bookHasEbook(book) {
  return !!(book?.ebook?.file || book?.ebook?.name || book?.ebook?.id);
}

/** Shelf badge: Audio, Read, or Both. */
export function shelfBadge(book) {
  const audio = bookHasAudio(book);
  const read = bookHasEbook(book);
  if (audio && read) return "Both";
  if (read) return "Read";
  return "Audio";
}

export function isImmuneBook(book) {
  return book?.collectionId === "immune" || String(book?.id || "").startsWith("immune/");
}

/**
 * Book-screen tabs. Empty means no tab bar (audio-only, or ebook-only).
 * Immune keeps Concepts; a paired EPUB adds Read beside Audio.
 */
export function bookScreenTabs(book) {
  const audio = bookHasAudio(book);
  const read = bookHasEbook(book);
  const immune = isImmuneBook(book);
  const tabs = [];
  if (audio && (read || immune)) tabs.push("audio");
  if (audio && read) tabs.push("read");
  if (immune) tabs.push("concepts");
  return tabs;
}

/**
 * Guess collection/book folders from a relative path.
 * Supports Library/Collection/listen/Book/file and shorter picks.
 */
export function locateBookPath(parts) {
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

function defaultStore() {
  try {
    if (typeof globalThis.localStorage !== "undefined") return globalThis.localStorage;
  } catch {
    /* private mode / Node */
  }
  throw new Error("localStorage is not available");
}

export function loadProgress(store = defaultStore()) {
  try {
    return JSON.parse(store.getItem(PROGRESS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function chapterProgress(bookId, chapterId, store = defaultStore()) {
  const book = loadProgress(store)[bookId];
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

export function resumeSeconds(saved) {
  if (!saved || !Number.isFinite(saved.positionSeconds)) return 0;
  const pos = saved.positionSeconds;
  const dur = saved.chapterDurationSeconds;
  if (dur > 0 && pos >= dur - 2) return 0;
  return pos;
}

export function saveProgress(
  bookId,
  chapterId,
  positionSeconds,
  chapterDurationSeconds,
  store = defaultStore()
) {
  const all = loadProgress(store);
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
    lastKind: "audio",
    chapters,
    text: previous.text || undefined,
  };
  store.setItem(PROGRESS_KEY, JSON.stringify(all));
}

export function textProgress(bookId, store = defaultStore()) {
  const book = loadProgress(store)[bookId];
  const text = book?.text;
  if (!text || !text.kind || !text.locator) return null;
  return text;
}

/**
 * Save a text locator on the same bookId without wiping audio chapters.
 * `kind` is epub-cfi (pdf-page / txt-offset wait for those readers).
 */
export function saveTextProgress(bookId, text, store = defaultStore()) {
  const all = loadProgress(store);
  const previous = all[bookId] || {};
  const now = new Date().toISOString();
  const kind = text?.kind;
  const locator = typeof text?.locator === "string" ? text.locator.trim() : "";
  if (!kind || !locator) return previous.text || null;
  const record = {
    kind,
    locator,
    updatedAt: now,
  };
  if (Number.isFinite(Number(text.fraction))) {
    const n = Number(text.fraction);
    record.fraction = Math.min(1, Math.max(0, n));
  }
  if (typeof text.label === "string" && text.label.trim()) record.label = text.label.trim();
  all[bookId] = {
    ...previous,
    text: record,
    lastKind: "text",
    updatedAt: now,
  };
  store.setItem(PROGRESS_KEY, JSON.stringify(all));
  return record;
}

/** Continue uses whichever of audio vs text was written last. */
export function latestProgressKind(record) {
  if (!record) return null;
  if (record.lastKind === "text" && record.text?.locator) return "text";
  if (record.lastKind === "audio" && record.chapterId) return "audio";
  const audioAt = record.chapterId
    ? record.chapters?.[record.chapterId]?.updatedAt ||
      (Number.isFinite(record.positionSeconds) ? record.updatedAt : null)
    : null;
  const textAt = record.text?.updatedAt || null;
  if (!audioAt && !textAt) return null;
  if (textAt && (!audioAt || textAt >= audioAt)) return "text";
  return "audio";
}

export function isEbookSavedOffline(saved) {
  if (!saved) return false;
  if (typeof saved.has === "function") return saved.has(EBOOK_OFFLINE_KEY);
  return !!saved[EBOOK_OFFLINE_KEY];
}

function nameSort(a, b) {
  return a.file.name.localeCompare(b.file.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function pickCoverFile(files) {
  const covers = files.filter((f) => COVER_EXT.has(extOf(f.file.name)));
  covers.sort((a, b) => {
    const score = (name) => {
      const n = name.toLowerCase();
      if (n.includes("cover")) return 0;
      if (n.includes("folder")) return 1;
      return 2;
    };
    return score(a.file.name) - score(b.file.name);
  });
  return covers[0]?.file || null;
}

function pickEbookEntry(files) {
  return files.filter((f) => EPUB_EXT.has(extOf(f.file.name))).sort(nameSort)[0] || null;
}

function ebookRecord(entry) {
  if (!entry?.file) return null;
  return {
    id: entry.file.name,
    name: entry.file.name,
    file: entry.file,
  };
}

function makeBook({ collectionFolder, bookFolder, audioFiles, coverFile, ebook }) {
  const collection = collectionMeta(collectionFolder);
  const meta = bookMeta(bookFolder, collection.author);
  const chapters = audioFiles.map((f, index) => ({
    id: f.file.name,
    index,
    title: titleFromFilename(f.file.name),
    file: f.file,
    url: null,
  }));
  return {
    id: `${collection.id}/${slug(bookFolder)}`,
    collectionId: collection.id,
    collectionTitle: collection.title,
    folder: bookFolder,
    title: meta.title,
    subtitle: meta.subtitle,
    author: meta.author,
    coverFile,
    coverUrl: null,
    chapters,
    ebook,
  };
}

/**
 * Build shelf books from a flat path+file list.
 * Pairs listen/ audio to sibling ebooks/<book>.epub (PDF is ignored).
 * @param {{ path: string, file: { name: string, size?: number } }[]} entries
 */
export function buildLibrary(entries) {
  const usable = entries.filter((e) => {
    const parts = pathParts(e.path || e.file?.name || "");
    if (shouldSkipPath(parts)) return false;
    if (!e.file?.name) return false;
    const ext = extOf(e.file.name);
    if (!(AUDIO_EXT.has(ext) || COVER_EXT.has(ext) || EPUB_EXT.has(ext))) return false;
    if ((AUDIO_EXT.has(ext) || EPUB_EXT.has(ext)) && e.file.size === 0) return false;
    return true;
  });

  /** @type {Map<string, { collectionFolder: string, bookFolder: string, files: { path: string, file: { name: string, size?: number } }[] }>} */
  const listenGroups = new Map();
  /** @type {Map<string, { collectionFolder: string, bookFolder: string, files: { path: string, file: { name: string, size?: number } }[] }>} */
  const ebookGroups = new Map();

  for (const entry of usable) {
    const parts = pathParts(entry.path || entry.file.name);
    if (isUnderEbookFolder(parts)) {
      const located = locateEbookPath(parts);
      if (!located) continue;
      const key = pairingKey(located.collectionFolder, located.bookFolder);
      if (!ebookGroups.has(key)) {
        ebookGroups.set(key, { ...located, files: [] });
      }
      ebookGroups.get(key).files.push(entry);
      continue;
    }
    const ext = extOf(entry.file.name);
    if (!(AUDIO_EXT.has(ext) || COVER_EXT.has(ext))) continue;
    const located = locateBookPath(parts);
    if (!located) continue;
    const { collectionFolder, bookFolder } = located;
    const key = pairingKey(collectionFolder, bookFolder);
    if (!listenGroups.has(key)) {
      listenGroups.set(key, { collectionFolder, bookFolder, files: [] });
    }
    listenGroups.get(key).files.push(entry);
  }

  const books = [];
  const pairedEbookKeys = new Set();

  for (const group of listenGroups.values()) {
    const audioFiles = group.files.filter((f) => AUDIO_EXT.has(extOf(f.file.name))).sort(nameSort);
    if (!audioFiles.length) continue;
    const key = pairingKey(group.collectionFolder, group.bookFolder);
    const ebookGroup = ebookGroups.get(key);
    const ebook = ebookRecord(pickEbookEntry(ebookGroup?.files || []));
    if (ebook) pairedEbookKeys.add(key);
    books.push(
      makeBook({
        collectionFolder: group.collectionFolder,
        bookFolder: group.bookFolder,
        audioFiles,
        coverFile: pickCoverFile(group.files) || pickCoverFile(ebookGroup?.files || []),
        ebook,
      })
    );
  }

  for (const [key, group] of ebookGroups) {
    if (pairedEbookKeys.has(key)) continue;
    const ebook = ebookRecord(pickEbookEntry(group.files));
    if (!ebook) continue;
    books.push(
      makeBook({
        collectionFolder: group.collectionFolder,
        bookFolder: group.bookFolder,
        audioFiles: [],
        coverFile: pickCoverFile(group.files),
        ebook,
      })
    );
  }

  return books.sort((a, b) => {
    const c = a.collectionTitle.localeCompare(b.collectionTitle);
    if (c) return c;
    return a.title.localeCompare(b.title);
  });
}
