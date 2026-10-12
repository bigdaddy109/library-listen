/** Shelf preview catalog helpers. Safe to import from Node tests. */

import {
  bookHasAudio,
  bookHasEbook,
  latestProgressKind,
  loadProgress,
  shelfBadge,
} from "../library.js";
import {
  emptySearchMessage,
  filterBooks,
  shelfCountLabel,
  trimQuery,
} from "../search.js";

export const VIEWS = ["spines", "topics", "covers"];

export const VIEW_LABELS = {
  spines: "書架",
  topics: "主題卡片",
  covers: "封面牆",
};

export const OPEN_INTENT_KEY = "librarylisten.open.v1";

/** One accent per series. Invented for this preview — not copied from another product. */
export const SERIES = {
  school: {
    id: "school",
    title: "上學不容易",
    author: "Library",
    accent: "#c45c3e",
    ink: "#5a2a1c",
    paper: "#f3e4d4",
    cloth: "#b4532f",
  },
  munroe: {
    id: "munroe",
    title: "門羅 What If",
    author: "Randall Munroe",
    accent: "#3d6b6a",
    ink: "#1d3333",
    paper: "#dce8e4",
    cloth: "#2f5857",
  },
  immune: {
    id: "immune",
    title: "Immune",
    author: "Philipp Dettmer",
    accent: "#8b3a4a",
    ink: "#3a1520",
    paper: "#f0dce0",
    cloth: "#7a3040",
  },
};

export const SERIES_ORDER = ["school", "munroe", "immune"];

export function hashString(value) {
  let h = 2166136261;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seriesIdForBook(book) {
  const hay = [book?.collectionId, book?.collectionTitle, book?.folder, book?.id, book?.title]
    .map((s) => String(s || ""))
    .join(" ");
  if (/immune/i.test(hay)) return "immune";
  if (/munroe|whatif|what-if|門羅/i.test(hay)) return "munroe";
  if (/上學|school/i.test(hay)) return "school";
  const id = String(book?.collectionId || "").toLowerCase();
  return SERIES[id] ? id : "other";
}

export function seriesMeta(bookOrId) {
  const id = typeof bookOrId === "string" ? bookOrId : seriesIdForBook(bookOrId);
  return (
    SERIES[id] || {
      id: id || "other",
      title: typeof bookOrId === "object" ? bookOrId?.collectionTitle || "其他" : "其他",
      author: "Unknown",
      accent: "#6b6358",
      ink: "#2a261f",
      paper: "#ebe4d6",
      cloth: "#5c564c",
    }
  );
}

export function normalizeView(view) {
  return VIEWS.includes(view) ? view : "spines";
}

function demoBook({
  id,
  collectionId,
  folder,
  title,
  subtitle,
  author,
  chapters = [],
  ebook = null,
}) {
  const series = seriesMeta(collectionId);
  return {
    id,
    collectionId,
    collectionTitle: series.title,
    folder,
    title,
    subtitle,
    author: author || series.author,
    coverFile: null,
    coverUrl: null,
    chapters,
    ebook,
    preview: true,
  };
}

function parts(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `Part${String(i + 1).padStart(2, "0")}.mp3`,
    index: i,
    title: `Part ${String(i + 1).padStart(2, "0")}`,
    file: null,
    url: null,
  }));
}

/**
 * Preview stand-ins so /shelf/ looks complete on Pages without a folder pick.
 * Ids for Munroe / Immune match library.js so existing progress can show.
 */
export function demoCatalog() {
  return [
    demoBook({
      id: "school/kaixue",
      collectionId: "school",
      folder: "kaixue",
      title: "開學",
      subtitle: "Preview stand-in — not a scanned file",
      chapters: parts(4),
    }),
    demoBook({
      id: "school/gongke",
      collectionId: "school",
      folder: "gongke",
      title: "功課",
      subtitle: "Preview stand-in — not a scanned file",
      chapters: parts(3),
      ebook: { id: "gongke.epub", name: "gongke.epub", file: null },
    }),
    demoBook({
      id: "school/fangjia",
      collectionId: "school",
      folder: "fangjia",
      title: "放假",
      subtitle: "Preview stand-in — not a scanned file",
      ebook: { id: "fangjia.epub", name: "fangjia.epub", file: null },
    }),
    demoBook({
      id: "munroe/what-if-1",
      collectionId: "munroe",
      folder: "what-if-1",
      title: "What If?",
      subtitle: "Serious Scientific Answers to Absurd Hypothetical Questions",
      author: "Randall Munroe",
      chapters: parts(6),
      ebook: { id: "what-if-1.epub", name: "what-if-1.epub", file: null },
    }),
    demoBook({
      id: "munroe/how-to",
      collectionId: "munroe",
      folder: "how-to",
      title: "How To",
      subtitle: "Absurd Scientific Advice for Common Real-World Problems",
      author: "Randall Munroe",
      chapters: parts(5),
    }),
    demoBook({
      id: "munroe/what-if-2",
      collectionId: "munroe",
      folder: "what-if-2",
      title: "What If? 2",
      subtitle: "Additional Serious Scientific Answers to Absurd Hypothetical Questions",
      author: "Randall Munroe",
      chapters: parts(1),
    }),
    demoBook({
      id: "immune/immune",
      collectionId: "immune",
      folder: "immune",
      title: "Immune",
      subtitle: "A Journey into the Mysterious System That Keeps You Alive",
      author: "Philipp Dettmer",
      chapters: parts(9),
      ebook: { id: "immune.epub", name: "immune.epub", file: null },
    }),
  ];
}

export function seriesChips(books) {
  const list = Array.isArray(books) ? books : [];
  const counts = new Map();
  for (const book of list) {
    const id = seriesIdForBook(book);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const chips = [{ id: "all", title: "全部", count: list.length, accent: "#1c1914" }];
  const seen = new Set();
  for (const id of SERIES_ORDER) {
    if (!counts.has(id)) continue;
    seen.add(id);
    chips.push({ ...seriesMeta(id), count: counts.get(id) });
  }
  for (const [id, count] of counts) {
    if (id === "all" || seen.has(id)) continue;
    chips.push({ ...seriesMeta(id), count });
  }
  return chips;
}

export function filterShelf(books, { query = "", seriesId = "all" } = {}) {
  const list = Array.isArray(books) ? books : [];
  const narrowed =
    seriesId && seriesId !== "all"
      ? list.filter((book) => seriesIdForBook(book) === seriesId)
      : list;
  return filterBooks(narrowed, query);
}

export function groupBySeries(books) {
  const groups = [];
  const index = new Map();
  for (const book of books || []) {
    const id = seriesIdForBook(book);
    if (!index.has(id)) {
      const group = { id, series: seriesMeta(book), books: [] };
      index.set(id, group);
      groups.push(group);
    }
    index.get(id).books.push(book);
  }
  return groups;
}

export function volumeNumber(book, booksInSeries) {
  const list = Array.isArray(booksInSeries) ? booksInSeries : [];
  const idx = list.findIndex((b) => b.id === book?.id);
  return idx >= 0 ? idx + 1 : 1;
}

export function mediaFlags(book) {
  return {
    audio: bookHasAudio(book),
    read: bookHasEbook(book),
    badge: shelfBadge(book),
  };
}

export function previewProgress(book, store) {
  const record = loadProgress(store)[book?.id];
  if (!record) return { line: "尚未開始", fraction: null };
  if (latestProgressKind(record) === "text") {
    const fraction = Number.isFinite(record.text?.fraction) ? record.text.fraction : null;
    let line = record.text?.label || "閱讀中";
    if (fraction != null) line += ` · ${Math.round(fraction * 100)}%`;
    return { line, fraction };
  }
  const chapter =
    (book?.chapters || []).find((c) => c.id === record.chapterId) || book?.chapters?.[0];
  if (!chapter) return { line: "尚未開始", fraction: null };
  const dur = record.chapterDurationSeconds;
  const pos = record.positionSeconds || 0;
  const fraction = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : null;
  let line = chapter.title || "收聽中";
  if (fraction != null) line += ` · ${Math.round(fraction * 100)}%`;
  return { line, fraction };
}

export function parseOpenIntent(search) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const bookId = params.get("open");
  if (!bookId) return null;
  return { bookId, pane: params.get("pane") === "read" ? "read" : "audio" };
}

export function stripOpenIntent(search) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  params.delete("open");
  params.delete("pane");
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function playerOpenUrl(bookId, pane) {
  const params = new URLSearchParams();
  params.set("open", bookId);
  if (pane === "read" || pane === "audio") params.set("pane", pane);
  return `../index.html?${params.toString()}`;
}

export function shelfStatusLabel(count, query, seriesId) {
  const base = shelfCountLabel(count, query);
  if (seriesId && seriesId !== "all" && !trimQuery(query)) {
    return `${base} · ${seriesMeta(seriesId).title}`;
  }
  return base;
}

export function emptyShelfMessage(query, seriesId) {
  const searchEmpty = emptySearchMessage(query);
  if (searchEmpty) return searchEmpty;
  if (seriesId && seriesId !== "all") return `這個系列還沒有書。`;
  return "";
}

export { emptySearchMessage, shelfCountLabel, trimQuery };
