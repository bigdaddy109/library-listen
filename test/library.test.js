import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROGRESS_KEY,
  KNOWN_COLLECTIONS,
  bookHasDriveMedia,
  booksFromLibrarySnapshot,
  buildLibrary,
  chapterIsPlayable,
  emptyLibraryMessage,
  isBookPlayable,
  isChapterPartName,
  knownCollectionFolders,
  listenFileBookFolder,
  mergeBookRecords,
  mergeLibraryScans,
  chapterProgress,
  loadProgress,
  locateBookPath,
  locateEbookPath,
  pairingKey,
  pathParts,
  resumeSeconds,
  saveProgress,
  saveTextProgress,
  shelfBadge,
  bookScreenTabs,
  libraryReadUrl,
  seriesFolderName,
  isImmuneBook,
  shouldSkipPath,
  textProgress,
  titleFromFilename,
  latestProgressKind,
  EBOOK_OFFLINE_KEY,
  isEbookSavedOffline,
} from "../docs/library.js";
import {
  ebookOnlyPage,
  jeffDriveLibraryEntries,
  jeffLibraryRootEbookEntries,
} from "./acceptance-fixture.mjs";

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

/** Jeff's live Library shape: Immune + school (several books) + Munroe + one more. */
function multiSeriesTree() {
  return [
    ...libraryTree(),
    entry("Library/上學不容易/listen/Middle School 01 First Day/01.mp3"),
    entry("Library/上學不容易/listen/Middle School 02 Get Me/01.mp3"),
    entry("Library/上學不容易/listen/Middle School 03 Homework/01.mp3"),
    entry("Library/上學不容易/listen/Middle School 04 Summer.m4b"),
    entry("Library/Thing Explainer/listen/Thing Explainer/01.mp3"),
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

  it("treats a whole-book file sitting in listen/ as its own title", () => {
    assert.deepEqual(
      locateBookPath(pathParts("Library/上學不容易/listen/Middle School 02 Get Me.m4b")),
      { collectionFolder: "上學不容易", bookFolder: "Middle School 02 Get Me" }
    );
    assert.equal(isChapterPartName("Immune-Part05.mp3"), true);
    assert.equal(isChapterPartName("Middle School 02 Get Me.m4b"), false);
    assert.equal(listenFileBookFolder("Immune", "Immune-Part05.mp3"), "immune");
    assert.equal(
      listenFileBookFolder("上學不容易", "Middle School 02 Get Me.m4b"),
      "Middle School 02 Get Me"
    );
  });

  it("does not collapse Library/Collection/Book paths into one Library book", () => {
    assert.deepEqual(
      locateBookPath(pathParts("Library/上學不容易/Middle School 02 Get Me/01.mp3")),
      { collectionFolder: "上學不容易", bookFolder: "Middle School 02 Get Me" }
    );
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
    assert.equal(whatIf.ebook, null);
    assert.equal(shelfBadge(whatIf), "Audio");
    assert.equal(shelfBadge(books.find((b) => b.id === "immune/immune")), "Audio");
  });

  it("keeps every series from a multi-book Library fixture", () => {
    const books = buildLibrary(multiSeriesTree());
    const ids = books.map((b) => b.id).sort();
    assert.deepEqual(ids, [
      "immune/immune",
      "munroe/how-to",
      "munroe/what-if-1",
      "munroe/what-if-2",
      "school/middle-school-01-first-day",
      "school/middle-school-02-get-me",
      "school/middle-school-03-homework",
      "school/middle-school-04-summer",
      "thing-explainer/thing-explainer",
    ]);
    assert.equal(books.find((b) => b.id === "school/middle-school-02-get-me").title, "Middle School 02 Get Me");
    assert.equal(books.find((b) => b.id === "school/middle-school-02-get-me").collectionTitle, "上學不容易");
    assert.equal(books.filter((b) => b.collectionId === "school").length, 4);
    assert.ok(books.some((b) => b.collectionId === "munroe"));
    assert.ok(books.some((b) => b.id === "thing-explainer/thing-explainer"));
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

  it("scans ebooks/ but still skips _source/, _prefixed folders, 0-byte media, and unreadable files", () => {
    assert.equal(shouldSkipPath(pathParts("Library/Immune/ebooks/immune.epub")), false);
    assert.equal(shouldSkipPath(pathParts("Library/門羅-WhatIf/_source/raw.mp3")), true);
    assert.equal(shouldSkipPath(pathParts("Library/_draft/listen/book/a.mp3")), true);

    const books = buildLibrary([
      entry("Library/Immune/listen/Immune-Part01.mp3"),
      entry("Library/Immune/ebooks/not-audio-book.mp3"),
      entry("Library/Immune/ebooks/ignored.pdf"),
      entry("Library/Immune/_source/raw.mp3"),
      entry("Library/_tmp/listen/ghost/a.mp3"),
      entry("Library/Immune/listen/empty-cloud.mp3", 0),
      entry("Library/Immune/ebooks/empty-cloud.epub", 0),
      { path: "Library/Immune/listen/unreadable.mp3", file: null },
      entry("Library/Immune/listen/notes.txt"),
    ]);
    assert.equal(books.length, 1);
    assert.equal(books[0].id, "immune/immune");
    assert.deepEqual(
      books[0].chapters.map((ch) => ch.id),
      ["Immune-Part01.mp3"]
    );
    assert.equal(books[0].ebook, null);
    assert.equal(shelfBadge(books[0]), "Audio");
  });

  it("pairs Library/listen/<book>/ to Library/ebooks/<book>.epub", () => {
    const books = buildLibrary([
      entry("Library/listen/what-if-1/01 - Introduction.mp3"),
      entry("Library/listen/what-if-1/02 - Global Windstorm.mp3"),
      entry("Library/ebooks/what-if-1.epub"),
    ]);
    assert.equal(books.length, 1);
    assert.equal(books[0].id, "library/what-if-1");
    assert.equal(books[0].folder, "what-if-1");
    assert.equal(books[0].chapters.length, 2);
    assert.equal(books[0].ebook?.name, "what-if-1.epub");
    assert.equal(shelfBadge(books[0]), "Audio");
  });

  it("pairs collection-scoped listen/ and ebooks/ siblings by slug", () => {
    const books = buildLibrary([
      ...libraryTree(),
      entry("Library/Immune/ebooks/Immune.epub"),
      entry("Library/門羅-WhatIf/ebooks/what-if-1.epub"),
      entry("Library/門羅-WhatIf/ebooks/How To/how-to.epub"),
    ]);
    const immune = books.find((b) => b.id === "immune/immune");
    const whatIf = books.find((b) => b.id === "munroe/what-if-1");
    const howTo = books.find((b) => b.id === "munroe/how-to");
    const whatIf2 = books.find((b) => b.id === "munroe/what-if-2");
    assert.equal(immune.ebook?.name, "Immune.epub");
    assert.equal(shelfBadge(immune), "Audio");
    assert.equal(whatIf.ebook?.name, "what-if-1.epub");
    assert.equal(shelfBadge(whatIf), "Audio");
    assert.equal(howTo.ebook?.name, "how-to.epub");
    assert.equal(shelfBadge(howTo), "Audio");
    assert.equal(whatIf2.ebook, null);
    assert.equal(shelfBadge(whatIf2), "Audio");
    assert.equal(whatIf.collectionFolder, "門羅-WhatIf");
    assert.equal(immune.collectionFolder, "Immune");
    assert.equal(
      libraryReadUrl(whatIf, 1),
      "https://bigdaddy109.github.io/library-read/?series=%E9%96%80%E7%BE%85-WhatIf&book=what-if-1&ch=2"
    );
    assert.equal(libraryReadUrl(whatIf2, 0), "");
  });

  it("adds a searchable ebook-only row and ignores PDF", () => {
    const books = buildLibrary([
      entry("Library/ebooks/solo-title.epub"),
      entry("Library/ebooks/earth-science.pdf"),
      entry("Library/Immune/ebooks/notes.pdf"),
    ]);
    assert.deepEqual(
      books.map((b) => [b.id, shelfBadge(b), b.chapters.length, b.ebook?.name]),
      [["library/solo-title", "Read", 0, "solo-title.epub"]]
    );
    assert.equal(books[0].title, "Solo Title");
  });

  it("pairs Library-root ebooks/<book>.epub onto the collection listen book", () => {
    const books = buildLibrary([
      entry("Library/Immune/listen/Immune-Part01.mp3"),
      entry("Library/ebooks/immune.epub"),
    ]);
    assert.deepEqual(
      books.map((b) => [b.id, shelfBadge(b), b.ebook?.name, b.chapters.length]),
      [["immune/immune", "Audio", "immune.epub", 1]]
    );
  });
});

describe("Jeff Drive fixture: every series has listen/ + ebooks/", () => {
  it("builds playable Audio books for 上學不容易, 門羅-WhatIf, Immune, Thing Explainer", () => {
    const books = buildLibrary(jeffDriveLibraryEntries());
    const expected = [
      "immune/immune",
      "munroe/how-to",
      "munroe/what-if-1",
      "munroe/what-if-2",
      "school/middle-school-01-first-day",
      "school/middle-school-02-get-me",
      "school/middle-school-03-homework",
      "school/middle-school-04-summer",
      "thing-explainer/thing-explainer",
    ];
    assert.deepEqual(books.map((b) => b.id).sort(), expected);
    for (const book of books) {
      assert.equal(shelfBadge(book), "Audio", book.id);
      assert.equal(isBookPlayable(book), true, book.id);
      assert.ok(book.ebook?.file, book.id);
      assert.ok(book.chapters.every((ch) => chapterIsPlayable(ch)), book.id);
    }
  });

  it("pairs Library/ebooks/<slug>.epub to collection listen/ audio", () => {
    const books = buildLibrary(jeffLibraryRootEbookEntries());
    assert.equal(books.length, 4);
    for (const book of books) {
      assert.equal(shelfBadge(book), "Audio", book.id);
      assert.equal(isBookPlayable(book), true, book.id);
    }
    assert.ok(books.every((b) => b.id !== "library/immune"));
  });
});

describe("isBookPlayable streams Drive stubs without a saved Blob", () => {
  it("treats driveId-only chapters as playable", () => {
    const stub = {
      id: "munroe/what-if-1",
      chapters: [{ id: "01.mp3", title: "Introduction", driveId: "d-wi1-01", file: null, url: null }],
      ebook: { id: "what-if-1.epub", name: "what-if-1.epub", driveId: "d-wi1-epub", file: null },
    };
    assert.equal(chapterIsPlayable(stub.chapters[0]), true);
    assert.equal(isBookPlayable(stub), true);
    assert.equal(isBookPlayable({ id: "x", chapters: [{ id: "01.mp3", file: null }] }), false);
    assert.equal(isBookPlayable({ id: "x", chapters: [] }), false);
  });
});

describe("locateEbookPath + pairingKey", () => {
  it("reads Library/ebooks/<book>.epub and collection-scoped siblings", () => {
    assert.deepEqual(locateEbookPath(pathParts("Library/ebooks/what-if-1.epub")), {
      collectionFolder: "Library",
      bookFolder: "what-if-1",
    });
    assert.deepEqual(locateEbookPath(pathParts("Library/Immune/ebooks/Immune.epub")), {
      collectionFolder: "Immune",
      bookFolder: "immune",
    });
    assert.deepEqual(locateEbookPath(pathParts("ebooks/what-if-1.epub")), {
      collectionFolder: "Library",
      bookFolder: "what-if-1",
    });
    assert.deepEqual(
      locateEbookPath(pathParts("Library/門羅-WhatIf/ebooks/what-if-1/book.epub")),
      { collectionFolder: "門羅-WhatIf", bookFolder: "what-if-1" }
    );
  });

  it("returns null when the path is not an EPUB under ebooks/", () => {
    assert.equal(locateEbookPath(pathParts("Library/ebooks")), null);
    assert.equal(locateEbookPath(pathParts("Library/ebooks/cover.jpg")), null);
    assert.equal(locateEbookPath(pathParts("Library/listen/what-if-1/01.mp3")), null);
  });

  it("pairs listen folder slugs to ebook stems", () => {
    assert.equal(
      pairingKey("門羅-WhatIf", "what-if-1"),
      pairingKey("門羅-WhatIf", "What If 1")
    );
    assert.equal(pairingKey("Immune", "immune"), pairingKey("Immune", "Immune"));
  });
});

describe("libraryReadUrl", () => {
  it("uses the series folder and EPUB stem, with a 1-based chapter", () => {
    const school = {
      collectionId: "school",
      ebook: { name: "Middle School 02 Get Me.epub" },
    };
    assert.equal(seriesFolderName(school), "上學不容易");
    assert.equal(
      libraryReadUrl(school, 0),
      "https://bigdaddy109.github.io/library-read/?series=%E4%B8%8A%E5%AD%B8%E4%B8%8D%E5%AE%B9%E6%98%93&book=Middle%20School%2002%20Get%20Me&ch=1"
    );
  });

  it("omits ch when nothing is playing and hides books without an EPUB", () => {
    assert.equal(
      libraryReadUrl({ collectionId: "immune", ebook: { id: "Immune.epub", name: "Immune.epub" } }, null),
      "https://bigdaddy109.github.io/library-read/?series=Immune&book=Immune"
    );
    assert.equal(libraryReadUrl({ collectionFolder: "Immune", ebook: null }, 3), "");
    assert.equal(libraryReadUrl({ collectionFolder: "Immune", ebook: { name: "notes.pdf" } }, 0), "");
    assert.equal(libraryReadUrl({ collectionId: "thing-explainer", ebook: { name: "Thing Explainer.epub" } }), "");
    assert.equal(
      libraryReadUrl(
        { collectionId: "thing-explainer", collectionFolder: "Thing Explainer", ebook: { name: "Thing Explainer.epub" } },
        4
      ),
      "https://bigdaddy109.github.io/library-read/?series=Thing%20Explainer&book=Thing%20Explainer&ch=5"
    );
  });
});

describe("shelfBadge", () => {
  it("returns Audio for listen books; Read only for ebook-only leftovers", () => {
    assert.equal(shelfBadge({ chapters: [{ id: "a" }], ebook: null }), "Audio");
    assert.equal(shelfBadge({ chapters: [], ebook: { name: "solo.epub" } }), "Read");
    assert.equal(
      shelfBadge({ chapters: [{ id: "a" }], ebook: { id: "book.epub" } }),
      "Audio"
    );
  });
});

describe("bookScreenTabs", () => {
  it("hides the tab bar for audio-only and ebook-only books", () => {
    assert.deepEqual(bookScreenTabs({ chapters: [{ id: "a" }], ebook: null }), []);
    assert.deepEqual(bookScreenTabs({ chapters: [], ebook: { name: "solo.epub" } }), []);
  });

  it("hides the tab bar for a paired listen book (listen-only, no Read tab)", () => {
    assert.deepEqual(
      bookScreenTabs({
        id: "munroe/how-to",
        collectionId: "munroe",
        chapters: [{ id: "01.mp3" }],
        ebook: { name: "how-to.epub" },
      }),
      []
    );
  });

  it("keeps Concepts for Immune and never adds Read", () => {
    assert.equal(isImmuneBook({ collectionId: "immune", id: "immune/immune" }), true);
    assert.deepEqual(
      bookScreenTabs({
        id: "immune/immune",
        collectionId: "immune",
        chapters: [{ id: "Immune-Part01.mp3" }],
        ebook: null,
      }),
      ["audio", "concepts"]
    );
    assert.deepEqual(
      bookScreenTabs({
        id: "immune/immune",
        collectionId: "immune",
        chapters: [{ id: "Immune-Part01.mp3" }],
        ebook: { name: "immune.epub" },
      }),
      ["audio", "concepts"]
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

  it("saves an epub-cfi text locator without wiping audio chapters", () => {
    const store = memoryStore();
    saveProgress("immune/immune", "Immune-Part02.mp3", 45, 580, store);
    const text = saveTextProgress(
      "immune/immune",
      { kind: "epub-cfi", locator: "epubcfi(/6/4!)", fraction: 0.37, label: "Later" },
      store
    );
    assert.equal(text.kind, "epub-cfi");
    assert.equal(text.locator, "epubcfi(/6/4!)");
    assert.equal(text.fraction, 0.37);
    assert.equal(text.label, "Later");
    const all = loadProgress(store)["immune/immune"];
    assert.equal(all.chapterId, "Immune-Part02.mp3");
    assert.equal(all.positionSeconds, 45);
    assert.ok(all.chapters["Immune-Part02.mp3"]);
    assert.equal(textProgress("immune/immune", store).locator, "epubcfi(/6/4!)");
    assert.equal(latestProgressKind(all), "text");
  });

  it("keeps the text locator when audio progress is written later", () => {
    const store = memoryStore();
    saveTextProgress("library/solo-title", { kind: "epub-cfi", locator: "epubcfi(/6/2!)", fraction: 0.1 }, store);
    saveProgress("library/solo-title", "01.mp3", 12, 90, store);
    const all = loadProgress(store)["library/solo-title"];
    assert.equal(all.text.locator, "epubcfi(/6/2!)");
    assert.equal(all.chapterId, "01.mp3");
    assert.equal(latestProgressKind(all), "audio");
  });

  it("Continue uses whichever of audio vs text was updated last", () => {
    const store = memoryStore({
      [PROGRESS_KEY]: JSON.stringify({
        "munroe/what-if-1": {
          chapterId: "01 - Introduction.mp3",
          positionSeconds: 33,
          chapterDurationSeconds: 120,
          updatedAt: "2026-01-02T00:00:00.000Z",
          chapters: {
            "01 - Introduction.mp3": {
              positionSeconds: 33,
              chapterDurationSeconds: 120,
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          },
          text: {
            kind: "epub-cfi",
            locator: "epubcfi(/6/2!)",
            fraction: 0.2,
            updatedAt: "2026-01-03T00:00:00.000Z",
          },
        },
      }),
    });
    const record = loadProgress(store)["munroe/what-if-1"];
    assert.equal(latestProgressKind(record), "text");
    record.text.updatedAt = "2026-01-01T00:00:00.000Z";
    assert.equal(latestProgressKind(record), "audio");
    assert.equal(latestProgressKind(null), null);
  });

  it("treats the reserved ebook IndexedDB key as a saved EPUB blob", () => {
    assert.equal(EBOOK_OFFLINE_KEY, "__ebook__");
    assert.equal(isEbookSavedOffline(new Map([[EBOOK_OFFLINE_KEY, { size: 12 }]])), true);
    assert.equal(isEbookSavedOffline(new Map()), false);
    assert.equal(isEbookSavedOffline(null), false);
  });
});

describe("snapshot restore does not hide the last full scan", () => {
  it("keeps every snapshot row, not only recently-played blobs", () => {
    const snapshot = buildLibrary(multiSeriesTree()).map((book, i) => ({
      id: book.id,
      title: book.title,
      collectionId: book.collectionId,
      source: "drive",
      chapters: book.chapters.map((ch) => ({
        id: ch.id,
        title: ch.title,
        driveId: i < 2 ? `drive-${ch.id}` : null,
      })),
    }));
    const listed = booksFromLibrarySnapshot(snapshot);
    assert.equal(listed.length, 9);
    assert.equal(listed.filter((b) => b.chapters.some((ch) => ch.driveId)).length, 2);
    assert.equal(bookHasDriveMedia(snapshot[0]), true);
    assert.equal(bookHasDriveMedia({ id: "x", chapters: [] }), false);
  });

  it("unions a 2-book reconnect with the previous Drive shelf", () => {
    const full = buildLibrary(multiSeriesTree()).map((book) => ({
      ...book,
      source: "drive",
      chapters: book.chapters.map((ch) => ({ ...ch, driveId: `d-${ch.id}` })),
    }));
    const recent = full.filter((b) => b.id === "immune/immune" || b.id === "school/middle-school-02-get-me");
    const merged = mergeLibraryScans(recent, full);
    assert.equal(merged.length, 9);
    assert.ok(merged.some((b) => b.id === "munroe/what-if-1"));
    assert.ok(merged.some((b) => b.id === "school/middle-school-01-first-day"));
    assert.ok(merged.some((b) => b.id === "thing-explainer/thing-explainer"));
  });

  it("does not let an ebooks/ page replace listen/ audio on the same id", () => {
    const full = buildLibrary(jeffDriveLibraryEntries());
    const ebookPage = buildLibrary(ebookOnlyPage());
    const whatIfEbook = ebookPage.find((b) => b.id === "munroe/what-if-1");
    assert.ok(whatIfEbook);
    assert.equal(whatIfEbook.chapters.length, 0);
    const merged = mergeLibraryScans(ebookPage, full);
    const whatIf = merged.find((b) => b.id === "munroe/what-if-1");
    assert.ok(whatIf.chapters.length >= 2);
    assert.equal(isBookPlayable(whatIf), true);
    assert.ok(whatIf.ebook?.name);
    assert.equal(merged.filter((b) => isBookPlayable(b)).length, full.length);
  });

  it("mergeBookRecords keeps previous Drive chapters when the new row is Read-only", () => {
    const audio = {
      id: "school/middle-school-02-get-me",
      chapters: [{ id: "01.mp3", driveId: "d-ms02", file: { name: "01.mp3", driveId: "d-ms02" } }],
      ebook: null,
      source: "drive",
    };
    const readOnly = {
      id: "school/middle-school-02-get-me",
      chapters: [],
      ebook: { id: "Middle School 02 Get Me.epub", name: "Middle School 02 Get Me.epub", driveId: "d-ms02-epub" },
      source: "drive",
    };
    const merged = mergeBookRecords(readOnly, audio);
    assert.equal(merged.chapters.length, 1);
    assert.equal(merged.chapters[0].driveId, "d-ms02");
    assert.equal(merged.ebook?.driveId, "d-ms02-epub");
    assert.equal(isBookPlayable(merged), true);
  });
});

describe("emptyLibraryMessage", () => {
  it("lists KNOWN_COLLECTIONS folders including 上學不容易", () => {
    assert.deepEqual(knownCollectionFolders(), Object.keys(KNOWN_COLLECTIONS));
    const msg = emptyLibraryMessage([], 0);
    assert.match(msg, /找不到有聲書/);
    assert.match(msg, /門羅-WhatIf \/ Immune \/ 上學不容易/);
    assert.match(msg, /用 Google 登入/);
    assert.match(msg, /看到 0 個檔案（音檔 0）/);
  });

  it("includes skipped counts and sample audio paths", () => {
    const msg = emptyLibraryMessage(
      [
        { path: "Notes/readme.txt", file: { name: "readme.txt", size: 12 } },
        { path: "Podcast/clip.mp3", file: { name: "clip.mp3", size: 2048 } },
      ],
      3
    );
    assert.match(msg, /看到 2 個檔案（音檔 1，略過或讀不到 3）/);
    assert.match(msg, /範例路徑：\nPodcast\/clip\.mp3/);
  });

  it("follows the known-collection map so a later folder can be added without leftover names", () => {
    const msg = emptyLibraryMessage([], 0, { Immune: { id: "immune" } });
    assert.match(msg, /或 Immune/);
    assert.match(msg, /listen\//);
    assert.equal(msg.includes("門羅-WhatIf"), false);
    assert.equal(msg.includes("上學不容易"), false);
  });
});
