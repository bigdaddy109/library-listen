import {
  bookHasAudio,
  isBookPlayable,
  listenShelfBooks,
  shelfBadge,
} from "../library.js?v=60";
import { matchingChapterTitles, chapterHitLine, trimQuery } from "../search.js?v=60";
import {
  COVER_MORPH,
  bookFlipFrames,
  DEFAULT_VIEW,
  OPEN_INTENT_KEY,
  VIEWS,
  VIEW_LABELS,
  demoCatalog,
  coverMorphTransform,
  coverTransitionMode,
  emptyShelfMessage,
  groupBySeries,
  shelfShownBooks,
  mediaFlags,
  normalizeView,
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
} from "./catalog.js?v=60";
import { coverSvg, spineMetrics } from "./covers.js?v=60";

/* v2: the cover wall became the default; the old key mostly held the old default. */
const VIEW_KEY = "librarylisten.shelfView.v2";
const SERIES_KEY = "librarylisten.shelfSeries";

const state = {
  source: "demo",
  books: demoCatalog(),
  query: "",
  seriesId: "all",
  view: DEFAULT_VIEW,
  liftedId: null,
  selectedId: null,
  phase: "shelf",
  coverOpen: false,
  morphing: false,
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

function shelfBooks() {
  return listenShelfBooks(state.books);
}

function visibleBooks() {
  return shelfShownBooks(state.books, { query: state.query, seriesId: state.seriesId });
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
      ? `Loaded ${visibleBooks().length} books. Tap a cover to listen.`
      : "Demo books show until you sign in. Sign in with Google to listen.";
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
  const chips = seriesChips(shelfBooks());
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
    <span class="cover-art" aria-hidden="true"></span>
    <span class="spine-tip"><strong></strong><span></span></span>
  `;
  btn.querySelector(".cover-art").innerHTML = coverSvg(book);
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

function renderCovers(books) {
  const grid = document.createElement("div");
  grid.className = "covers";
  for (const book of books) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "cover-card";
    card.dataset.id = book.id;
    const face = shelfBadge(book);
    card.setAttribute("aria-label", `${book.title} · ${face}`);
    card.innerHTML = `<span class="cover-art"></span><h3></h3><p></p>`;
    card.querySelector(".cover-art").innerHTML = coverSvg(book);
    card.querySelector("h3").textContent = book.title;
    card.querySelector("p").textContent = `${book.author} · ${face}`;
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
    empty.textContent = emptyShelfMessage(state.query, state.seriesId) || "The shelf is empty.";
    els.stage.appendChild(empty);
    return;
  }
  if (state.view === "covers") renderCovers(books);
  else renderSpines(books);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function book3dDisabled() {
  return prefersReducedMotion();
}

function applyNoBook3dClass() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("no-book-3d", book3dDisabled());
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
  state.coverOpen = false;
  document.documentElement.classList.remove("book-open");
  els.layer.classList.add("hidden");
  els.layer.hidden = true;
  els.bookStage.innerHTML = "";
}

function coverMode() {
  return coverTransitionMode({ reducedMotion: prefersReducedMotion() });
}

/** Cover SVG used as the shared-element morph source (cover-wall card or bookshelf spine). */
function cardArtFor(bookId) {
  for (const el of els.stage?.querySelectorAll(".cover-card, .spine") || []) {
    if (el.dataset.id === bookId) return el.querySelector(".cover-art svg");
  }
  return null;
}

function spreadArt() {
  return els.bookStage?.querySelector(".leaf-front svg") || null;
}

function onScreen(rect) {
  return (
    !!rect &&
    rect.width > 0 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  );
}

function showCoverSpread(book, { opened = false } = {}) {
  state.selectedId = book.id;
  state.phase = "open";
  state.coverOpen = true;
  markDrawnSpine(book.id, true);
  document.documentElement.classList.add("book-open");
  els.layer.classList.remove("hidden");
  els.layer.hidden = false;
  renderSpread(book, "open", { cover: true, opened });
}

function setMorphing(on) {
  state.morphing = on;
  if (on) els.layer.dataset.morph = "1";
  else delete els.layer.dataset.morph;
}

/** Swing the front board open (or shut) on its spine. */
function flipBook(opening) {
  const root = els.bookStage?.querySelector(".draw-root.is-cover");
  if (!root) return Promise.resolve();
  root.classList.toggle("is-opened", opening);
  root.classList.toggle("is-closed", !opening);
  const frames = bookFlipFrames(opening);
  const timing = {
    duration: opening ? COVER_MORPH.flipMs : COVER_MORPH.flipCloseMs,
    delay: opening ? COVER_MORPH.flipDelayMs : 0,
    easing: COVER_MORPH.flipEasing,
    fill: "backwards",
  };
  const parts = [
    [".cover-leaf", frames.leaf],
    [".spread", frames.spread],
    [".page.left", frames.endpaper],
    [".leaf-front", frames.front],
    [".leaf-back", frames.back],
    [".page.right .page-shade", frames.pageShade],
    [".leaf-front .leaf-shade", frames.frontShade],
    [".leaf-back .leaf-shade", frames.backShade],
  ];
  root.classList.add("is-flipping");
  const anims = parts
    .map(([sel, f]) => root.querySelector(sel)?.animate(f, timing))
    .filter(Boolean);
  return Promise.all(anims.map((a) => a.finished))
    .catch(() => {})
    .then(() => root.classList.remove("is-flipping"));
}

/**
 * Phase 1: FLIP ghost zooms the cover between the wall card and the closed-book
 * cover box (transform + opacity only). Phase 2 is flipBook (hinge left).
 */
function flipMorph({ cardEl, opening }) {
  const art = spreadArt();
  if (!art) return Promise.resolve();
  const bigRect = art.getBoundingClientRect();
  const cardRect = cardEl && onScreen(cardEl.getBoundingClientRect()) ? cardEl.getBoundingClientRect() : null;
  const duration = opening ? COVER_MORPH.openMs : COVER_MORPH.closeMs;
  const fade = [{ opacity: 0 }, { opacity: 1 }];
  const layerAnim = els.layer.animate(opening ? fade : [...fade].reverse(), {
    duration: opening ? duration * 0.7 : duration * 0.8,
    easing: "ease-out",
    fill: "both",
  });
  const shrunk = coverMorphTransform(cardRect, bigRect);
  if (!shrunk) return layerAnim.finished.catch(() => {}).then(() => layerAnim.cancel());
  const ghost = art.cloneNode(true);
  ghost.classList.add("cover-ghost");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    left: `${bigRect.left}px`,
    top: `${bigRect.top}px`,
    width: `${bigRect.width}px`,
    height: `${bigRect.height}px`,
  });
  document.body.appendChild(ghost);
  art.style.opacity = "0";
  const frames = [{ transform: shrunk.css }, { transform: "none" }];
  const ghostAnim = ghost.animate(opening ? frames : frames.reverse(), {
    duration,
    easing: COVER_MORPH.easing,
    fill: "both",
  });
  return Promise.all([ghostAnim.finished, layerAnim.finished])
    .catch(() => {})
    .then(() => {
      art.style.opacity = "";
      ghost.remove();
      layerAnim.cancel();
    });
}

async function openCoverBook(book) {
  if (state.morphing) return;
  const mode = coverMode();
  const fromEl = cardArtFor(book.id);
  if (mode === "none" || !fromEl) {
    showCoverSpread(book, { opened: true });
    beginListening(book);
    return;
  }
  setMorphing(true);
  try {
    // Closed book first, then hinge — never zoom straight into the open spread.
    showCoverSpread(book, { opened: false });
    await flipMorph({ cardEl: fromEl, opening: true });
    await flipBook(true);
  } finally {
    setMorphing(false);
  }
  beginListening(book);
}

/** After the cover opens, go straight into audio. */
function beginListening(book) {
  if (!bookHasAudio(book)) {
    showToast("This book has no audio to play.");
    return;
  }
  goToPlayer(book, "audio", isBookPlayable(book));
}

async function closeCoverBook() {
  if (state.morphing) return;
  const id = state.selectedId;
  const mode = coverMode();
  const fromEl = spreadArt();
  if (mode === "none" || !fromEl || !id) {
    closeBook();
    return;
  }
  setMorphing(true);
  try {
    await flipBook(false);
    markDrawnSpine(id, false);
    const cardEl = cardArtFor(id);
    if (cardEl) cardEl.style.opacity = "0";
    await flipMorph({ cardEl, opening: false });
    if (cardEl) cardEl.style.opacity = "";
    closeBook();
  } finally {
    setMorphing(false);
  }
}

function dismissBook() {
  if (els.layer.hidden) return;
  if (state.coverOpen) closeCoverBook();
  else closeBook();
}

/**
 * Shelf tap (cover wall or bookshelf): same openCoverBook path — cover zoom → hinge left.
 * phaseHint is only for ?flip= / ?pull= / ?spread= preview freezes (not UI taps).
 */
function openFromShelf(book, phaseHint) {
  if (!phaseHint) {
    openCoverBook(book);
    return;
  }
  state.selectedId = book.id;
  state.phase = phaseHint;
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
  const scene = root.querySelector(".book-3d-scene")?.getBoundingClientRect();
  const vars = pullTransformVars(rect, {
    width: scene?.width || window.innerWidth,
    height: scene?.height || window.innerHeight,
    left: scene?.left || 0,
    top: scene?.top || 0,
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

function renderSpread(book, phase = "open", { cover = false, opened = true } = {}) {
  const series = seriesMeta(book);
  const flags = mediaFlags(book);
  const siblings = state.books.filter((b) => seriesIdForBook(b) === series.id);
  const volume = String(volumeNumber(book, siblings)).padStart(2, "0");
  const progress = previewProgress(book);
  const rootClass = cover
    ? `is-open is-cover ${opened ? "is-opened" : "is-closed"}`
    : drawRootClass(phase);
  const scene = cover
    ? ""
    : `
      <div class="book-3d-scene" aria-hidden="true">
        <div class="book-3d" aria-hidden="${phase === "open" ? "true" : "false"}">
          <div class="book-3d-cover">${coverSvg(book, { width: 240, height: 330 })}</div>
          <div class="book-3d-spine"><span class="book-3d-spine-title"></span></div>
          <div class="book-3d-fore" aria-hidden="true"></div>
          <div class="book-3d-top" aria-hidden="true"></div>
          <div class="book-3d-bottom" aria-hidden="true"></div>
          <div class="book-3d-back" aria-hidden="true"></div>
        </div>
      </div>`;
  const bookplate = `
          <div class="bookplate">
            <div class="bookplate-card">
              <div class="seal" style="--accent:${series.accent}">Ex</div>
              <p>Bookplate</p>
              <strong></strong>
              <p class="vol"></p>
            </div>
          </div>`;
  const leftPage = cover ? "" : bookplate;
  const leaf = cover
    ? `
        <div class="cover-leaf" aria-hidden="true">
          <div class="leaf-face leaf-front" style="--paper:${series.paper}">
            ${coverSvg(book, { width: 240, height: 330 })}
            <span class="leaf-shade"></span>
          </div>
          <div class="leaf-face leaf-back">${bookplate}
            <span class="leaf-shade"></span>
          </div>
        </div>`
    : "";
  els.bookStage.innerHTML = `
    <div class="draw-root ${rootClass}">${scene}
      <article class="spread">
        <section class="page left">${leftPage}
        </section>
        <section class="page right">${cover ? '<span class="page-shade" aria-hidden="true"></span>' : ""}
          <p class="kicker"></p>
          <h2></h2>
          <p class="author"></p>
          <p class="progress"></p>
        </section>${leaf}
      </article>
    </div>
  `;
  const root = els.bookStage.querySelector(".draw-root");
  root.style.setProperty("--cloth", series.cloth);
  root.style.setProperty("--accent", series.accent);
  if (!cover) {
    applyPullVars(root, book);
    els.bookStage.querySelector(".book-3d-spine-title").textContent = book.title;
  }
  els.bookStage.querySelector(".bookplate-card strong").textContent = series.title;
  els.bookStage.querySelector(".vol").textContent = `No. ${volume}`;
  els.bookStage.querySelector(".kicker").textContent = `${series.title} · ${flags.badge}`;
  els.bookStage.querySelector("h2").textContent = book.title;
  els.bookStage.querySelector(".author").textContent = book.author || "";
  els.bookStage.querySelector(".progress").textContent = progress.line;
  if (phase === "draw") playDraw(root);
}

function goToPlayer(book, pane, ready) {
  if (state.source === "demo" || !ready) {
    showToast("Sign in with Google to listen.");
    if (typeof shelfOptions.onNeedLibrary === "function") {
      shelfOptions.onNeedLibrary(book, pane);
    }
    return;
  }
  if (typeof shelfOptions.onOpenBook === "function") {
    closeBook();
    shelfOptions.onOpenBook(book, pane === "concepts" ? "concepts" : "audio");
    return;
  }
  try {
    sessionStorage.setItem(OPEN_INTENT_KEY, JSON.stringify({ bookId: book.id, pane: "audio" }));
  } catch {
    /* private mode */
  }
  window.location.href = playerOpenUrl(book.id, "audio");
}

function applyLoaded(books) {
  if (!books.length) {
    showToast("No playable books found. The demo shelf is still here.");
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
      else showToast("Drive did not return any books.");
    } catch (err) {
      if (err?.name === "AbortError") return;
      showToast("Drive did not finish loading.");
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
  document.getElementById("btn-close-book")?.addEventListener("click", dismissBook);
  els.layer?.addEventListener("click", (event) => {
    if (event.target === els.layer) dismissBook();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismissBook();
  });
  if (!document.body?.classList.contains("shell-shelf")) bindDriveHook();
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
