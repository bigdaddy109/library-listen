import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const LIVE = process.env.DEPLOY_URL || "https://bigdaddy109.github.io/library-listen/";
const sw = readFileSync(new URL("../docs/sw.js", import.meta.url), "utf8");
const home = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
const version = sw.match(/const CACHE = "library-listen-shell-v(\d+)";/)?.[1];
if (!version) throw new Error("docs/sw.js has no shell version");
const googleLabel = home.match(/id="btn-google"[^>]*>\s*([^<]+?)\s*</)?.[1];
if (!googleLabel) throw new Error("homepage is missing the Google sign-in label");

const shots = new URL("../deploy-smoke-screenshots/", import.meta.url);
mkdirSync(shots, { recursive: true });

test("live homepage version matches, and a demo book opens without Google sign-in", async ({ page }) => {
  const oauth = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("oauth2") || url.includes("/o/oauth2")) oauth.push(url);
  });
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* private mode */
    }
  });

  await page.goto(`${LIVE}?cb=${Date.now()}`);
  await expect(page.locator("#app-version")).toHaveText(`v${version}`);
  await expect(page.locator("#btn-google")).toHaveText(googleLabel);
  await expect(page.locator("#btn-pick-main")).toHaveText("Use a local folder instead");
  await expect(page.locator("#btn-sleep")).toHaveText("Sleep");
  const card = page.locator('.cover-card[data-id="munroe/what-if-1"]');
  await expect(card.locator("h3")).toHaveText("What If?");
  await page.screenshot({ path: new URL("01-homepage.png", shots).pathname, fullPage: true });

  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.locator("#source-sheet:not(.hidden)")).toBeVisible();
  await expect(page.locator("#source-sheet-title")).toHaveText("Library source");
  await expect(page.locator("#drive-status.drive-error")).toHaveCount(0);
  expect(oauth, "smoke test must not start Google sign-in").toEqual([]);
  await page.screenshot({ path: new URL("02-demo-book.png", shots).pathname, fullPage: true });
});
