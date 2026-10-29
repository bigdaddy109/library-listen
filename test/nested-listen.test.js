/**
 * Real Drive names (generated/silent files only — no book text, no audio bytes).
 *
 * Immune is flat: Library/<series>/listen/Immune-PartNN.mp3
 * Middle School is nested: Library/上學不容易-Middle-School/listen/Middle School NN - Title/*.mp3
 *   parts 02–15 and 17 (no 01, no 16).
 * What If is nested: Library/門羅-WhatIf/listen/how-to/ and listen/what-if-1/
 * The known series key is 上學不容易; the Drive folder is 上學不容易-Middle-School.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIVE_FOLDER_MIME,
  attachDriveMedia,
  shouldWalkDriveItem,
  walkDriveFolder,
} from "../docs/drive.js";
import {
  READ_THIS_BOOK_LABEL,
  buildLibrary,
  isBookPlayable,
  listenShelfBooks,
  matchKnownCollection,
} from "../docs/library.js";

const FOLDER = DRIVE_FOLDER_MIME;
const BASE = "https://bigdaddy109.github.io/library-listen/";

function folder(id, name, parents, mimeType = FOLDER) {
  return { id, name, mimeType, parents };
}

function audio(id, name, parents, size = 2048) {
  return { id, name, mimeType: "audio/mpeg", size, parents };
}

function epub(id, name, parents, size = 4096) {
  return { id, name, mimeType: "application/epub+zip", size, parents };
}

/** 02–15 and 17. No 01, no 16. */
function middleSchoolParts() {
  const parts = [];
  for (let n = 2; n <= 15; n += 1) parts.push(String(n).padStart(2, "0"));
  parts.push("17");
  return parts;
}

/**
 * @param {{ labelBookFolders?: boolean }} [opts]
 * `labelBookFolders: false` is a listing that names listen/<book>/ but omits the folder mime.
 */
function realDriveTree({ labelBookFolders = true } = {}) {
  const bookMime = labelBookFolders ? FOLDER : "";
  const tree = [
    folder("lib", "Library"),
    folder("immune", "Immune", ["lib"]),
    folder("ilisten", "listen", ["immune"]),
    audio("p1", "Immune-Part01.mp3", ["ilisten"]),
    audio("p2", "Immune-Part02.mp3", ["ilisten"]),
    folder("school", "上學不容易-Middle-School", ["lib"]),
    folder("slisten", "listen", ["school"]),
    folder("munroe", "門羅-WhatIf", ["lib"]),
    folder("mlisten", "listen", ["munroe"]),
    folder("howto", "how-to", ["mlisten"], bookMime),
    audio("hta", "001.mp3", ["howto"]),
    folder("wi1", "what-if-1", ["mlisten"], bookMime),
    audio("wia", "01.mp3", ["wi1"]),
    folder("explain", "Thing Explainer", ["lib"]),
    folder("eebooks", "ebooks", ["explain"]),
    epub("te", "Thing Explainer.epub", ["eebooks"]),
    folder("notes", "Notes", ["lib"]),
    folder("nlisten", "listen", ["notes"]),
    folder("empty", "Empty", ["nlisten"], bookMime),
    { id: "empty-cover", name: "cover.jpg", mimeType: "image/jpeg", size: 800, parents: ["empty"] },
  ];
  for (const part of middleSchoolParts()) {
    const id = `ms${part}`;
    tree.push(folder(id, `Middle School ${part} - Title`, ["slisten"], bookMime));
    tree.push(audio(`${id}a`, "01.mp3", [id]));
    if (part === "02") tree.push(audio(`${id}b`, "02.mp3", [id]));
  }
  return tree;
}

function mockDriveFetch(tree) {
  return async (url) => {
    const u = new URL(url, "https://www.googleapis.com");
    const q = u.searchParams.get("q") || "";
    const parent = q.match(/'([^']+)' in parents/);
    let files = tree;
    if (parent) files = tree.filter((item) => (item.parents || [])[0] === parent[1]);
    else if (q.includes("name='Library'")) {
      files = tree.filter((item) => item.name === "Library" && item.mimeType === FOLDER);
    }
    const body = { files };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

async function playedBooks({ labelBookFolders } = {}) {
  const { entries } = await walkDriveFolder("lib", "tok", {
    prefix: ["Library"],
    fetchImpl: mockDriveFetch(realDriveTree({ labelBookFolders })),
  });
  const books = attachDriveMedia(buildLibrary(entries), { base: BASE });
  return { entries, books, shelf: listenShelfBooks(books) };
}

function assertRealLayout({ entries, books, shelf }) {
  assert.ok(entries.some((e) => e.path === "Library/Immune/listen/Immune-Part01.mp3"));
  assert.ok(
    entries.some(
      (e) => e.path === "Library/上學不容易-Middle-School/listen/Middle School 02 - Title/01.mp3"
    )
  );
  assert.ok(
    entries.some(
      (e) => e.path === "Library/上學不容易-Middle-School/listen/Middle School 02 - Title/02.mp3"
    )
  );
  assert.ok(entries.some((e) => e.path === "Library/門羅-WhatIf/listen/how-to/001.mp3"));
  assert.ok(entries.some((e) => e.path === "Library/門羅-WhatIf/listen/what-if-1/01.mp3"));
  assert.equal(
    entries.some((e) => e.path.includes("Middle School 01")),
    false
  );
  assert.equal(
    entries.some((e) => e.path.includes("Middle School 16")),
    false
  );

  const immune = books.find((b) => b.id === "immune/immune");
  assert.ok(immune);
  assert.equal(immune.chapters.length, 2);
  assert.equal(isBookPlayable(immune), true);
  assert.match(immune.chapters[0].url, /\/drive-media\/p1$/);
  assert.match(immune.chapters[1].url, /\/drive-media\/p2$/);

  const matched = matchKnownCollection("上學不容易-Middle-School");
  assert.equal(matched?.folder, "上學不容易");
  assert.equal(matched?.meta.id, "school");

  const school = books.filter((b) => b.collectionId === "school");
  assert.equal(school.length, middleSchoolParts().length);
  for (const part of middleSchoolParts()) {
    const book = school.find((b) => b.folder === `Middle School ${part} - Title`);
    assert.ok(book, part);
    assert.equal(book.collectionTitle, "School Isn't Easy");
    assert.equal(book.collectionFolder, "上學不容易-Middle-School");
    assert.equal(book.id, `school/middle-school-${part}-title`);
    assert.equal(isBookPlayable(book), true, part);
    assert.match(book.chapters[0].url, /\/drive-media\//);
    assert.equal(book.chapters.length, part === "02" ? 2 : 1);
  }
  assert.equal(
    books.some((b) => /middle school 01/i.test(b.folder || "") || /middle school 16/i.test(b.folder || "")),
    false
  );

  const howTo = books.find((b) => b.id === "munroe/how-to");
  const whatIf = books.find((b) => b.id === "munroe/what-if-1");
  assert.equal(howTo?.title, "How To");
  assert.equal(isBookPlayable(howTo), true);
  assert.match(howTo.chapters[0].url, /\/drive-media\/hta$/);
  assert.equal(whatIf?.title, "What If?");
  assert.equal(isBookPlayable(whatIf), true);
  assert.match(whatIf.chapters[0].url, /\/drive-media\/wia$/);

  const read = shelf.find((b) => b.collectionFolder === "Thing Explainer");
  assert.ok(read);
  assert.equal(read.chapters.length, 0);
  assert.equal(isBookPlayable(read), false);
  assert.equal(read.readLabel, READ_THIS_BOOK_LABEL);
  assert.equal(read.readLabel, "讀這本");
  assert.match(read.readUrl, /^https:\/\/bigdaddy109\.github\.io\/library-read\/\?/);
  assert.match(read.readUrl, /series=Thing%20Explainer/);
  assert.match(read.readUrl, /book=Thing%20Explainer/);
  assert.equal(
    shelf.some((b) => !b.chapters?.length && !b.readUrl),
    false
  );
  assert.equal(
    shelf.some((b) => b.folder === "Empty" || b.collectionFolder === "Notes"),
    false
  );
}

describe("real Drive layout: nested listen folders and the Middle-School series key", () => {
  it("matches 上學不容易-Middle-School to the known 上學不容易 series", () => {
    assert.equal(matchKnownCollection("上學不容易")?.meta.id, "school");
    assert.equal(matchKnownCollection("上學不容易-Middle-School")?.folder, "上學不容易");
    assert.equal(matchKnownCollection("門羅-WhatIf")?.meta.id, "munroe");
    assert.equal(matchKnownCollection("Immune")?.meta.id, "immune");
    assert.equal(matchKnownCollection("ImmuneSystem"), null);
  });

  it("plays flat Immune files and nested Middle School / What If folders", async () => {
    assertRealLayout(await playedBooks({ labelBookFolders: true }));
  });

  it("still plays nested books when Drive omits the folder mime on listen/<book>/", async () => {
    assert.equal(
      shouldWalkDriveItem({ name: "Middle School 02 - Title", mimeType: "" }),
      true
    );
    assert.equal(
      shouldWalkDriveItem({ name: "how-to", mimeType: "application/vnd.google-apps.shortcut" }),
      true
    );
    assert.equal(
      shouldWalkDriveItem({ name: "Immune-Part01.mp3", mimeType: "audio/mpeg" }),
      false
    );
    assertRealLayout(await playedBooks({ labelBookFolders: false }));
  });

  it("hides a book with no audio and no EPUB, and routes an EPUB to Library Read", () => {
    assert.deepEqual(listenShelfBooks([{ id: "x", title: "Silent", chapters: [], ebook: null }]), []);
    const shelf = listenShelfBooks([
      {
        id: "thing-explainer/thing-explainer",
        collectionFolder: "Thing Explainer",
        chapters: [],
        ebook: { name: "Thing Explainer.epub" },
      },
    ]);
    assert.equal(shelf.length, 1);
    assert.equal(shelf[0].readLabel, "讀這本");
    assert.match(shelf[0].readUrl, /library-read/);
    assert.equal(isBookPlayable(shelf[0]), false);
  });
});

describe("buildLibrary pairs the real nested paths without a Drive round-trip", () => {
  it("keeps Immune as one book and does not drop nested listen/<book>/*.mp3", () => {
    const file = (name) => ({ name, size: 128 });
    const books = buildLibrary([
      { path: "Library/Immune/listen/Immune-Part01.mp3", file: file("Immune-Part01.mp3") },
      { path: "Library/Immune/listen/Immune-Part02.mp3", file: file("Immune-Part02.mp3") },
      {
        path: "Library/上學不容易-Middle-School/listen/Middle School 02 - Title/01.mp3",
        file: file("01.mp3"),
      },
      {
        path: "Library/上學不容易-Middle-School/listen/Middle School 17 - Title/01.mp3",
        file: file("01.mp3"),
      },
      { path: "Library/門羅-WhatIf/listen/how-to/001.mp3", file: file("001.mp3") },
      { path: "Library/門羅-WhatIf/listen/what-if-1/01.mp3", file: file("01.mp3") },
    ]);
    const immune = books.find((b) => b.id === "immune/immune");
    const part02 = books.find((b) => b.id === "school/middle-school-02-title");
    const part17 = books.find((b) => b.id === "school/middle-school-17-title");
    assert.equal(isBookPlayable(immune), true);
    assert.equal(immune.chapters.length, 2);
    assert.equal(part02.collectionId, "school");
    assert.equal(part02.collectionFolder, "上學不容易-Middle-School");
    assert.equal(isBookPlayable(part02), true);
    assert.equal(isBookPlayable(part17), true);
    assert.equal(isBookPlayable(books.find((b) => b.id === "munroe/how-to")), true);
    assert.equal(isBookPlayable(books.find((b) => b.id === "munroe/what-if-1")), true);
    assert.equal(books.some((b) => b.collectionId === "middle-school"), false);
  });
});
