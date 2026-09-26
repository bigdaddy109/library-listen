# Library Listen method

Shareable notes for building or using an offline iPhone audiobook player the same way. This describes the method only. It does not include anyone’s book titles, folder paths, or devices.

The player is a SwiftUI iOS app. The audiobooks stay in an iCloud Drive folder the owner already has. The app does not copy the library, does not use a second cloud account, and does not synthesize speech.

## Library layout

Put books in iCloud Drive. On the iPhone they show up in Files → iCloud Drive. The app scans a `listen` folder. `ebooks/` and anything whose name starts with `_` (including `_source/`) are ignored.

Two shapes work:

```text
Library/
  Some Collection/
    listen/
      Book One/          # one file per chapter: mp3, m4a, or m4b
        01.mp3
        02.mp3
      Book Two/
        book.m4b         # one file; chapter markers if the file has them
  Another Collection/
    listen/
      Part01.mp3         # audio files sitting directly in listen/ = one book
      Part02.mp3
```

Accepted audio extensions: `mp3`, `m4a`, `m4b`, `aac`.

Pick the Library folder once inside the app (or pick a single collection). The app stores a security-scoped bookmark and remembers it. There is no import step.

Before a trip, open Files and Download Now on that folder. A cloud icon means the file is not on the phone yet. After the files are local, the Mac can be asleep. Playback does not need the Mac.

## What the app remembers

Listening progress stays on the phone, in Application Support, as `progress.json`. It is not written back into the iCloud library.

Each saved row has:

- book id
- chapter id
- position in the file, in seconds
- optional chapter length in seconds (older files simply omit this)
- updated time

For a multi-chapter m4b, the shelf shows time inside the current chapter (`file position − chapter start`), not the time from the start of the whole file. Chapter length uses the saved length first, then `chapter end − chapter start`, then the chapter’s own duration. If the length is still unknown, show the time and do not draw a progress bar.

Do not rename audio files to invent chapter titles. Do not add a sidecar such as `chapters.json`.

## Playback behavior worth keeping

- Continue resumes from the saved file position.
- Opening the saved chapter also resumes from that position.
- Opening any other chapter starts at that chapter’s start.
- If that chapter is the one already loaded, do not restart it. If it is paused, resume.
- Shelf line when there is progress: `Chapter name · 12:34 / 1:02:58 · yesterday`.
- The book that is playing right now uses the live clock and does not append a relative time.
- Relative times: `just now`, `Nm ago`, `Nh ago`, `yesterday`, `Nd ago`.
- Never played: `Not started`.

Search compares title, author, collection, subtitle, folder name, and chapter title with `localizedStandardContains`. Show at most two matching chapter names, then `· +N`. Sort choices: Collection (default, grouped, books by title), Title, Author, Recent. Store the choice in AppStorage under `librarylisten.shelfSort`.

## Install onto a phone

This does not go through the App Store.

1. Install the full Xcode app. Command Line Tools alone cannot run the app on a phone.
2. Open the Xcode project. Scheme is the app. Destination is the iPhone.
3. Signing & Capabilities: Automatically manage signing, Team = the Apple ID. If the bundle id conflicts, change it.
4. On the iPhone, if iOS says the developer is untrusted: Settings → General → VPN & Device Management → trust that Apple ID.
5. Developer Mode must be on: Settings → Privacy & Security → Developer Mode.
6. Run. The first personal-team provisioning profile lasts about 7 days. When it expires the app will not open until it is installed again.

Xcode 27 does not have Window → Devices and Simulators, and it does not have a “Connect via network” checkbox. Devices are managed in Device Hub:

- Xcode menu → Open Developer Tool → Device Hub
- or the run-destination menu → Manage Devices…

Plug the phone in once and trust the computer. After that, the same Wi-Fi is enough. Device Hub shows the phone’s screen when the connection is live. It does not show a globe icon. The phone must be unlocked to install or launch. The Mac has to be awake for an install. It does not have to be awake for listening.

Bluetooth is not an update channel. The phone will not pull a new build by itself.

## What not to copy this pattern onto

This works for files the phone only reads, such as audio that already lives in iCloud Drive. It is a poor fit for a database the Mac is still writing. iCloud syncs each file separately. A live SQLite database plus its `-wal` and `-shm` files can arrive out of order and corrupt the original. For that kind of data, keep the Mac as the only writer and publish a read-only snapshot for the phone.
