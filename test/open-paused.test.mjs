import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadProgress, saveProgress } from "../docs/library.js";
import { allowProgressWrite, planPausedOpen } from "../docs/open-paused.js";

const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../docs/app.js"), "utf8");

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

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  let i = source.indexOf("(", start);
  let depth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  const brace = source.indexOf("{", i);
  depth = 0;
  for (let j = brace; j < source.length; j += 1) {
    const ch = source[j];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  throw new Error(`unclosed ${signature}`);
}

describe("open a second book paused", () => {
  it("does not start playback and does not discard that book's saved position", () => {
    const store = memoryStore();
    const bookA = {
      id: "book-a",
      title: "Book A",
      chapters: [
        { id: "a-1", title: "A1" },
        { id: "a-2", title: "A2" },
      ],
    };
    const bookB = {
      id: "book-b",
      title: "Book B",
      chapters: [
        { id: "b-1", title: "B1" },
        { id: "b-2", title: "B2" },
      ],
    };
    saveProgress("book-a", "a-1", 200, 600, store);
    saveProgress("book-b", "b-2", 88.5, 400, store);
    const savedB = loadProgress(store)["book-b"];

    const audio = {
      paused: false,
      currentTime: 200,
      src: "blob:a-1",
      playCalls: 0,
      play() {
        this.playCalls += 1;
        this.paused = false;
      },
    };

    const plan = planPausedOpen({
      book: bookB,
      loadedBookId: bookA.id,
      progress: loadProgress(store),
    });
    assert.equal(plan.autoplay, false);
    assert.equal(plan.sameBook, false);
    assert.equal(plan.pausePrevious, true);
    assert.equal(plan.cue, true);
    assert.equal(plan.chapterIndex, 1);
    assert.equal(plan.chapterId, "b-2");
    assert.equal(plan.seekSeconds, 88.5);

    if (plan.pausePrevious) audio.paused = true;
    assert.equal(
      allowProgressWrite({
        holdBookId: null,
        writingBookId: bookA.id,
        paused: true,
        seekPlaced: true,
        currentTime: audio.currentTime,
        seekSeconds: 0,
        srcReady: true,
      }),
      true
    );

    const refused = [
      { paused: true, seekPlaced: false, currentTime: 200, srcReady: false },
      { paused: true, seekPlaced: false, currentTime: 0, srcReady: true },
      { paused: true, seekPlaced: true, currentTime: 0, srcReady: true },
      { paused: true, seekPlaced: true, currentTime: 200, srcReady: true },
      { paused: true, seekPlaced: true, currentTime: 88.5, srcReady: true },
      { paused: false, seekPlaced: true, currentTime: 200, srcReady: true },
      { paused: false, seekPlaced: false, currentTime: 0, srcReady: true },
    ];
    for (const attempt of refused) {
      const allow = allowProgressWrite({
        holdBookId: plan.bookId,
        writingBookId: plan.bookId,
        seekSeconds: plan.seekSeconds,
        ...attempt,
      });
      assert.equal(allow, false, JSON.stringify(attempt));
    }

    audio.src = plan.chapterId;
    audio.currentTime = plan.seekSeconds;
    audio.paused = true;
    assert.equal(audio.playCalls, 0);
    assert.equal(audio.paused, true);
    assert.equal(audio.currentTime, 88.5);

    const after = loadProgress(store)["book-b"];
    assert.deepEqual(after, savedB);
    assert.equal(after.chapterId, "b-2");
    assert.equal(after.positionSeconds, 88.5);
    assert.equal(after.chapters["b-2"].positionSeconds, 88.5);
    assert.equal(loadProgress(store)["book-a"].chapterId, "a-1");
    assert.equal(loadProgress(store)["book-a"].positionSeconds, 200);

    const m4b = {
      id: "m4b-book",
      chapters: [
        { id: "c1", start: 100, end: 160 },
        { id: "c2", start: 160, end: 220 },
      ],
    };
    saveProgress("m4b-book", "c2", 180, 60, store);
    const beforeM = JSON.stringify(loadProgress(store)["m4b-book"]);
    const marked = planPausedOpen({
      book: m4b,
      loadedBookId: bookA.id,
      progress: loadProgress(store),
    });
    assert.equal(marked.autoplay, false);
    assert.equal(marked.chapterId, "c2");
    assert.equal(marked.seekSeconds, 180);
    assert.equal(JSON.stringify(loadProgress(store)["m4b-book"]), beforeM);

    const same = planPausedOpen({
      book: bookA,
      loadedBookId: bookA.id,
      progress: loadProgress(store),
    });
    assert.equal(same.sameBook, true);
    assert.equal(same.cue, false);
    assert.equal(same.pausePrevious, false);
    assert.equal(same.autoplay, false);

    const first = planPausedOpen({
      book: bookB,
      loadedBookId: null,
      progress: loadProgress(store),
    });
    assert.equal(first.pausePrevious, false);
    assert.equal(first.cue, true);
    assert.equal(first.autoplay, false);
    assert.equal(first.seekSeconds, 88.5);

    assert.equal(
      allowProgressWrite({
        holdBookId: bookB.id,
        writingBookId: bookB.id,
        paused: false,
        seekPlaced: true,
        currentTime: 88.5,
        seekSeconds: 88.5,
        srcReady: true,
      }),
      true
    );
    assert.deepEqual(loadProgress(store)["book-b"], savedB);
  });

  it("wires the shelf open to the paused cue and still calls audio.play() with no await in front of it", () => {
    const openBook = functionBody(APP, "function openBook(");
    assert.match(openBook, /planPausedOpen\(/);
    assert.match(openBook, /pauseOtherBook\(/);
    assert.match(openBook, /autoplay:\s*false/);
    assert.doesNotMatch(openBook, /audio\.play\(/);

    const handler = APP.slice(APP.indexOf("onOpenBook(book)"), APP.indexOf("onNeedLibrary"));
    assert.match(handler, /openBook\(book\.id, \{ pane: "audio" \}\)/);
    assert.doesNotMatch(handler, /playChapter\(/);
    assert.doesNotMatch(handler, /\.play\(/);

    const playChapter = functionBody(APP, "async function playChapter");
    const playAt = playChapter.indexOf("const pending = audio.play()");
    assert.ok(playAt > 0);
    const beforePlay = playChapter.slice(0, playAt);
    assert.match(beforePlay, /if\s*\(\s*!autoplay\s*\)/);
    assert.match(beforePlay, /return;/);
    assert.match(
      playChapter,
      /No await before play\(\): iOS drops the user-gesture if we wait\.\s*const pending = audio\.play\(\)/
    );

    const playButton = APP.slice(
      APP.indexOf('getElementById("btn-play").addEventListener'),
      APP.indexOf('getElementById("btn-prev").addEventListener')
    );
    assert.match(playButton, /if \(audio\.paused\) await audio\.play\(\)\.catch\(\(\) => \{\}\)/);
    const direct = playButton.slice(playButton.indexOf("if (audio.paused)"));
    assert.doesNotMatch(direct, /await(?! audio\.play)/);
  });
});
