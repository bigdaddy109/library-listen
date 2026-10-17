import {
  ORIGIN,
  SERIES_BOOKS,
  SNAPSHOT,
  STALE_SNAPSHOT,
  audioAdvances,
  expect,
  openFixtureShelf,
  openFromCoverAndListen,
  test,
} from "./fixtures.mjs";

test.describe("Jeff Drive fixture: every series listens (listen-only)", () => {
  test.beforeEach(async ({ page }) => {
    await openFixtureShelf(page);
  });

  test("every series is on the shelf; listen books are Audio; no Read UI", async ({ page }) => {
    const chips = await page.locator("#series-chips .chip").allTextContents();
    for (const label of ["上學不容易", "門羅", "Immune"]) {
      expect(chips.some((c) => c.includes(label)), label).toBe(true);
    }
    const ids = await page.locator(".cover-card[data-id]").evaluateAll((els) => els.map((e) => e.dataset.id));
    for (const { id } of SERIES_BOOKS) expect(ids).toContain(id);
    const badges = await page.locator(".cover-card p").allTextContents();
    expect(badges).toHaveLength(SNAPSHOT.length);
    for (const badge of badges) expect(badge).toMatch(/· 音檔$/);
    await expect(page.locator('[data-view="topics"]')).toHaveCount(0);
    await expect(page.locator("#tab-read")).toHaveCount(0);
    await expect(page.locator("#reader")).toHaveCount(0);
    const toggle = await page.locator(".view-toggle button").allTextContents();
    expect(toggle).toEqual(["封面牆", "書架"]);
  });

  test("stale 2-book localStorage still becomes a multi-series Drive shelf", async ({ page }) => {
    await page.evaluate((rows) => localStorage.setItem("librarylisten.library.v1", JSON.stringify(rows)), STALE_SNAPSHOT);
    await page.reload();
    await page.evaluate((rows) => localStorage.setItem("librarylisten.library.v1", JSON.stringify(rows)), SNAPSHOT);
    await page.reload();
    await expect.poll(() => page.locator(".cover-card[data-id]").count()).toBe(SNAPSHOT.length);
  });

  test("stale topics shelfView falls back to covers", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("librarylisten.shelfView.v2", "topics"));
    await page.reload();
    await expect(page.locator('.view-toggle [data-view="covers"]')).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.locator(".cover-card[data-id]").count()).toBeGreaterThan(0);
    await expect(page.locator(".topic-card")).toHaveCount(0);
  });

  for (const book of SERIES_BOOKS) {
    test(`${book.series}: tap cover → auto-listens (no Read chooser)`, async ({ page }) => {
      await openFromCoverAndListen(page, book.id);
      await audioAdvances(page);
      await expect(page.locator("#player-bar:not(.hidden)")).toBeVisible();
      await expect(page.locator("#tab-read")).toHaveCount(0);
      await expect(page.locator("#reader")).toHaveCount(0);
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

  test("cover wall zooms then hinges, then auto-listens", async ({ page }) => {
    await expect(page.locator('.view-toggle [data-view="covers"]')).toHaveAttribute("aria-pressed", "true");
    const id = "munroe/what-if-1";
    const card = page.locator(`.cover-card[data-id="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    const animated = page.evaluate(async () => {
      const props = new Set();
      const sawClosed = { v: false };
      const sawHinge = { v: false };
      const t0 = performance.now();
      while (performance.now() - t0 < 1600) {
        const root = document.querySelector("#book-layer .draw-root.is-cover");
        if (root?.classList.contains("is-closed")) sawClosed.v = true;
        if (root?.classList.contains("is-flipping") || root?.classList.contains("is-opened")) sawHinge.v = true;
        for (const a of document.getAnimations()) {
          for (const frame of a.effect?.getKeyframes?.() || []) {
            for (const key of Object.keys(frame)) props.add(key);
            if (typeof frame.transform === "string" && /rotateY\(-90deg\)/.test(frame.transform)) {
              sawHinge.v = true;
            }
          }
        }
        await new Promise((r) => setTimeout(r, 16));
      }
      return {
        props: [...props].filter((k) => !["offset", "computedOffset", "easing", "composite"].includes(k)),
        sawClosed: sawClosed.v,
        sawHinge: sawHinge.v,
      };
    });
    await card.click();
    await expect(page.locator("#book:not(.hidden)")).toBeVisible({ timeout: 20_000 });
    const observed = await animated;
    expect(observed.props.every((p) => p === "transform" || p === "opacity")).toBe(true);
    expect(observed.sawClosed).toBe(true);
    expect(observed.sawHinge).toBe(true);
    await audioAdvances(page);
    await expect(page.locator("#book-layer")).toBeHidden();
    await expect(page.locator('[data-open="audio"], [data-open="read"]')).toHaveCount(0);
  });

  test("reduced motion still auto-listens", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.locator('.cover-card[data-id="immune/immune"]').click();
    await expect(page.locator("#book:not(.hidden)")).toBeVisible({ timeout: 15_000 });
    await audioAdvances(page);
  });

  test("書架 spine tap uses cover zoom → hinge then auto-listens (no 3D pull-out)", async ({ page }) => {
    await page.locator('.view-toggle [data-view="spines"]').click();
    await expect(page.locator('.view-toggle [data-view="spines"]')).toHaveAttribute("aria-pressed", "true");
    const id = "school/middle-school-02-get-me";
    const spine = page.locator(`.spine[data-id="${id}"]`);
    await expect(spine.locator(".cover-art svg")).toBeAttached();
    await spine.scrollIntoViewIfNeeded();
    const animated = page.evaluate(async () => {
      const props = new Set();
      const sawClosed = { v: false };
      const sawHinge = { v: false };
      const sawPull3d = { v: false };
      const t0 = performance.now();
      while (performance.now() - t0 < 1600) {
        const root = document.querySelector("#book-layer .draw-root");
        if (root?.classList.contains("is-cover") && root.classList.contains("is-closed")) sawClosed.v = true;
        if (root?.classList.contains("is-flipping") || root?.classList.contains("is-opened")) sawHinge.v = true;
        if (root && !root.classList.contains("is-cover") && root.querySelector(".book-3d")) sawPull3d.v = true;
        for (const a of document.getAnimations()) {
          for (const frame of a.effect?.getKeyframes?.() || []) {
            for (const key of Object.keys(frame)) props.add(key);
            if (typeof frame.transform === "string" && /rotateY\(-90deg\)/.test(frame.transform)) {
              sawHinge.v = true;
            }
          }
        }
        await new Promise((r) => setTimeout(r, 16));
      }
      return {
        props: [...props].filter((k) => !["offset", "computedOffset", "easing", "composite"].includes(k)),
        sawClosed: sawClosed.v,
        sawHinge: sawHinge.v,
        sawPull3d: sawPull3d.v,
      };
    });
    await spine.click();
    await expect(page.locator("#book:not(.hidden)")).toBeVisible({ timeout: 20_000 });
    const observed = await animated;
    expect(observed.sawPull3d).toBe(false);
    expect(observed.sawClosed).toBe(true);
    expect(observed.sawHinge).toBe(true);
    expect(observed.props.every((p) => p === "transform" || p === "opacity")).toBe(true);
    await audioAdvances(page);
  });

  test("/classic/ is still the dark player without Read UI", async ({ page }) => {
    await page.goto(`${ORIGIN}/classic/`);
    await expect(page.locator('body[data-shell="classic"]')).toBeAttached();
    await expect(page.locator("#tab-read")).toHaveCount(0);
    await expect(page.locator("#reader")).toHaveCount(0);
  });
});

test.describe("lock screen (Media Session)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const ms = navigator.mediaSession;
      if (!ms) return;
      const original = ms.setActionHandler.bind(ms);
      ms.setActionHandler = (name, fn) => {
        const seen = JSON.parse(sessionStorage.getItem("__actions") || "{}");
        seen[name] = typeof fn === "function" ? "set" : "cleared";
        sessionStorage.setItem("__actions", JSON.stringify(seen));
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
    const actions = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__actions") || "{}"));
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
