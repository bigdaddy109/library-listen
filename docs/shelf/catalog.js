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

export const VIEWS = ["covers", "spines", "topics"];

export const DEFAULT_VIEW = "covers";

export const VIEW_LABELS = {
  covers: "封面牆",
  spines: "書架",
  topics: "主題卡片",
};

export const OPEN_INTENT_KEY = "librarylisten.open.v1";

/**
 * Own motion — not a Gloss/Nutlope clone.
 * draw: pull off the plank + yaw spine→cover, then the front board uncases from the RIGHT.
 * pull: freeze after the yaw (cover faces the camera, still closed).
 * flip: freeze mid-uncase. open / reduced motion / ?spread=1 skip to the spread.
 * 3D is on for iPhone and iPad. Reduced motion is the only skip.
 */
export const PULL_TIMING = {
  totalMs: 820,
  extractMs: 420,
  openMs: 400,
};

export function openBookPhase({
  reducedMotion = false,
  spread = false,
  flip = false,
  pull = false,
  no3d = false,
} = {}) {
  if (spread || reducedMotion || no3d) return "open";
  if (flip) return "flip";
  if (pull) return "pull";
  return "draw";
}

/**
 * Cover wall → book: a 2D shared-element zoom onto the closed book, then the
 * front board swings open on its spine (rotateY, the only 3D). Closing runs it
 * backwards. Transform + opacity only; reduced motion switches instantly.
 */
export const COVER_MORPH = {
  openMs: 420,
  closeMs: 360,
  easing: "cubic-bezier(0.32, 0.72, 0, 1)",
  flipMs: 680,
  flipCloseMs: 560,
  flipEasing: "cubic-bezier(0.45, 0.05, 0.2, 1)",
};

function reverseFrames(frames) {
  return [...frames]
    .reverse()
    .map((f) => (f.offset == null ? f : { ...f, offset: 1 - f.offset }));
}

/**
 * Keyframes for the board swing; `opening: false` is the exact reverse.
 * The faces swap by opacity at offset 0.5, which (same duration + easing as
 * the leaf) is the edge-on rotateY(-90deg) moment, so engines that flatten 3D
 * and ignore backface-visibility still never show the mirrored side.
 */
export function bookFlipFrames(opening = true) {
  const frames = {
    leaf: [{ transform: "rotateY(0deg)" }, { transform: "rotateY(-180deg)" }],
    spread: [{ transform: "translateX(-25%)" }, { transform: "translateX(0)" }],
    endpaper: [{ opacity: 0 }, { opacity: 1 }],
    front: [
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.5 },
      { opacity: 0, offset: 0.5 },
      { opacity: 0, offset: 1 },
    ],
    back: [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: 0.5 },
      { opacity: 1, offset: 0.5 },
      { opacity: 1, offset: 1 },
    ],
    frontShade: [{ opacity: 0 }, { opacity: 0.35 }],
    backShade: [{ opacity: 0.35 }, { opacity: 0 }],
  };
  if (opening) return frames;
  return Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, reverseFrames(f)]));
}

export function coverTransitionMode({ reducedMotion = false, viewTransitions = false } = {}) {
  if (reducedMotion) return "none";
  return viewTransitions ? "view-transition" : "flip";
}

function usableRect(rect) {
  return (
    !!rect &&
    [rect.left, rect.top, rect.width, rect.height].every((n) => Number.isFinite(n)) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/** Transform (origin 0 0) that draws an element laid out at `to` over the `from` box. */
export function coverMorphTransform(from, to) {
  if (!usableRect(from) || !usableRect(to)) return null;
  const x = from.left - to.left;
  const y = from.top - to.top;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const r = (n) => Math.round(n * 1000) / 1000;
  return {
    x: r(x),
    y: r(y),
    sx: r(sx),
    sy: r(sy),
    css: `translate(${r(x)}px, ${r(y)}px) scale(${r(sx)}, ${r(sy)})`,
  };
}

export function pullOriginFromRect(rect) {
  if (!rect || !Number.isFinite(rect.width) || rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0, w: 24, h: 180, valid: false };
  }
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    w: rect.width,
    h: rect.height,
    valid: true,
  };
}

export function pullTransformVars(rect, viewport = {}) {
  const width = Number(viewport.width) > 0 ? Number(viewport.width) : 390;
  const height = Number(viewport.height) > 0 ? Number(viewport.height) : 844;
  const left = Number.isFinite(Number(viewport.left)) ? Number(viewport.left) : 0;
  const top = Number.isFinite(Number(viewport.top)) ? Number(viewport.top) : 0;
  const origin = pullOriginFromRect(rect);
  const yaw = Number.isFinite(viewport.yaw) ? viewport.yaw : origin.valid ? 76 : 0;
  const cx = left + width / 2;
  const cy = top + height / 2;
  let dx = origin.valid ? origin.x - cx : 0;
  let dy = origin.valid ? origin.y - cy : 0;
  const maxX = Math.max(width, 1) * 0.95;
  const maxY = Math.max(height, 1) * 0.95;
  dx = Math.max(-maxX, Math.min(maxX, dx));
  dy = Math.max(-maxY, Math.min(maxY, dy));
  return {
    fromX: `${Math.round(dx)}px`,
    fromY: `${Math.round(dy)}px`,
    fromW: `${Math.round(origin.w)}px`,
    fromH: `${Math.round(origin.h)}px`,
    fromYaw: `${yaw}deg`,
  };
}

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
  return VIEWS.includes(view) ? view : DEFAULT_VIEW;
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
 * Preview stand-ins so the homepage shelf looks complete on Pages without a folder pick.
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
