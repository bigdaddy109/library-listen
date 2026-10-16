/**
 * Multi-series fixture matching Jeff's Drive Library:
 * each series has listen/ audio AND ebooks/ EPUB.
 * Silent / in-memory only — not Hub audio.
 */

export const JEFF_SERIES = [
  { id: "school", title: "上學不容易", bookIds: [
    "school/middle-school-01-first-day",
    "school/middle-school-02-get-me",
    "school/middle-school-03-homework",
    "school/middle-school-04-summer",
  ]},
  { id: "munroe", title: "門羅-WhatIf", bookIds: [
    "munroe/what-if-1",
    "munroe/how-to",
    "munroe/what-if-2",
  ]},
  { id: "immune", title: "Immune", bookIds: ["immune/immune"] },
  { id: "thing-explainer", title: "Thing Explainer", bookIds: ["thing-explainer/thing-explainer"] },
];

export function jeffDriveLibraryEntries() {
  return [
    entry("Library/Immune/listen/Immune-Part01.mp3", "d-immune-p1"),
    entry("Library/Immune/listen/Immune-Part02.mp3", "d-immune-p2"),
    entry("Library/Immune/ebooks/Immune.epub", "d-immune-epub"),
    entry("Library/門羅-WhatIf/listen/what-if-1/01 - Introduction.mp3", "d-wi1-01"),
    entry("Library/門羅-WhatIf/listen/what-if-1/02 - Global Windstorm.mp3", "d-wi1-02"),
    entry("Library/門羅-WhatIf/listen/how-to/001 - How To.mp3", "d-ht-01"),
    entry("Library/門羅-WhatIf/listen/what-if-2/What If 2 - Randall Munroe.m4b", "d-wi2"),
    entry("Library/門羅-WhatIf/ebooks/what-if-1.epub", "d-wi1-epub"),
    entry("Library/門羅-WhatIf/ebooks/how-to.epub", "d-ht-epub"),
    entry("Library/門羅-WhatIf/ebooks/what-if-2.epub", "d-wi2-epub"),
    entry("Library/上學不容易/listen/Middle School 01 First Day/01.mp3", "d-ms01"),
    entry("Library/上學不容易/listen/Middle School 02 Get Me/01.mp3", "d-ms02"),
    entry("Library/上學不容易/listen/Middle School 03 Homework/01.mp3", "d-ms03"),
    entry("Library/上學不容易/listen/Middle School 04 Summer.m4b", "d-ms04"),
    entry("Library/上學不容易/ebooks/Middle School 01 First Day.epub", "d-ms01-epub"),
    entry("Library/上學不容易/ebooks/Middle School 02 Get Me.epub", "d-ms02-epub"),
    entry("Library/上學不容易/ebooks/Middle School 03 Homework.epub", "d-ms03-epub"),
    entry("Library/上學不容易/ebooks/Middle School 04 Summer.epub", "d-ms04-epub"),
    entry("Library/Thing Explainer/listen/Thing Explainer/01.mp3", "d-te-01"),
    entry("Library/Thing Explainer/ebooks/Thing Explainer.epub", "d-te-epub"),
  ];
}

/** Same audio, ebooks only at Library/ebooks/<slug>.epub (cross-pair). */
export function jeffLibraryRootEbookEntries() {
  return [
    entry("Library/Immune/listen/Immune-Part01.mp3", "d-immune-p1"),
    entry("Library/門羅-WhatIf/listen/what-if-1/01.mp3", "d-wi1-01"),
    entry("Library/上學不容易/listen/Middle School 02 Get Me/01.mp3", "d-ms02"),
    entry("Library/Thing Explainer/listen/Thing Explainer/01.mp3", "d-te-01"),
    entry("Library/ebooks/immune.epub", "d-immune-epub"),
    entry("Library/ebooks/what-if-1.epub", "d-wi1-epub"),
    entry("Library/ebooks/Middle School 02 Get Me.epub", "d-ms02-epub"),
    entry("Library/ebooks/Thing Explainer.epub", "d-te-epub"),
  ];
}

export function ebookOnlyPage(entries = jeffDriveLibraryEntries()) {
  return entries.filter((e) => /\.epub$/i.test(e.file.name));
}

/** localStorage snapshot: Drive ids only — no Blobs. */
export function jeffDriveLibrarySnapshot(buildLibrary) {
  return buildLibrary(jeffDriveLibraryEntries()).map((book) => ({
    id: book.id,
    collectionId: book.collectionId,
    collectionTitle: book.collectionTitle,
    collectionFolder: book.collectionFolder || null,
    folder: book.folder,
    title: book.title,
    subtitle: book.subtitle,
    author: book.author,
    source: "drive",
    coverDriveId: null,
    ebook: book.ebook
      ? {
          id: book.ebook.id,
          name: book.ebook.name,
          driveId: book.ebook.file?.driveId || `d-ebook-${book.id}`,
          size: 4096,
          type: "application/epub+zip",
        }
      : null,
    chapters: book.chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      driveId: ch.file?.driveId || `d-${ch.id}`,
      size: 2048,
      type: "audio/mpeg",
    })),
  }));
}

function entry(path, driveId, size = 2048) {
  const name = path.split("/").pop();
  return {
    path,
    file: { name, size, driveId },
  };
}
