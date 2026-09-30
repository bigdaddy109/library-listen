# Library Listen

Offline audiobook player for files that already live in a shared **iCloud Drive Library** folder. Local files only. No TTS. No upload of your books.

## Web player (any device with a link)

**Live:** https://bigdaddy109.github.io/library-listen/

Share that URL. Each listener:

1. Accepts your **iCloud** share of `Library` (or `門羅-WhatIf` / `Immune`).
2. In **Files**, taps **Download Now** on `listen/` so chapters are on-device.
3. Opens the link → **Choose Library folder** (desktop Chrome) or **Choose audio files** (iPhone Safari) → play.

Progress and the shelf are stored in that browser. After the page or home-screen app restarts:

- **Desktop Chrome/Edge** remembers the folder and reconnects on its own (or after one permission tap).
- **iPhone/iPad** cannot keep folder access. Open a book and tap **Save to this device** to keep a copy in the browser's storage; saved books play after a restart without picking the folder again. Other books show **reconnect to play** until you pick the folder again.

Source: [`docs/`](docs/) (GitHub Pages from `/docs` on `main`).

## Library folder layout

On the Mac (example Hub path):

```
…/Library/
  門羅-WhatIf/listen/
    what-if-1/   # chapter mp3s
    how-to/      # chapter mp3s
    what-if-2/   # single m4b
  Immune/listen/
    Immune-Part01.mp3 … Immune-Part09.mp3
```

`ebooks/` and `_source/` are ignored.

## How to share audio (iCloud)

1. On Mac: share `Library` (or a single collection) via iCloud to the listener’s Apple ID.
2. Listener: **Files → Shared** → open folder → **Download Now** on `listen/`.
3. Open the web player link and pick that folder / those files.

## Native iOS app (optional)

SwiftUI app in this repo for sideload via Xcode. Bookmarks persist across launches. See **[INSTALL-zh.md](INSTALL-zh.md)**.

```bash
./start.sh
```

## What the player does

- Shelf of books from scanned `listen/` trees
- Chapter list, play / pause / resume, auto-advance
- Cover images when present next to the audio
- Per-book progress (chapter + position)
- Media Session lock-screen controls in supporting browsers

Thing Explainer has no audio and is not synthesized.

## Fixtures (native app only)

Silent stubs only — never commit copyrighted Hub audio:

```bash
bash scripts/generate-fixtures.sh
```

## Method notes

See **[SHARE-library-listen.md](SHARE-library-listen.md)** for a shareable description without personal paths.
