/** Lock-screen / Control Center helpers. Pure parts are safe to import from Node tests. */

export const ARTWORK_SIZE = 512;

/** iPhone, iPod, and iPadOS (which reports itself as a touch Mac). */
export function isIOSDevice({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
  if (/iP(hone|od|ad)/.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/**
 * Which Media Session actions to register. iOS shows either track arrows or
 * skip buttons on the lock screen, preferring the arrows whenever a track
 * handler exists — so audiobooks there get only the ±seconds skips and
 * chapter changes stay in the app. Elsewhere media keys keep chapter arrows.
 */
export function lockScreenActions({ ios = false } = {}) {
  const always = ["play", "pause", "seekbackward", "seekforward", "seekto"];
  return ios
    ? { register: always, clear: ["previoustrack", "nexttrack"] }
    : { register: [...always, "previoustrack", "nexttrack"], clear: [] };
}

/** Where a portrait cover sits inside the square artwork (contain + margin). */
export function artworkLayout(coverWidth, coverHeight, size = ARTWORK_SIZE, margin = 0.06) {
  const box = size * (1 - margin * 2);
  const scale = Math.min(box / coverWidth, box / coverHeight);
  const width = Math.round(coverWidth * scale);
  const height = Math.round(coverHeight * scale);
  return {
    x: Math.round((size - width) / 2),
    y: Math.round((size - height) / 2),
    width,
    height,
  };
}

function svgDimensions(svg) {
  const box = String(svg).match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/);
  return box ? { width: Number(box[1]), height: Number(box[2]) } : { width: 160, height: 220 };
}

/**
 * Render a generated SVG cover into a square PNG for MediaMetadata.artwork
 * (iOS ignores SVG artwork). Resolves to a blob: URL, or "" if the browser
 * can't rasterise it.
 */
export async function svgCoverToPngUrl(svg, { background = "#f3eee4", size = ARTWORK_SIZE } = {}) {
  if (typeof document === "undefined" || !svg) return "";
  const { width, height } = svgDimensions(svg);
  const img = new Image();
  img.decoding = "async";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
  } catch {
    return "";
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  const at = artworkLayout(width, height, size);
  ctx.drawImage(img, at.x, at.y, at.width, at.height);
  const blob = await new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, "image/png");
    } catch {
      resolve(null);
    }
  });
  return blob ? URL.createObjectURL(blob) : "";
}
