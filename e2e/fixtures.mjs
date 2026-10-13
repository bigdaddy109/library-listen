import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { buildLibrary } from "../docs/library.js";
import { jeffDriveLibrarySnapshot } from "../test/acceptance-fixture.mjs";

export { expect };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ORIGIN = "http://127.0.0.1:8080";
export const MP3 = readFileSync(join(ROOT, "test/fixtures/acceptance/silent.mp3"));
export const EPUB = readFileSync(join(ROOT, "test/fixtures/acceptance/fixture.epub"));
export const SNAPSHOT = jeffDriveLibrarySnapshot(buildLibrary);
export const SHELL_VERSION = Number(
  readFileSync(join(ROOT, "docs/sw.js"), "utf8").match(/library-listen-shell-v(\d+)/)[1]
);

/** One book per series of Jeff's Drive Library (each has listen/ + ebooks/). */
export const SERIES_BOOKS = [
  { series: "上學不容易", id: "school/middle-school-02-get-me" },
  { series: "門羅-WhatIf", id: "munroe/what-if-1" },
  { series: "Immune", id: "immune/immune" },
  { series: "Thing Explainer", id: "thing-explainer/thing-explainer" },
];

export const STALE_SNAPSHOT = [
  { id: "immune/immune", title: "Immune", chapters: [{ id: "Immune-Part01.mp3" }] },
  { id: "school/middle-school-02-get-me", title: "Get Me", chapters: [] },
];

/**
 * Every test runs in a persistent profile: WebKit's ephemeral contexts refuse
 * Blobs in IndexedDB, and the saved-EPUB path is part of what we accept.
 */
export const test = base.extend({
  context: async (
    { playwright, browserName, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, serviceWorkers },
    use
  ) => {
    const dir = mkdtempSync(join(tmpdir(), "ll-e2e-"));
    const context = await playwright[browserName].launchPersistentContext(dir, {
      viewport,
      userAgent,
      isMobile: browserName === "firefox" ? undefined : isMobile,
      hasTouch,
      deviceScaleFactor,
      serviceWorkers,
    });
    await use(context);
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] || (await context.newPage());
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
    await use(page);
  },
});

export async function routeDriveMedia(page) {
  await page.route("**/drive-media/**", async (route) => {
    const isEpub = /epub/i.test(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: isEpub ? "application/epub+zip" : "audio/mpeg",
      body: isEpub ? EPUB : MP3,
      headers: { "Accept-Ranges": "bytes" },
    });
  });
}

/** Saved EPUB blobs, as after "Save to this device"; audio stays Drive-stream only. */
export async function seedOfflineEpubs(page) {
  await page.evaluate(
    async ({ rows, epubB64 }) => {
      const bytes = Uint8Array.from(atob(epubB64), (c) => c.charCodeAt(0));
      await new Promise((resolve, reject) => {
        const req = indexedDB.open("library-listen", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("offline")) db.createObjectStore("offline");
          if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles");
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction("offline", "readwrite");
          for (const book of rows) {
            if (!book.ebook) continue;
            const blob = new Blob([bytes], { type: "application/epub+zip" });
            tx.objectStore("offline").put({ bookId: book.id, chapterId: "__ebook__", blob }, [book.id, "__ebook__"]);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { rows: SNAPSHOT, epubB64: EPUB.toString("base64") }
  );
}

/** Jeff's multi-series Drive shelf with saved EPUBs, served without a service worker. */
export async function openFixtureShelf(page) {
  await routeDriveMedia(page);
  await page.addInitScript((rows) => {
    localStorage.setItem("librarylisten.library.v1", JSON.stringify(rows));
  }, SNAPSHOT);
  await page.goto(`${ORIGIN}/`);
  await seedOfflineEpubs(page);
  await page.reload();
  await expect.poll(() => page.locator(".cover-card[data-id]").count()).toBe(SNAPSHOT.length);
}

export async function waitBookSettled(page) {
  await expect(page.locator("#book-layer:not([data-morph])")).toBeAttached();
}

/** Real taps: cover → zoom + swing → 聽. */
export async function openFromCoverAndListen(page, bookId) {
  const card = page.locator(`.cover-card[data-id="${bookId}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.locator("#book-layer .draw-root.is-cover.is-opened")).toBeAttached();
  await waitBookSettled(page);
  await page.locator('#book-layer [data-open="audio"]').click();
  await expect(page.locator("#book:not(.hidden)")).toBeVisible();
}

export async function audioAdvances(page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const audio = document.getElementById("audio");
          if (!audio?.src || audio.error) return 0;
          return Number(audio.currentTime) || 0;
        }),
      { timeout: 20_000 }
    )
    .toBeGreaterThan(0);
}

export async function epubRenders(page) {
  await page.locator("#tab-read").click();
  await expect(page.locator("#reader:not(.hidden)")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        try {
          return (document.getElementById("reader-frame")?.contentDocument?.body?.innerText || "").trim();
        } catch {
          return "";
        }
      })
    )
    .toMatch(/Opening|Fixture|spine/i);
}

export async function shellState(page) {
  return page.evaluate(async () => ({
    caches: await caches.keys(),
    controller: navigator.serviceWorker?.controller?.scriptURL || null,
    appScript: document.querySelector('script[type="module"]')?.getAttribute("src") || "",
    view: document.querySelector(".view-toggle [aria-pressed=true]")?.dataset.view || "",
    covers: document.querySelectorAll(".cover-card[data-id]").length,
  }));
}

/** shellState that tolerates the app's own controllerchange reload. */
export async function settledShellState(page) {
  for (let i = 0; i < 8; i++) {
    try {
      await page.waitForLoadState("load");
      return await shellState(page);
    } catch {
      await page.waitForTimeout(500);
    }
  }
  return shellState(page);
}
