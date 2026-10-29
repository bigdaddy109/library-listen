/* Shell-only cache. Audiobook files are never cached here. */
const CACHE = "library-listen-shell-v55";
const CACHE_CONCEPTS_MESSAGE = "librarylisten.cache-concepts";
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

/** Immune concept cards are not in the shell precache. The page asks for them when that book opens. */
self.addEventListener("message", (event) => {
  if (event.data?.type !== CACHE_CONCEPTS_MESSAGE) return;
  const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
  const allowed = urls.filter((url) => {
    try {
      const parsed = new URL(url, self.location.href);
      return parsed.origin === self.location.origin && parsed.pathname.includes("/concepts/immune/");
    } catch {
      return false;
    }
  });
  if (!allowed.length) return;
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(allowed)));
});

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=55",
  "./app.js?v=55",
  "./library.js?v=55",
  "./drive.js?v=55",
  "./search.js?v=55",
  "./markers.js?v=55",
  "./save-prompt.js?v=55",
  "./media-session.js?v=55",
  "./sleep.js?v=55",
  "./immune-cards.js?v=55",
  "./manifest.webmanifest",
  "./icon.svg?v=55",
  "./apple-touch-icon.png?v=55",
  "./og-image.png",
  "./classic/index.html",
  "./shelf/index.html",
  "./shelf/shelf.css?v=55",
  "./shelf/shelf.js?v=55",
  "./shelf/catalog.js?v=55",
  "./shelf/covers.js?v=55",
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

function driveMediaNameFromPath(pathname) {
  const at = String(pathname || "").lastIndexOf(DRIVE_MEDIA_PREFIX);
  if (at < 0) return "";
  const parts = String(pathname).slice(at + DRIVE_MEDIA_PREFIX.length).split("/").filter(Boolean);
  if (parts.length < 2) return "";
  const raw = parts.slice(1).join("/");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Keep in lockstep with rewriteDriveAudioContentType in docs/drive.js. */
function rewriteDriveAudioContentType(name, contentType) {
  const baseName = String(name || "");
  const dot = baseName.lastIndexOf(".");
  const ext = dot >= 0 ? baseName.slice(dot + 1).toLowerCase() : "";
  if (ext === "m4a" || ext === "m4b" || ext === "aac") return "audio/mp4";
  if (ext) return contentType || "";
  const base = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (base === "video/mp4") return "audio/mp4";
  return contentType || "";
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
  const mediaName = driveMediaNameFromPath(url.pathname);
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = res.headers.get(name);
    if (!value) continue;
    if (name === "content-type") {
      out.set(name, rewriteDriveAudioContentType(mediaName, value) || value);
    } else {
      out.set(name, value);
    }
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
