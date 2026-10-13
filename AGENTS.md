# Library Listen — agent notes

Offline audiobook player for a shared `Library` folder. Google Drive (GIS + drive.readonly) is the web source; local-folder pick stays as fallback. No TTS. No upload of books. No paid external APIs. The Drive Client ID and Picker key in [`docs/drive.js`](docs/drive.js) are public browser config (not secrets) — see README for Google Cloud setup.

Read this before changing code. Keep [README.md](README.md), [SHARE-library-listen.md](SHARE-library-listen.md), and [INSTALL-zh.md](INSTALL-zh.md) as the user-facing docs — do not replace them with this file.

**Do not merge or report live** until [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) is fully checked (play + read on every series, 390px iPhone UA and desktop, stale SW, screenshots).

**iOS / native is paused (Jeff, 2026-10-11).** The SwiftUI tree in `LibraryListen/` remains in the repo for history. Do not change it, do not add XCTest, do not run `./start.sh` as part of web work, and do not keep Swift metadata tables in sync unless he un-pauses native. Active work is the web player only. See [fix_plan.md](fix_plan.md).

## What it is

| Surface | Where | Status |
| --- | --- | --- |
| **Web player (live)** | [`docs/`](docs/) | **Active.** GitHub Pages from `/docs` on `main`: https://bigdaddy109.github.io/library-listen/ |
| **Native iOS/iPadOS app** | [`LibraryListen/`](LibraryListen/) + [`LibraryListen.xcodeproj`](LibraryListen.xcodeproj) | **Paused.** Sideload-via-Xcode code is still here. Do not treat it as a second product to maintain. |

Recent merged PRs (#1–#28) are almost all web-player work. That is the deploy path. The homepage is the rice-paper shelf; the previous dark player stays at `/classic/`. `/shelf/` redirects home.

## Architecture

### Library layout

```text
Library/
  門羅-WhatIf/listen/{what-if-1,how-to,what-if-2}
  Immune/listen/Immune-Part01.mp3 … Immune-Part09.mp3
```

- Scan looks for a `listen/` folder up to two levels down from the picked root.
- Skip `ebooks/`, `_source/`, and any name starting with `_`.
- Audio: `mp3`, `m4a`, `m4b`, `aac`. Covers: `jpg`, `jpeg`, `png`, `webp`.
- Files sitting directly in `listen/` are one book (Immune). Subfolders are books (Munroe).
- Known titles/authors for the live player live in [`docs/library.js`](docs/library.js) (`KNOWN_COLLECTIONS` / `KNOWN_BOOKS`). The same names also exist in paused [`LibraryListen/HubPaths.swift`](LibraryListen/HubPaths.swift) — leave that file alone.
- Google Drive: [`docs/drive.js`](docs/drive.js) walks a folder named `Library` (My Drive + Shared with me, or Google Picker) and feeds `{path, file}` entries into `buildLibrary`. Do not rewrite pairing rules there. The homepage is the rice-paper shelf; `/classic/` is the previous dark player. Authorized JS origin is only `https://bigdaddy109.github.io` (no path). Local preview: `http://127.0.0.1:8080` and `http://localhost:8080`. Client ID is pasted public browser config (not a secret).
- Never commit real Hub audio or a real OAuth client secret.

### Web player (`docs/`)

Vanilla ES modules. No bundler, no framework. Root `package.json` is only `"type": "module"` plus `node --test`.

- [`docs/index.html`](docs/index.html) + [`docs/app.js`](docs/app.js) + [`docs/styles.css`](docs/styles.css) + [`docs/drive.js`](docs/drive.js)
- [`docs/sw.js`](docs/sw.js) — shell-only service worker. **Audiobook bytes are never cached here.** Same-origin `/drive-media/<id>` is proxied to Drive `alt=media` with Range and is never written to the cache.
- [`docs/immune-cards.js`](docs/immune-cards.js) + `docs/concepts/immune/*.jpg` — original Immune concept cards (not book text), shown only for the Immune book.
- Progress: `localStorage` key `librarylisten.progress.v1` (per-book last chapter **and** a per-chapter map).
- Shelf snapshot: `librarylisten.library.v1`.
- Sort / rate: `librarylisten.shelfSort`, `librarylisten.rate`.
- IndexedDB `library-listen`: `handles` (desktop File System Access directory handle) and `offline` (copied chapter/cover blobs).
- Folder pick: **用 Google 登入** (GIS token, Drive API v3 `drive.readonly`) or `showDirectoryPicker` / `<input webkitdirectory>` as the local fallback. iPhone Safari cannot keep local folder permission across launches — Drive reconnect or **Save to this device** is the workaround.
- Playback extras on the web player: sleep timer (15/30/45/60), −30/+30, next-chapter toast, save-to-device, Immune Concepts tab, shelf search (`docs/search.js`), EPUB Read tab, m4b chapter markers (`docs/markers.js`). The mid-listen save `confirm()` is gated to phones without a persisted folder handle.
- A chaptered `m4b` is split with in-file markers when present (`applyAudiobookMarkers`). Unmarked files stay one chapter.

### Native app (`LibraryListen/`) — paused

Leave this tree untouched. Short map only so you do not mistake it for the live player: SwiftUI iOS 17+, Xcode 16, bundle id `com.jeffwu.librarylisten`. It can persist a folder bookmark (Safari cannot), parse m4b chapter markers, and search the shelf. It does not have the web sleep timer, save-to-device, or Immune cards. Install notes remain in [INSTALL-zh.md](INSTALL-zh.md) / [SHARE-library-listen.md](SHARE-library-listen.md) for when (if) native is un-paused.

### What is intentionally out of scope

- No TTS, no cloud account of our own, no App Store, no server.
- Thing Explainer has no audio and is not synthesized.
- Do not invent chapter titles by renaming files. Do not add a `chapters.json` sidecar.
- Do not put a live SQLite database in this iCloud folder (see SHARE-library-listen.md).

## Build, run, deploy

### Web (no build step)

The site **is** `docs/`. Merge to `main` and GitHub Pages (`source: main /docs`, legacy project Pages, https enforced) publishes it.

Preview locally (any static server; do not add a paid host):

```bash
python3 -m http.server 8080 --directory docs
# then open http://127.0.0.1:8080/
```

```bash
node --check docs/app.js
node --check docs/drive.js
node --check docs/immune-cards.js
node --check docs/sw.js
node --test
```

### Native — paused

Do not run `./start.sh`, `scripts/generate-fixtures.sh`, or `xcodebuild` for current work. Those exist only for the shelved iOS app. Sideload details stay in [INSTALL-zh.md](INSTALL-zh.md) if native is ever un-paused.

## Tests (as of 2026-10-12)

Local `node --test` covers scan/title/progress (`test/library.test.js`), PWA cache lockstep (`test/pwa-cache.test.mjs`), shelf search, m4b markers, save-prompt gating, Drive helpers, EPUB parse, and the Jeff Drive listen+ebook fixture. GitHub Actions (`.github/workflows/acceptance.yml`) installs ffmpeg, then runs `node --test` plus Playwright against that fixture. That is not a paid device farm. Do not add App Store / XCTest CI. Live merge still requires [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

Recorded on a Linux agent against `main` @ `b0e0b6c` (after Drive OAuth #23):

| Check | Result |
| --- | --- |
| GitHub Pages live site | **Pass** — https://bigdaddy109.github.io/library-listen/ serves Drive onboarding + player chrome. Shell cache version is the integer in `docs/sw.js` (v32 after empty-library status). Pages source `main` `/docs`. |
| `node --check` on `docs/{app,drive,immune-cards,sw}.js` | **Pass** |
| `node --test` | **Pass** |
| `docs/manifest.webmanifest` JSON | **Pass** |
| Service-worker asset list vs files on disk | **Pass** (CACHE / `?v=` / ASSETS kept in lockstep by `test/pwa-cache.test.mjs`) |
| Immune concept image files vs `immune-cards.js` | **Pass** |
| `xcodebuild` / XCTest | **Absent.** Native is paused; do not add a Swift test target or a paid device farm. |
| `.github/workflows/acceptance.yml` | **Present.** `node --test` + Playwright fixture only. |

Do not invent a paid CI service. Keep the workflow free and fixture-only.

## Cache-bust (web)

The PWA cache version is a hand-maintained integer. Today it is **40**. When you change `docs/index.html`, `docs/app.js`, `docs/styles.css`, `docs/drive.js`, `docs/immune-cards.js`, icons, or concept images, bump **all** of:

1. `?v=N` on every asset link in [`docs/index.html`](docs/index.html)
2. `import … from "./….js?v=N"` in [`docs/app.js`](docs/app.js) (including `drive.js`)
3. `const CACHE = "library-listen-shell-vN"` **and** every `?v=N` path in [`docs/sw.js`](docs/sw.js) `ASSETS`

Miss one and phones keep a stale shell. HTML navigations are network-first; other assets are cache-first.

## Pitfalls

- **iPhone Safari cannot persist a folder.** Desktop Chrome/Edge can, via IndexedDB directory handles. On iOS Safari, progress survives but playable `File` objects do not. Save-to-device (IndexedDB blobs) is the workaround. The mid-listen `confirm()` is already gated (PR #16) — don’t add more blocking dialogs without a reason.
- **iCloud placeholders look like empty files.** The web walker skips 0-byte audio and unreadable handles instead of failing the whole scan. “Empty shelf” almost always means Download Now was not done.
- **Resume is fragile on iOS Safari.** `playChapter` must not `await` before `audio.play()` or the user-gesture is dropped. There is a resume-guard against post-play snap-back. Touch it with a real iPhone, not only desktop.
- **Native is paused.** Do not “fix” `HubPaths` personal paths, `ProgressStore`, `generate-fixtures.sh` / `AppIcon.png`, or Xcode signing as part of web work. Those stay dropped in [fix_plan.md](fix_plan.md).
- **No secrets.** `.gitignore` already blocks `.env*` and `/Library/`. Do not add real Hub paths or copyrighted audio.

## Working rules

1. **Changes go through PRs. Never merge your own PR.** Jeff reviews and merges.
2. **Docs-only vs app changes stay separate** unless a one-line doc fix is required for the files you were asked to touch.
3. **Search the repo before assuming something is missing.** README, SHARE, INSTALL-zh, this file, and `fix_plan.md` already exist once this PR lands.
4. **No stubs.** Don’t add empty tests, placeholder functions, or “TODO implement later” files.
5. **One most-important thing at a time** (see [fix_plan.md](fix_plan.md)). Finish and verify that item before starting the next.
6. **Commit only after the checks you can run have passed.** At minimum: `node --check` on any edited JS.
7. **No paid external API calls or new paid services** without Jeff’s approval. No new cloud accounts. No App Store pipeline.
8. **No secrets in code.** No real library paths. No copyrighted audiobooks.
9. **Do not work the paused native app** unless Jeff explicitly un-pauses it.

## Suggested first command when you open the repo

```bash
node --check docs/app.js && node --check docs/drive.js && node --check docs/immune-cards.js && node --check docs/sw.js && node --test
```

Then read [fix_plan.md](fix_plan.md) and do only the top unchecked item.
