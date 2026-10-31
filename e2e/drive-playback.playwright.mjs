/**
 * Drive listen audio, not a special case for Immune or How To.
 *
 * Upstream mimics Drive: octet-stream / video/mp4, no Content-Range, and an
 * open Range that returns only a prefix (moov of the m4b/mp4 is past that
 * prefix; the mp3 has no Xing header). The player must still start and show
 * a real duration on desktop Chromium, iPhone WebKit, and iPad WebKit.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { devices } from "@playwright/test";
import { LIBRARY_SHELL_KEY, LIBRARY_SNAPSHOT_KEY } from "../docs/library.js";
import { ORIGIN, SHELL_VERSION, audioAdvances, expect, test } from "./fixtures.mjs";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/playback");
const OUT = "/cursor/stores/bc-a9df44a7-f3a8-570d-9864-cb63e4f9af5d/media/drive-playback";
const OPEN_CAP = 16 * 1024;

const FILES = {
  "fx-what-if": {
    body: readFileSync(join(FIXTURE_DIR, "noxing.mp3")),
    driveType: "application/octet-stream",
  },
  "fx-what-if-2": {
    body: readFileSync(join(FIXTURE_DIR, "moov-end.m4a")),
    driveType: "video/mp4",
  },
  "fx-school": {
    body: readFileSync(join(FIXTURE_DIR, "moov-end.mp4")),
    driveType: "video/mp4",
  },
};

const BOOKS = [
  {
    id: "munroe/what-if-1",
    title: "What If?",
    collectionTitle: "Munroe",
    chapterId: "01.mp3",
    driveId: "fx-what-if",
    slug: "what-if",
  },
  {
    id: "munroe/what-if-2",
    title: "What If? 2",
    collectionTitle: "Munroe",
    chapterId: "What If 2.m4b",
    driveId: "fx-what-if-2",
    slug: "what-if-2",
  },
  {
    id: "school/middle-school-01",
    title: "Middle School 01",
    collectionTitle: "School Isn't Easy",
    chapterId: "Book.mp4",
    driveId: "fx-school",
    slug: "middle-school-01",
  },
].map((book) => ({
  ...book,
  size: FILES[book.driveId].body.length,
}));

function snapshot() {
  return BOOKS.map((book) => ({
    id: book.id,
    collectionId: book.id.split("/")[0],
    collectionTitle: book.collectionTitle,
    collectionFolder: book.collectionTitle,
    folder: book.id.split("/")[1],
    title: book.title,
    author: "Fixture",
    source: "drive",
    chapters: [
      {
        id: book.chapterId,
        title: "Chapter 1",
        driveId: book.driveId,
        size: book.size,
        type: FILES[book.driveId].driveType,
      },
    ],
  }));
}

function sliceUpstream(body, range) {
  const total = body.length;
  if (!range) return { status: 200, slice: body };
  const suffix = /^bytes=-(\d+)$/i.exec(range);
  let start = 0;
  let end = total - 1;
  if (suffix) {
    const count = Math.min(total, Number(suffix[1]) || 0);
    start = total - count;
  } else {
    const match = /^bytes=(\d+)-(\d*)$/i.exec(range);
    if (!match) return { status: 200, slice: body };
    start = Number(match[1]);
    end = match[2] === "" ? total - 1 : Number(match[2]);
    if (match[2] === "" && start === 0) end = Math.min(end, OPEN_CAP - 1);
  }
  end = Math.min(total - 1, Math.max(start, end));
  return { status: 206, slice: body.subarray(start, end + 1) };
}

async function openShelf(page) {
  await page.addInitScript(
    ({ rows, shell, snapshotKey, shellKey }) => {
      localStorage.setItem(snapshotKey, JSON.stringify(rows));
      localStorage.setItem(shellKey, String(shell));
    },
    {
      rows: snapshot(),
      shell: String(SHELL_VERSION),
      snapshotKey: LIBRARY_SNAPSHOT_KEY,
      shellKey: LIBRARY_SHELL_KEY,
    }
  );
  await page.goto(`${ORIGIN}/`);
  await expect.poll(() => page.locator(".cover-card[data-id]").count()).toBe(BOOKS.length);
}

async function playBook(page, book, label) {
  const seen = [];
  const onResponse = (response) => {
    if (!response.url().includes("/drive-media/")) return;
    const headers = response.headers();
    seen.push({
      status: response.status(),
      type: headers["content-type"] || "",
      range: headers["content-range"] || "",
    });
  };
  page.on("response", onResponse);
  const card = page.locator(`.cover-card[data-id="${book.id}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.locator("#book:not(.hidden)")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#player-bar:not(.hidden)")).toBeVisible();
  await audioAdvances(page);
  await expect
    .poll(() => page.evaluate(() => document.getElementById("audio").currentTime), { timeout: 15_000 })
    .toBeGreaterThan(1);
  const sample = await page.evaluate(() => {
    const audio = document.getElementById("audio");
    const seek = document.getElementById("player-seek");
    return {
      title: document.getElementById("player-title")?.textContent || "",
      t: audio.currentTime,
      d: audio.duration,
      err: audio.error ? audio.error.code : 0,
      pos: document.getElementById("player-pos")?.textContent || "",
      dur: document.getElementById("player-dur")?.textContent || "",
      seek: Number(seek?.value || 0),
      seekMax: Number(seek?.max || 0),
      src: audio.currentSrc || audio.src || "",
    };
  });
  page.off("response", onResponse);
  expect(sample.err, book.title).toBe(0);
  expect(sample.t, book.title).toBeGreaterThan(1);
  expect(Number.isFinite(sample.d) && sample.d > 1, `${book.title} duration ${sample.d}`).toBe(true);
  expect(sample.dur, book.title).not.toBe("0:00");
  expect(sample.pos, book.title).not.toBe("0:00");
  expect(sample.seek, book.title).toBeGreaterThan(0);
  expect(sample.seekMax, book.title).toBeGreaterThan(sample.seek);
  expect(sample.src).toContain("/drive-media/");
  expect(sample.src).toContain("size=");
  const typed = seen.filter((hit) => hit.type);
  for (const hit of typed) {
    expect(hit.type.split(";")[0].startsWith("audio/"), `${book.title} ${hit.type}`).toBe(true);
  }
  if (label.startsWith("chromium")) {
    expect(typed.some((hit) => hit.type.startsWith("audio/")), book.title).toBe(true);
    for (const hit of seen.filter((entry) => entry.status === 206 && entry.range)) {
      expect(hit.range, book.title).toMatch(/\/\d+$/);
    }
  }
  mkdirSync(OUT, { recursive: true });
  const shot = join(OUT, `${label}-${book.slug}.png`);
  await page.screenshot({ path: shot });
  appendFileSync(
    join(OUT, "runs.jsonl"),
    `${JSON.stringify({
      at: new Date().toISOString(),
      label,
      book: book.title,
      id: book.id,
      currentTime: sample.t,
      duration: sample.d,
      pos: sample.pos,
      dur: sample.dur,
      seek: sample.seek,
      advanced: sample.t > 1 && sample.dur !== "0:00",
      shot,
    })}\n`
  );
  await page.evaluate(() => document.getElementById("audio").pause());
  await page.locator("#btn-back").click();
  await expect.poll(() => page.locator(".cover-card[data-id]").count()).toBe(BOOKS.length);
}

test.describe("Drive playback for every listen container", () => {
  test("What If, What If 2, and Middle School 01 play with a moving slider", async ({ page }, testInfo) => {
    await openShelf(page);
    for (const book of BOOKS) {
      await playBook(page, book, testInfo.project.name);
    }
  });
});

test.describe("iPad Safari", () => {
  const ipad = devices["iPad Pro 11"];
  test.use({
    viewport: ipad.viewport,
    userAgent: ipad.userAgent,
    isMobile: ipad.isMobile,
    hasTouch: ipad.hasTouch,
    deviceScaleFactor: ipad.deviceScaleFactor,
  });
  test.skip(({ browserName }) => browserName !== "webkit", "iPad WebKit only");

  test("the same three books play on iPad", async ({ page }) => {
    await openShelf(page);
    for (const book of BOOKS) {
      await playBook(page, book, "webkit-ipad");
    }
  });
});

test.describe("real service worker", () => {
  test.use({ serviceWorkers: "allow" });

  test("the shell proxy repairs a partial Drive response", async ({ page, context, browserName }, testInfo) => {
    test.skip(browserName !== "chromium" || testInfo.project.name !== "chromium-desktop");
    await context.route("https://www.googleapis.com/drive/v3/files/**", async (route) => {
      const request = route.request();
      if (!request.url().includes("alt=media")) {
        await route.fallback();
        return;
      }
      const id = decodeURIComponent(new URL(request.url()).pathname.split("/").pop());
      const fixture = FILES[id];
      if (!fixture) {
        await route.fulfill({ status: 404, body: "missing" });
        return;
      }
      const range = request.headers().range || "";
      const part = sliceUpstream(fixture.body, range);
      await route.fulfill({
        status: part.status,
        body: part.slice,
        headers: {
          "content-type": fixture.driveType,
          "content-length": String(part.slice.length),
          "accept-ranges": "bytes",
        },
      });
    });
    await openShelf(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.locator(".cover-card[data-id]").count()).toBe(BOOKS.length);
    await page.evaluate(() =>
      navigator.serviceWorker.controller.postMessage({ type: "librarylisten.drive-token", token: "fixture-token" })
    );
    for (const book of BOOKS) {
      await playBook(page, book, "chromium-service-worker");
    }
  });
});
