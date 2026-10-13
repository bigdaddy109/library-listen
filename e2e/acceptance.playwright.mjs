import {
  ORIGIN,
  SERIES_BOOKS,
  SNAPSHOT,
  STALE_SNAPSHOT,
  audioAdvances,
  epubRenders,
  expect,
  openFixtureShelf,
  openFromCoverAndListen,
  test,
  waitBookSettled,
} from "./fixtures.mjs";

test.describe("Jeff Drive fixture: every series plays and reads", () => {
  test.beforeEach(async ({ page }) => {
    await openFixtureShelf(page);
  });

  test("every series is on the shelf and no listen/ book is Read-only", async ({ page }) => {
    const chips = await page.locator("#series-chips .chip").allTextContents();
    for (const label of ["上學不容易", "門羅", "Immune"]) {
      expect(chips.some((c) => c.includes(label)), label).toBe(true);
    }
    const ids = await page.locator(".cover-card[data-id]").evaluateAll((els) => els.map((e) => e.dataset.id));
    for (const { id } of SERIES_BOOKS) expect(ids).toContain(id);
    const badges = await page.locator(".cover-card p").allTextContents();
    expect(badges).toHaveLength(SNAPSHOT.length);
    for (const badge of badges) expect(badge).toMatch(/· (Both|Audio)$/);
  });

  test("stale 2-book localStorage still becomes a multi-series Drive shelf", async ({ page }) => {
    await page.evaluate((rows) => localStorage.setItem("librarylisten.library.v1", JSON.stringify(rows)), STALE_SNAPSHOT);
    await page.reload();
    await page.evaluate((rows) => localStorage.setItem("librarylisten.library.v1", JSON.stringify(rows)), SNAPSHOT);
    await page.reload();
    await expect.poll(() => page.locator(".cover-card[data-id]").count()).toBe(SNAPSHOT.length);
  });

  for (const book of SERIES_BOOKS) {
    test(`${book.series}: tap cover → 聽 plays, 讀 opens the EPUB`, async ({ page }) => {
      await openFromCoverAndListen(page, book.id);
      await audioAdvances(page);
      await expect(page.locator("#player-bar:not(.hidden)")).toBeVisible();
      await epubRenders(page);
      await page.evaluate(() => document.getElementById("audio").pause());
      await page.locator("#btn-back").click();
      await expect.poll(() => page.locator(".cover-card[data-id]").count()).toBe(SNAPSHOT.length);
    });
  }

  test("?open= deep link still lands on the book screen and plays", async ({ page }) => {
    await page.goto(`${ORIGIN}/?open=${encodeURIComponent("munroe/what-if-1")}&pane=audio`);
    await expect(page.locator("#book:not(.hidden)")).toBeVisible();
    await page.locator("#chapter-list button").first().click();
    await audioAdvances(page);
  });

  test("cover wall is the default; a cover zooms in, swings open on its spine, and closes back", async ({ page }) => {
    await expect(page.locator('.view-toggle [data-view="covers"]')).toHaveAttribute("aria-pressed", "true");
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
        await new Promise((r) => setTimeout(r, 16));
      }
      return [...props].filter((k) => !["offset", "computedOffset", "easing", "composite"].includes(k));
    });
    await card.click();
    await expect(page.locator("#book-layer[data-morph] .page.right [data-open=audio]")).toBeAttached();
    const hit = await page.evaluate(() => {
      const r = document.querySelector("#book-layer .page.right [data-open=audio]").getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("[data-open]") !== null;
    });
    expect(hit).toBe(false);
    const props = await animated;
    expect(props).toContain("transform");
    expect(props.every((p) => p === "transform" || p === "opacity")).toBe(true);
    await expect(page.locator("#book-layer .draw-root.is-cover.is-opened .cover-leaf")).toBeAttached();
    await waitBookSettled(page);
    const leaf = await page.locator("#book-layer .cover-leaf").evaluate((el) => getComputedStyle(el).transform);
    expect(leaf).toMatch(/^matrix3d\(-1,|^matrix\(-1,/);
    await expect(page.locator("#book-layer .page.right [data-open=audio]")).toBeVisible();
    await expect(page.locator("#book-layer .book-3d")).toHaveCount(0);
    await expect(page.locator("#book-layer .page.right h2")).toHaveText("What If?");
    await page.locator("#btn-close-book").click();
    await expect(page.locator("#book-layer")).toBeHidden();
    await expect(page.locator(`.cover-card[data-id="${id}"] .cover-art svg`)).toHaveCSS("opacity", "1");
    await expect.poll(() => page.evaluate(() => document.documentElement.className)).not.toMatch(/cover-morph|book-open/);
  });

  test("reduced motion opens and closes the book instantly", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.locator('.cover-card[data-id="immune/immune"]').click();
    await expect(page.locator("#book-layer .draw-root.is-cover.is-opened")).toBeAttached();
    await expect(page.locator("#book-layer .page.right [data-open=audio]")).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("#book-layer")).toBeHidden();
  });

  test("/classic/ is still the dark player", async ({ page }) => {
    await page.goto(`${ORIGIN}/classic/`);
    await expect(page.locator('body[data-shell="classic"]')).toBeAttached();
  });
});

test.describe("lock screen (Media Session)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__actions = {};
      const ms = navigator.mediaSession;
      if (!ms) return;
      const original = ms.setActionHandler.bind(ms);
      ms.setActionHandler = (name, fn) => {
        window.__actions[name] = typeof fn === "function" ? "set" : "cleared";
        try {
          original(name, fn);
        } catch {
          /* unsupported action */
        }
      };
    });
    await openFixtureShelf(page);
  });

  test("playing a book without a cover file puts a PNG of its cover on the lock screen", async ({ page }) => {
    test.skip(!(await page.evaluate(() => "mediaSession" in navigator)), "no Media Session in this engine");
    await openFromCoverAndListen(page, "munroe/what-if-1");
    await audioAdvances(page);
    await expect
      .poll(() => page.evaluate(() => navigator.mediaSession.metadata?.artwork?.[0]?.type || ""))
      .toBe("image/png");
    const art = await page.evaluate(async () => {
      const meta = navigator.mediaSession.metadata;
      const a = meta.artwork[0];
      const img = new Image();
      img.src = a.src;
      await img.decode();
      return { title: meta.title, album: meta.album, sizes: a.sizes, src: a.src.slice(0, 5), w: img.naturalWidth, h: img.naturalHeight };
    });
    expect(art.album).toBe("What If?");
    expect(art.sizes).toBe("512x512");
    expect(art.src).toBe("blob:");
    expect([art.w, art.h]).toEqual([512, 512]);
  });

  test("iPhone gets ±30 s skip buttons, desktop keeps chapter arrows", async ({ page, isMobile }) => {
    test.skip(!(await page.evaluate(() => "mediaSession" in navigator)), "no Media Session in this engine");
    const actions = await page.evaluate(() => window.__actions);
    expect(actions.seekbackward).toBe("set");
    expect(actions.seekforward).toBe("set");
    expect(actions.play).toBe("set");
    if (isMobile) {
      expect(actions.nexttrack).toBe("cleared");
      expect(actions.previoustrack).toBe("cleared");
    } else {
      expect(actions.nexttrack).toBe("set");
      expect(actions.previoustrack).toBe("set");
    }
  });
});
