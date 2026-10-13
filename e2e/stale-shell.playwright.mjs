import {
  MP3,
  ORIGIN,
  SHELL_VERSION,
  SNAPSHOT,
  STALE_SNAPSHOT,
  audioAdvances,
  expect,
  openFromCoverAndListen,
  settledShellState,
  test,
} from "./fixtures.mjs";

const OLD = SHELL_VERSION - 1;

test.use({ serviceWorkers: "allow" });

test("an installed previous shell (old SW + cache + 2-book snapshot) upgrades to the current one", async ({
  page,
  context,
  browserName,
}) => {
  await context.addCookies([{ name: "ll-shell", value: "old", url: ORIGIN }]);
  await context.addInitScript(
    ({ rows }) => {
      if (localStorage.getItem("__staleSeeded")) return;
      localStorage.setItem("__staleSeeded", "1");
      localStorage.setItem("librarylisten.library.v1", JSON.stringify(rows));
      localStorage.setItem("librarylisten.shelfView", "spines");
    },
    { rows: STALE_SNAPSHOT }
  );

  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(async () => (await settledShellState(page)).caches)
    .toEqual([`library-listen-shell-v${OLD}`]);
  const before = await settledShellState(page);
  expect(before.controller).toMatch(/\/sw\.js$/);
  expect(before.appScript).toBe(`./app.js?v=${OLD}`);

  await context.clearCookies();
  await page.reload();
  await expect
    .poll(
      async () => {
        const s = await settledShellState(page);
        return `${s.caches.join(",")} ${s.appScript}`;
      },
      { timeout: 20_000 }
    )
    .toBe(`library-listen-shell-v${SHELL_VERSION} ./app.js?v=${SHELL_VERSION}`);
  await page.reload();
  const after = await settledShellState(page);
  expect(after.caches).toEqual([`library-listen-shell-v${SHELL_VERSION}`]);
  expect(after.controller).toMatch(/\/sw\.js$/);
  expect(after.view).toBe("covers");

  await page.evaluate((rows) => localStorage.setItem("librarylisten.library.v1", JSON.stringify(rows)), SNAPSHOT);
  await page.reload();
  await expect.poll(() => page.locator(".cover-card[data-id]").count()).toBe(SNAPSHOT.length);

  // Playwright can only stub requests a service worker makes in Chromium; in
  // WebKit the proxy would reach the real Drive API with a fake token.
  if (browserName !== "chromium") return;
  await context.route("https://www.googleapis.com/drive/v3/files/**", (route) =>
    route.fulfill({ status: 200, contentType: "audio/mpeg", body: MP3, headers: { "Accept-Ranges": "bytes" } })
  );
  await page.evaluate(() =>
    navigator.serviceWorker.controller.postMessage({ type: "librarylisten.drive-token", token: "fixture-token" })
  );
  await openFromCoverAndListen(page, "munroe/what-if-2");
  await audioAdvances(page);
  expect(await page.evaluate(() => document.getElementById("audio").src)).toContain("/drive-media/");
});
