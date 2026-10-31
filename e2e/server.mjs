/**
 * Static server for the Playwright acceptance suite. Serves docs/ like Pages.
 * GET /__test/shell/old switches every response to the previous shell release
 * (cache name and ?v= one lower) until GET /__test/shell/current. A global
 * switch, not a cookie: WebKit sends no cookies on service-worker update
 * checks. The suite runs one test at a time, and each test resets it.
 */
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { driveMediaProxyOutHeaders } from "../docs/drive.js";

const ROOT = resolve(fileURLToPath(new URL("../docs/", import.meta.url)));
const PORT = Number(process.env.PORT || 8080);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};
const REWRITE = new Set([".html", ".js", ".css", ".webmanifest"]);

export function shellVersion() {
  const sw = readFileSync(join(ROOT, "sw.js"), "utf8");
  return Number(sw.match(/library-listen-shell-v(\d+)/)[1]);
}

export function asOldShell(text, version) {
  const old = version - 1;
  return text
    .replaceAll(`library-listen-shell-v${version}`, `library-listen-shell-v${old}`)
    .replaceAll(`?v=${version}`, `?v=${old}`);
}

let mode = "current";

function resolveFile(urlPath) {
  const path = decodeURIComponent(urlPath.split("?")[0]);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) return null;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    statSync(file);
    return file;
  } catch {
    return null;
  }
}

/**
 * Generated sine tones (not audiobook bytes). The first open Range is only a
 * prefix, and the upstream omits Content-Range / uses a type <audio> refuses,
 * the way Drive's CORS response does. The proxy helper must repair both.
 */
const PLAYBACK_FIXTURE_DIR = resolve(fileURLToPath(new URL("../test/fixtures/playback/", import.meta.url)));
const PLAYBACK_OPEN_CAP = 16 * 1024;
const PLAYBACK_MEDIA = {
  "fx-what-if": { body: readFileSync(join(PLAYBACK_FIXTURE_DIR, "noxing.mp3")), driveType: "application/octet-stream" },
  "fx-what-if-2": { body: readFileSync(join(PLAYBACK_FIXTURE_DIR, "moov-end.m4a")), driveType: "video/mp4" },
  "fx-school": { body: readFileSync(join(PLAYBACK_FIXTURE_DIR, "moov-end.mp4")), driveType: "video/mp4" },
};

function playbackSlice(body, range) {
  const total = body.length;
  if (!range) return { status: 200, slice: body };
  const suffix = /^bytes=-(\d+)$/i.exec(range);
  let start = 0;
  let end = total - 1;
  if (suffix) {
    const count = Math.min(total, Number(suffix[1]) || 0);
    start = total - count;
  } else {
    const match = /^bytes=(\d+)-(\d*)$/i.exec(range);
    if (!match) return { status: 200, slice: body };
    start = Number(match[1]);
    end = match[2] === "" ? total - 1 : Number(match[2]);
    if (match[2] === "" && start === 0) end = Math.min(end, PLAYBACK_OPEN_CAP - 1);
  }
  end = Math.min(total - 1, Math.max(start, end));
  return { status: 206, slice: body.subarray(start, end + 1) };
}

function servePlaybackMedia(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const match = url.pathname.match(/\/drive-media\/([^/]+)/);
  if (!match) return false;
  let id = match[1];
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep the raw segment */
  }
  const fixture = PLAYBACK_MEDIA[id];
  if (!fixture) return false;
  const range = req.headers.range || "";
  const part = playbackSlice(fixture.body, range);
  const upstream = {
    get(name) {
      const key = String(name || "").toLowerCase();
      if (key === "content-type") return fixture.driveType;
      if (key === "content-length") return String(part.slice.length);
      if (key === "accept-ranges") return "bytes";
      return null;
    },
  };
  const headers = driveMediaProxyOutHeaders(upstream, url.searchParams.get("name") || "", {
    status: part.status,
    range,
    totalSize: url.searchParams.get("size"),
  });
  res.writeHead(part.status, { ...headers, "Cross-Origin-Opener-Policy": "same-origin-allow-popups" });
  res.end(req.method === "HEAD" ? undefined : part.slice);
  return true;
}

const version = shellVersion();
createServer((req, res) => {
  const control = (req.url || "").match(/^\/__test\/shell\/(old|current)$/);
  if (control) {
    mode = control[1];
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    });
    res.end(mode);
    return;
  }
  if (servePlaybackMedia(req, res)) return;
  const file = resolveFile(req.url || "/");
  if (!file) {
    res.writeHead(404, {
      "Content-Type": "text/plain",
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    });
    res.end("Not found");
    return;
  }
  const ext = extname(file);
  let body = readFileSync(file);
  const old = mode === "old" && REWRITE.has(ext);
  if (old) body = Buffer.from(asOldShell(body.toString("utf8"), version));
  res.writeHead(200, {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "X-Shell": old ? `v${version - 1}` : `v${version}`,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`docs/ on http://127.0.0.1:${PORT} (shell v${version}; /__test/shell/old → v${version - 1})`);
});
