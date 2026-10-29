import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildLibrary } from "../docs/library.js";
import {
  clearAccessToken,
  makeDriveFile,
  finishDrivePlaybackAuthRetry,
  freshAccessToken,
  planDrivePlaybackAuthRetry,
  setAccessToken,
  refreshGoogleToken,
  setDriveTokenAppliedListener,
  setSilentPopupGraceMs,
  signInWithGoogle,
  tokenForChapterFetch,
  tokenForRead,
} from "../docs/drive.js";

const APP = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../docs/app.js"),
  "utf8"
);

function installGis(prompts, { failSilent = false, token = "gis-token", expiresIn = 3600 } = {}) {
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient(opts) {
          return {
            requestAccessToken(arg) {
              const prompt =
                arg && Object.prototype.hasOwnProperty.call(arg, "prompt") ? arg.prompt : "(missing)";
              prompts.push(prompt);
              setTimeout(() => {
                if (prompt === "" && failSilent) {
                  opts.error_callback?.({
                    type: "interaction_required",
                    message: "interaction_required",
                  });
                  return;
                }
                if (prompt !== "" && prompt !== "consent") {
                  opts.error_callback?.({
                    type: "popup_failed_to_open",
                    message: "Failed to open popup window",
                  });
                  return;
                }
                opts.callback?.({ access_token: token, expires_in: expiresIn });
              }, 0);
            },
          };
        },
        revoke(_token, done) {
          if (done) done();
        },
      },
    },
  };
}

describe("Drive token expiry during listen", { concurrency: false }, () => {
  /** @type {string[]} */
  let prompts;

  beforeEach(() => {
    prompts = [];
    clearAccessToken();
    installGis(prompts);
  });

  afterEach(() => {
    clearAccessToken();
    setSilentPopupGraceMs(1000);
    delete globalThis.google;
  });

  it("stores expiry and treats the last minute as already expired", () => {
    const t0 = 1_000_000_000;
    setAccessToken("hour", { expiresIn: 3600, now: t0 });
    assert.equal(freshAccessToken(t0 + 3_000_000), "hour");
    assert.equal(freshAccessToken(t0 + 3600_000 - 60_001), "hour");
    assert.equal(freshAccessToken(t0 + 3600_000 - 60_000), null);
    clearAccessToken();
    assert.equal(freshAccessToken(t0 + 1_000), null);
  });

  it("reuses a fresh token for the next chapter and does not call requestAccessToken", async () => {
    const token = await signInWithGoogle();
    assert.deepEqual(prompts, ["consent"]);
    prompts.length = 0;
    const again = await tokenForChapterFetch();
    assert.equal(again, token);
    assert.equal(freshAccessToken(), token);
    assert.deepEqual(prompts, []);
  });

  it("simulates expiry and refreshes with prompt:'' before the chapter fetch", async () => {
    installGis(prompts, { expiresIn: 120, token: "short" });
    const token = await signInWithGoogle();
    assert.equal(token, "short");
    prompts.length = 0;
    const still = await tokenForChapterFetch({ now: Date.now() + 30_000 });
    assert.equal(still, "short");
    assert.deepEqual(prompts, []);
    setAccessToken("short");
    assert.equal(freshAccessToken(Date.now() + 90_000), null);
    const next = await tokenForRead({ now: Date.now() + 90_000 });
    assert.equal(next, "short");
    assert.deepEqual(prompts, [""]);
    assert.ok(prompts.every((prompt) => prompt === ""));
  });

  it("an hour-old token is refreshed silently and never with a popup prompt", async () => {
    await signInWithGoogle();
    prompts.length = 0;
    const next = await tokenForRead({ now: Date.now() + 4_000_000 });
    assert.equal(next, "gis-token");
    assert.deepEqual(prompts, [""]);
  });

  it("when silent refresh fails, the chapter fetch rejects without a consent popup", async () => {
    clearAccessToken();
    prompts.length = 0;
    installGis(prompts, { failSilent: true });
    await assert.rejects(tokenForChapterFetch(), (err) => {
      assert.ok(err);
      assert.equal(err.kind === "abort", false);
      return true;
    });
    assert.deepEqual(prompts, [""]);
  });

  it("retries one 401 chapter at the same position and does not loop", () => {
    const first = planDrivePlaybackAuthRetry(null, {
      bookId: "immune",
      chapterIndex: 3,
      position: 125.4,
    });
    assert.equal(first.action, "retry");
    assert.equal(first.chapterIndex, 3);
    assert.equal(first.position, 125.4);

    const burst = planDrivePlaybackAuthRetry(first.state, {
      bookId: "immune",
      chapterIndex: 3,
      position: 125.4,
    });
    assert.equal(burst.action, "ignore");

    const settled = finishDrivePlaybackAuthRetry(first.state, { ok: false });
    const again = planDrivePlaybackAuthRetry(settled, {
      bookId: "immune",
      chapterIndex: 3,
      position: 125.4,
    });
    assert.equal(again.action, "fail");

    const nextChapter = planDrivePlaybackAuthRetry(settled, {
      bookId: "immune",
      chapterIndex: 4,
      position: 8,
    });
    assert.equal(nextChapter.action, "retry");
    assert.equal(nextChapter.position, 8);

    assert.equal(finishDrivePlaybackAuthRetry(first.state, { ok: true }), null);
    const later = planDrivePlaybackAuthRetry(null, {
      bookId: "immune",
      chapterIndex: 3,
      position: 200,
    });
    assert.equal(later.action, "retry");
    assert.equal(later.position, 200);

    assert.equal(planDrivePlaybackAuthRetry(null, {}).action, "fail");
    assert.equal(
      planDrivePlaybackAuthRetry(null, { bookId: "b", chapterIndex: 0, position: 0 }).position,
      0
    );
  });

  it("keeps a token when popup_failed_to_open fires and sign-in still succeeds", async () => {
    clearAccessToken();
    let applied = 0;
    setDriveTokenAppliedListener(() => {
      applied += 1;
    });
    globalThis.google = {
      accounts: {
        oauth2: {
          initTokenClient(opts) {
            return {
              requestAccessToken() {
                opts.error_callback?.({
                  type: "popup_failed_to_open",
                  message: "Failed to open popup window",
                });
                setTimeout(() => {
                  opts.callback?.({ access_token: "recovered", expires_in: 3600 });
                }, 20);
              },
            };
          },
        },
      },
    };
    try {
      const token = await signInWithGoogle();
      assert.equal(token, "recovered");
      assert.equal(freshAccessToken(), "recovered");
      assert.equal(applied, 1);
    } finally {
      setDriveTokenAppliedListener(null);
    }
  });

  it("token callback after an account is chosen loads the books", async () => {
    clearAccessToken();
    globalThis.google = {
      accounts: {
        oauth2: {
          initTokenClient(opts) {
            return {
              requestAccessToken(arg) {
                assert.equal(arg.prompt, "consent");
                opts.error_callback?.({
                  type: "popup_failed_to_open",
                  message: "Failed to open popup window",
                });
                opts.callback?.({ access_token: "account-chosen", expires_in: 3600 });
              },
            };
          },
        },
      },
    };
    const token = await signInWithGoogle();
    assert.equal(token, "account-chosen");
    assert.equal(freshAccessToken(), "account-chosen");
    const file = makeDriveFile({
      id: "part01",
      name: "Immune-Part01.mp3",
      mimeType: "audio/mpeg",
      size: 1200,
      videoMediaMetadata: { durationMillis: "3600000" },
    });
    const books = buildLibrary([
      { path: "Library/Immune/listen/Immune-Part01.mp3", file },
    ]);
    assert.equal(books.length, 1);
    assert.equal(books[0].chapters.length, 1);
    assert.equal(books[0].chapters[0].durationMillis, 3_600_000);
  });

  it("a second click after a stuck attempt still opens sign-in", async () => {
    clearAccessToken();
    /** @type {string[]} */
    const prompts = [];
    let clients = 0;
    globalThis.google = {
      accounts: {
        oauth2: {
          initTokenClient(opts) {
            return {
              requestAccessToken(arg) {
                clients += 1;
                const prompt =
                  arg && Object.prototype.hasOwnProperty.call(arg, "prompt") ? arg.prompt : "(missing)";
                prompts.push(prompt);
                if (clients === 1) {
                  opts.error_callback?.({
                    type: "popup_failed_to_open",
                    message: "Failed to open popup window",
                  });
                  return;
                }
                opts.callback?.({ access_token: "second-click", expires_in: 3600 });
              },
            };
          },
        },
      },
    };
    const first = signInWithGoogle();
    const firstDone = first.then(
      () => "token",
      (err) => err
    );
    const token = await signInWithGoogle();
    assert.equal(token, "second-click");
    assert.deepEqual(prompts, ["consent", "consent"]);
    assert.equal(clients, 2);
    assert.equal(freshAccessToken(), "second-click");
    const firstErr = await firstDone;
    assert.equal(firstErr?.name, "AbortError");
    assert.equal(firstErr?.silent, true);
    const file = makeDriveFile({
      id: "ms",
      name: "01.mp3",
      mimeType: "audio/mpeg",
      size: 800,
    });
    const books = buildLibrary([
      { path: "Library/上學不容易/listen/Middle School 01 First Day/01.mp3", file },
    ]);
    assert.equal(books.length, 1);
  });

  it("a silent refresh does not open a consent popup or lock the next click", async () => {
    clearAccessToken();
    setSilentPopupGraceMs(30);
    /** @type {string[]} */
    const prompts = [];
    let clients = 0;
    globalThis.google = {
      accounts: {
        oauth2: {
          initTokenClient(opts) {
            return {
              requestAccessToken(arg) {
                clients += 1;
                const prompt =
                  arg && Object.prototype.hasOwnProperty.call(arg, "prompt") ? arg.prompt : "(missing)";
                prompts.push(prompt);
                if (prompt === "") {
                  opts.error_callback?.({
                    type: "popup_failed_to_open",
                    message: "Failed to open popup window",
                  });
                  return;
                }
                opts.callback?.({ access_token: "from-click", expires_in: 3600 });
              },
            };
          },
        },
      },
    };
    const silent = refreshGoogleToken();
    const silentDone = silent.then(
      () => null,
      (err) => err
    );
    const clicked = await signInWithGoogle();
    assert.equal(clicked, "from-click");
    assert.deepEqual(prompts, ["", "consent"]);
    assert.equal(clients, 2);
    const err = await silentDone;
    assert.equal(err?.name, "AbortError");
    assert.equal(err?.silent, true);
    assert.doesNotMatch(String(err?.message || ""), /Failed to open popup window/);
  });

  it("a silent token after popup_failed_to_open still resolves the refresh", async () => {
    clearAccessToken();
    setSilentPopupGraceMs(500);
    /** @type {string[]} */
    const prompts = [];
    globalThis.google = {
      accounts: {
        oauth2: {
          initTokenClient(opts) {
            return {
              requestAccessToken(arg) {
                prompts.push(arg.prompt);
                opts.error_callback?.({
                  type: "popup_failed_to_open",
                  message: "Failed to open popup window",
                });
                setTimeout(() => {
                  opts.callback?.({ access_token: "silent-token", expires_in: 3600 });
                }, 20);
              },
            };
          },
        },
      },
    };
    const token = await refreshGoogleToken();
    assert.equal(token, "silent-token");
    assert.deepEqual(prompts, [""]);
    assert.equal(freshAccessToken(), "silent-token");
  });

  it("shows Drive failures inline and replays a 401 at the saved position", () => {
    const start = APP.indexOf("function showDriveError");
    const end = APP.indexOf("function updateDriveStatus");
    assert.ok(start > 0 && end > start);
    const fn = APP.slice(start, end);
    assert.doesNotMatch(fn, /alert\s*\(/);
    assert.match(APP, /getAccessToken\(\) && !freshAccessToken\(\)/);
    assert.match(APP, /tokenForChapterFetch\(\)/);
    assert.match(APP, /planDrivePlaybackAuthRetry/);
    assert.match(APP, /authRetry:\s*true/);
    assert.match(APP, /startAt:\s*plan\.position/);
    assert.match(APP, /id="player-drive-error"|player-drive-error/);
  });
});
