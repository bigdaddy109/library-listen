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

const version = shellVersion();
createServer((req, res) => {
  const control = (req.url || "").match(/^\/__test\/shell\/(old|current)$/);
  if (control) {
    mode = control[1];
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end(mode);
    return;
  }
  const file = resolveFile(req.url || "/");
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain" });
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
    "X-Shell": old ? `v${version - 1}` : `v${version}`,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`docs/ on http://127.0.0.1:${PORT} (shell v${version}; /__test/shell/old → v${version - 1})`);
});
