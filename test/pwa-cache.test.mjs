import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

const VERSIONED_SHELL = /\.(?:js|css|svg)$/i;

/**
 * One mechanical check for the old v20 problem:
 * CACHE version, every ?v=N, and the SW ASSETS list must stay in lockstep
 * when files are added under docs/.
 *
 * @param {{ sw: string, html: string, app: string, cards: string, files: string[] }} sources
 * `files` are posix paths relative to docs/ (e.g. "app.js", "concepts/immune/skin.jpg").
 */
export function auditPwaCache(sources) {
  const errors = [];
  const sw = sources.sw ?? "";
  const html = sources.html ?? "";
  const app = sources.app ?? "";
  const cards = sources.cards ?? "";
  const files = [...new Set(sources.files ?? [])].map(posixDocsPath);

  const cache = sw.match(/const CACHE = "library-listen-shell-v(\d+)";/);
  if (!cache) {
    errors.push('docs/sw.js must declare const CACHE = "library-listen-shell-vN";');
    return { version: null, assets: [], errors };
  }
  const version = Number(cache[1]);

  const assetsBlock = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!assetsBlock) {
    errors.push("docs/sw.js must declare const ASSETS = [ ... ];");
    return { version, assets: [], errors };
  }
  const assets = [...assetsBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (assets.length === 0) {
    errors.push("docs/sw.js ASSETS is empty");
  }

  const listed = new Map();
  for (const raw of assets) {
    const path = stripQuery(raw);
    if (listed.has(path)) {
      errors.push(`ASSETS lists ${path} more than once`);
    }
    listed.set(path, raw);

    const query = raw.match(/\?v=(\d+)$/);
    if (needsQuery(path)) {
      if (!query) {
        errors.push(`${path} in ASSETS is missing ?v=${version}`);
      } else if (Number(query[1]) !== version) {
        errors.push(`${raw} does not match CACHE v${version}`);
      }
    } else if (query && Number(query[1]) !== version) {
      errors.push(`${raw} does not match CACHE v${version}`);
    }

    if (path !== "./" && !files.includes(path.slice(2))) {
      errors.push(`ASSETS lists missing file: ${raw}`);
    }
  }

  if (!listed.has("./")) errors.push('ASSETS must include "./"');
  if (!listed.has("./index.html")) errors.push('ASSETS must include "./index.html"');

  const shelfHtml = sources.shelfHtml ?? "";
  const shelfJs = sources.shelfJs ?? "";
  const shelfCatalog = sources.shelfCatalog ?? "";
  const shelfCovers = sources.shelfCovers ?? "";
  const classicHtml = sources.classicHtml ?? "";

  for (const [label, source] of [
    ["docs/index.html", html],
    ["docs/app.js", app],
    ["docs/sw.js", sw],
    ["docs/shelf/index.html", shelfHtml],
    ["docs/shelf/shelf.js", shelfJs],
    ["docs/classic/index.html", classicHtml],
  ]) {
    const versions = queryVersions(source);
    if (versions.length === 0) {
      errors.push(`${label} has no ?v=N cache-bust`);
      continue;
    }
    for (const found of versions) {
      if (found !== version) {
        errors.push(`${label} has ?v=${found} but CACHE is v${version}`);
      }
    }
  }

  for (const rel of files.filter(isShellAsset)) {
    const asset = `./${rel}`;
    if (!listed.has(asset)) {
      errors.push(
        `${asset} is on disk but not in sw.js ASSETS (add it; keep CACHE / ?v= in lockstep)`
      );
    }
  }

  for (const href of localRefs(html, /(?:href|src)="(\.\/[^"]+)"/g)) {
    const path = stripQuery(href);
    if (path === "./sw.js") continue;
    if (!listed.has(path)) {
      errors.push(`docs/index.html references ${href} which is not in ASSETS`);
    }
  }

  for (const href of localRefs(app, /from\s+"(\.\/[^"]+)"/g)) {
    const path = stripQuery(href);
    if (!listed.has(path)) {
      errors.push(`docs/app.js imports ${href} which is not in ASSETS`);
    }
  }

  if (listed.has("./shelf/index.html")) {
    if (!listed.has("./shelf/shelf.css")) {
      errors.push("ASSETS lists shelf/index.html but not ./shelf/shelf.css");
    }
    if (!listed.has("./shelf/shelf.js")) {
      errors.push("ASSETS lists shelf/index.html but not ./shelf/shelf.js");
    }
  }

  for (const [label, relFile, source] of [
    ["docs/shelf/index.html", "shelf/index.html", shelfHtml],
    ["docs/shelf/shelf.js", "shelf/shelf.js", shelfJs],
    ["docs/shelf/catalog.js", "shelf/catalog.js", shelfCatalog],
    ["docs/shelf/covers.js", "shelf/covers.js", shelfCovers],
    ["docs/classic/index.html", "classic/index.html", classicHtml],
  ]) {
    const pattern = relFile.endsWith(".html")
      ? /(?:href|src)="((?:\.\.\/|\.\/)[^"]+)"/g
      : /from\s+"((?:\.\.\/|\.\/)[^"]+)"/g;
    for (const href of localRefs(source, pattern)) {
      if (href.startsWith("../sw.js")) continue;
      const path = resolveDocsAsset(relFile, href);
      if (!listed.has(path)) {
        errors.push(`${label} references ${href} which is not in ASSETS (${path})`);
      }
    }
  }

  for (const file of localRefs(cards, /file:\s*"([^"]+)"/g)) {
    const asset = `./concepts/immune/${file}`;
    if (!listed.has(asset)) {
      errors.push(`IMMUNE_CARDS file ${asset} is not in ASSETS`);
    }
    if (!files.includes(`concepts/immune/${file}`)) {
      errors.push(`IMMUNE_CARDS file ${asset} is missing on disk`);
    }
  }

  return { version, assets, errors };
}

function optionalRead(docsDir, rel) {
  try {
    return readFileSync(join(docsDir, rel), "utf8");
  } catch {
    return "";
  }
}

export function readPlayerSources(docsDir = DOCS) {
  return {
    sw: readFileSync(join(docsDir, "sw.js"), "utf8"),
    html: readFileSync(join(docsDir, "index.html"), "utf8"),
    app: readFileSync(join(docsDir, "app.js"), "utf8"),
    cards: readFileSync(join(docsDir, "immune-cards.js"), "utf8"),
    shelfHtml: optionalRead(docsDir, "shelf/index.html"),
    shelfJs: optionalRead(docsDir, "shelf/shelf.js"),
    shelfCatalog: optionalRead(docsDir, "shelf/catalog.js"),
    shelfCovers: optionalRead(docsDir, "shelf/covers.js"),
    classicHtml: optionalRead(docsDir, "classic/index.html"),
    files: listDocsFiles(docsDir),
  };
}

function listDocsFiles(docsDir) {
  const out = [];
  walk(docsDir, docsDir, out);
  return out;
}

function walk(dir, root, out) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, root, out);
      continue;
    }
    out.push(posixDocsPath(relative(root, full)));
  }
}

function isShellAsset(rel) {
  if (rel === "sw.js") return false;
  if (rel === "index.html" || rel === "manifest.webmanifest") return true;
  if (rel === "apple-touch-icon.png" || rel === "og-image.png") return true;
  if (rel === "shelf/index.html" || rel === "classic/index.html") return true;
  if (rel.startsWith("shelf/") && VERSIONED_SHELL.test(rel)) return true;
  if (!rel.includes("/") && VERSIONED_SHELL.test(rel)) return true;
  return rel.startsWith("concepts/") && /\.(jpe?g|png|webp)$/i.test(rel);
}

function needsQuery(assetPath) {
  if (assetPath === "./apple-touch-icon.png") return true;
  return VERSIONED_SHELL.test(assetPath);
}

function queryVersions(source) {
  return [...source.matchAll(/\?v=(\d+)/g)].map((m) => Number(m[1]));
}

function localRefs(source, pattern) {
  return [...source.matchAll(pattern)].map((m) => m[1]);
}

function stripQuery(value) {
  return value.replace(/\?v=\d+$/, "");
}

function resolveDocsAsset(fromRel, href) {
  const path = stripQuery(href);
  const parts = fromRel.split("/").slice(0, -1);
  for (const bit of path.split("/")) {
    if (!bit || bit === ".") continue;
    if (bit === "..") parts.pop();
    else parts.push(bit);
  }
  return `./${parts.join("/")}`;
}

function posixDocsPath(rel) {
  return String(rel).split("\\").join("/");
}

function live() {
  return auditPwaCache(readPlayerSources());
}

describe("PWA cache-bust", () => {
  it("keeps CACHE, ?v=N, and ASSETS in lockstep on the live docs/ tree", () => {
    const result = live();
    assert.equal(
      result.errors.length,
      0,
      result.errors.join("\n")
    );
    assert.ok(Number.isInteger(result.version) && result.version >= 21);
    assert.ok(result.assets.includes("./"));
    assert.ok(result.assets.includes("./index.html"));
    assert.ok(
      result.assets.some((a) => stripQuery(a) === "./library.js"),
      "ASSETS must include library.js from main"
    );
    assert.ok(
      result.assets.some((a) => stripQuery(a) === "./drive.js"),
      "ASSETS must include drive.js from main"
    );
    assert.ok(
      result.assets.some((a) => stripQuery(a) === "./epub.js"),
      "ASSETS must include epub.js from main"
    );
    assert.ok(
      result.assets.some((a) => stripQuery(a) === "./shelf/index.html"),
      "ASSETS must include the /shelf/ redirect page"
    );
    assert.ok(
      result.assets.some((a) => stripQuery(a) === "./classic/index.html"),
      "ASSETS must include the /classic/ player"
    );
  });

  it("fails when one ?v= drifts from CACHE", () => {
    const sources = readPlayerSources();
    sources.html = sources.html.replace(/\?v=\d+/g, "?v=1");
    const result = auditPwaCache(sources);
    assert.ok(
      result.errors.some((e) => e.includes("docs/index.html") && e.includes("?v=1")),
      result.errors.join("\n")
    );
  });

  it("fails when a docs/ file is added but left out of ASSETS", () => {
    const sources = readPlayerSources();
    sources.files = [...sources.files, "extra-shell.js"];
    const result = auditPwaCache(sources);
    assert.ok(
      result.errors.some((e) => e.includes("./extra-shell.js") && e.includes("not in sw.js ASSETS")),
      result.errors.join("\n")
    );
  });

  it("fails when app.js imports a module that ASSETS omitted", () => {
    const sources = readPlayerSources();
    const version = live().version;
    sources.app = `import { x } from "./extra-shell.js?v=${version}";\n` + sources.app;
    const result = auditPwaCache(sources);
    assert.ok(
      result.errors.some((e) => e.includes("docs/app.js imports") && e.includes("extra-shell.js")),
      result.errors.join("\n")
    );
  });
});
