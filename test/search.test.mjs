import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bookMatches,
  chapterHitLine,
  emptySearchMessage,
  fieldContains,
  filterBooks,
  matchingChapterTitles,
  shelfCountLabel,
  trimQuery,
} from "../docs/search.js";

function munroeWhatIf(overrides = {}) {
  return {
    id: "munroe/what-if-1",
    collectionTitle: "Munroe",
    folder: "what-if-1",
    title: "What If?",
    subtitle: "Serious Scientific Answers to Absurd Hypothetical Questions",
    author: "Randall Munroe",
    chapters: [
      { id: "01", title: "Global Windstorm" },
      { id: "02", title: "Relativistic Baseball" },
    ],
    ...overrides,
  };
}

function munroeHowTo() {
  return munroeWhatIf({
    id: "munroe/how-to",
    folder: "how-to",
    title: "How To",
    subtitle: "Absurd Scientific Advice for Common Real-World Problems",
    chapters: [{ id: "01", title: "How to Throw a Rock" }],
  });
}

function immune() {
  return {
    id: "immune/immune",
    collectionTitle: "Immune",
    folder: "immune",
    title: "Immune",
    subtitle: "A Journey into the Mysterious System That Keeps You Alive",
    author: "Philipp Dettmer",
    chapters: [
      { id: "p01", title: "Part 01" },
      { id: "p02", title: "Part 02" },
      { id: "p03", title: "Part 03" },
    ],
  };
}

const shelf = [munroeWhatIf(), munroeHowTo(), immune()];

describe("trimQuery", () => {
  it("trims whitespace and treats null as empty", () => {
    assert.equal(trimQuery("  Part 01  "), "Part 01");
    assert.equal(trimQuery(null), "");
    assert.equal(trimQuery(undefined), "");
  });
});

describe("fieldContains", () => {
  it("is case-insensitive and ignores diacritics", () => {
    assert.equal(fieldContains("Randall Munroe", "munroe"), true);
    assert.equal(fieldContains("Philipp Dettmer", "DETTMÉR"), true);
    assert.equal(fieldContains("What If?", "what if"), true);
    assert.equal(fieldContains("Immune", "xyz"), false);
  });
});

describe("bookMatches", () => {
  it("matches title, author, collection, subtitle, and folder", () => {
    const book = munroeWhatIf();
    assert.equal(bookMatches(book, "what if"), true);
    assert.equal(bookMatches(book, "Randall"), true);
    assert.equal(bookMatches(book, "munroe"), true);
    assert.equal(bookMatches(book, "hypothetical"), true);
    assert.equal(bookMatches(book, "what-if-1"), true);
    assert.equal(bookMatches(book, "dettmer"), false);
  });

  it("matches native folderName when folder is absent", () => {
    const book = munroeWhatIf({ folder: undefined, folderName: "what-if-1" });
    assert.equal(bookMatches(book, "what-if"), true);
  });

  it("matches a chapter title when book fields do not", () => {
    assert.equal(bookMatches(immune(), "part 02"), true);
    assert.equal(bookMatches(munroeWhatIf(), "relativistic"), true);
    assert.equal(bookMatches(munroeWhatIf(), "part 02"), false);
  });

  it("treats blank and whitespace-only queries as match-all", () => {
    assert.equal(bookMatches(immune(), ""), true);
    assert.equal(bookMatches(immune(), "   "), true);
  });
});

describe("filterBooks", () => {
  it("returns the same list when the query is empty", () => {
    assert.deepEqual(filterBooks(shelf, ""), shelf);
    assert.deepEqual(filterBooks(shelf, "  "), shelf);
  });

  it("keeps Munroe books for author and Immune for a chapter title", () => {
    assert.deepEqual(
      filterBooks(shelf, "munroe").map((b) => b.id),
      ["munroe/what-if-1", "munroe/how-to"]
    );
    assert.deepEqual(
      filterBooks(shelf, "part 01").map((b) => b.id),
      ["immune/immune"]
    );
    assert.deepEqual(filterBooks(shelf, "no-such-book"), []);
  });

  it("returns an empty array for a non-list", () => {
    assert.deepEqual(filterBooks(null, "immune"), []);
  });
});

describe("matchingChapterTitles + chapterHitLine", () => {
  it("returns no chapter hits when the query is empty", () => {
    assert.deepEqual(matchingChapterTitles(immune(), ""), []);
    assert.equal(chapterHitLine([]), "");
  });

  it("lists matching chapter titles in order", () => {
    assert.deepEqual(matchingChapterTitles(immune(), "part"), [
      "Part 01",
      "Part 02",
      "Part 03",
    ]);
    assert.deepEqual(matchingChapterTitles(immune(), "part 02"), ["Part 02"]);
  });

  it("shows at most two titles, then · +N", () => {
    assert.equal(chapterHitLine(["Part 01"]), "Part 01");
    assert.equal(chapterHitLine(["Part 01", "Part 02"]), "Part 01 · Part 02");
    assert.equal(
      chapterHitLine(["Part 01", "Part 02", "Part 03"]),
      "Part 01 · Part 02 · +1"
    );
    assert.equal(
      chapterHitLine(["A", "B", "C", "D"]),
      "A · B · +2"
    );
  });
});

describe("shelf labels", () => {
  it("uses books vs matches and native empty copy", () => {
    assert.equal(shelfCountLabel(3, ""), "3 books");
    assert.equal(shelfCountLabel(1, "immune"), "1 matches");
    assert.equal(shelfCountLabel(0, "xyz"), "0 matches");
    assert.equal(emptySearchMessage("xyz"), "No books match “xyz”.");
    assert.equal(emptySearchMessage("  "), "");
  });
});
