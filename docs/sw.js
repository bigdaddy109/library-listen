/* Shell-only cache. Audiobook files are never cached here. */
const CACHE = "library-listen-shell-v46";
const DRIVE_MEDIA_PREFIX = "/drive-media/";
const DRIVE_TOKEN_MESSAGE = "librarylisten.drive-token";
const DRIVE_UNAUTHORIZED_MESSAGE = "librarylisten.drive-unauthorized";
/** In-memory only. The page posts the GIS access token; never cached. */
let driveToken = "";

self.addEventListener("message", (event) => {
  if (event.data?.type === DRIVE_TOKEN_MESSAGE) {
    driveToken = event.data.token || "";
  }
});

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=46",
  "./app.js?v=46",
  "./library.js?v=46",
  "./drive.js?v=46",
  "./search.js?v=46",
  "./markers.js?v=46",
  "./save-prompt.js?v=46",
  "./media-session.js?v=46",
  "./epub.js?v=46",
  "./immune-cards.js?v=46",
  "./manifest.webmanifest",
  "./icon.svg?v=46",
  "./apple-touch-icon.png?v=46",
  "./classic/index.html",
  "./shelf/index.html",
  "./shelf/shelf.css?v=46",
  "./shelf/shelf.js?v=46",
  "./shelf/catalog.js?v=46",
  "./shelf/covers.js?v=46",
  "./concepts/immune/skin.jpg",
  "./concepts/immune/bacteria.jpg",
  "./concepts/immune/inflammation.jpg",
  "./concepts/immune/neutrophil.jpg",
  "./concepts/immune/macrophage.jpg",
  "./concepts/immune/complement.jpg",
  "./concepts/immune/cytokines.jpg",
  "./concepts/immune/dendritic.jpg",
  "./concepts/immune/lymph-node.jpg",
  "./concepts/immune/thymus.jpg",
  "./concepts/immune/t-cell.jpg",
  "./concepts/immune/b-cell.jpg",
  "./concepts/immune/mucosa.jpg",
  "./concepts/immune/virus.jpg",
  "./concepts/immune/interferon.jpg",
  "./concepts/immune/natural-killer.jpg",
  "./concepts/immune/mast-cell.jpg",
  "./concepts/immune/memory.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isDriveMediaUrl(url) {
  return url.origin === self.location.origin && url.pathname.includes(DRIVE_MEDIA_PREFIX);
}

function driveFileIdFromPath(pathname) {
  const at = pathname.lastIndexOf(DRIVE_MEDIA_PREFIX);
  if (at < 0) return "";
  const raw = pathname.slice(at + DRIVE_MEDIA_PREFIX.length).split("/")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function proxyDriveMedia(request, url) {
  const fileId = driveFileIdFromPath(url.pathname);
  if (!fileId) return new Response("Missing Drive file", { status: 400 });
  if (!driveToken) return new Response("Sign in with Google", { status: 401 });
  const headers = { Authorization: `Bearer ${driveToken}` };
  const range = request.headers.get("Range");
  if (range) headers.Range = range;
  /* Keep Range / Authorization / Cache-Control: no-store in lockstep with
     planDriveMediaProxy + driveMediaProxyOutHeaders in docs/drive.js. */
  const dest = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(dest, { headers });
  if (res.status === 401) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: DRIVE_UNAUTHORIZED_MESSAGE });
    }
  }
  const out = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = res.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set("Cache-Control", "no-store");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: out,
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isDriveMediaUrl(url)) {
    event.respondWith(proxyDriveMedia(request, url));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML, revalidated past the HTTP cache (Pages sends
  // max-age=600), so a new release is picked up on the next launch.
  if (request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
