/**
 * iPhone sign-in must leave the page for Google. A token in the hash must
 * replace the demo shelf. The Drive files here are a fixture, not Jeff's library.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { GOOGLE_OAUTH_CLIENT_ID, LIVE_IMPLICIT_REDIRECT_URI } from "../docs/drive.js";
import { ORIGIN, SHELL_VERSION, expect, test } from "./fixtures.mjs";

const OUT = "/cursor/stores/bc-a9df44a7-f3a8-570d-9864-cb63e4f9af5d/media/mobile-signin";
const FOLDER = "application/vnd.google-apps.folder";
const DEMO_TITLES = ["First Day", "Homework", "What If?", "How To", "What If? 2", "Immune"];

function filesForQuery(q) {
  if (q.includes("sharedWithMe=true")) return [];
  if (q.includes("name='Library'")) {
    return [{ id: "lib-root", name: "Library", mimeType: FOLDER, ownedByMe: true }];
  }
  if (q.includes("'lib-root' in parents")) {
    return [{ id: "col-harbor", name: "FixtureShelf", mimeType: FOLDER }];
  }
  if (q.includes("'col-harbor' in parents")) {
    return [{ id: "listen-harbor", name: "listen", mimeType: FOLDER }];
  }
  if (q.includes("'listen-harbor' in parents")) {
    return [{ id: "harbor-mp3", name: "Harbor.mp3", mimeType: "audio/mpeg", size: "2048" }];
  }
  return [];
}

async function saveShot(page, name, extra) {
  try {
    mkdirSync(OUT, { recursive: true });
    const shot = join(OUT, name);
    await page.screenshot({ path: shot, fullPage: true });
    appendFileSync(
      join(OUT, "runs.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), shot, ...extra })}\n`
    );
  } catch (err) {
    if (err?.code === "EACCES" || err?.code === "EPERM" || err?.code === "ENOENT") return;
    throw err;
  }
}

test.describe("iPhone implicit sign-in", () => {
  test("full-page redirect replaces the demo shelf with a fixture Drive library", async ({ page }, testInfo) => {
    const ua = testInfo.project.use.userAgent || "";
    test.skip(!/iPhone|iPad/.test(ua), "iPhone and iPad projects only");
    const webkit = testInfo.project.name === "webkit-iphone-390";
    /* serviceWorkers: "block" leaves navigator.serviceWorker.ready pending,
       and the player waits on it before the Drive scan. Resolve it here. */
    await page.addInitScript(() => {
      const sw = navigator.serviceWorker;
      if (!sw) return;
      const ready = Promise.resolve({ active: null });
      try {
        Object.defineProperty(sw, "ready", { configurable: true, get: () => ready });
      } catch {
        /* real ready promise */
      }
    });

    await page.route("https://accounts.google.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><title>oauth</title><p id=\"oauth-landed\">full-page oauth redirect</p>",
      });
    });
    await page.route("https://www.googleapis.com/**", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "GET, OPTIONS",
          },
        });
        return;
      }
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/about")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ user: { emailAddress: "fixture@example.com" } }),
        });
        return;
      }
      const files = filesForQuery(url.searchParams.get("q") || "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ files }),
      });
    });

    const gsi = [];
    let popup = false;
    page.on("request", (req) => {
      if (req.url().includes("/gsi/client")) gsi.push(req.url());
    });
    page.on("popup", () => {
      popup = true;
    });

    await page.goto(`${ORIGIN}/`);
    await expect(page.locator("#shell-build")).toHaveText(`v${SHELL_VERSION} · mobile`);
    await expect(page.locator("#app-version")).toHaveText(`v${SHELL_VERSION} · mobile`);
    await expect(page.getByRole("button", { name: "All 6" })).toBeVisible();
    await expect
      .poll(async () => (await page.locator(".cover-card h3").allTextContents()).slice().sort())
      .toEqual([...DEMO_TITLES].sort());
    const built = await page.evaluate(async (version) => {
      const mod = await import(`./drive.js?v=${version}`);
      const live = new URL(
        mod.localImplicitAuthUrl({
          origin: "https://bigdaddy109.github.io",
          hostname: "bigdaddy109.github.io",
        })
      );
      return {
        redirect: live.searchParams.get("redirect_uri"),
        desktop: mod.gisUsesRedirect("bigdaddy109.github.io", {
          userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0",
          maxTouchPoints: 0,
        }),
        ipadMac: mod.gisUsesRedirect("bigdaddy109.github.io", {
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
          maxTouchPoints: 5,
        }),
      };
    }, String(SHELL_VERSION));
    expect(built.redirect).toBe(LIVE_IMPLICIT_REDIRECT_URI);
    expect(built.desktop).toBe(false);
    expect(built.ipadMac).toBe(true);
    if (webkit) await saveShot(page, "webkit-iphone-demo-shelf.png", { step: "demo", note: "fixture demo shelf, not Jeff's 21 books" });

    await page.getByRole("button", { name: "Sign in with Google" }).click();
    await page.waitForURL(/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    const landed = new URL(page.url());
    expect(popup).toBe(false);
    expect(gsi).toEqual([]);
    expect(landed.searchParams.get("response_type")).toBe("token");
    expect(landed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8080/");
    expect(landed.searchParams.get("client_id")).toBe(GOOGLE_OAUTH_CLIENT_ID);
    expect(landed.searchParams.get("redirect_uri")).not.toBe(LIVE_IMPLICIT_REDIRECT_URI);
    await expect(page.locator("#oauth-landed")).toHaveText("full-page oauth redirect");
    if (webkit) {
      await saveShot(page, "webkit-iphone-redirect.png", {
        step: "redirect",
        redirect_uri: landed.searchParams.get("redirect_uri"),
        note: "main frame left for Google; GIS popup was not opened",
      });
    }

    await page.goto(
      `${ORIGIN}/#access_token=ya29.fixture-mobile&expires_in=3600&token_type=Bearer`
    );
    await expect(page.locator(".cover-card h3")).toHaveText(["Harbor"]);
    for (const title of DEMO_TITLES) {
      await expect(page.locator(".cover-card h3", { hasText: title })).toHaveCount(0);
    }
    await expect(page.locator("#drive-status")).toContainText("fixture@example.com");
    await expect(page.locator("#capability-hint")).not.toHaveText("Scanning the Drive Library…");
    await expect(page.locator("#load-hint")).toBeHidden();
    if (webkit) {
      await saveShot(page, "webkit-iphone-drive-shelf.png", {
        step: "fixture-drive",
        note: "mocked Drive library (Harbor), not Jeff's 21 books",
      });
      await page.setViewportSize({ width: 720, height: 1024 });
      await saveShot(page, "webkit-iphone-720-drive-shelf.png", {
        step: "fixture-drive-720",
        note: "720px portrait of the mocked shelf, not Jeff's 21 books",
      });
    }
  });
});
