/* Shell-only cache. Audiobook files are never cached here. */
const CACHE = "library-listen-shell-v62";
const CACHE_CONCEPTS_MESSAGE = "librarylisten.cache-concepts";
const DRIVE_MEDIA_PREFIX = "/drive-media/";
const DRIVE_TOKEN_MESSAGE = "librarylisten.drive-token";
const DRIVE_UNAUTHORIZED_MESSAGE = "librarylisten.drive-unauthorized";
const DRIVE_MEDIA_ERROR_MESSAGE = "librarylisten.drive-media-error";
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
  "./styles.css?v=62",
  "./app.js?v=62",
  "./library.js?v=62",
  "./drive.js?v=62",
  "./search.js?v=62",
  "./markers.js?v=62",
  "./save-prompt.js?v=62",
  "./media-session.js?v=62",
  "./sleep.js?v=62",
  "./immune-cards.js?v=62",
  "./manifest.webmanifest",
  "./icon.svg?v=62",
  "./apple-touch-icon.png?v=62",
  "./og-image.png",
  "./classic/index.html",
  "./shelf/index.html",
  "./shelf/shelf.css?v=62",
  "./shelf/shelf.js?v=62",
  "./shelf/catalog.js?v=62",
  "./shelf/covers.js?v=62",
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

function driveMediaNameFromUrl(url) {
  const fromQuery = url.searchParams.get("name");
  if (fromQuery) return fromQuery;
  return driveMediaNameFromPath(url.pathname);
}

function driveMediaSizeFromUrl(url) {
  const n = Number(url.searchParams.get("size"));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Keep in lockstep with DRIVE_AUDIO_MIME_BY_EXT / rewriteDriveAudioContentType in docs/drive.js. */
const DRIVE_AUDIO_MIME_BY_EXT = {
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  mp2: "audio/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  m4p: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/mp4",
  wav: "audio/wav",
  wave: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  caf: "audio/x-caf",
  aif: "audio/aiff",
  aiff: "audio/aiff",
};

function rewriteDriveAudioContentType(name, contentType) {
  const baseName = String(name || "").split("?")[0].split("/").pop();
  const dot = baseName.lastIndexOf(".");
  const ext = dot >= 0 ? baseName.slice(dot + 1).toLowerCase() : "";
  const raw = String(contentType || "");
  const base = raw.split(";")[0].trim().toLowerCase();
  const mapped = DRIVE_AUDIO_MIME_BY_EXT[ext];
  if (mapped) {
    if (base === mapped || (mapped === "audio/mpeg" && base === "audio/mp3")) return raw || mapped;
    return mapped;
  }
  if (base === "video/mp4" || base === "application/mp4" || base === "video/quicktime") return "audio/mp4";
  return raw;
}

/** 206 without a numeric total is not seekable. Do not read the body. */
function contentRangeForPartial(range, contentLength, totalSize) {
  const total = Number(totalSize);
  const known = Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
  const headerTotal = known ? String(known) : "*";
  const raw = String(range || "").trim();
  const suffix = /^bytes=-(\d+)$/i.exec(raw);
  if (suffix) {
    const n = Number(suffix[1]);
    if (!known || !Number.isFinite(n) || n < 1) return "";
    const len = Number(contentLength);
    const count = Number.isFinite(len) && len > 0 ? Math.min(len, known) : Math.min(n, known);
    const start = Math.max(0, known - count);
    const end = known - 1;
    if (end < start) return "";
    return `bytes ${start}-${end}/${known}`;
  }
  const match = /^bytes=(\d+)-(\d*)$/i.exec(raw);
  if (!match) return "";
  const start = Number(match[1]);
  if (!Number.isFinite(start) || start < 0) return "";
  let end = match[2] === "" ? NaN : Number(match[2]);
  const len = Number(contentLength);
  if (!Number.isFinite(end)) {
    if (Number.isFinite(len) && len >= 1) end = start + len - 1;
    else if (known) end = known - 1;
    else return "";
  } else if (Number.isFinite(len) && len >= 1 && start + len - 1 < end) {
    end = start + len - 1;
  }
  if (known && end >= known) end = known - 1;
  if (end < start) return "";
  return `bytes ${start}-${end}/${headerTotal}`;
}

function withKnownMediaTotal(contentRange, totalSize) {
  const total = Number(totalSize);
  const header = String(contentRange || "");
  if (!header || !Number.isFinite(total) || total <= 0) return header;
  if (/\/\*$/.test(header)) return header.replace(/\/\*$/, `/${Math.round(total)}`);
  return header;
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
  const res = await fetch(dest, {
    headers,
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "follow",
  });
  if (res.type === "opaque" || res.status === 0) {
    return new Response("Drive media response was opaque", {
      status: 502,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
    });
  }
  if (res.status === 401) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: DRIVE_UNAUTHORIZED_MESSAGE });
    }
  }
  if (res.status !== 200 && res.status !== 206) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: DRIVE_MEDIA_ERROR_MESSAGE, status: res.status, fileId });
    }
  }
  const out = new Headers();
  const mediaName = driveMediaNameFromUrl(url);
  const totalSize = driveMediaSizeFromUrl(url);
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = res.headers.get(name);
    if (!value) continue;
    if (name === "content-type") {
      out.set(name, rewriteDriveAudioContentType(mediaName, value) || value);
    } else if (name === "content-range") {
      out.set(name, withKnownMediaTotal(value, totalSize) || value);
    } else {
      out.set(name, value);
    }
  }
  if (res.status === 206 && !out.has("content-range")) {
    const synthesized = contentRangeForPartial(range, out.get("content-length"), totalSize);
    if (synthesized) out.set("content-range", synthesized);
  }
  out.set("Cache-Control", "no-store");
  /* Stream res.body. Never buffer the audiobook. */
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: out,
  });
}

const SIGN_IN_COOP = "same-origin-allow-popups";

function withSignInCoop(response) {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", SIGN_IN_COOP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
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
  // GIS posts the sign-in token back to window.opener. That fails when the
  // document has no COOP and Chrome blocks popup.closed. same-origin-allow-popups
  // keeps the opener so the token arrives after the Google popup closes.
  if (request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((response) => {
          const wrapped = withSignInCoop(response);
          const copy = wrapped.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return wrapped;
        })
        .catch(() => caches.match(request).then((cached) => (cached ? withSignInCoop(cached) : cached)))
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
