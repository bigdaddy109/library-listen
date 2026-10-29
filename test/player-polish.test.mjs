import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildLibrary } from "../docs/library.js";
import {
  driveChromeAfterSignIn,
  driveListUrl,
  makeDriveFile,
  restoreDriveFile,
  shouldSurfacePopupFailure,
  snapshotDriveFields,
} from "../docs/drive.js";
import {
  partDurationSeconds,
  playbackDisplayClock,
  restoreChapterFields,
  snapshotChapter,
} from "../docs/markers.js";
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

    assert.match(APP, /setDriveTokenAppliedListener\(\(\) => \{/);
    assert.match(APP, /clearStalePopupError\(\)/);
    assert.match(APP, /queueMicrotask\(\(\) => clearStalePopupError\(\)\)/);
    assert.match(APP, /setTimeout\(\(\) => clearStalePopupError\(\), 0\)/);
    assert.match(APP, /shouldSurfacePopupFailure\(err, \{ promptOpened: true, signedIn: !!freshAccessToken\(\) \}\)/);
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

  it("non-finite audio.duration falls back to durationMillis", () => {
    const file = makeDriveFile({
      id: "part01",
      name: "Immune-Part01.mp3",
      mimeType: "audio/mpeg",
      size: 1200,
      videoMediaMetadata: { durationMillis: "3600000" },
    });
    assert.equal(file.durationMillis, 3_600_000);
    const books = buildLibrary([
      { path: "Library/Immune/listen/Immune-Part01.mp3", file },
    ]);
    const chapter = books[0].chapters[0];
    assert.equal(chapter.durationMillis, 3_600_000);
    const school = makeDriveFile({
      id: "ms01",
      name: "01.mp3",
      mimeType: "audio/mpeg",
      size: 800,
      videoMediaMetadata: { durationMillis: 2_700_000 },
    });
    const schoolBooks = buildLibrary([
      { path: "Library/上學不容易/listen/Middle School 01 First Day/01.mp3", file: school },
    ]);
    assert.equal(schoolBooks[0].chapters[0].durationMillis, 2_700_000);

    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const clock = playbackDisplayClock({
        currentTime: 49,
        mediaDuration: bad,
        heldDuration: 0,
        chapter,
        durationMillis: chapter.durationMillis,
      });
      assert.equal(clock.dur, 3600);
      assert.equal(clock.pos, 49);
      assert.notEqual(clock.dur, clock.pos);
    }
    assert.match(decodeURIComponent(driveListUrl({ q: "trashed=false" })), /videoMediaMetadata\(durationMillis\)/);
    assert.equal(restoreDriveFile(snapshotDriveFields(file)).durationMillis, 3_600_000);
    assert.equal(restoreChapterFields(snapshotChapter(chapter), 0).durationMillis, 3_600_000);
    assert.match(APP, /durationMillis: chapter\?\.durationMillis/);
  });

  it("durationchange updates the total", () => {
    const chapter = {
      id: "Immune-Part01.mp3",
      title: "Part 01",
      durationMillis: 3_600_000,
    };
    const streaming = playbackDisplayClock({
      currentTime: 36,
      mediaDuration: Number.POSITIVE_INFINITY,
      heldDuration: 0,
      chapter,
    });
    assert.equal(streaming.dur, 3600);
    assert.equal(streaming.pos, 36);

    const changed = playbackDisplayClock({
      currentTime: 49,
      mediaDuration: 3599.5,
      heldDuration: streaming.heldDuration,
      chapter,
    });
    assert.equal(changed.dur, 3599.5);
    assert.notEqual(changed.dur, 0);
    assert.notEqual(changed.dur, changed.pos);

    const wiped = playbackDisplayClock({
      currentTime: 50,
      mediaDuration: Number.NaN,
      heldDuration: changed.heldDuration,
      chapter,
    });
    assert.equal(wiped.dur, 3599.5);
    assert.match(APP, /addEventListener\("durationchange"/);
    assert.match(APP, /updateChapterTimes\(\)/);
  });

  it("the part label is the duration, not currentTime", () => {
    const chapter = { id: "Immune-Part01.mp3", title: "Part 01", durationMillis: 3_600_000 };
    const at49 = partDurationSeconds(chapter, {
      elementDuration: Number.POSITIVE_INFINITY,
      currentTime: 49,
    });
    const at59 = partDurationSeconds(chapter, {
      elementDuration: Number.NaN,
      currentTime: 59,
    });
    assert.equal(at49, 3600);
    assert.equal(at59, 3600);
    assert.notEqual(at49, 49);
    assert.notEqual(at59, 59);
    assert.notEqual(at49, 0.36);

    const render = APP.slice(APP.indexOf("function renderBook"), APP.indexOf("function render("));
    const times = APP.slice(APP.indexOf("function updateChapterTimes"), APP.indexOf("function writeSeekBar"));
    assert.match(render, /formatPartDuration\(ch\)/);
    assert.doesNotMatch(render, /positionSeconds/);
    assert.match(times, /formatPartDuration\(ch\)/);
    assert.doesNotMatch(times, /positionSeconds/);
    assert.match(APP, /partDurationSeconds\(ch,/);
  });

  it("the popup error does not stick after success", () => {
    const popup = { type: "popup_failed_to_open", message: "Failed to open popup window" };
    assert.equal(shouldSurfacePopupFailure(popup, { promptOpened: true, signedIn: false }), false);
    assert.equal(shouldSurfacePopupFailure(popup, { promptOpened: true, signedIn: true }), false);
    assert.equal(shouldSurfacePopupFailure(popup, { promptOpened: false, signedIn: true }), false);
    assert.equal(
      shouldSurfacePopupFailure({ message: "Could not play “Immune”." }, { promptOpened: true }),
      true
    );

    const opened = {
      statusText: "",
      statusIsError: false,
      playerText: "",
      playerIsError: false,
    };
    assert.equal(shouldSurfacePopupFailure(popup, { promptOpened: true }), false);
    assert.equal(opened.statusText, "");
    assert.equal(opened.playerText, "");

    const stuck = driveChromeAfterSignIn(
      {
        statusText: "Failed to open popup window",
        statusIsError: true,
        playerText: "Failed to open popup window",
        playerIsError: true,
      },
      { signedIn: true }
    );
    assert.equal(stuck.statusText, "");
    assert.equal(stuck.statusIsError, false);
    assert.equal(stuck.playerText, "");
    assert.equal(stuck.playerIsError, false);

    const show = APP.slice(APP.indexOf("function showDriveError"), APP.indexOf("function updateDriveStatus"));
    assert.match(show, /shouldSurfacePopupFailure/);
    assert.match(show, /clearStalePopupError\(\)/);
    assert.doesNotMatch(
      show.slice(0, show.indexOf("clearStalePopupError")),
      /Failed to open popup window/
    );
  });
});
