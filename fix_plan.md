# Library Listen — fix plan

Prioritized backlog from a full read of `main` @ `23df173` plus the checks in [AGENTS.md](AGENTS.md). Grounded in what is in the tree and what actually ran. Not a wishlist.

**Ralph method for this repo:** search before assuming missing · no stubs · one most-important thing at a time · commit only after the checks you can run have passed · PR only, never self-merge · no paid APIs or new paid services.

Work **Now** first. Do not start item 2 until item 1 is merged and verified.

---

## Now — 1. First automated tests for scan + title + progress (web)

**Found:** There is no test runner, no XCTest target, no CI, no `package.json`. Library rules are duplicated in [`docs/app.js`](docs/app.js) (`buildLibrary`, `locateBookPath`, `titleFromFilename`, `saveProgress` / `chapterProgress` / `resumeSeconds`) and in Swift (`LibraryScanner`, `HubPaths.titleFromFilename`, `ProgressStore`). Recent regressions this repo already paid for: empty shelf mid-scan, resume snap-back, stale onboarding, single-slot progress wiping other chapters.

**Why this first:** Every later item (m4b chapters, progress alignment, new collections) will break silently without a fixture. The web helpers are plain functions and can be tested with Node’s built-in runner. No new paid service.

**Do**

- Extract (or export) the pure helpers from `docs/app.js` so `node --test` can import them. Keep behavior identical.
- Cover, with silent in-memory `File` stubs only:
  - `listen/` layout: collection subfolders vs Immune-style files sitting in `listen/`
  - skip `ebooks/`, `_source/`, `_…`, 0-byte / unreadable audio
  - `titleFromFilename` (`Part 01`, stripped leading `01 - `)
  - progress: per-chapter map kept when switching chapters; resume-at-end-of-chapter restarts at 0
  - `locateBookPath` for `Library/…/listen/book/file`, `listen/` files, and a short collection pick
- Add the commands to AGENTS.md once they exist.
- Leave Swift tests for a later item unless you are already on a Mac with Xcode.

**Verify**

```bash
node --test
node --check docs/app.js
```

Do not commit copyrighted audio. Do not add Jest/Vitest/CI-as-a-service.

**Done when:** `node --test` fails if someone breaks Immune-as-one-book, Munroe-as-subfolders, or per-chapter progress.

---

## 2. Stop shipping Jeff’s personal Hub paths in the native UI

**Found:** [`HubPaths.swift`](LibraryListen/HubPaths.swift) hard-codes `/Users/jeffwu/Documents/Main Hub/Personal/Daryl Stuff/Library` (and the two `listen/` children). [`OnboardingView.swift`](LibraryListen/OnboardingView.swift) prints those paths and tells the user to open `Main Hub → … → Daryl Stuff → Library`. [`SettingsView.swift`](LibraryListen/SettingsView.swift) has a “Verified Mac Hub paths” section with the same strings. [`INSTALL-zh.md`](INSTALL-zh.md) names that folder.

The iPhone never reads those Mac paths (`HubPaths` says so). Showing them on-device is noise and leaks a personal directory tree to anyone who sideloads the app.

**Do:** Keep collection *names* (`門羅-WhatIf`, `Immune`) and known-book metadata. Replace displayed Mac paths with the same instructions the web player uses (Files → iCloud Drive → shared `Library` → Download Now). Move any remaining Mac-only notes into SHARE/INSTALL, or drop them.

**Verify:** Onboarding and Folders screens have no `/Users/jeffwu` and no `Daryl Stuff`. Simulator “bundled sample” still works. This is a native change — needs Xcode on a Mac; Linux agents cannot screenshot it.

---

## 3. Align progress: native is still one slot per book

**Found:** Web (`librarylisten.progress.v1`, PR #4) stores a per-chapter map so Part 3 is not wiped when you play Part 2. Native [`ProgressStore`](LibraryListen/ProgressStore.swift) still writes a single `ProgressRecord` per `bookId`. [SHARE-library-listen.md](SHARE-library-listen.md) documents the native shape.

**Do:** Give native the same per-chapter map (keep the last-played pointer for Continue). Read old `progress.json` files that lack the map. Do not invent a cloud sync. Progress stays on-device in both clients.

**Verify:** Play chapter 2, then chapter 1, kill the app, reopen: both positions remain. Continue still opens the latest chapter. Existing `progress.json` without `chapters` still loads.

---

## 4. Make the PWA cache-bust mechanical

**Found:** Shell cache is `library-listen-shell-v20`. The integer `20` is copied through `index.html` query strings, `app.js`’s `immune-cards.js?v=20` import, and every `ASSETS` entry in `sw.js`. One missed bump leaves phones on a stale shell (cache-first for JS/CSS). There is no check for this today; a static script during the 2026-10-11 health pass confirmed they currently match.

**Do:** One constant or a tiny Node check that fails if the versions diverge. Optionally add a GitHub Actions workflow that only runs `node --check` + that assertion on PR (free for a public repo; do not add a paid CI product).

**Verify:** Change one `?v=` and the check fails. Bump once and all three files agree.

---

## 5. `generate-fixtures.sh` must not overwrite the app icon

**Found:** Running `bash scripts/generate-fixtures.sh` on 2026-10-11 succeeded and produced the Munroe + Immune stubs, and also modified `LibraryListen/Assets.xcassets/AppIcon.appiconset/AppIcon.png`. `./start.sh` always runs that script. Easy to commit a solid-color ffmpeg icon by accident.

**Do:** Stop writing the icon, or write it only when the icon is missing. Keep silent audio generation. Fix [`LibraryListen/Fixtures/README.txt`](LibraryListen/Fixtures/README.txt) (`Audio/Immune/listen/…` is wrong; Hub layout is `Library/Immune/listen/…`).

**Verify:** Run the script, `git status` shows no `AppIcon.png` change. README matches the tree the script writes.

---

## Later (do not start while 1–5 are open)

These are real, but they are not the next PR.

- **Web does not read m4b chapter markers.** Native `LibraryScanner.loadAudiobookChapters` does (What If 2 fixture is a 3-chapter m4b). On the web that file is one chapter. If web gains markers, reuse the test fixtures from item 1; do not copy Hub m4b files into git.
- **Feature drift, web ↔ native.** Web-only: sleep timer, save-to-device, Immune Concepts, next-chapter toast, −30/+30. Native-only: shelf search, multi-folder bookmarks, AVFoundation Now Playing, bundled sample. Port the one Jeff actually misses; don’t “parity” everything in one PR. Sleep timer on native is the obvious commute feature if he uses the iOS app. Search on web is the obvious feature if he uses Pages.
- **`PlayerController.skipChapter` always autoplays.** Native line is `autoplay: isPlaying || true` — the `|| true` makes the paused-skip case start playback. SHARE says opening the current chapter should resume if paused, not restart; skip of another chapter should follow the current play/pause state. Confirm on device, then delete `|| true` if it is accidental.
- **Aggressive save `confirm()` on web.** `maybeOfferSaveWhileListening` fires ~12s into a book. Fine for iPhone folder loss; noisy on desktop where the directory handle already persists. Gate it to “no directory handle / not offline.”
- **Hardcoded known books only.** New folders get `humanize(folder)` titles. That’s OK. Adding a book means editing both `KNOWN_BOOKS` tables. A later optional `folder.jpg` + filename is enough; do not add a metadata service.
- **Empty-library copy mentions `上學不容易`.** [`docs/app.js`](docs/app.js) `emptyLibraryMessage` lists that collection; it is not in `KNOWN_COLLECTIONS`. Either add it when that folder exists, or drop the name so the alert matches the two collections the app knows.
- **No native CI.** Acceptable: this is a personal-team sideload app. Do not buy a Mac cloud builder. When Swift tests exist, Jeff runs them in Xcode.

## Out of scope (do not do)

- App Store / TestFlight / paid Apple programs unless Jeff asks.
- TTS, uploading books, a second cloud, or any paid speech/storage API.
- Committing copyrighted Hub audio or real `/Users/jeffwu/…` library files.
- Merging your own PR.
- Rewriting the web player into a bundler/framework “to make it testable.” Extract functions; don’t start a new app.
- “Fixing” iPhone Safari’s inability to persist a folder. That’s a platform limit; save-to-device is the supported path.
