import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROGRESS_KEY,
  buildLibrary,
  chapterProgress,
  loadProgress,
  locateBookPath,
  pathParts,
  resumeSeconds,
  saveProgress,
  shouldSkipPath,
  titleFromFilename,
} from "../docs/library.js";

/** In-memory file for scan tests. Not a real audiobook. */
function file(name, size = 2048) {
  return { name, size };
}

function entry(path, size = 2048) {
  const name = path.split("/").pop();
  return { path, file: file(name, size) };
}

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

function libraryTree() {
  return [
    entry("Library/門羅-WhatIf/listen/what-if-1/01 - Introduction.mp3"),
    entry("Library/門羅-WhatIf/listen/what-if-1/02 - Global Windstorm.mp3"),
    entry("Library/門羅-WhatIf/listen/what-if-1/cover.jpg"),
    entry("Library/門羅-WhatIf/listen/how-to/001 - How To Absurd Scientific Advice.mp3"),
    entry("Library/門羅-WhatIf/listen/how-to/002 - How To Jump Really High.mp3"),
    entry("Library/門羅-WhatIf/listen/what-if-2/What If 2 - Randall Munroe.m4b"),
    entry("Library/Immune/listen/Immune-Part01.mp3"),
    entry("Library/Immune/listen/Immune-Part02.mp3"),
    entry("Library/Immune/listen/Immune-Part03.mp3"),
    entry("Library/Immune/listen/Immune-Part04.mp3"),
    entry("Library/Immune/listen/Immune-Part05.mp3"),
    entry("Library/Immune/listen/Immune-Part06.mp3"),
    entry("Library/Immune/listen/Immune-Part07.mp3"),
    entry("Library/Immune/listen/Immune-Part08.mp3"),
    entry("Library/Immune/listen/Immune-Part09.mp3"),
  ];
}

describe("locateBookPath", () => {
  it("reads Library/Collection/listen/book/file", () => {
    assert.deepEqual(
      locateBookPath(pathParts("Library/門羅-WhatIf/listen/what-if-1/01 - Introduction.mp3")),
      { collectionFolder: "門羅-WhatIf", bookFolder: "what-if-1" }
    );
  });

  it("treats files sitting in Immune/listen as the immune book", () => {
    assert.deepEqual(locateBookPath(pathParts("Immune/listen/Immune-Part01.mp3")), {
      collectionFolder: "Immune",
      bookFolder: "immune",
    });
  });

  it("treats files under a bare listen/ folder as one Library book", () => {
    assert.deepEqual(locateBookPath(pathParts("listen/Immune-Part01.mp3")), {
      collectionFolder: "Library",
      bookFolder: "library",
    });
  });

  it("accepts a short collection pick without listen/", () => {
    assert.deepEqual(locateBookPath(pathParts("門羅-WhatIf/what-if-1/01 - Introduction.mp3")), {
      collectionFolder: "門羅-WhatIf",
      bookFolder: "what-if-1",
    });
  });

  it("returns null when the path ends at listen/", () => {
    assert.equal(locateBookPath(pathParts("Immune/listen")), null);
  });

  it("imports a lone filename as Imported/imported", () => {
    assert.deepEqual(locateBookPath(pathParts("Immune-Part01.mp3")), {
      collectionFolder: "Imported",
      bookFolder: "imported",
    });
  });
});

describe("titleFromFilename", () => {
  it("turns Immune-PartNN into Part NN", () => {
    assert.equal(titleFromFilename("Immune-Part01.mp3"), "Part 01");
    assert.equal(titleFromFilename("Immune-Part09.mp3"), "Part 09");
    assert.equal(titleFromFilename("Immune-Part1.mp3"), "Part 01");
  });

  it("strips a leading chapter number and separator", () => {
    assert.equal(titleFromFilename("01 - Introduction.mp3"), "Introduction");
    assert.equal(titleFromFilename("001 - How To Absurd Scientific Advice.mp3"), "How To Absurd Scientific Advice");
    assert.equal(titleFromFilename("02. Global Windstorm.mp3"), "Global Windstorm");
    assert.equal(titleFromFilename("03) Something.mp3"), "Something");
  });

  it("keeps a name that is not numbered or a part", () => {
    assert.equal(titleFromFilename("What If 2 - Randall Munroe.m4b"), "What If 2 - Randall Munroe");
  });
});

describe("buildLibrary scan", () => {
  it("scans Munroe as subfolder books and Immune as one book", () => {
    const books = buildLibrary(libraryTree());
    assert.deepEqual(
      books.map((b) => [b.id, b.title, b.chapters.length]),
      [
        ["immune/immune", "Immune", 9],
        ["munroe/how-to", "How To", 2],
        ["munroe/what-if-1", "What If?", 2],
        ["munroe/what-if-2", "What If? 2", 1],
      ]
    );
    const immune = books.find((b) => b.id === "immune/immune");
    assert.equal(immune.author, "Philipp Dettmer");
    assert.deepEqual(
      immune.chapters.map((ch) => ch.title),
      ["Part 01", "Part 02", "Part 03", "Part 04", "Part 05", "Part 06", "Part 07", "Part 08", "Part 09"]
    );
    const whatIf = books.find((b) => b.id === "munroe/what-if-1");
    assert.equal(whatIf.author, "Randall Munroe");
    assert.deepEqual(
      whatIf.chapters.map((ch) => ch.title),
      ["Introduction", "Global Windstorm"]
    );
    assert.equal(whatIf.coverFile?.name, "cover.jpg");
  });

  it("still groups Immune when the pick starts at the collection folder", () => {
    const books = buildLibrary([
      entry("Immune/listen/Immune-Part01.mp3"),
      entry("Immune/listen/Immune-Part02.mp3"),
    ]);
    assert.equal(books.length, 1);
    assert.equal(books[0].id, "immune/immune");
    assert.equal(books[0].chapters.length, 2);
  });

  it("skips ebooks/, _source/, _prefixed folders, 0-byte audio, and unreadable files", () => {
    assert.equal(shouldSkipPath(pathParts("Library/Immune/ebooks/book.mp3")), true);
    assert.equal(shouldSkipPath(pathParts("Library/門羅-WhatIf/_source/raw.mp3")), true);
    assert.equal(shouldSkipPath(pathParts("Library/_draft/listen/book/a.mp3")), true);

    const books = buildLibrary([
      entry("Library/Immune/listen/Immune-Part01.mp3"),
      entry("Library/Immune/ebooks/not-audio-book.mp3"),
      entry("Library/Immune/_source/raw.mp3"),
      entry("Library/_tmp/listen/ghost/a.mp3"),
      entry("Library/Immune/listen/empty-cloud.mp3", 0),
      { path: "Library/Immune/listen/unreadable.mp3", file: null },
      entry("Library/Immune/listen/notes.txt"),
    ]);
    assert.equal(books.length, 1);
    assert.equal(books[0].id, "immune/immune");
    assert.deepEqual(
      books[0].chapters.map((ch) => ch.id),
      ["Immune-Part01.mp3"]
    );
  });
});

describe("progress", () => {
  it("keeps a per-chapter map when switching chapters", () => {
    const store = memoryStore();
    saveProgress("immune/immune", "Immune-Part03.mp3", 120.456, 600, store);
    saveProgress("immune/immune", "Immune-Part02.mp3", 45, 580, store);

    const part3 = chapterProgress("immune/immune", "Immune-Part03.mp3", store);
    const part2 = chapterProgress("immune/immune", "Immune-Part02.mp3", store);
    const all = loadProgress(store)["immune/immune"];

    assert.equal(part3.positionSeconds, 120.46);
    assert.equal(part3.chapterDurationSeconds, 600);
    assert.equal(part2.positionSeconds, 45);
    assert.equal(part2.chapterDurationSeconds, 580);
    assert.equal(all.chapterId, "Immune-Part02.mp3");
    assert.equal(all.positionSeconds, 45);
    assert.ok(all.chapters["Immune-Part03.mp3"]);
    assert.ok(all.chapters["Immune-Part02.mp3"]);
  });

  it("promotes the old single-slot chapter into the map when switching", () => {
    const store = memoryStore({
      [PROGRESS_KEY]: JSON.stringify({
        "immune/immune": {
          chapterId: "Immune-Part03.mp3",
          positionSeconds: 99,
          chapterDurationSeconds: 600,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    });
    saveProgress("immune/immune", "Immune-Part02.mp3", 10, 580, store);
    const part3 = chapterProgress("immune/immune", "Immune-Part03.mp3", store);
    assert.equal(part3.positionSeconds, 99);
    assert.equal(part3.chapterDurationSeconds, 600);
    assert.equal(chapterProgress("immune/immune", "Immune-Part02.mp3", store).positionSeconds, 10);
  });

  it("reads the legacy single-slot chapter when the map has no entry yet", () => {
    const store = memoryStore({
      [PROGRESS_KEY]: JSON.stringify({
        "munroe/what-if-1": {
          chapterId: "01 - Introduction.mp3",
          positionSeconds: 33,
          chapterDurationSeconds: 120,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      }),
    });
    const saved = chapterProgress("munroe/what-if-1", "01 - Introduction.mp3", store);
    assert.equal(saved.positionSeconds, 33);
    assert.equal(saved.chapterDurationSeconds, 120);
    assert.equal(chapterProgress("munroe/what-if-1", "02 - Global Windstorm.mp3", store), null);
  });

  it("restarts at 0 when resume is at the end of a chapter", () => {
    assert.equal(resumeSeconds({ positionSeconds: 598, chapterDurationSeconds: 600 }), 0);
    assert.equal(resumeSeconds({ positionSeconds: 599.5, chapterDurationSeconds: 600 }), 0);
    assert.equal(resumeSeconds({ positionSeconds: 120, chapterDurationSeconds: 600 }), 120);
    assert.equal(resumeSeconds({ positionSeconds: 12 }), 12);
    assert.equal(resumeSeconds(null), 0);
  });

  it("returns an empty object when stored progress is missing or invalid", () => {
    assert.deepEqual(loadProgress(memoryStore()), {});
    assert.deepEqual(loadProgress(memoryStore({ [PROGRESS_KEY]: "not-json" })), {});
  });
});
