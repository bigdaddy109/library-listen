import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPEN_INTENT_KEY,
  SERIES,
  SERIES_ORDER,
  VIEWS,
  demoCatalog,
  emptyShelfMessage,
  filterShelf,
  groupBySeries,
  mediaFlags,
  normalizeView,
  isWebKitBook3dUnsafe,
  openBookPhase,
  PULL_TIMING,
  pullOriginFromRect,
  pullTransformVars,
  parseOpenIntent,
  playerOpenUrl,
  previewProgress,
  seriesChips,
  seriesIdForBook,
  seriesMeta,
  shelfStatusLabel,
  stripOpenIntent,
  volumeNumber,
} from "../docs/shelf/catalog.js";
import {
  PROGRESS_KEY,
  buildLibrary,
  saveProgress,
  saveTextProgress,
  shelfBadge,
} from "../docs/library.js";

function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

describe("demo catalog", () => {
  it("includes the three series Jeff asked to see", () => {
    const books = demoCatalog();
    const ids = new Set(books.map(seriesIdForBook));
    assert.deepEqual([...ids].sort(), ["immune", "munroe", "school"]);
    assert.ok(books.some((b) => b.title === "開學"));
    assert.ok(books.some((b) => b.id === "munroe/what-if-1"));
    assert.ok(books.some((b) => b.id === "immune/immune"));
  });

  it("uses Audio / Read / Both badges from library.js", () => {
    const books = demoCatalog();
    const badges = new Set(books.map((b) => shelfBadge(b)));
    assert.ok(badges.has("Audio"));
    assert.ok(badges.has("Read"));
    assert.ok(badges.has("Both"));
    assert.equal(mediaFlags(books.find((b) => b.title === "放假")).badge, "Read");
  });
});

describe("series + views", () => {
  it("keeps one accent per known series", () => {
    const accents = SERIES_ORDER.map((id) => SERIES[id].accent);
    assert.equal(new Set(accents).size, 3);
    assert.equal(seriesMeta("school").title, "上學不容易");
    assert.equal(seriesIdForBook({ collectionTitle: "門羅-WhatIf" }), "munroe");
    assert.equal(seriesIdForBook({ id: "collection/kaixue", collectionTitle: "上學不容易" }), "school");
  });

  it("normalizes views and chips", () => {
    assert.deepEqual(VIEWS, ["spines", "topics", "covers"]);
    assert.equal(normalizeView("map"), "spines");
    const chips = seriesChips(demoCatalog());
    assert.equal(chips[0].id, "all");
    assert.equal(chips.find((c) => c.id === "school").count, 3);
  });

  it("groups a scanned multi-series Library onto every plank", () => {
    const books = buildLibrary([
      { path: "Library/Immune/listen/Immune-Part01.mp3", file: { name: "Immune-Part01.mp3", size: 2048 } },
      { path: "Library/門羅-WhatIf/listen/what-if-1/01.mp3", file: { name: "01.mp3", size: 2048 } },
      { path: "Library/上學不容易/listen/Middle School 02 Get Me/01.mp3", file: { name: "01.mp3", size: 2048 } },
      { path: "Library/上學不容易/listen/Middle School 01 First Day/01.mp3", file: { name: "01.mp3", size: 2048 } },
      { path: "Library/Thing Explainer/listen/Thing Explainer/01.mp3", file: { name: "01.mp3", size: 2048 } },
    ]);
    const groups = groupBySeries(books);
    assert.deepEqual(
      groups.map((g) => [g.id, g.books.length]).sort(),
      [
        ["immune", 1],
        ["munroe", 1],
        ["other", 1],
        ["school", 2],
      ]
    );
    const chips = seriesChips(books);
    assert.equal(chips[0].count, 5);
    assert.ok(chips.some((c) => c.id === "munroe"));
    assert.ok(chips.some((c) => c.id === "school" && c.count === 2));
    assert.ok(chips.some((c) => c.id === "other"));
  });
});

describe("filterShelf", () => {
  it("reuses search.js and series chips together", () => {
    const books = demoCatalog();
    assert.equal(filterShelf(books, { query: "munroe" }).length, 3);
    assert.equal(filterShelf(books, { query: "Part 09" }).map((b) => b.id).join(), "immune/immune");
    assert.equal(filterShelf(books, { seriesId: "school", query: "功課" }).length, 1);
    assert.equal(filterShelf(books, { seriesId: "immune", query: "開學" }).length, 0);
    assert.match(emptyShelfMessage("zzz"), /No books match/);
    assert.match(shelfStatusLabel(2, "immune", "all"), /2 matches/);
  });
});

describe("open intent", () => {
  it("builds a player URL and parses it back", () => {
    assert.equal(playerOpenUrl("immune/immune", "read"), "../index.html?open=immune%2Fimmune&pane=read");
    assert.deepEqual(parseOpenIntent("?open=munroe/how-to&pane=audio"), {
      bookId: "munroe/how-to",
      pane: "audio",
    });
    assert.equal(stripOpenIntent("?open=a&pane=read&x=1"), "?x=1");
    assert.equal(OPEN_INTENT_KEY, "librarylisten.open.v1");
  });
});

describe("preview progress", () => {
  it("reads the same progress key as the player", () => {
    const book = demoCatalog().find((b) => b.id === "immune/immune");
    const store = memoryStore();
    assert.equal(previewProgress(book, store).line, "尚未開始");
    saveProgress(book.id, book.chapters[2].id, 12, 120, store);
    assert.match(previewProgress(book, store).line, /Part 03/);
    saveTextProgress(book.id, { kind: "epub-cfi", locator: "/6/4", fraction: 0.4, label: "Ch 2" }, store);
    assert.match(previewProgress(book, store).line, /Ch 2/);
    assert.equal(JSON.parse(store.getItem(PROGRESS_KEY))[book.id].text.kind, "epub-cfi");
  });
});

describe("openBookPhase", () => {
  it("draws by default and skips to the spread when motion is reduced", () => {
    assert.equal(openBookPhase({}), "draw");
    assert.equal(openBookPhase({ reducedMotion: true }), "open");
    assert.equal(openBookPhase({ spread: true }), "open");
    assert.equal(openBookPhase({ flip: true }), "flip");
    assert.equal(openBookPhase({ pull: true }), "pull");
    assert.equal(openBookPhase({ spread: true, flip: true }), "open");
    assert.equal(openBookPhase({ reducedMotion: true, pull: true }), "open");
    assert.equal(openBookPhase({ no3d: true }), "open");
    assert.equal(openBookPhase({ no3d: true, pull: true }), "open");
    assert.equal(openBookPhase({ no3d: true, flip: true }), "open");
  });
});

describe("isWebKitBook3dUnsafe", () => {
  it("flags iPhone Safari and desktop Safari, not Chromium", () => {
    assert.equal(
      isWebKitBook3dUnsafe(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      ),
      true
    );
    assert.equal(
      isWebKitBook3dUnsafe(
        "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
      ),
      true
    );
    assert.equal(
      isWebKitBook3dUnsafe(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15"
      ),
      true
    );
    assert.equal(
      isWebKitBook3dUnsafe("", { touchMacPad: true }),
      true
    );
    assert.equal(
      isWebKitBook3dUnsafe(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
      ),
      false
    );
    assert.equal(
      isWebKitBook3dUnsafe(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      ),
      false
    );
    assert.equal(isWebKitBook3dUnsafe(""), false);
  });
});

describe("pull transform", () => {
  it("keeps the draw under 900ms and maps a spine rect to CSS vars", () => {
    assert.equal(PULL_TIMING.totalMs, 820);
    assert.ok(PULL_TIMING.totalMs >= 600 && PULL_TIMING.totalMs <= 900);
    assert.equal(PULL_TIMING.extractMs + PULL_TIMING.openMs, PULL_TIMING.totalMs);
    assert.equal(pullOriginFromRect(null).valid, false);
    const origin = pullOriginFromRect({ left: 40, top: 200, width: 24, height: 180 });
    assert.equal(origin.valid, true);
    assert.equal(origin.x, 52);
    assert.equal(origin.y, 290);
    const vars = pullTransformVars(
      { left: 40, top: 200, width: 24, height: 180 },
      { width: 390, height: 844 }
    );
    assert.equal(vars.fromX, "-143px");
    assert.equal(vars.fromY, "-132px");
    assert.equal(vars.fromYaw, "76deg");
    assert.equal(
      pullTransformVars(null, { width: 390, height: 844, yaw: 8 }).fromYaw,
      "8deg"
    );
  });
});

describe("volume + groups", () => {
  it("numbers books inside a series", () => {
    const school = groupBySeries(demoCatalog()).find((g) => g.id === "school");
    assert.equal(volumeNumber(school.books[1], school.books), 2);
  });
});
