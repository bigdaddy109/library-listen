# Library Listen

Offline audiobook player for a shared **Library** folder on **Google Drive** (sign in, read-only). No local folder picker. No link to Library Read. No TTS. No upload of your books. No paid APIs.

## Web player (any device with a link)

**Live:** https://bigdaddy109.github.io/library-listen/

Share that URL. Each listener (Jeff, Kerry, Daryl):

1. Accepts Jeff’s **Google Drive** share of the folder named `Library` (same `listen/` + `ebooks/` layout).
2. Opens the link → **Sign in with Google** with *their own* Google account → the player finds `Library` in Drive / Shared with me.
3. Plays from the shelf. Audio streams from Drive.

Progress and the shelf are stored in that browser (`librarylisten.*` keys only). After the page or home-screen app restarts:

- **Google Drive:** sign-in can reconnect without re-downloading the folder. The OAuth token is kept in memory (and the service worker) only — not in `localStorage`.
- If Drive is not signed in, the next open goes back to the start screen (progress is kept). **Save to this device** still copies a book’s chapter bytes for offline play. It is not a second library.
- Shelf shows **Continue listening** for the last chapter with progress.
- Player **Sleep** cycles 15 / 30 / 45 / 60 minutes, then pauses.
- Chapter changes briefly show a **Next:** toast.

Source: [`docs/`](docs/) (GitHub Pages from `/docs` on `main`). The homepage is the rice-paper shelf; the previous dark player stays at [`docs/classic/`](docs/classic/). Drive helpers live in [`docs/drive.js`](docs/drive.js).

## Google Cloud setup (Drive + GIS)

The Client ID is **public browser config**, not a secret. Keep the repo placeholder until you paste yours. Never commit a client secret (this app does not use one).

Do this once in [Google Cloud Console](https://console.cloud.google.com/):

1. Create or pick a project (e.g. `library-listen`).
2. **APIs & Services → Library** — enable:
   - **Google Drive API** (list + `alt=media` stream / download)
   - **Google Picker API** (optional folder picker; needs the browser API key below)
   - **Google Identity / GIS** is the OAuth consent + Identity Services script, not a separate paid API
3. **APIs & Services → OAuth consent screen**
   - User type: External (or Internal if everyone is on one Workspace)
   - App name: `Library Listen`
   - Scopes: only `https://www.googleapis.com/auth/drive.readonly`
   - Test users while the app is in Testing: Jeff, Kerry, Daryl Google accounts
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `library-listen-web`
   - **Authorized JavaScript origins** (host only — no path, no trailing slash):
     - `https://bigdaddy109.github.io`
   - `/library-listen` is the player path on that origin, not a second origin. For local preview also add:
     - `http://127.0.0.1:8080`
     - `http://localhost:8080`
   - Redirect URIs: not needed for the GIS token client (`initTokenClient`).
5. Copy the **Client ID** only (`….apps.googleusercontent.com`). Paste it over the placeholder in [`docs/drive.js`](docs/drive.js):

   ```js
   export const GOOGLE_OAUTH_CLIENT_ID =
     "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com";
   ```

6. Optional — **Credentials → Create credentials → API key**, restrict it to HTTP referrers (`https://bigdaddy109.github.io/*`) and the Picker API. Paste it over `YOUR_GOOGLE_PICKER_API_KEY` in `docs/drive.js` so **Browse Google Drive** opens the official Picker. Without it, the player still lists folders named `Library` (My Drive + Shared with me).
7. Jeff shares the Drive folder named `Library` with Kerry and Daryl (Viewer is enough). They sign in with their own accounts; the walker looks in Shared with me.

After you paste a real Client ID, bump the PWA cache version once (see AGENTS.md) so phones pick up `drive.js`.

## Local preview

Sign-in uses the GIS popup. Chrome blocks `window.closed` on that popup unless the player page is served with:

`Cross-Origin-Opener-Policy: same-origin-allow-popups`

`python3 -m http.server` does not send that header. The Google window can open, consent can be granted, and the page still never receives a token (status stays “Scanning the Drive Library…”).

From the repo root:

```bash
node scripts/preview.mjs
```

Then open either authorized origin:

- `http://127.0.0.1:8080/`
- `http://localhost:8080/`

The script serves `docs/` on port 8080 and sends that COOP header on every response. On `localhost` and `127.0.0.1` the sign-in button does not open the GIS popup. It redirects to Google (`response_type=token`) and reads `#access_token` when the browser returns. `https://bigdaddy109.github.io` stays on the popup. The sign-in button shows `vN · localhost` or `vN · live`.

This repo’s setup says redirect URIs are not required for `initTokenClient`. Local sign-in no longer uses that client. It redirects to Google with `response_type=token` and `redirect_uri` set to the current origin plus `/`. I cannot see the Cloud console. Those redirect URIs are not the same as JavaScript origins. Add these Authorized redirect URIs or the return is rejected:

- `http://127.0.0.1:8080/`
- `http://localhost:8080/`

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

`_source/` and names starting with `_` are skipped. Sibling `ebooks/` folders pair an EPUB to the listen book (PDF is ignored).

## How to share audio

Share the Drive folder named `Library` with the listener’s Google account (Viewer). They open the player and tap **Sign in with Google**.

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
