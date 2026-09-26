# Library Listen

Offline **iPhone and iPad** player for audiobooks that already live in Jeff’s Main Hub **Library** folder on iCloud Drive. SwiftUI, local files only. No TTS. No extra cloud account. The Mac does not need to be on for a commute.

## Library folder (only this tree)

On the Mac:

```
/Users/jeffwu/Documents/Main Hub/Personal/Daryl Stuff/IIS-義大國際小學/Library/
```

The app scans `listen/` under that folder (or you can pick a single collection):

```
Library/門羅-WhatIf/listen/
  what-if-1/   # chapter mp3s
  how-to/      # chapter mp3s
  what-if-2/   # single m4b

Library/Immune/listen/
  Immune-Part01.mp3 … Immune-Part09.mp3
```

Immune’s nine parts sit **directly in `Library/Immune/listen/`**. Same play / auto-advance / progress as How To.

Main Hub is already iCloud Drive. On iPhone/iPad: **Files → iCloud Drive → … → Main Hub → … → Library**. Pick that **Library** folder once. The app saves a security-scoped bookmark. There is no separate copy step.

`ebooks/` and `_source/` are ignored.

## What the app does

1. Choose the iCloud Drive **Library** folder (or add `門羅-WhatIf` / `Immune`). Bookmarks persist.
2. Scan `門羅-WhatIf/listen/` and `Immune/listen/` for mp3 / m4b / m4a.
3. Book → chapter list → play / pause / resume → auto-advance. What If 2 uses m4b chapter markers when they are readable; otherwise one item.
4. Remember per-book last chapter + position in app-local JSON.
5. Ask iCloud to download cloud-only files. For a commute: in **Files**, tap **Download Now** on `Library/` so chapters are on-device.

Thing Explainer has no audio and is not synthesized.

First-time Mac install (Traditional Chinese, includes installing Xcode.app): see **[INSTALL-zh.md](INSTALL-zh.md)**. Command Line Tools alone are not enough.

## Install and run (Xcode on Jeff’s Mac)

Needs **Xcode.app** from the Mac App Store (not only Command Line Tools) and the iOS 17 SDK.

```bash
cd /path/to/this-repo
./start.sh
```

`start.sh` regenerates silent fixture stubs and opens `LibraryListen.xcodeproj`.

In Xcode:

1. Scheme **LibraryListen**.
2. Destination: iPhone or iPad simulator, or a signed-in device (Signing & Capabilities → your Team).
3. Run (⌘R).

- **Simulator:** **Use bundled sample** (silent Munroe chapters + Immune-Part01…09).
- **Device / commute:** **Choose a Hub folder** → Files → iCloud Drive → navigate to **Library** → Open. Later, **Folders** can add `門羅-WhatIf` or `Immune` if you picked a single collection.

No App Store listing is required for v1 (Xcode run / sideload / TestFlight later).

## Offline commute

- The Mac can be asleep. Playback is from files on the phone.
- Cloud icon in Files means it is not local yet. Download on Wi‑Fi before you leave.
- Lock-screen play/pause and next/previous chapter work via Now Playing.

## Acceptance checklist

**Munroe**

- [ ] Open iCloud Drive `Library/` (or `Library/門羅-WhatIf`); app remembers it after relaunch.
- [ ] Shelf lists What If, How To, What If 2 from scanned files.
- [ ] What If and How To: full sorted chapter lists; tap any chapter.
- [ ] What If 2: play the m4b; pause/resume; chapter markers if present, else one item.
- [ ] Multi-file books auto-advance; progress ±2s survives relaunch.

**Immune**

- [ ] Same `Library/` pick also shows Immune as one book from `Library/Immune/listen/`.
- [ ] Nine parts (`Immune-Part01` … `Part09`) listed, playable, auto-advance, progress saved.
- [ ] No TTS.

**Shared**

- [ ] Works on iPhone; usable on iPad.
- [ ] Git contains only silent fixture audio.

## Fixtures

`LibraryListen/Fixtures/` is a **Library-shaped** tree (silent files only):

```bash
bash scripts/generate-fixtures.sh
```
