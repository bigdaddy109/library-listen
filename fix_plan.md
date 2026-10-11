# Library Listen — fix plan

Prioritized backlog from a full read of `main` @ `23df173` plus the checks in [AGENTS.md](AGENTS.md). Grounded in what is in the tree and what actually ran. Not a wishlist.

**iOS / native is paused.** The SwiftUI app in `LibraryListen/` stays in the repo but is **not active work**. Do not open PRs for native UI, native progress, Xcode fixtures, or sideload/install docs unless Jeff un-pauses it. The live product is the web player.

**Ralph method for this repo:** search before assuming missing · no stubs · one most-important thing at a time · commit only after the checks you can run have passed · PR only, never self-merge · no paid APIs or new paid services.

Work **Now** first. Do not start item 2 until item 1 is merged and verified.

---

## Now — 1. First automated tests for scan + title + progress (web)

**Found:** There is no test runner, no CI, no `package.json`. The rules that matter for the live player live in [`docs/app.js`](docs/app.js): `buildLibrary`, `locateBookPath`, `titleFromFilename`, `saveProgress` / `chapterProgress` / `resumeSeconds`. Recent web regressions this repo already paid for: empty shelf mid-scan, resume snap-back, stale onboarding, single-slot progress wiping other chapters (fixed on web in PR #4).

**Why this first:** Every later web item (m4b chapters, new collections, progress tweaks) will break silently without a fixture. The helpers are plain functions and can be tested with Node’s built-in runner. No new paid service.

**Do**

- Extract (or export) the pure helpers from `docs/app.js` so `node --test` can import them. Keep behavior identical.
- Cover, with silent in-memory `File` stubs only:
  - `listen/` layout: collection subfolders vs Immune-style files sitting in `listen/`
  - skip `ebooks/`, `_source/`, `_…`, 0-byte / unreadable audio
  - `titleFromFilename` (`Part 01`, stripped leading `01 - `)
  - progress: per-chapter map kept when switching chapters; resume-at-end-of-chapter restarts at 0
  - `locateBookPath` for `Library/…/listen/book/file`, `listen/` files, and a short collection pick
- Add the commands to AGENTS.md once they exist.

**Verify**

```bash
node --test
node --check docs/app.js
```

Do not commit copyrighted audio. Do not add Jest/Vitest/CI-as-a-service. Do not add an XCTest target (native is paused).

**Done when:** `node --test` fails if someone breaks Immune-as-one-book, Munroe-as-subfolders, or per-chapter progress.

---

## 2. Make the PWA cache-bust mechanical

**Found:** Shell cache is `library-listen-shell-v20`. The integer `20` is copied through `index.html` query strings, `app.js`’s `immune-cards.js?v=20` import, and every `ASSETS` entry in `sw.js`. One missed bump leaves phones on a stale shell (cache-first for JS/CSS). There is no check for this today; a static script during the 2026-10-11 health pass confirmed they currently match.

**Do:** One constant or a tiny Node check that fails if the versions diverge. Optionally add a GitHub Actions workflow that only runs `node --check` + that assertion on PR (free for a public repo; do not add a paid CI product).

**Verify:** Change one `?v=` and the check fails. Bump once and all three files agree.

---

## Later — web-player improvements (do not start while 1–2 are open)

These are real and web-only. They are not the next PR.

- **Shelf search on the web.** [`docs/app.js`](docs/app.js) can cycle sort (collection / title / author / recent) but has no query box. Title, author, collection, subtitle, folder, and chapter title are the fields the native shelf already searched — port that filter to the Pages player, at most two matching chapter names then `· +N`.
- **Web does not read m4b chapter markers.** A chaptered m4b (What If 2 is this shape on the Hub) is one chapter in `buildLibrary`. If web gains markers, reuse the in-memory fixtures from item 1; do not copy Hub m4b files into git. Do not start this by reviving the native scanner.
- **Aggressive save `confirm()`.** `maybeOfferSaveWhileListening` fires ~12s into a book. Useful on iPhone Safari, where folder permission does not survive a restart. Noisy on desktop, where the directory handle already persists. Gate it to “no directory handle / not offline.”
- **Hardcoded known books only.** New folders get `humanize(folder)` titles. That’s OK. Adding a book means editing `KNOWN_BOOKS` / `KNOWN_COLLECTIONS` in [`docs/app.js`](docs/app.js). A later optional `folder.jpg` + filename is enough; do not add a metadata service. Do not also edit the paused Swift tables unless Jeff un-pauses native.
- **Empty-library copy mentions `上學不容易`.** [`docs/app.js`](docs/app.js) `emptyLibraryMessage` lists that collection; it is not in `KNOWN_COLLECTIONS`. Either add it when that folder exists, or drop the name so the alert matches the two collections the player knows.

## Dropped while native is paused

Left here so they are not “rediscovered” as missing. Do not pick these up.

- Personal Hub paths in the native onboarding/settings UI (`HubPaths.swift`, `OnboardingView.swift`, `SettingsView.swift`).
- Native `ProgressStore` is still one slot per book; web already has a per-chapter map.
- `generate-fixtures.sh` overwrites `AppIcon.png` (native bundled-sample pipeline only).
- Native `PlayerController.skipChapter` (`autoplay: isPlaying || true`).
- Native CI / XCTest / Xcode fixture README path typo (`Audio/Immune/listen/`).

## Out of scope (do not do)

- Any native iOS/Xcode work until Jeff un-pauses it (including App Store / TestFlight).
- TTS, uploading books, a second cloud, or any paid speech/storage API.
- Committing copyrighted Hub audio or real `/Users/jeffwu/…` library files.
- Merging your own PR.
- Rewriting the web player into a bundler/framework “to make it testable.” Extract functions; don’t start a new app.
- “Fixing” iPhone Safari’s inability to persist a folder. That’s a platform limit; save-to-device is the supported path.
