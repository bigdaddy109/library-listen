import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const LIVE = process.env.DEPLOY_URL || "https://bigdaddy109.github.io/library-listen/";
const sw = readFileSync(new URL("../docs/sw.js", import.meta.url), "utf8");
const version = sw.match(/const CACHE = "library-listen-shell-v(\d+)";/)?.[1];
if (!version) throw new Error("docs/sw.js has no shell version");

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
  await expect(page.locator("#btn-google")).toHaveText("用 Google 登入");
  await expect(page.locator("#btn-pick-main")).toHaveText("改用本機資料夾");
  await expect(page.locator("#btn-sleep")).toHaveText("睡眠");
  const card = page.locator('.cover-card[data-id="munroe/what-if-1"]');
  await expect(card.locator("h3")).toHaveText("What If?");
  await page.screenshot({ path: new URL("01-homepage.png", shots).pathname, fullPage: true });

  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.locator("#source-sheet:not(.hidden)")).toBeVisible();
  await expect(page.locator("#source-sheet-title")).toHaveText("書庫來源");
  await expect(page.locator("#drive-status")).not.toContainText("已連上 Google Drive");
  expect(oauth, "smoke test must not start Google sign-in").toEqual([]);
  await page.screenshot({ path: new URL("02-demo-book.png", shots).pathname, fullPage: true });
});
