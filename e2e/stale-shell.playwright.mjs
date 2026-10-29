import { LIBRARY_SHELL_KEY, LIBRARY_SNAPSHOT_KEY } from "../docs/library.js";
import {
  MP3,
  ORIGIN,
  SHELL_VERSION,
  SNAPSHOT,
  STALE_SNAPSHOT,
  audioAdvances,
  expect,
  openFromCoverAndListen,
  seedOfflineAudio,
  setShell,
  settledShellState,
  waitShellSettled,
  shellState,
  test,
  writeShelfSnapshot,
} from "./fixtures.mjs";

const OLD = SHELL_VERSION - 1;

test.use({ serviceWorkers: "allow" });

test("an installed previous shell (old SW + cache + 2-book snapshot) upgrades to the current one", async ({
  page,
  context,
  browserName,
}) => {
  await setShell("old");
  await context.addInitScript(
    ({ rows, shell, snapshotKey, shellKey }) => {
      if (localStorage.getItem("__staleSeeded")) return;
      localStorage.setItem("__staleSeeded", "1");
      localStorage.setItem(snapshotKey, JSON.stringify(rows));
      localStorage.setItem(shellKey, String(shell));
      localStorage.setItem("librarylisten.shelfView", "spines");
    },
    {
      rows: STALE_SNAPSHOT,
      shell: String(OLD),
      snapshotKey: LIBRARY_SNAPSHOT_KEY,
      shellKey: LIBRARY_SHELL_KEY,
    }
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

  await setShell("current");
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
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), LIBRARY_SNAPSHOT_KEY))
    .toBeNull();

  await writeShelfSnapshot(page, SNAPSHOT, SHELL_VERSION);
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

test("a page left open on the old shell upgrades when it returns to the foreground, but not mid-chapter", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name === "chromium-iphone-ua-390", "covered by the WebKit 390 and desktop runs");
  test.setTimeout(180_000);
  await setShell("old");
  await context.addInitScript(
    ({ rows, shell, snapshotKey, shellKey }) => {
      localStorage.setItem(snapshotKey, JSON.stringify(rows));
      localStorage.setItem(shellKey, String(shell));
    },
    {
      rows: SNAPSHOT,
      shell: String(OLD),
      snapshotKey: LIBRARY_SNAPSHOT_KEY,
      shellKey: LIBRARY_SHELL_KEY,
    }
  );
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await seedOfflineAudio(page, "munroe/what-if-1");
  await page.reload();
  const installed = await waitShellSettled(page);
  expect(installed.caches).toEqual([`library-listen-shell-v${OLD}`]);
  expect(installed.header).toBe(`v${OLD}`);

  await openFromCoverAndListen(page, "munroe/what-if-1");
  await audioAdvances(page);
  await page.evaluate(() => {
    document.getElementById("audio").loop = true;
  });
  const listening = await shellState(page);

  await setShell("current");
  // The app throttles foreground update checks to one a minute.
  await page.waitForTimeout(61_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(4_000);
  const midChapter = await shellState(page);
  expect(midChapter.origin, "no reload while a chapter plays").toBe(listening.origin);
  expect(midChapter.playing).toBe(true);
  expect(midChapter.header).toBe(`v${OLD}`);

  await page.evaluate(() => document.getElementById("audio").pause());
  await expect
    .poll(
      async () => {
        const s = await settledShellState(page);
        return `${s.header} ${s.caches.join(",")} ${s.appScript}`;
      },
      { timeout: 20_000 }
    )
    .toBe(`v${SHELL_VERSION} library-listen-shell-v${SHELL_VERSION} ./app.js?v=${SHELL_VERSION}`);
  expect((await shellState(page)).origin).not.toBe(listening.origin);
});

test("reloading while a new service worker takes over does not start a reload loop", async ({ page }) => {
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  await setShell("old");
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await setShell("current");
  await page.reload();
  await page.waitForTimeout(8_000);
  expect(navigations, "goto + reload + at most one SW reload").toBeLessThanOrEqual(3);
  const s = await settledShellState(page);
  expect(s.controller).toMatch(/\/sw\.js$/);
  expect(s.caches).toEqual([`library-listen-shell-v${SHELL_VERSION}`]);
});
