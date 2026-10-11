/** Local EPUB unzip + spine reader. No network. Safe to import from Node tests. */

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export const READER_STYLES = `html,body{margin:0;padding:0;background:#f3efe4;color:#241c14;font-family:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;line-height:1.55;font-size:1.05rem;}body{padding:1rem 1.1rem 2rem;}img,svg,video{max-width:100%;height:auto;}a{color:#6b3f1f;}p{margin:0.7em 0;}`;

function toBytes(buffer) {
  if (buffer instanceof Uint8Array) return buffer;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  throw new Error("Expected an ArrayBuffer");
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u16(view, offset) {
  return view.getUint16(offset, true);
}

function u32(view, offset) {
  return view.getUint32(offset, true);
}

function findEocd(bytes) {
  const view = viewOf(bytes);
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (u32(view, i) === SIG_EOCD) return i;
  }
  throw new Error("Not a zip: missing end of central directory");
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === "function") {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { inflateRawSync } = await import("node:zlib");
  return inflateRawSync(data);
}

/**
 * Unzip a local EPUB/ZIP buffer. Supports STORE and DEFLATE.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function unzip(buffer) {
  const bytes = toBytes(buffer);
  const view = viewOf(bytes);
  const eocd = findEocd(bytes);
  const count = u16(view, eocd + 10);
  let offset = u32(view, eocd + 16);
  const files = new Map();

  for (let i = 0; i < count; i += 1) {
    if (u32(view, offset) !== SIG_CD) throw new Error("Corrupt zip: central directory");
    const method = u16(view, offset + 10);
    const compSize = u32(view, offset + 20);
    const nameLen = u16(view, offset + 28);
    const extraLen = u16(view, offset + 30);
    const commentLen = u16(view, offset + 32);
    const localOff = u32(view, offset + 42);
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLen)).replace(/\\/g, "/");
    offset += 46 + nameLen + extraLen + commentLen;

    if (u32(view, localOff) !== SIG_LOCAL) throw new Error(`Corrupt zip: ${name}`);
    const localNameLen = u16(view, localOff + 26);
    const localExtraLen = u16(view, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === METHOD_STORE) data = compressed;
    else if (method === METHOD_DEFLATE) data = await inflateRaw(compressed);
    else throw new Error(`Unsupported zip method ${method} for ${name}`);
    if (name.endsWith("/")) continue;
    files.set(name, data);
  }
  return files;
}

export function zipPath(baseDir, href) {
  const clean = String(href || "")
    .split("#")[0]
    .split("?")[0]
    .replace(/\\/g, "/");
  if (!clean) return "";
  const joined = (baseDir ? `${baseDir.replace(/\/?$/, "/")}` : "") + clean;
  const parts = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : "";
}

function fileFromMap(files, path) {
  if (files.has(path)) return files.get(path);
  const lower = path.toLowerCase();
  for (const [name, data] of files) {
    if (name.toLowerCase() === lower) return data;
  }
  return null;
}

function parseContainer(xml) {
  const match = xml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!match) throw new Error("EPUB is missing META-INF/container.xml rootfile");
  return match[1].replace(/\\/g, "/");
}

function parseNavLabels(xml, navDir) {
  const labels = new Map();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const href = attr(m[1], "href");
    if (!href) continue;
    const path = zipPath(navDir, href);
    if (!path || labels.has(path)) continue;
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) labels.set(path, text);
  }
  return labels;
}

function parseNcxLabels(xml, ncxDir) {
  const labels = new Map();
  const re = /<navPoint\b[\s\S]*?<\/navPoint>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const label = m[0].match(/<text>([^<]*)<\/text>/i)?.[1]?.replace(/\s+/g, " ").trim();
    const src = m[0].match(/<content\b[^>]*src\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!label || !src) continue;
    const path = zipPath(ncxDir, src);
    if (path && !labels.has(path)) labels.set(path, label);
  }
  return labels;
}

function parseOpf(xml) {
  const title = xml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
  const manifest = new Map();
  const itemRe = /<item\b([^>]*)\/?>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const id = attr(m[1], "id");
    const href = attr(m[1], "href");
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      mediaType: attr(m[1], "media-type"),
      properties: attr(m[1], "properties"),
    });
  }
  const spine = [];
  const refRe = /<itemref\b([^>]*)\/?>/gi;
  while ((m = refRe.exec(xml))) {
    const idref = attr(m[1], "idref");
    const item = manifest.get(idref);
    if (item) spine.push(item);
  }
  const navItem = [...manifest.values()].find((item) => /\bnav\b/.test(item.properties));
  const ncxItem =
    [...manifest.values()].find((item) => item.mediaType === "application/x-dtbncx+xml") ||
    [...manifest.values()].find((item) => /\.ncx$/i.test(item.href));
  return { title, manifest, spine, navItem, ncxItem };
}

/**
 * Parse a local EPUB into a spine the reader can render.
 * @param {ArrayBuffer|Uint8Array} buffer
 */
export async function parseEpub(buffer) {
  const files = await unzip(buffer);
  const container = fileFromMap(files, "META-INF/container.xml");
  if (!container) throw new Error("EPUB is missing META-INF/container.xml");
  const opfPath = parseContainer(decodeUtf8(container));
  const opfBytes = fileFromMap(files, opfPath);
  if (!opfBytes) throw new Error(`EPUB is missing ${opfPath}`);
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const { title, spine, navItem, ncxItem } = parseOpf(decodeUtf8(opfBytes));
  if (!spine.length) throw new Error("EPUB has an empty spine");

  let labels = new Map();
  if (navItem) {
    const navPath = zipPath(opfDir, navItem.href);
    const navBytes = fileFromMap(files, navPath);
    if (navBytes) {
      const navDir = navPath.includes("/") ? navPath.slice(0, navPath.lastIndexOf("/") + 1) : "";
      labels = parseNavLabels(decodeUtf8(navBytes), navDir);
    }
  }
  if (!labels.size && ncxItem) {
    const ncxPath = zipPath(opfDir, ncxItem.href);
    const ncxBytes = fileFromMap(files, ncxPath);
    if (ncxBytes) {
      const ncxDir = ncxPath.includes("/") ? ncxPath.slice(0, ncxPath.lastIndexOf("/") + 1) : "";
      labels = parseNcxLabels(decodeUtf8(ncxBytes), ncxDir);
    }
  }

  const items = spine.map((item, index) => {
    const path = zipPath(opfDir, item.href);
    return {
      index,
      id: item.id,
      href: item.href,
      path,
      mediaType: item.mediaType || "application/xhtml+xml",
      title: labels.get(path) || "",
    };
  });

  return {
    title,
    spine: items,
    files,
    read(path) {
      return fileFromMap(files, path);
    },
  };
}

/** Spine item 0 → epubcfi(/6/2!), item 1 → epubcfi(/6/4!). */
export function spineCfi(index) {
  const n = (Math.max(0, Number(index) || 0) + 1) * 2;
  return `epubcfi(/6/${n}!)`;
}

export function spineIndexFromCfi(cfi) {
  const match = String(cfi || "").match(/epubcfi\(\/6\/(\d+)/i);
  if (!match) return 0;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 2) return 0;
  return Math.max(0, Math.floor(n / 2) - 1);
}

export function clampFraction(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function scrollFraction(el) {
  if (!el) return 0;
  const max = el.scrollHeight - el.clientHeight;
  if (!(max > 0)) return 0;
  return clampFraction(el.scrollTop / max);
}

export function applyScrollFraction(el, fraction) {
  if (!el) return;
  const max = el.scrollHeight - el.clientHeight;
  if (!(max > 0)) return;
  el.scrollTop = max * clampFraction(fraction);
}

const ATTR_URL = /((?:src|href|xlink:href)\s*=\s*["'])([^"']+)(["'])/gi;

/**
 * Rewrite spine XHTML so images/CSS resolve from the zip, and strip scripts.
 * @param {string} html
 * @param {(href: string) => string|null} resolveHref
 */
export function rewriteSpineHtml(html, resolveHref) {
  let out = String(html || "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script\b[^>]*\/>/gi, "");
  out = out.replace(ATTR_URL, (all, pre, href, post) => {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("data:") || /^[a-z]+:/i.test(trimmed)) {
      return all;
    }
    const next = resolveHref(trimmed);
    return next ? `${pre}${next}${post}` : all;
  });
  if (!/<head[\s>]/i.test(out)) {
    out = `<!DOCTYPE html><html><head></head><body>${out}</body></html>`;
  }
  if (!/<style data-library-listen-reader/i.test(out)) {
    out = out.replace(
      /<head([^>]*)>/i,
      `<head$1><style data-library-listen-reader>${READER_STYLES}</style>`
    );
  }
  return out;
}

export function mimeForPath(path, fallback = "application/octet-stream") {
  const ext = String(path || "")
    .split("?")[0]
    .split("#")[0]
    .split(".")
    .pop()
    .toLowerCase();
  if (ext === "css") return "text/css";
  if (ext === "js") return "text/javascript";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "xhtml" || ext === "html" || ext === "htm") return "application/xhtml+xml";
  if (ext === "otf") return "font/otf";
  if (ext === "ttf") return "font/ttf";
  if (ext === "woff") return "font/woff";
  if (ext === "woff2") return "font/woff2";
  return fallback;
}

export function spineLabel(item, index, total) {
  const title = item?.title?.trim();
  const n = (index ?? item?.index ?? 0) + 1;
  const of = total || 0;
  if (title && of) return `${title} · ${n} of ${of}`;
  if (title) return title;
  if (of) return `${n} of ${of}`;
  return `Section ${n}`;
}

const LEADING_CHAPTER = /^(?:part|chapter|ch|sec|section|track)\s+/;

/**
 * Comparable tokens for an audio chapter title / m4b marker vs an EPUB TOC/spine label.
 * Does not invent display titles.
 */
export function jumpKeys(value) {
  const raw = String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/#\d+$/g, "");
  const spaced = raw
    .replace(/[_./\\-]+/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const keys = [];
  const add = (key) => {
    if (key && !keys.includes(key)) keys.push(key);
  };
  add(spaced);
  const noLead = spaced.replace(LEADING_CHAPTER, "").replace(/^0+(\d)/, "$1").trim();
  add(noLead);
  add(noLead.replace(/^\d+\s+/, "").trim());
  return keys;
}

function keyOverlapScore(leftKeys, rightKeys) {
  let score = 0;
  for (const left of leftKeys) {
    for (const right of rightKeys) {
      if (!left || !right || left.length < 2 || right.length < 2) continue;
      if (left === right) score = Math.max(score, 20 + Math.min(left.length, 12));
      else if (left.includes(right) || right.includes(left)) {
        score = Math.max(score, 10 + Math.min(left.length, right.length, 12));
      }
    }
  }
  return score;
}

function spineItemKeys(item) {
  const stem = String(item?.path || item?.href || "")
    .split("/")
    .pop();
  return [...jumpKeys(item?.title), ...jumpKeys(stem)];
}

/**
 * Map an audio / m4b-marker chapter onto an EPUB spine item.
 * Title/TOC match wins; otherwise same index when counts match, else proportional.
 */
export function spineIndexForChapter(spine, chapter, chapterIndex = 0, chapterCount = 0) {
  const items = Array.isArray(spine) ? spine : [];
  if (!items.length) return 0;
  const idx = Math.max(0, Number(chapterIndex) || 0);
  const count = Number(chapterCount) > 0 ? Number(chapterCount) : 0;
  const chapterKeys = [...jumpKeys(chapter?.title), ...jumpKeys(chapter?.id)];

  let best = -1;
  let bestScore = 0;
  items.forEach((item, i) => {
    const score = keyOverlapScore(chapterKeys, spineItemKeys(item));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  if (best >= 0) return best;
  if (count <= 1) return 0;
  if (count === items.length) return Math.min(items.length - 1, idx);
  return Math.max(
    0,
    Math.min(items.length - 1, Math.round((idx / Math.max(1, count - 1)) * (items.length - 1)))
  );
}
