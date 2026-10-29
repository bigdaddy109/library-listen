import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { driveChromeAfterSignIn } from "../docs/drive.js";
import { playbackDisplayClock } from "../docs/markers.js";
import { loadedShelfCount, shelfShownBooks } from "../docs/shelf/catalog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "docs/app.js"), "utf8");
const SHELF = readFileSync(join(ROOT, "docs/shelf/shelf.js"), "utf8");

describe("player polish", () => {
  it("clears a stale popup failure on the status line and the player bar after sign-in", () => {
    const stale = {
      statusText: "Failed to open popup window",
      statusIsError: true,
      playerText: "Failed to open popup window",
      playerIsError: true,
    };
    const pending = driveChromeAfterSignIn(stale, { signedIn: false });
    assert.equal(pending.statusText, "Failed to open popup window");
    assert.equal(pending.playerText, "Failed to open popup window");
    assert.equal(pending.statusIsError, true);
    assert.equal(pending.playerIsError, true);

    const signedIn = driveChromeAfterSignIn(stale, { signedIn: true });
    assert.equal(signedIn.statusText, "");
    assert.equal(signedIn.statusIsError, false);
    assert.equal(signedIn.playerText, "");
    assert.equal(signedIn.playerIsError, false);

    const other = driveChromeAfterSignIn(
      {
        statusText: "Sign-in expired. Tap Sign in with Google again to keep playing from Drive.",
        statusIsError: true,
        playerText: 'Could not play “Immune”.',
        playerIsError: true,
      },
      { signedIn: true }
    );
    assert.match(other.statusText, /Sign-in expired/);
    assert.equal(other.playerText, 'Could not play “Immune”.');

    assert.match(APP, /setDriveTokenAppliedListener\(\(\) => \{\s*clearStalePopupError\(\);\s*\}\)/);
    assert.match(APP, /isPopupWindowFailure\(err\) && freshAccessToken\(\)/);
    assert.match(APP, /driveChromeAfterSignIn\(readDriveChrome\(\), \{ signedIn: true \}\)/);
  });

  it("counts the books on the shelf, not files, chapters, or silent EPUBs", () => {
    const playable = Array.from({ length: 21 }, (_, i) => ({
      id: `book-${i}`,
      title: `Book ${i}`,
      chapters: [
        { id: `book-${i}-a`, title: "Part 01" },
        { id: `book-${i}-b`, title: "Part 02" },
        { id: `book-${i}-c`, title: "Part 03" },
      ],
      ebook: { name: `book-${i}.epub` },
    }));
    const silent = Array.from({ length: 9 }, (_, i) => ({
      id: `notes-${i}`,
      title: `Notes ${i}`,
      chapters: [],
      ebook: { name: `notes-${i}.epub` },
    }));
    const library = [...playable, ...silent];
    assert.equal(library.length, 30);
    assert.equal(loadedShelfCount(library), 21);
    assert.deepEqual(
      shelfShownBooks(library).map((book) => book.id),
      playable.map((book) => book.id)
    );
    const chapterFiles = playable.reduce((n, book) => n + book.chapters.length, 0);
    assert.equal(chapterFiles, 63);
    assert.notEqual(loadedShelfCount(library), chapterFiles);

    const immune = {
      id: "immune/immune",
      title: "Immune",
      collectionId: "immune",
      chapters: Array.from({ length: 9 }, (_, i) => ({
        id: `Immune-Part${String(i + 1).padStart(2, "0")}.mp3`,
        title: `Part ${String(i + 1).padStart(2, "0")}`,
      })),
    };
    assert.equal(loadedShelfCount([immune]), 1);
    assert.equal(loadedShelfCount([immune, ...silent]), 1);
    assert.equal(shelfShownBooks([immune, ...silent]).some((book) => book.id === immune.id), true);

    assert.match(SHELF, /Loaded \$\{visibleBooks\(\)\.length\} books/);
    assert.doesNotMatch(SHELF, /Loaded \$\{state\.books\.length\} books/);
  });

  it("shows a real duration once metadata arrives and does not freeze at 0:00", () => {
    const chapter = { id: "Immune-Part01.mp3", title: "Part 01" };
    const before = playbackDisplayClock({
      currentTime: 6,
      mediaDuration: 0,
      heldDuration: 0,
      chapter,
    });
    assert.equal(before.dur, 0);
    assert.equal(before.heldDuration, 0);

    const meta = playbackDisplayClock({
      currentTime: 6.4,
      mediaDuration: 3725,
      heldDuration: before.heldDuration,
      chapter,
    });
    assert.equal(meta.dur, 3725);
    assert.ok(meta.dur > 0);

    const glitch = playbackDisplayClock({
      currentTime: 8,
      mediaDuration: 0,
      heldDuration: meta.heldDuration,
      chapter,
    });
    assert.equal(glitch.dur, 3725);
    assert.match(APP, /heldFileDuration = 0/);
    assert.match(APP, /loadedmetadata/);
    assert.match(APP, /durationchange/);
  });

  it("tracks audio.currentTime instead of a stale sample", () => {
    const chapter = { id: "Immune-Part01.mp3", title: "Part 01" };
    const early = playbackDisplayClock({
      currentTime: 4,
      mediaDuration: 3725,
      heldDuration: 3725,
      chapter,
    });
    const later = playbackDisplayClock({
      currentTime: 11.6,
      mediaDuration: 3725,
      heldDuration: early.heldDuration,
      chapter,
    });
    assert.equal(early.pos, 4);
    assert.equal(later.pos, 11.6);
    assert.ok(later.pos - early.pos > 5);
    assert.match(APP, /playbackDisplayClock\(/);
    assert.match(APP, /requestAnimationFrame\(tick\)/);
    assert.match(APP, /startPlaybackClock\(\)/);
  });
});
