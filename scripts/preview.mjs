/**
 * Local player preview. Sends the COOP header GIS needs to return a token.
 * python3 -m http.server does not send this header.
 *
 *   node scripts/preview.mjs
 *   open http://127.0.0.1:8080/ or http://localhost:8080/
 */
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../docs/", import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const COOP = "same-origin-allow-popups";
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

const server = createServer((req, res) => {
  const file = resolveFile(req.url || "/");
  if (!file) {
    res.writeHead(404, {
      "Content-Type": "text/plain",
      "Cross-Origin-Opener-Policy": COOP,
    });
    res.end("Not found");
    return;
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "Cross-Origin-Opener-Policy": COOP,
  });
  res.end(req.method === "HEAD" ? undefined : body);
});

server.listen(PORT, () => {
  console.log(`Library Listen docs/ on port ${PORT}`);
  console.log(`  http://127.0.0.1:${PORT}/`);
  console.log(`  http://localhost:${PORT}/`);
  console.log(`Cross-Origin-Opener-Policy: ${COOP}`);
});
