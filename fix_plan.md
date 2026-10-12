# Library Listen — fix plan

Prioritized backlog from a full read of `main` @ `23df173` plus the checks in [AGENTS.md](AGENTS.md). Grounded in what is in the tree and what actually ran. Not a wishlist.

**iOS / native is paused.** The SwiftUI app in `LibraryListen/` stays in the repo but is **not active work**. Do not open PRs for native UI, native progress, Xcode fixtures, or sideload/install docs unless Jeff un-pauses it. The live product is the web player.

**Ralph method for this repo:** search before assuming missing · no stubs · one most-important thing at a time · commit only after the checks you can run have passed · PR only, never self-merge · no paid APIs or new paid services.

Items 1–2 below shipped. Further web work is one small PR at a time. Do not merge [shelf preview #21](https://github.com/bigdaddy109/library-listen/pull/21) or reinvent Drive from leftover-backlog work.

---

## Done — 1. First automated tests for scan + title + progress (web)

**Shipped:** [PR #12](https://github.com/bigdaddy109/library-listen/pull/12). Pure helpers live in [`docs/library.js`](docs/library.js); `node --test` covers Immune-as-one-book, Munroe-as-subfolders, skips, titles, and per-chapter progress.

---

## Done — 2. Make the PWA cache-bust mechanical

**Shipped:** [PR #13](https://github.com/bigdaddy109/library-listen/pull/13). `test/pwa-cache.test.mjs` fails if CACHE / `?v=` / ASSETS drift. No GitHub Actions — keep it local.

---

## Now — leftover small web items

Ship these one PR at a time. Do not start a Drive walker, PDF reader, or native work from this list. The rice-paper shelf is now the homepage; `/classic/` is the previous dark player.

- **Empty-library copy + in-page status.** **Shipped** — `emptyLibraryMessage` lives in [`docs/library.js`](docs/library.js) and lists only `KNOWN_COLLECTIONS`. An empty or failed local scan writes `#library-status` instead of `alert()`.

---

## Later — web-player improvements

These shipped after 1–2 (do not re-do them):

- **Shelf search on the web.** [PR #14](https://github.com/bigdaddy109/library-listen/pull/14) — [`docs/search.js`](docs/search.js).
- **Web reads m4b chapter markers.** [PR #15](https://github.com/bigdaddy109/library-listen/pull/15) — [`docs/markers.js`](docs/markers.js). Silent fixtures only; do not copy Hub m4b files.
- **Save `confirm()` gated.** [PR #16](https://github.com/bigdaddy109/library-listen/pull/16) — [`docs/save-prompt.js`](docs/save-prompt.js). Phones without a folder handle only.
- **EPUB Read tab + pairing badges.** [PR #17](https://github.com/bigdaddy109/library-listen/pull/17)–[#20](https://github.com/bigdaddy109/library-listen/pull/20). PDF still later.
- **Google Drive library source.** [PR #22](https://github.com/bigdaddy109/library-listen/pull/22)–[#23](https://github.com/bigdaddy109/library-listen/pull/23), hardened in [#25](https://github.com/bigdaddy109/library-listen/pull/25). Do not reinvent the walker or replace the OAuth client.

Still later (optional):

- **Hardcoded known books only.** New folders get `humanize(folder)` titles. That’s OK. Adding a book means editing `KNOWN_BOOKS` / `KNOWN_COLLECTIONS` in [`docs/library.js`](docs/library.js). A later optional `folder.jpg` + filename is enough; do not add a metadata service. Do not also edit the paused Swift tables unless Jeff un-pauses native.
- **Rice-paper homepage.** Shipped as the `/shelf/` preview in [PR #21](https://github.com/bigdaddy109/library-listen/pull/21), then moved to the root Pages URL. Old player remains at `/classic/`.
- **PDF reader.** Jeff said later. EPUB MVP is live.

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
