# Acceptance — do not merge or report live until all boxes are done

From v40 on, a shelf / playback / pairing change is **not** done when books merely appear. Jeff’s Drive Library has four series. Each series has `listen/` audio **and** `ebooks/` EPUB. Listen plays the audio. It does not link to Library Read, and it does not offer a local folder.

Live: https://bigdaddy109.github.io/library-listen/  
Classic (must stay the dark player): https://bigdaddy109.github.io/library-listen/classic/

Do **not** merge, and do **not** write a live-pass report, unless every item below is checked. Screenshots for this release live in the verify doc named in the task (this time `docs/pages-verify-listen-pairing.md` in the Project store).

## 1. Multi-series fixture = Jeff Drive Library

Build or inject a library where **each** series has `listen/` audio **and** `ebooks/` EPUB:

| Series | `listen/` | `ebooks/` |
| --- | --- | --- |
| 上學不容易 | required | required |
| 門羅-WhatIf | required | required |
| Immune | required | required |
| Thing Explainer | required | required |

Use `test/acceptance-fixture.mjs` (`jeffDriveLibraryEntries`) or a real Drive reload. Playwright lives in `e2e/` (`acceptance.playwright.mjs`, `stale-shell.playwright.mjs`, shared `fixtures.mjs`, test server `server.mjs`). Silent / in-memory files only — no Hub audio in the repo.

- [ ] Every series is on the shelf (the fixture shelf is 9 cover cards)
- [ ] Every book with `listen/` audio shows **Audio**. There is no Read link and no local-folder control
- [ ] Drive stubs without a saved Blob still count as playable (`driveId` / `/drive-media/` stream)

## 2. Press Play on every series

For **each** of the four series, on at least one book:

- [ ] Tap the cover
- [ ] `audio.currentTime` advances (not just a disabled button or “reconnect” toast)
- [ ] No Library Read link and no “Use a local folder instead” control

Immune-only playback is a **fail**.

## 3. WebKit iPhone UA 390px **and** Chromium desktop

Including a **stale service worker / localStorage** pass (old `library-listen-shell-vN`, leftover 2-book snapshot).

- [ ] Chromium desktop: shelf + play
- [ ] WebKit / iPhone UA at **390px**: same
- [ ] Stale SW or stale `librarylisten.library.v1`: new shell loads; other series still play after Drive stream restore (Reload only if the snapshot has no `driveId`s)

## 4. Screenshots in the verify doc

Every box above has a screenshot (or a short clip) linked from the verify doc. A single shelf still is not enough.

- [ ] Shelf with all four series
- [ ] Play on a **non-Immune** book (`currentTime` / player bar)
- [ ] 390px iPhone UA
- [ ] Chromium desktop
- [ ] Stale SW / cache note

## Commands

```bash
node --check docs/app.js && node --check docs/drive.js && node --check docs/immune-cards.js && node --check docs/sw.js
node --test
npx playwright test
```

GitHub Actions runs `node --test` plus Playwright on every push and PR, in three projects: **Chromium desktop**, real **WebKit at iPhone 390×844**, and Chromium with the iPhone UA at 390. Per project it automates sections 1–3:

- every series on the shelf (9 cover cards), Audio badges, no local-folder control, no Library Read link (Drive `driveId` stubs, no saved audio Blob, `/drive-media/` stream);
- for **each** of the four series: tap cover → book opens → `audio.currentTime` advances;
- leftover 2-book `librarylisten.library.v1` → full shelf;
- **old shell upgrade on launch**: `e2e/server.mjs` serves the previous release (`library-listen-shell-v(N-1)`, `?v=N-1`) after `GET /__test/shell/old`; the test installs that service worker and cache plus a 2-book snapshot, switches the server back, and requires the cache to become only `vN`, the app to load `?v=N`, and the full shelf to return. In Chromium it also plays through the SW `/drive-media/` proxy (WebKit can't stub requests made by a service worker);
- **old shell upgrade on return to foreground** (Chromium desktop, WebKit 390): a page left open on `v(N-1)` with a chapter playing does **not** reload when it comes back to the foreground; after pause it reloads into `vN` (header, cache, `?v=`);
- cover-wall open/close motion (transform/opacity only), reduced motion, `/classic/`.

A green CI run is required but does **not** replace section 4: after merge, run the checklist on the live site and attach live screenshots.

## Out of scope for this checklist

- iPhone 3D pull-out (separate worker / PR)
- Classic player redesign (`/classic/` stays)
- Native iOS
- Paid CI / device farm
