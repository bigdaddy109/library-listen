# Acceptance — do not merge or report live until all boxes are done

From v40 on, a shelf / playback / pairing change is **not** done when books merely appear. Jeff’s Drive Library has four series. Each series has `listen/` audio **and** `ebooks/` EPUB. A book that only shows Read is a fail if `listen/` audio exists.

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

Use `test/acceptance-fixture.mjs` (`jeffDriveLibraryEntries`) or a real Drive reload. Playwright lives in `e2e/acceptance.playwright.mjs`. Silent / in-memory files only — no Hub audio in the repo.

- [ ] Every series is on the shelf
- [ ] Every book with `listen/` audio is **Both** or **Audio**, never Read-only
- [ ] Drive stubs without a saved Blob still count as playable (`driveId` / `/drive-media/` stream)

## 2. Press Play and open Read on every series

For **each** of the four series, on at least one book:

- [ ] Tap 聽 / Play
- [ ] `audio.currentTime` advances (not just a disabled button or “reconnect” toast)
- [ ] Open 讀 / Read and the EPUB renders

Immune-only playback is a **fail**.

## 3. WebKit iPhone UA 390px **and** Chromium desktop

Including a **stale service worker / localStorage** pass (old `library-listen-shell-vN`, leftover 2-book snapshot).

- [ ] Chromium desktop: shelf + play + read
- [ ] WebKit / iPhone UA at **390px**: same
- [ ] Stale SW or stale `librarylisten.library.v1`: new shell loads; other series still play after Drive stream restore (Reload only if the snapshot has no `driveId`s)

## 4. Screenshots in the verify doc

Every box above has a screenshot (or a short clip) linked from the verify doc. A single shelf still is not enough.

- [ ] Shelf with all four series
- [ ] Play on a **non-Immune** book (`currentTime` / player bar)
- [ ] Read / EPUB on a non-Immune book
- [ ] 390px iPhone UA
- [ ] Chromium desktop
- [ ] Stale SW / cache note

## Commands

```bash
node --check docs/app.js && node --check docs/drive.js && node --check docs/immune-cards.js && node --check docs/sw.js
node --test
npx playwright test
```

Playwright covers the Jeff fixture (Drive `driveId` stubs, no saved Blob, `/drive-media/` stream) in Chromium. GitHub Actions runs `node --test` plus Playwright. That does **not** replace the 390px iPhone-UA + screenshot pass.

## Out of scope for this checklist

- iPhone 3D pull-out (separate worker / PR)
- Classic player redesign (`/classic/` stays)
- Native iOS
- Paid CI / device farm
