# Library Listen — agent notes

Offline audiobook player for files that already live in a shared iCloud Drive `Library` folder. Local files only. No TTS. No upload of books. No paid external APIs.

Read this before changing code. Keep [README.md](README.md), [SHARE-library-listen.md](SHARE-library-listen.md), and [INSTALL-zh.md](INSTALL-zh.md) as the user-facing docs — do not replace them with this file.

## What it is

Two clients share one library layout and (mostly) the same metadata rules:

| Surface | Where | Who uses it |
| --- | --- | --- |
| **Web player (primary, live)** | [`docs/`](docs/) | Anyone with the Pages link. GitHub Pages from `/docs` on `main`: https://bigdaddy109.github.io/library-listen/ |
| **Native iOS/iPadOS app (optional)** | [`LibraryListen/`](LibraryListen/) + [`LibraryListen.xcodeproj`](LibraryListen.xcodeproj) | Sideload via Xcode. Personal team. Not App Store. |

The live product people open is the web player. Recent merged PRs (#1–#9) are almost all web-player work. Treat native as a second implementation of the same idea, not the deploy path.

## Architecture

### Library layout (both clients)

```text
Library/
  門羅-WhatIf/listen/{what-if-1,how-to,what-if-2}
  Immune/listen/Immune-Part01.mp3 … Immune-Part09.mp3
```

- Scan looks for a `listen/` folder up to two levels down from the picked root.
- Skip `ebooks/`, `_source/`, and any name starting with `_`.
- Audio: `mp3`, `m4a`, `m4b`, `aac`. Covers: `jpg`, `jpeg`, `png`, `webp`.
- Files sitting directly in `listen/` are one book (Immune). Subfolders are books (Munroe).
- Known titles/authors live in [`docs/app.js`](docs/app.js) (`KNOWN_COLLECTIONS` / `KNOWN_BOOKS`) and [`LibraryListen/HubPaths.swift`](LibraryListen/HubPaths.swift). Keep those tables in sync if you add a book.
- Never commit real Hub audio. Silent stubs only — see Fixtures below.

### Web player (`docs/`)

Vanilla ES modules. No bundler, no `package.json`, no framework.

- [`docs/index.html`](docs/index.html) + [`docs/app.js`](docs/app.js) + [`docs/styles.css`](docs/styles.css)
- [`docs/sw.js`](docs/sw.js) — shell-only service worker. **Audiobook bytes are never cached here.**
- [`docs/immune-cards.js`](docs/immune-cards.js) + `docs/concepts/immune/*.jpg` — original Immune concept cards (not book text), shown only for the Immune book.
- Progress: `localStorage` key `librarylisten.progress.v1` (per-book last chapter **and** a per-chapter map).
- Shelf snapshot: `librarylisten.library.v1`.
- Sort / rate: `librarylisten.shelfSort`, `librarylisten.rate`.
- IndexedDB `library-listen`: `handles` (desktop File System Access directory handle) and `offline` (copied chapter/cover blobs).
- Folder pick: `showDirectoryPicker` when present (desktop Chromium); otherwise `<input webkitdirectory>` / file list. iPhone Safari cannot keep folder permission across launches — after restart the user re-picks or plays books saved with **Save to this device**.
- Playback extras that exist only on web today: sleep timer (15/30/45/60), −30/+30, next-chapter toast, save-to-device, Immune Concepts tab.

### Native app (`LibraryListen/`)

SwiftUI, iOS 17+, Xcode 16 project, bundle id `com.jeffwu.librarylisten`, team `36V44B3RTF` (Jeff’s personal team).

- [`LibraryListenApp.swift`](LibraryListen/LibraryListenApp.swift) owns `LibrarySession` + `PlayerController`.
- [`LibraryScanner.swift`](LibraryListen/LibraryScanner.swift) walks `listen/` and, for a single `m4b`/`m4a`, loads AVFoundation chapter markers. **The web player does not do this** — a chaptered m4b is one chapter on the web.
- [`BookmarkStore.swift`](LibraryListen/BookmarkStore.swift) persists security-scoped bookmarks in UserDefaults so the folder survives relaunches (this is the native advantage over iPhone Safari).
- [`ProgressStore.swift`](LibraryListen/ProgressStore.swift) writes `Application Support/LibraryListen/progress.json`. **One slot per book** (chapter + file position), not the web’s per-chapter map.
- [`ICloudFiles.swift`](LibraryListen/ICloudFiles.swift) kicks `startDownloadingUbiquitousItem` when a file is still in the cloud.
- [`FolderPicker.swift`](LibraryListen/FolderPicker.swift) is a UIKit `UIDocumentPickerViewController` (more reliable than SwiftUI `.fileImporter` for folders).
- Playback extras that exist only on native today: in-shelf search, multi-folder bookmarks, lock-screen remote commands, bundled silent sample.

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
# syntax only — there is no test runner
node --check docs/app.js
node --check docs/immune-cards.js
node --check docs/sw.js
```

### Native (Mac + full Xcode.app)

Command Line Tools alone cannot install to a phone.

```bash
./start.sh
```

That generates silent fixtures and, on Darwin, opens `LibraryListen.xcodeproj`. In Xcode: scheme **LibraryListen**, destination a simulator or a trusted device, Signing Team = Jeff’s Apple ID, Run (⌘R). Do **not** Archive for the App Store.

CLI build (Mac only; this repo has no Linux/Swift toolchain):

```bash
xcodebuild -project LibraryListen.xcodeproj -scheme LibraryListen \
  -destination 'generic/platform=iOS Simulator' build
```

Sideload details, Device Hub, and the ~7-day personal-team profile: [INSTALL-zh.md](INSTALL-zh.md) and the install section of [SHARE-library-listen.md](SHARE-library-listen.md).

### Fixtures (native only)

```bash
bash scripts/generate-fixtures.sh
```

Needs `ffmpeg`. Writes silent mp3s + a chaptered m4b under `LibraryListen/Fixtures/`, which Xcode copies into the app bundle as the “bundled sample.” **Never replace those stubs with copyrighted Hub audio.**

## Tests (as of 2026-10-11)

There is **no test target, no `package.json`, no CI workflow, no `tests/` directory.**

Recorded on a Linux agent against `main` @ `23df173`:

| Check | Result |
| --- | --- |
| GitHub Pages live site | **Pass** — https://bigdaddy109.github.io/library-listen/ serves the onboarding + player chrome (v20 features: Sleep, 1.0×). Pages status `built`, source `main` `/docs`. |
| `node --check` on `docs/{app,immune-cards,sw}.js` | **Pass** |
| `docs/manifest.webmanifest` JSON | **Pass** |
| Service-worker asset list vs files on disk | **Pass** (cache name `library-listen-shell-v20`, query `?v=20` consistent in html/js/sw) |
| Immune concept image files vs `immune-cards.js` | **Pass** |
| `bash -n start.sh` and `scripts/generate-fixtures.sh` | **Pass** |
| `bash scripts/generate-fixtures.sh` | **Pass** — writes Munroe + Immune stubs. Also **overwrites** `AppIcon.png` (see pitfalls). Revert the icon; do not commit generated audio. |
| `xcodebuild` / `swift` | **Missing** on Linux. Native app is unbuildable and untestable in this environment. Xcode scheme TestAction is empty; `project.pbxproj` has no XCTest target. |

Do not invent a paid device farm, TestFlight, or CI service. If you add tests, keep them local (`node --test` for extracted JS helpers, or an XCTest target Jeff can run in Xcode).

## Cache-bust (web)

The PWA cache version is a hand-maintained integer. Today it is **20**. When you change `docs/index.html`, `docs/app.js`, `docs/styles.css`, `docs/immune-cards.js`, icons, or concept images, bump **all** of:

1. `?v=N` on every asset link in [`docs/index.html`](docs/index.html)
2. `import { IMMUNE_CARDS } from "./immune-cards.js?v=N"` in [`docs/app.js`](docs/app.js)
3. `const CACHE = "library-listen-shell-vN"` **and** every `?v=N` path in [`docs/sw.js`](docs/sw.js) `ASSETS`

Miss one and phones keep a stale shell. HTML navigations are network-first; other assets are cache-first.

## Pitfalls

- **`./start.sh` / `generate-fixtures.sh` rewrites `AppIcon.png`.** Confirmed: the script runs `ffmpeg` against `LibraryListen/Assets.xcassets/AppIcon.appiconset/AppIcon.png`. Restore that file before commit unless you meant to change the icon.
- **Fixtures are not in git.** Only [`LibraryListen/Fixtures/README.txt`](LibraryListen/Fixtures/README.txt) is committed. The bundled sample is empty until someone runs the generator. The committed README still says `Audio/Immune/listen/…`, which is wrong (Hub path is `Library/Immune/listen/…`).
- **Personal Hub paths ship in the native UI.** [`HubPaths.swift`](LibraryListen/HubPaths.swift) hard-codes `/Users/jeffwu/Documents/Main Hub/Personal/Daryl Stuff/Library`. [`OnboardingView.swift`](LibraryListen/OnboardingView.swift) and [`SettingsView.swift`](LibraryListen/SettingsView.swift) display those strings. [`INSTALL-zh.md`](INSTALL-zh.md) names `Main Hub / Personal / Daryl Stuff / Library`. Do not add more personal paths. Do not put secrets in the repo (`.gitignore` already blocks `.env*` and `/Library/`).
- **iPhone Safari cannot persist a folder.** Desktop Chrome/Edge can, via IndexedDB directory handles. On iOS, progress survives but playable `File` objects do not. Save-to-device (IndexedDB blobs) is the workaround. `confirm()` save prompts fire ~12s into playback — don’t add more blocking dialogs without a reason.
- **iCloud placeholders look like empty files.** The web walker skips 0-byte audio and unreadable handles instead of failing the whole scan. “Empty shelf” almost always means Download Now was not done. Native calls `ICloudFiles.ensureLocal` but still cannot play a cloud-only file.
- **Web vs native already disagree.** Web: per-chapter progress, sleep timer, save-to-device, Immune cards, no m4b chapter markers, no search. Native: one progress slot per book, search, bookmarks, m4b chapters, no sleep timer, no concept cards. Changing a rule in one client and not the other is a bug.
- **Resume is fragile on iOS Safari.** `playChapter` must not `await` before `audio.play()` or the user-gesture is dropped. There is a resume-guard against post-play snap-back. Touch it with a real iPhone, not only desktop.
- **Personal-team installs expire (~7 days).** The app will not open until Xcode runs again. Bluetooth is not an update channel.
- **No Mac Catalyst.** `SUPPORTS_MACCATALYST = NO`.
- **Linux agents cannot build the iOS app.** Record that; don’t fake an `xcodebuild` pass.

## Working rules

1. **Changes go through PRs. Never merge your own PR.** Jeff reviews and merges.
2. **Docs-only vs app changes stay separate** unless a one-line doc fix is required for the files you were asked to touch.
3. **Search the repo before assuming something is missing.** README, SHARE, INSTALL-zh, this file, and `fix_plan.md` already exist once this PR lands.
4. **No stubs.** Don’t add empty tests, placeholder functions, or “TODO implement later” files.
5. **One most-important thing at a time** (see [fix_plan.md](fix_plan.md)). Finish and verify that item before starting the next.
6. **Commit only after the checks you can run have passed.** At minimum: `node --check` on any edited JS, and do not leave generated fixture audio or a rewritten `AppIcon.png` in the commit. Native builds only on a Mac with Xcode.
7. **No paid external API calls or new paid services** without Jeff’s approval. No new cloud accounts. No App Store pipeline unless he asks.
8. **No secrets in code.** No real library paths beyond what is already there (and prefer removing those). No copyrighted audiobooks.

## Suggested first command when you open the repo

```bash
node --check docs/app.js && node --check docs/immune-cards.js && node --check docs/sw.js
```

Then read [fix_plan.md](fix_plan.md) and do only the top unchecked item.
