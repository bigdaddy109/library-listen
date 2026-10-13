import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyAudiobookMarkers,
  chapterIndexAtTime,
  chapterRelativePosition,
  chaptersFromMarkers,
  chapterStart,
  filePositionFromDisplay,
  isSingleAudioFileBook,
  liveChapterDuration,
  offlineChapterBlob,
  readMp4Chapters,
  resolvedChapterDuration,
  resumeFileSeconds,
  uniqueChapterFiles,
} from "../docs/markers.js";

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

function box(type, payload) {
  const body = Buffer.concat([Buffer.from(type), payload]);
  return Buffer.concat([u32(body.length + 4), body]);
}

function fullBox(type, payload, version = 0) {
  return box(type, Buffer.concat([Buffer.from([version, 0, 0, 0]), payload]));
}

function chplBox(chapters) {
  const parts = [Buffer.from([1, 0, 0, 0, 0]), u32(chapters.length)];
  for (const ch of chapters) {
    const start = Buffer.alloc(8);
    start.writeBigUInt64BE(BigInt(Math.round(ch.start * 10_000_000)));
    const title = Buffer.from(ch.title, "utf8");
    parts.push(start, Buffer.from([title.length]), title);
  }
  return box("chpl", Buffer.concat(parts));
}

function neroOnlyM4b(chapters) {
  const moov = box("moov", box("udta", chplBox(chapters)));
  return new Uint8Array(Buffer.concat([box("ftyp", Buffer.from("M4A isom")), moov]));
}

function makeFile(bytes, name) {
  return new File([bytes], name, { type: "audio/mp4" });
}

function ffmpegAvailable() {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return probe.status === 0;
}

function ffmpegChapteredM4b() {
  const dir = mkdtempSync(join(tmpdir(), "ll-markers-"));
  const audio = join(dir, "silent.m4a");
  const meta = join(dir, "chapters.txt");
  const out = join(dir, "What If 2 - Randall Munroe.m4b");
  writeFileSync(
    meta,
    [
      ";FFMETADATA1",
      "title=What If 2 (fixture)",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      "START=0",
      "END=2000",
      "title=01 - The Sun",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      "START=2000",
      "END=4000",
      "title=02 - A Mole of Moles",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      "START=4000",
      "END=6000",
      "title=03 - Hair Dryer",
      "",
    ].join("\n")
  );
  const silent = spawnSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "6", "-c:a", "aac", "-b:a", "24k", audio],
    { encoding: "utf8" }
  );
  if (silent.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(silent.stderr || "ffmpeg silent failed");
  }
  const mux = spawnSync(
    "ffmpeg",
    ["-y", "-i", audio, "-i", meta, "-map_metadata", "1", "-codec", "copy", out],
    { encoding: "utf8" }
  );
  if (mux.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(mux.stderr || "ffmpeg mux failed");
  }
  const bytes = new Uint8Array(readFileSync(out));
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

test("Nero chpl markers are read from an in-memory m4b", async () => {
  const bytes = neroOnlyM4b([
    { start: 0, title: "01 - The Sun" },
    { start: 2, title: "02 - A Mole of Moles" },
    { start: 4, title: "03 - Hair Dryer" },
  ]);
  const markers = await readMp4Chapters(bytes);
  assert.equal(markers.length, 3);
  assert.equal(markers[0].title, "01 - The Sun");
  assert.equal(markers[1].title, "02 - A Mole of Moles");
  assert.equal(markers[2].title, "03 - Hair Dryer");
  assert.equal(markers[0].start, 0);
  assert.ok(Math.abs(markers[1].start - 2) < 0.001);
  assert.ok(Math.abs(markers[2].start - 4) < 0.001);
});

test("ffmpeg QuickTime + Nero fixture (What If 2 shape) is three chapters", async (t) => {
  if (!ffmpegAvailable()) {
    t.skip("ffmpeg is not installed");
    return;
  }
  const bytes = ffmpegChapteredM4b();
  const markers = await readMp4Chapters(bytes);
  assert.equal(markers.length, 3);
  assert.deepEqual(
    markers.map((m) => m.title),
    ["01 - The Sun", "02 - A Mole of Moles", "03 - Hair Dryer"]
  );
  assert.equal(markers[0].start, 0);
  assert.ok(Math.abs(markers[1].start - 2) < 0.05);
  assert.ok(Math.abs(markers[2].start - 4) < 0.05);
  assert.ok(Math.abs((markers[0].end ?? markers[1].start) - 2) < 0.05);
});

test("chaptersFromMarkers uses filename#index and chapter spans", () => {
  const file = makeFile(new Uint8Array([0]), "book.m4b");
  const chapters = chaptersFromMarkers(
    file.name,
    [
      { start: 0, end: 120, title: "Intro" },
      { start: 120, title: "The Sun" },
    ],
    file
  );
  assert.equal(chapters[0].id, "book.m4b#0");
  assert.equal(chapters[1].id, "book.m4b#1");
  assert.equal(chapters[0].start, 0);
  assert.equal(chapters[0].end, 120);
  assert.equal(chapters[0].duration, 120);
  assert.equal(chapters[1].start, 120);
  assert.equal(chapters[1].end, null);
  assert.equal(chapters[1].file, file);
});

test("applyAudiobookMarkers splits a single m4b and leaves Immune-style files alone", async () => {
  const bytes = neroOnlyM4b([
    { start: 0, title: "01 - The Sun" },
    { start: 90, title: "02 - A Mole of Moles" },
  ]);
  const m4b = makeFile(bytes, "What If 2 - Randall Munroe.m4b");
  const part1 = makeFile(new Uint8Array([1]), "Immune-Part01.mp3");
  const part2 = makeFile(new Uint8Array([2]), "Immune-Part02.mp3");
  const books = [
    {
      id: "munroe/what-if-2",
      title: "What If? 2",
      chapters: [{ id: m4b.name, index: 0, title: "What If 2 - Randall Munroe", file: m4b, url: null }],
    },
    {
      id: "immune/immune",
      title: "Immune",
      chapters: [
        { id: part1.name, index: 0, title: "Part 01", file: part1, url: null },
        { id: part2.name, index: 1, title: "Part 02", file: part2, url: null },
      ],
    },
  ];
  await applyAudiobookMarkers(books);
  assert.equal(books[0].kind, "audiobook");
  assert.equal(books[0].chapters.length, 2);
  assert.equal(books[0].chapters[0].title, "01 - The Sun");
  assert.equal(books[0].chapters[1].title, "02 - A Mole of Moles");
  assert.equal(books[1].kind, undefined);
  assert.equal(books[1].chapters.length, 2);
  assert.equal(books[1].chapters[0].title, "Part 01");
});

test("a chapterless m4b stays one file-named chapter", async () => {
  const empty = new Uint8Array(box("ftyp", Buffer.from("M4A isom")));
  const file = makeFile(empty, "notes.m4b");
  const books = [
    {
      chapters: [{ id: file.name, index: 0, title: "Notes", file, url: null }],
    },
  ];
  await applyAudiobookMarkers(books);
  assert.equal(books[0].kind, undefined);
  assert.equal(books[0].chapters.length, 1);
  assert.equal(books[0].chapters[0].id, "notes.m4b");
});

test("only a lone m4b/m4a is a marker candidate", () => {
  assert.equal(
    isSingleAudioFileBook({
      chapters: [{ id: "book.m4b", file: { name: "book.m4b" } }],
    }),
    true
  );
  assert.equal(
    isSingleAudioFileBook({
      chapters: [{ id: "book.m4a", file: { name: "book.m4a" } }],
    }),
    true
  );
  assert.equal(
    isSingleAudioFileBook({
      chapters: [{ id: "a.mp3", file: { name: "a.mp3" } }],
    }),
    false
  );
  assert.equal(
    isSingleAudioFileBook({
      chapters: [
        { id: "a.m4b", file: { name: "a.m4b" } },
        { id: "b.m4b", file: { name: "b.m4b" } },
      ],
    }),
    false
  );
});

test("display time is file position minus chapter start", () => {
  const chapter = { start: 120, end: 180, duration: 60 };
  assert.equal(chapterStart(chapter), 120);
  assert.equal(chapterRelativePosition(chapter, 150), 30);
  assert.equal(filePositionFromDisplay(chapter, 30), 150);
  assert.equal(resolvedChapterDuration(chapter, null), 60);
  assert.equal(resolvedChapterDuration(chapter, 59), 59);
  assert.equal(liveChapterDuration({ start: 120 }, 200), 80);
});

test("resumeFileSeconds uses file-absolute position and chapter-relative duration", () => {
  const chapter = { start: 120, end: 180, duration: 60 };
  assert.equal(resumeFileSeconds(null, chapter), 120);
  assert.equal(resumeFileSeconds({ positionSeconds: 150, chapterDurationSeconds: 60 }, chapter), 150);
  assert.equal(resumeFileSeconds({ positionSeconds: 179, chapterDurationSeconds: 60 }, chapter), 120);
  assert.equal(resumeFileSeconds({ positionSeconds: 12 }, { start: 0 }), 12);
});

test("chapterIndexAtTime follows native start/end windows", () => {
  const chapters = [
    { start: 0, end: 2, title: "A" },
    { start: 2, end: 4, title: "B" },
    { start: 4, title: "C" },
  ];
  assert.equal(chapterIndexAtTime(chapters, 0), 0);
  assert.equal(chapterIndexAtTime(chapters, 1.9), 0);
  assert.equal(chapterIndexAtTime(chapters, 2), 1);
  assert.equal(chapterIndexAtTime(chapters, 5), 2);
});

test("offline lookup and unique files share one m4b blob", () => {
  const file = makeFile(new Uint8Array([9]), "book.m4b");
  const chapters = chaptersFromMarkers(
    file.name,
    [
      { start: 0, title: "A" },
      { start: 10, title: "B" },
    ],
    file
  );
  const saved = new Map([["book.m4b", file]]);
  assert.equal(offlineChapterBlob(saved, chapters[0]), file);
  assert.equal(offlineChapterBlob(saved, chapters[1]), file);
  assert.equal(uniqueChapterFiles(chapters).length, 1);
});
