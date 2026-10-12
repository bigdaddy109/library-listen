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
import { PROGRESS_KEY, saveProgress, saveTextProgress, shelfBadge } from "../docs/library.js";

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

describe("volume + groups", () => {
  it("numbers books inside a series", () => {
    const school = groupBySeries(demoCatalog()).find((g) => g.id === "school");
    assert.equal(volumeNumber(school.books[1], school.books), 2);
  });
});
