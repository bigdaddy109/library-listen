import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { buildLibrary } from "../docs/library.js";
import { jeffDriveLibrarySnapshot } from "../test/acceptance-fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mp3 = readFileSync(join(ROOT, "test/fixtures/acceptance/silent.mp3"));
const epub = readFileSync(join(ROOT, "test/fixtures/acceptance/fixture.epub"));
const snapshot = jeffDriveLibrarySnapshot(buildLibrary);
const ORIGIN = "http://127.0.0.1:8080";
const SERIES_BOOKS = [
  { series: "上學不容易", id: "school/middle-school-02-get-me" },
  { series: "門羅-WhatIf", id: "munroe/what-if-1" },
  { series: "Immune", id: "immune/immune" },
  { series: "Thing Explainer", id: "thing-explainer/thing-explainer" },
];

async function seedOfflineEpubs(page) {
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
          const db = req.result;
          const tx = db.transaction("offline", "readwrite");
          const store = tx.objectStore("offline");
          for (const book of rows) {
            if (!book.ebook) continue;
            const blob = new Blob([bytes], { type: "application/epub+zip" });
            store.put({ bookId: book.id, chapterId: "__ebook__", blob }, [book.id, "__ebook__"]);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { rows: snapshot, epubB64: epub.toString("base64") }
  );
}

test.describe("Jeff Drive fixture plays every series without saved audio Blobs", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/drive-media/**", async (route) => {
      const url = route.request().url();
      const isEpub = /epub/i.test(url);
      await route.fulfill({
        status: 200,
        contentType: isEpub ? "application/epub+zip" : "audio/mpeg",
        body: isEpub ? epub : mp3,
        headers: { "Accept-Ranges": "bytes" },
      });
    });
    await page.addInitScript(
      ({ rows }) => {
        localStorage.setItem("librarylisten.library.v1", JSON.stringify(rows));
        navigator.serviceWorker?.getRegistrations?.().then((regs) => {
          for (const reg of regs) reg.unregister();
        });
      },
      { rows: snapshot }
    );
    await page.goto(`${ORIGIN}/`);
    await seedOfflineEpubs(page);
  });

  test("stale 2-book localStorage still becomes a multi-series Drive shelf", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem(
        "librarylisten.library.v1",
        JSON.stringify([
          { id: "immune/immune", title: "Immune", chapters: [{ id: "Immune-Part01.mp3" }] },
          { id: "school/middle-school-02-get-me", title: "Get Me", chapters: [] },
        ])
      );
    });
    await page.reload();
    await page.evaluate((rows) => {
      localStorage.setItem("librarylisten.library.v1", JSON.stringify(rows));
    }, snapshot);
    await page.reload();
    await expect.poll(async () => page.locator(".spine[data-id], .cover-card[data-id]").count()).toBe(9);
  });

  test("cover wall is the default; a cover zooms in, swings open on its spine, and closes back", async ({ page }) => {
    await page.goto(`${ORIGIN}/`);
    await expect(page.locator('.view-toggle [data-view="covers"]')).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => page.locator(".cover-card[data-id]").count()).toBe(9);
    const id = "munroe/what-if-1";
    const card = page.locator(`.cover-card[data-id="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    const animated = page.evaluate(async () => {
      const props = new Set();
      const t0 = performance.now();
      while (performance.now() - t0 < 1300) {
        for (const a of document.getAnimations()) {
          for (const frame of a.effect?.getKeyframes?.() || []) {
            for (const key of Object.keys(frame)) props.add(key);
          }
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return [...props].filter((k) => !["offset", "computedOffset", "easing", "composite"].includes(k));
    });
    await card.click();
    const props = await animated;
    expect(props).toContain("transform");
    expect(props.every((p) => p === "transform" || p === "opacity")).toBe(true);
    await expect(page.locator("#book-layer .draw-root.is-cover.is-opened .cover-leaf")).toBeAttached();
    await expect(page.locator("#book-layer:not([data-morph])")).toBeAttached();
    const leaf = await page.locator("#book-layer .cover-leaf").evaluate((el) => getComputedStyle(el).transform);
    expect(leaf).toMatch(/^matrix3d\(-1,/);
    await expect(page.locator("#book-layer .page.right [data-open=audio]")).toBeVisible();
    await expect(page.locator("#book-layer .book-3d")).toHaveCount(0);
    await expect(page.locator("#book-layer .page.right h2")).toHaveText("What If?");
    await page.locator("#btn-close-book").click();
    await expect(page.locator("#book-layer")).toBeHidden();
    await expect(page.locator(`.cover-card[data-id="${id}"] .cover-art svg`)).toHaveCSS("opacity", "1");
    await expect.poll(async () => page.evaluate(() => document.documentElement.className)).not.toMatch(/cover-morph/);
  });

  test("reduced motion opens and closes the cover spread instantly", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${ORIGIN}/`);
    await page.locator('.cover-card[data-id="immune/immune"]').click();
    await expect(page.locator("#book-layer .draw-root.is-cover.is-opened")).toBeAttached();
    await expect(page.locator("#book-layer .page.right [data-open=audio]")).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("#book-layer")).toBeHidden();
  });

  for (const book of SERIES_BOOKS) {
    test(`${book.series}: play advances currentTime and Read opens`, async ({ page }) => {
      await page.goto(`${ORIGIN}/?open=${encodeURIComponent(book.id)}&pane=audio`);
      await expect(page.locator("#book:not(.hidden)")).toBeVisible();
      await expect(page.locator("#chapter-list button").first()).toBeVisible();
      page.once("dialog", (dialog) => dialog.dismiss().catch(() => {}));
      await page.locator("#chapter-list button").first().click();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const audio = document.getElementById("audio");
            if (!audio?.src) return 0;
            if (audio.error) return 0;
            return Number(audio.currentTime) || (audio.paused ? 0 : 0.001);
          })
        )
        .toBeGreaterThan(0);
      await page.locator("#tab-read").click();
      await expect(page.locator("#reader:not(.hidden)")).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const frame = document.getElementById("reader-frame");
            try {
              return (frame?.contentDocument?.body?.innerText || "").trim();
            } catch {
              return "";
            }
          })
        )
        .toMatch(/Opening|Fixture|spine/i);
    });
  }
});
