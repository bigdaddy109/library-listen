import {
  AUDIO_EXT,
  EPUB_EXT,
  SKIP_FOLDERS,
  bookHasAudio,
  bookHasEbook,
  buildLibrary,
  extOf,
  shelfBadge,
} from "../library.js?v=37";
import { matchingChapterTitles, chapterHitLine, trimQuery } from "../search.js?v=37";
import {
  OPEN_INTENT_KEY,
  VIEWS,
  VIEW_LABELS,
  demoCatalog,
  emptyShelfMessage,
  filterShelf,
  groupBySeries,
  mediaFlags,
  normalizeView,
  isWebKitBook3dUnsafe,
  openBookPhase,
  PULL_TIMING,
  pullTransformVars,
  playerOpenUrl,
  previewProgress,
  seriesChips,
  seriesIdForBook,
  seriesMeta,
  shelfStatusLabel,
  volumeNumber,
} from "./catalog.js?v=37";
import { coverSvg, spineMetrics, topicMotifSvg } from "./covers.js?v=37";

const VIEW_KEY = "librarylisten.shelfView";
const SERIES_KEY = "librarylisten.shelfSeries";

const state = {
  source: "demo",
  books: demoCatalog(),
  query: "",
  seriesId: "all",
  view: "spines",
  liftedId: null,
  selectedId: null,
  phase: "shelf",
};

const els = {
  stage: document.getElementById("stage"),
  chips: document.getElementById("series-chips"),
  count: document.getElementById("shelf-count"),
  query: document.getElementById("shelf-query"),
  clear: document.getElementById("btn-clear-search"),
  hint: document.getElementById("load-hint"),
  layer: document.getElementById("book-layer"),
  bookStage: document.getElementById("book-stage"),
  toast: document.getElementById("toast"),
  fileDir: document.getElementById("file-input-dir"),
  fileFiles: document.getElementById("file-input-files"),
};

let toastTimer = null;
let coverTimer = null;
const coarsePointer = window.matchMedia("(hover: none)").matches;

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.add("hidden"), 2400);
}

function visibleBooks() {
  return filterShelf(state.books, { query: state.query, seriesId: state.seriesId });
}

function findBook(id) {
  return state.books.find((b) => b.id === id) || null;
}

function persistChrome() {
  try {
    localStorage.setItem(VIEW_KEY, state.view);
    localStorage.setItem(SERIES_KEY, state.seriesId);
  } catch {
    /* private mode */
  }
}

function restoreChrome() {
  try {
    state.view = normalizeView(localStorage.getItem(VIEW_KEY));
    const series = localStorage.getItem(SERIES_KEY);
    if (series) state.seriesId = series;
  } catch {
    /* private mode */
  }
}

let shelfOptions = { onOpenBook: null, onNeedLibrary: null };
let shelfBound = false;

function sameBookIds(next) {
  return (
    state.books.length === next.length &&
    state.books.every((book, i) => book.id === next[i]?.id)
  );
}

function updateHint() {
  if (!els.hint) return;
  els.hint.textContent =
    state.source === "library"
      ? `已載入 ${state.books.length} 本書。聽／讀在這一頁打開。`
      : "尚未選庫時顯示示範書。登入或選資料夾後即可聽／讀。";
}

function setLibrary(books, source = "library") {
  const next = Array.isArray(books) ? books : [];
  const unchanged = state.source === source && sameBookIds(next);
  state.books = next;
  state.source = source;
  if (!unchanged) {
    state.liftedId = null;
    closeBook();
  }
  updateHint();
  render();
}

function filteredMessage(books) {
  els.count.textContent = shelfStatusLabel(books.length, state.query, state.seriesId);
  els.clear?.classList.toggle("hidden", !trimQuery(state.query));
}

function renderChips() {
  const chips = seriesChips(state.books);
  els.chips.innerHTML = "";
  for (const chip of chips) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.setAttribute("aria-pressed", chip.id === state.seriesId ? "true" : "false");
    const dot = document.createElement("span");
    dot.className = "chip-dot";
    dot.style.setProperty("--accent", chip.accent);
    dot.style.background = chip.accent;
    btn.append(dot, document.createTextNode(`${chip.title} ${chip.count}`));
    btn.addEventListener("click", () => {
      state.seriesId = chip.id;
      persistChrome();
      render();
    });
    els.chips.appendChild(btn);
  }
}

function renderViews() {
  for (const btn of document.querySelectorAll(".view-toggle [data-view]")) {
    const view = btn.getAttribute("data-view");
    btn.textContent = VIEW_LABELS[view] || view;
    btn.setAttribute("aria-pressed", view === state.view ? "true" : "false");
  }
}

function tipText(book) {
  const hits = chapterHitLine(matchingChapterTitles(book, state.query));
  const badge = shelfBadge(book);
  return hits ? `${badge} · ${hits}` : badge;
}

function liftSpine(id) {
  state.liftedId = id;
  for (const el of els.stage.querySelectorAll(".spine")) {
    el.classList.toggle("is-lifted", el.dataset.id === id);
  }
}

function spineButton(book) {
  const series = seriesMeta(book);
  const metrics = spineMetrics(book);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "spine";
  btn.dataset.id = book.id;
  btn.style.setProperty("--w", `${metrics.thickness}px`);
  btn.style.setProperty("--h", `${metrics.height}px`);
  btn.style.setProperty("--cloth", series.cloth);
  btn.style.setProperty("--lean", `${metrics.lean}deg`);
  btn.setAttribute("aria-label", `${book.title} · ${shelfBadge(book)}`);
  btn.innerHTML = `
    <span class="spine-box">
      <span class="spine-cloth">
        <span class="spine-label"></span>
        <span class="spine-title"></span>
      </span>
      <span class="spine-fore" aria-hidden="true"></span>
      <span class="spine-head" aria-hidden="true"></span>
    </span>
    <span class="spine-tip"><strong></strong><span></span></span>
  `;
  btn.querySelector(".spine-title").textContent = book.title;
  btn.querySelector(".spine-tip strong").textContent = book.title;
  btn.querySelector(".spine-tip span").textContent = tipText(book);
  btn.addEventListener("pointerenter", () => liftSpine(book.id));
  btn.addEventListener("focus", () => liftSpine(book.id));
  btn.addEventListener("click", () => {
    if (coarsePointer && state.liftedId !== book.id) {
      liftSpine(book.id);
      return;
    }
    openFromShelf(book);
  });
  if (state.liftedId === book.id) btn.classList.add("is-lifted");
  return btn;
}

function renderSpines(books) {
  const groups = groupBySeries(books);
  const root = document.createDocumentFragment();
  for (const group of groups) {
    const block = document.createElement("section");
    block.className = "plank-block";
    const label = document.createElement("p");
    label.className = "plank-label";
    label.innerHTML = `<strong></strong><span></span>`;
    label.querySelector("strong").textContent = group.series.title;
    label.querySelector("span").textContent = `${group.books.length}`;
    const plank = document.createElement("div");
    plank.className = "plank";
    for (const book of group.books) plank.appendChild(spineButton(book));
    block.append(label, plank);
    root.appendChild(block);
  }
  els.stage.appendChild(root);
}

function renderTopics(books) {
  const groups = groupBySeries(books);
  const grid = document.createElement("div");
  grid.className = "topics";
  for (const group of groups) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "topic-card";
    card.style.setProperty("--accent", group.series.accent);
    card.innerHTML = `${topicMotifSvg(group.id)}<h2></h2><p></p><div class="topic-chart"></div>`;
    card.querySelector("h2").textContent = group.series.title;
    card.querySelector("p").textContent = `${group.books.length} 本`;
    const chart = card.querySelector(".topic-chart");
    for (const book of group.books) {
      const bar = document.createElement("i");
      bar.style.height = `${Math.round(spineMetrics(book).height / 8)}px`;
      bar.style.background = group.series.accent;
      chart.appendChild(bar);
    }
    card.addEventListener("click", () => {
      state.seriesId = group.id;
      state.view = "covers";
      persistChrome();
      render();
    });
    grid.appendChild(card);
  }
  els.stage.appendChild(grid);
}

function renderCovers(books) {
  const grid = document.createElement("div");
  grid.className = "covers";
  for (const book of books) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "cover-card";
    card.dataset.id = book.id;
    card.innerHTML = `<span class="cover-art"></span><h3></h3><p></p>`;
    card.querySelector(".cover-art").innerHTML = coverSvg(book);
    card.querySelector("h3").textContent = book.title;
    card.querySelector("p").textContent = `${book.author} · ${shelfBadge(book)}`;
    card.addEventListener("click", () => openFromShelf(book));
    grid.appendChild(card);
  }
  els.stage.appendChild(grid);
}

function render() {
  const books = visibleBooks();
  renderViews();
  renderChips();
  filteredMessage(books);
  els.stage.innerHTML = "";
  if (!books.length) {
    const empty = document.createElement("p");
    empty.className = "shelf-empty";
    empty.textContent = emptyShelfMessage(state.query, state.seriesId) || "書架是空的。";
    els.stage.appendChild(empty);
    return;
  }
  if (state.view === "topics") renderTopics(books);
  else if (state.view === "covers") renderCovers(books);
  else renderSpines(books);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function book3dDisabled() {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  return (
    prefersReducedMotion() ||
    isWebKitBook3dUnsafe(nav?.userAgent || "", {
      touchMacPad: nav?.platform === "MacIntel" && nav.maxTouchPoints > 1,
    })
  );
}

function applyNoBook3dClass() {
  if (typeof document === "undefined" || !book3dDisabled()) return;
  document.documentElement.classList.add("no-book-3d");
}

function markDrawnSpine(bookId, drawn) {
  for (const el of els.stage?.querySelectorAll(".spine, .cover-card") || []) {
    el.classList.toggle("is-drawn", Boolean(drawn) && el.dataset.id === bookId);
  }
}

function originRectForBook(book) {
  if (!book?.id || !els.stage) return null;
  const id = book.id;
  for (const el of els.stage.querySelectorAll(".spine, .cover-card")) {
    if (el.dataset.id === id) return el.getBoundingClientRect();
  }
  return null;
}

function closeBook() {
  window.clearTimeout(coverTimer);
  markDrawnSpine(state.selectedId, false);
  state.selectedId = null;
  state.phase = "shelf";
  els.layer.classList.add("hidden");
  els.layer.hidden = true;
  els.bookStage.innerHTML = "";
}

function openFromShelf(book, phaseHint) {
  state.selectedId = book.id;
  state.phase =
    phaseHint ||
    openBookPhase({ reducedMotion: prefersReducedMotion(), no3d: book3dDisabled() });
  markDrawnSpine(book.id, true);
  els.layer.classList.remove("hidden");
  els.layer.hidden = false;
  renderSpread(book, state.phase);
}

function drawRootClass(phase) {
  if (phase === "open") return "is-open";
  if (phase === "flip") return "is-facing is-opening is-flipping is-frozen";
  if (phase === "pull") return "is-facing is-frozen";
  return "is-drawing";
}

function applyPullVars(root, book) {
  if (!root) return;
  const rect = originRectForBook(book);
  const vars = pullTransformVars(rect, {
    width: window.innerWidth,
    height: window.innerHeight,
    yaw: state.view === "covers" ? 8 : 76,
  });
  root.style.setProperty("--from-x", vars.fromX);
  root.style.setProperty("--from-y", vars.fromY);
  root.style.setProperty("--from-w", vars.fromW);
  root.style.setProperty("--from-h", vars.fromH);
  root.style.setProperty("--from-yaw", vars.fromYaw);
}

function playDraw(root) {
  window.clearTimeout(coverTimer);
  if (!root || book3dDisabled()) {
    root?.classList.add("is-open");
    state.phase = "open";
    return;
  }
  const start = () => {
    root.classList.remove("is-drawing");
    root.classList.add("is-facing");
    coverTimer = window.setTimeout(() => {
      root.classList.add("is-opening");
      coverTimer = window.setTimeout(() => {
        root.classList.add("is-open");
        root.querySelector(".book-3d")?.setAttribute("aria-hidden", "true");
        state.phase = "open";
      }, PULL_TIMING.openMs);
    }, PULL_TIMING.extractMs);
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(start));
}

function renderSpread(book, phase = "open") {
  const series = seriesMeta(book);
  const flags = mediaFlags(book);
  const siblings = state.books.filter((b) => seriesIdForBook(b) === series.id);
  const volume = String(volumeNumber(book, siblings)).padStart(2, "0");
  const progress = previewProgress(book);
  const playable = bookHasAudio(book) && book.chapters.some((ch) => ch.file);
  const readable = bookHasEbook(book) && !!book.ebook?.file;
  const rootClass = drawRootClass(phase);
  els.bookStage.innerHTML = `
    <div class="draw-root ${rootClass}">
      <div class="book-3d" aria-hidden="${phase === "open" ? "true" : "false"}">
        <div class="book-3d-cover">${coverSvg(book, { width: 240, height: 330 })}</div>
        <div class="book-3d-spine"><span class="book-3d-spine-title"></span></div>
        <div class="book-3d-fore" aria-hidden="true"></div>
        <div class="book-3d-top" aria-hidden="true"></div>
        <div class="book-3d-bottom" aria-hidden="true"></div>
        <div class="book-3d-back" aria-hidden="true"></div>
      </div>
      <article class="spread">
        <section class="page left">
          <div class="bookplate">
            <div class="bookplate-card">
              <div class="seal" style="--accent:${series.accent}">藏</div>
              <p>藏書票</p>
              <strong></strong>
              <p class="vol"></p>
            </div>
          </div>
        </section>
        <section class="page right">
          <p class="kicker"></p>
          <h2></h2>
          <p class="author"></p>
          <p class="progress"></p>
          <div class="actions">
            <button type="button" class="primary" data-open="audio">聽</button>
            <button type="button" class="primary" data-open="read">讀</button>
          </div>
        </section>
      </article>
    </div>
  `;
  const root = els.bookStage.querySelector(".draw-root");
  root.style.setProperty("--cloth", series.cloth);
  root.style.setProperty("--accent", series.accent);
  applyPullVars(root, book);
  els.bookStage.querySelector(".book-3d-spine-title").textContent = book.title;
  els.bookStage.querySelector(".bookplate-card strong").textContent = series.title;
  els.bookStage.querySelector(".vol").textContent = `編號 ${volume}`;
  els.bookStage.querySelector(".kicker").textContent = `${series.title} · ${flags.badge}`;
  els.bookStage.querySelector("h2").textContent = book.title;
  els.bookStage.querySelector(".author").textContent = book.author || "";
  els.bookStage.querySelector(".progress").textContent = progress.line;
  const listen = els.bookStage.querySelector('[data-open="audio"]');
  const read = els.bookStage.querySelector('[data-open="read"]');
  listen.disabled = !flags.audio;
  read.disabled = !flags.read;
  listen.addEventListener("click", () => goToPlayer(book, "audio", playable));
  read.addEventListener("click", () => goToPlayer(book, "read", readable));
  if (phase === "draw") playDraw(root);
}

function goToPlayer(book, pane, ready) {
  if (state.source === "demo" || !ready) {
    showToast("先登入 Google 或選擇 Library 資料夾，才能聽或讀。");
    if (typeof shelfOptions.onNeedLibrary === "function") {
      shelfOptions.onNeedLibrary(book, pane);
    }
    return;
  }
  if (typeof shelfOptions.onOpenBook === "function") {
    closeBook();
    shelfOptions.onOpenBook(book, pane);
    return;
  }
  try {
    sessionStorage.setItem(OPEN_INTENT_KEY, JSON.stringify({ bookId: book.id, pane }));
  } catch {
    /* private mode */
  }
  window.location.href = playerOpenUrl(book.id, pane);
}

async function walkDirectory(dir, prefix = []) {
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
        const ext = extOf(file.name);
        if (!file || ((AUDIO_EXT.has(ext) || EPUB_EXT.has(ext)) && file.size === 0)) {
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

function pickWithInput(input) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      input.onchange = null;
      fn(value);
    };
    input.onchange = () => {
      const files = [...(input.files || [])];
      if (!files.length) {
        finish(reject, Object.assign(new Error("No files selected"), { name: "AbortError" }));
        return;
      }
      finish(
        resolve,
        files.map((file) => ({ path: file.webkitRelativePath || file.name, file }))
      );
    };
    try {
      input.value = "";
    } catch {
      /* iOS may ignore */
    }
    input.click();
  });
}

async function loadFromFolder() {
  if (typeof window.showDirectoryPicker === "function") {
    const handle = await window.showDirectoryPicker({ mode: "read", id: "library-shelf" });
    const { entries } = await walkDirectory(handle);
    return buildLibrary(entries);
  }
  const entries = await pickWithInput(els.fileDir);
  return buildLibrary(entries);
}

async function loadFromFiles() {
  const entries = await pickWithInput(els.fileFiles);
  return buildLibrary(entries);
}

function applyLoaded(books) {
  if (!books.length) {
    showToast("沒有找到聽或讀的書。示範書架還在。");
    return;
  }
  setLibrary(books, "library");
}

/** Thin hook: a later Drive PR can set globalThis.libraryListenDriveLoad. */
function bindDriveHook() {
  const btn = document.getElementById("btn-drive-load");
  const load = globalThis.libraryListenDriveLoad;
  if (!btn || typeof load !== "function") return;
  btn.hidden = false;
  btn.addEventListener("click", async () => {
    try {
      const result = await load();
      const books = Array.isArray(result) ? result : result?.books;
      if (books?.length) applyLoaded(books);
      else showToast("Drive 沒有帶回書。");
    } catch (err) {
      if (err?.name === "AbortError") return;
      showToast("Drive 載入沒有完成。");
    }
  });
}

function bind() {
  for (const btn of document.querySelectorAll(".view-toggle [data-view]")) {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-view");
      if (!VIEWS.includes(view)) return;
      state.view = view;
      persistChrome();
      render();
    });
  }
  els.query?.addEventListener("input", () => {
    state.query = els.query.value;
    render();
  });
  els.clear?.addEventListener("click", () => {
    state.query = "";
    if (els.query) els.query.value = "";
    render();
  });
  document.getElementById("btn-close-book")?.addEventListener("click", closeBook);
  els.layer?.addEventListener("click", (event) => {
    if (event.target === els.layer) closeBook();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeBook();
  });
  if (!document.body?.classList.contains("shell-shelf")) {
    document.getElementById("btn-pick-folder")?.addEventListener("click", async () => {
      try {
        applyLoaded(await loadFromFolder());
      } catch (err) {
        if (err?.name === "AbortError") return;
        showToast("無法打開資料夾。");
      }
    });
    document.getElementById("btn-pick-files")?.addEventListener("click", async () => {
      try {
        applyLoaded(await loadFromFiles());
      } catch (err) {
        if (err?.name === "AbortError") return;
        showToast("無法打開檔案。");
      }
    });
    bindDriveHook();
  }
}

function applyPreviewParams() {
  const params = new URLSearchParams(location.search);
  const view = params.get("view");
  if (VIEWS.includes(view)) state.view = view;
  const series = params.get("series");
  if (series) state.seriesId = series;
  const query = params.get("q");
  if (query) {
    state.query = query;
    if (els.query) els.query.value = query;
  }
  const lift = params.get("lift");
  if (lift) state.liftedId = lift;
  return params;
}

function previewWantsOpen(params) {
  return (
    params.get("spread") === "1" ||
    params.get("flip") === "1" ||
    params.get("pull") === "1"
  );
}

export function isRiceShelfPage() {
  return document.body?.classList.contains("shell-shelf") && !!document.getElementById("stage");
}

export function closeRiceBook() {
  closeBook();
}

export function setRiceShelfLibrary(books, source = "library") {
  setLibrary(books, source);
}

export function initRiceShelf(options = {}) {
  shelfOptions = { ...shelfOptions, ...options };
  if (!els.stage) {
    els.stage = document.getElementById("stage");
    els.chips = document.getElementById("series-chips");
    els.count = document.getElementById("shelf-count");
    els.query = document.getElementById("shelf-query");
    els.clear = document.getElementById("btn-clear-search");
    els.hint = document.getElementById("load-hint");
    els.layer = document.getElementById("book-layer");
    els.bookStage = document.getElementById("book-stage");
    els.toast = document.getElementById("toast");
    els.fileDir = document.getElementById("file-input-dir");
    els.fileFiles = document.getElementById("file-input-files");
  }
  applyNoBook3dClass();
  restoreChrome();
  const previewParams = applyPreviewParams();
  if (!shelfBound) {
    bind();
    shelfBound = true;
  }
  if (!state.books.length) setLibrary(demoCatalog(), "demo");
  else render();
  const openId = previewParams.get("book");
  if (openId && findBook(openId) && previewWantsOpen(previewParams)) {
    const book = findBook(openId);
    openFromShelf(
      book,
      openBookPhase({
        reducedMotion: prefersReducedMotion(),
        no3d: book3dDisabled(),
        spread: previewParams.get("spread") === "1",
        flip: previewParams.get("flip") === "1",
        pull: previewParams.get("pull") === "1",
      })
    );
  }
  return { previewParams };
}
