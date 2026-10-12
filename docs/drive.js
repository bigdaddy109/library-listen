/**
 * Google Drive library source for the web player (and later /shelf/).
 * GIS token + Drive API v3 drive.readonly only. Client ID and Picker key
 * are public browser config (not secrets).
 */

import { AUDIO_EXT, COVER_EXT, EPUB_EXT, SKIP_FOLDERS, extOf } from "./library.js";

/** Public Web application OAuth Client ID. Not a secret. */
export const GOOGLE_OAUTH_CLIENT_ID =
  "827714015808-hp9o0gl26mbcs8mmipjfu2dtuvv9vdo3.apps.googleusercontent.com";

/**
 * Public browser API key for Google Picker (HTTP-referrer restricted to
 * https://bigdaddy109.github.io/*). Without it, the player still lists
 * folders named Library from Drive search.
 */
export const GOOGLE_PICKER_API_KEY = "AIzaSyBaeZWLYArw6iH-5-ietM3AyI8MNLOYui4";

export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const LIBRARY_FOLDER_NAME = "Library";
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const GIS_SRC = "https://accounts.google.com/gsi/client";
export const GAPI_SRC = "https://apis.google.com/js/api.js";
export const DRIVE_MEDIA_PREFIX = "/drive-media/";
export const DRIVE_TOKEN_MESSAGE = "librarylisten.drive-token";
export const DRIVE_UNAUTHORIZED_MESSAGE = "librarylisten.drive-unauthorized";
export const DRIVE_SESSION_KEY = "librarylisten.drive.v1";

const PLACEHOLDER_CLIENT = /YOUR_GOOGLE_OAUTH_CLIENT_ID/i;
const PLACEHOLDER_PICKER = /YOUR_GOOGLE_PICKER_API_KEY/i;

/** @type {string | null} */
let accessToken = null;
/** @type {((token: string) => void) | null} */
let rangeFetchImpl = null;

export function isPlaceholderClientId(id = GOOGLE_OAUTH_CLIENT_ID) {
  const value = String(id || "").trim();
  return !value || PLACEHOLDER_CLIENT.test(value) || !value.includes(".apps.googleusercontent.com");
}

export function isGoogleClientConfigured() {
  return !isPlaceholderClientId(GOOGLE_OAUTH_CLIENT_ID);
}

export function isPickerConfigured() {
  const key = String(GOOGLE_PICKER_API_KEY || "").trim();
  return !!key && !PLACEHOLDER_PICKER.test(key);
}

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || null;
  return accessToken;
}

export function isDriveFile(file) {
  return !!file && typeof file.driveId === "string" && file.driveId.length > 0;
}

export function isDriveMediaPath(pathname) {
  return String(pathname || "").includes(DRIVE_MEDIA_PREFIX);
}

export function driveFileIdFromPath(pathname) {
  const path = String(pathname || "");
  const at = path.lastIndexOf(DRIVE_MEDIA_PREFIX);
  if (at < 0) return "";
  const raw = path.slice(at + DRIVE_MEDIA_PREFIX.length).split("/")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function driveMediaPath(fileId) {
  return `.${DRIVE_MEDIA_PREFIX}${encodeURIComponent(fileId)}`;
}

export function driveMediaUrl(fileId, base = globalThis.location?.href) {
  if (!base) return driveMediaPath(fileId);
  return new URL(driveMediaPath(fileId), base).href;
}

export function driveAltMediaUrl(fileId) {
  return `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
}

export function driveProxyHeaders(requestHeaders, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const range =
    requestHeaders?.get?.("Range") ||
    requestHeaders?.get?.("range") ||
    requestHeaders?.Range ||
    requestHeaders?.range;
  if (range) headers.Range = range;
  return headers;
}

export function libraryFolderQuery({ sharedWithMe = false } = {}) {
  const parts = [
    `name='${LIBRARY_FOLDER_NAME}'`,
    `mimeType='${DRIVE_FOLDER_MIME}'`,
    "trashed=false",
  ];
  if (sharedWithMe) parts.push("sharedWithMe=true");
  return parts.join(" and ");
}

export function childrenQuery(folderId) {
  return `'${folderId}' in parents and trashed=false`;
}

export function shouldSkipDriveName(name) {
  if (!name || name === "." || name === "..") return true;
  if (name.startsWith(".")) return true;
  if (name.startsWith("_")) return true;
  return SKIP_FOLDERS.has(name.toLowerCase());
}

export function resolveDriveItem(item) {
  if (!item) return null;
  if (item.mimeType === DRIVE_SHORTCUT_MIME && item.shortcutDetails?.targetId) {
    return {
      ...item,
      id: item.shortcutDetails.targetId,
      mimeType: item.shortcutDetails.targetMimeType || item.mimeType,
    };
  }
  return item;
}

export function walkPrefixForFolder(folder) {
  const name = String(folder?.name || LIBRARY_FOLDER_NAME).trim();
  return [name || LIBRARY_FOLDER_NAME];
}

export function uniqueDriveFolders(folders) {
  const seen = new Set();
  const out = [];
  for (const folder of folders || []) {
    if (!folder?.id || seen.has(folder.id)) continue;
    seen.add(folder.id);
    out.push(folder);
  }
  return out;
}

export function rankLibraryFolders(folders) {
  return uniqueDriveFolders(folders).sort((a, b) => {
    const ao = a.ownedByMe === true ? 0 : 1;
    const bo = b.ownedByMe === true ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

/** One hit → use it. Zero or many → caller shows Picker / a list. */
export function chooseSoleLibraryFolder(folders) {
  const ranked = rankLibraryFolders(folders);
  return ranked.length === 1 ? ranked[0] : null;
}

export function libraryFolderLabel(folder) {
  const name = folder?.name || LIBRARY_FOLDER_NAME;
  if (folder?.ownedByMe) return `${name} (your Drive)`;
  const owner =
    folder?.owners?.[0]?.displayName || folder?.owners?.[0]?.emailAddress || "";
  if (owner) return `${name} (shared by ${owner})`;
  if (folder?.shared) return `${name} (shared with you)`;
  return name;
}

export function mimeForDriveName(name) {
  const ext = extOf(name);
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a" || ext === "m4b" || ext === "aac") return "audio/mp4";
  if (ext === "epub") return "application/epub+zip";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export function isLibraryMediaName(name) {
  const ext = extOf(name);
  return AUDIO_EXT.has(ext) || COVER_EXT.has(ext) || EPUB_EXT.has(ext);
}

function parentId(item) {
  return item?.parents?.[0] || null;
}

/**
 * Turn a flat Drive file list (id / name / parents) into {path, file} entries
 * that `buildLibrary` already understands. PDF is left for library.js to ignore.
 */
export function driveFilesToEntries(items, { rootId, rootName = LIBRARY_FOLDER_NAME } = {}) {
  const resolved = (items || []).map(resolveDriveItem).filter(Boolean);
  const byId = new Map(resolved.map((item) => [item.id, item]));
  const entries = [];

  const pathOf = (item) => {
    if (!item) return null;
    if (item.id === rootId) return [rootName];
    const seen = new Set();
    const parts = [];
    let cur = item;
    while (cur && cur.id !== rootId) {
      if (seen.has(cur.id)) return null;
      seen.add(cur.id);
      parts.unshift(cur.name);
      const pid = parentId(cur);
      if (!pid) return null;
      if (pid === rootId) {
        parts.unshift(rootName);
        return parts;
      }
      cur = byId.get(pid);
      if (!cur) return null;
    }
    return parts.length ? parts : null;
  };

  for (const item of resolved) {
    if (item.id === rootId) continue;
    if (item.mimeType === DRIVE_FOLDER_MIME) continue;
    if (shouldSkipDriveName(item.name) || !isLibraryMediaName(item.name)) continue;
    const parts = pathOf(item);
    if (!parts || parts.some(shouldSkipDriveName)) continue;
    const ext = extOf(item.name);
    const size = Number(item.size) || 0;
    if ((AUDIO_EXT.has(ext) || EPUB_EXT.has(ext)) && size === 0) continue;
    entries.push({
      path: parts.join("/"),
      file: makeDriveFile(item),
    });
  }
  return entries;
}

export function setDriveRangeFetch(fn) {
  rangeFetchImpl = typeof fn === "function" ? fn : null;
}

async function rangeBytes(fileId, start, end) {
  if (rangeFetchImpl) return rangeFetchImpl(fileId, start, end);
  const token = getAccessToken();
  if (!token) throw new Error("Sign in with Google to read this file.");
  const last = Math.max(start, end - 1);
  const headers = driveProxyHeaders({ Range: `bytes=${start}-${last}` }, token);
  const res = await fetch(driveAltMediaUrl(fileId), { headers });
  if (!res.ok) throw new Error(`Drive range read failed (${res.status})`);
  return res.arrayBuffer();
}

export function makeDriveFile(item) {
  const id = item?.id || item?.driveId;
  const name = item?.name || "file";
  const size = Number(item?.size) || 0;
  const type = item?.mimeType && !String(item.mimeType).startsWith("application/vnd.google-apps.")
    ? item.mimeType
    : mimeForDriveName(name);

  const file = {
    name,
    size,
    type,
    driveId: id,
    lastModified: Date.now(),
    slice(start = 0, end = size) {
      const from = Math.max(0, Number(start) || 0);
      const to = Math.min(size, end == null ? size : Number(end));
      const length = Math.max(0, to - from);
      return {
        size: length,
        async arrayBuffer() {
          if (!id || length <= 0) return new ArrayBuffer(0);
          return rangeBytes(id, from, to);
        },
        slice(innerStart = 0, innerEnd = length) {
          return file.slice(from + (Number(innerStart) || 0), from + (innerEnd == null ? length : Number(innerEnd)));
        },
      };
    },
    async arrayBuffer() {
      if (!id) return new ArrayBuffer(0);
      return downloadDriveBuffer(id);
    },
    async blob() {
      const buf = await file.arrayBuffer();
      return new Blob([buf], { type });
    },
  };
  return file;
}

export function loadDriveSession(store = defaultStore()) {
  try {
    const raw = store?.getItem?.(DRIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.folderId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDriveSession(session, store = defaultStore()) {
  if (!store?.setItem) return session;
  if (!session?.folderId) {
    try {
      store.removeItem?.(DRIVE_SESSION_KEY);
    } catch {
      /* private mode */
    }
    return null;
  }
  const record = {
    folderId: session.folderId,
    folderName: session.folderName || LIBRARY_FOLDER_NAME,
    email: session.email || "",
    updatedAt: new Date().toISOString(),
  };
  try {
    store.setItem(DRIVE_SESSION_KEY, JSON.stringify(record));
  } catch {
    /* quota / private mode */
  }
  return record;
}

export function clearDriveSession(store = defaultStore()) {
  try {
    store?.removeItem?.(DRIVE_SESSION_KEY);
  } catch {
    /* private mode */
  }
  return null;
}

function defaultStore() {
  try {
    if (typeof globalThis.localStorage !== "undefined") return globalThis.localStorage;
  } catch {
    /* private mode / Node */
  }
  return null;
}

function driveListUrl({ q, pageToken, fields } = {}) {
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", q);
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("corpora", "user");
  url.searchParams.set(
    "fields",
    fields ||
      "nextPageToken,files(id,name,mimeType,size,parents,ownedByMe,shared,owners(displayName,emailAddress),shortcutDetails)"
  );
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url.toString();
}

export { driveListUrl };

async function driveGetJson(url, token, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    const err = new Error("Google sign-in expired. Sign in again.");
    err.name = "DriveAuthError";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Drive request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function driveListAll(token, q, fetchImpl = fetch) {
  const files = [];
  let pageToken = "";
  do {
    const body = await driveGetJson(driveListUrl({ q, pageToken }), token, fetchImpl);
    files.push(...(body.files || []));
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return files.map(resolveDriveItem).filter(Boolean);
}

export async function findLibraryFolders(token, fetchImpl = fetch) {
  const [mine, shared] = await Promise.all([
    driveListAll(token, libraryFolderQuery(), fetchImpl),
    driveListAll(token, libraryFolderQuery({ sharedWithMe: true }), fetchImpl),
  ]);
  return rankLibraryFolders([...mine, ...shared]);
}

export async function walkDriveFolder(folderId, token, { prefix, fetchImpl = fetch } = {}) {
  const rootPrefix = prefix || [LIBRARY_FOLDER_NAME];
  /** @type {{ path: string, file: ReturnType<typeof makeDriveFile> }[]} */
  const entries = [];
  let skipped = 0;

  const walk = async (id, parts) => {
    const children = await driveListAll(token, childrenQuery(id), fetchImpl);
    for (const raw of children) {
      const item = resolveDriveItem(raw);
      if (!item?.name || shouldSkipDriveName(item.name)) {
        skipped += 1;
        continue;
      }
      const next = [...parts, item.name];
      if (item.mimeType === DRIVE_FOLDER_MIME) {
        try {
          await walk(item.id, next);
        } catch {
          skipped += 1;
        }
        continue;
      }
      if (!isLibraryMediaName(item.name)) continue;
      const ext = extOf(item.name);
      const size = Number(item.size) || 0;
      if ((AUDIO_EXT.has(ext) || EPUB_EXT.has(ext)) && size === 0) {
        skipped += 1;
        continue;
      }
      entries.push({ path: next.join("/"), file: makeDriveFile(item) });
    }
  };

  await walk(folderId, rootPrefix);
  return { entries, skipped };
}

export async function downloadDriveBuffer(fileId, token = getAccessToken(), fetchImpl = fetch) {
  if (!token) throw new Error("Sign in with Google to download this file.");
  const res = await fetchImpl(driveAltMediaUrl(fileId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return res.arrayBuffer();
}

export async function downloadDriveFile(file, token = getAccessToken(), fetchImpl = fetch) {
  const id = file?.driveId || file?.id;
  const name = file?.name || "file";
  const type = file?.type || mimeForDriveName(name);
  const buf = await downloadDriveBuffer(id, token, fetchImpl);
  if (typeof File === "function") {
    const disk = new File([buf], name, { type });
    disk.driveId = id;
    return disk;
  }
  return makeDriveFile({ id, name, size: buf.byteLength, mimeType: type });
}

export function attachDriveMedia(books, { base } = {}) {
  for (const book of books || []) {
    for (const ch of book.chapters || []) {
      if (isDriveFile(ch.file)) {
        ch.url = driveMediaUrl(ch.file.driveId, base);
        ch.driveId = ch.file.driveId;
      }
    }
    if (isDriveFile(book.ebook?.file)) {
      book.ebook.driveId = book.ebook.file.driveId;
    }
    if (isDriveFile(book.coverFile)) {
      book.coverDriveId = book.coverFile.driveId;
    }
    book.source = book.source || "drive";
  }
  return books;
}

export async function hydrateDriveCovers(books, token = getAccessToken(), fetchImpl = fetch) {
  await Promise.all(
    (books || []).map(async (book) => {
      if (!isDriveFile(book.coverFile) || book.coverFile.size > 8_000_000) return;
      try {
        book.coverFile = await downloadDriveFile(book.coverFile, token, fetchImpl);
      } catch {
        /* cover is optional */
      }
    })
  );
  return books;
}

export function snapshotDriveFields(file) {
  if (!isDriveFile(file)) return null;
  return { driveId: file.driveId, name: file.name, size: file.size, type: file.type };
}

export function restoreDriveFile(fields) {
  if (!fields?.driveId) return null;
  return makeDriveFile({
    id: fields.driveId,
    name: fields.name || "file",
    size: fields.size,
    mimeType: fields.type,
  });
}

function loadScript(src) {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Google scripts load in the browser."));
  }
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    return existing.dataset.loaded === "1"
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
            once: true,
          });
        });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function requireClientId() {
  if (!isGoogleClientConfigured()) {
    const err = new Error(
      "Google sign-in is not configured yet. Paste a Web Client ID into GOOGLE_OAUTH_CLIENT_ID in docs/drive.js (see README)."
    );
    err.name = "DriveConfigError";
    throw err;
  }
}

function tokenClientOptions(callback, errorCallback) {
  return {
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    scope: DRIVE_READONLY_SCOPE,
    callback,
    error_callback: errorCallback,
  };
}

export async function signInWithGoogle({ prompt = "consent" } = {}) {
  requireClientId();
  await loadScript(GIS_SRC);
  const gis = globalThis.google?.accounts?.oauth2;
  if (!gis?.initTokenClient) {
    throw new Error("Google Identity Services did not load.");
  }
  return new Promise((resolve, reject) => {
    const client = gis.initTokenClient(
      tokenClientOptions(
        (resp) => {
          if (resp?.error || !resp?.access_token) {
            reject(new Error(resp?.error || "Google sign-in was cancelled."));
            return;
          }
          setAccessToken(resp.access_token);
          resolve(resp.access_token);
        },
        (err) => {
          const msg = err?.message || err?.type || "Google sign-in was cancelled.";
          const error = new Error(msg);
          error.name = err?.type === "popup_closed" ? "AbortError" : "DriveAuthError";
          reject(error);
        }
      )
    );
    client.requestAccessToken({ prompt });
  });
}

export async function refreshGoogleToken() {
  return signInWithGoogle({ prompt: "" });
}

export async function signOutGoogle() {
  const token = accessToken;
  setAccessToken(null);
  try {
    const oauth2 = globalThis.google?.accounts?.oauth2;
    if (token && oauth2?.revoke) {
      await new Promise((resolve) => oauth2.revoke(token, resolve));
    }
  } catch {
    /* ignore revoke failures */
  }
  return null;
}

export async function publishDriveToken(token = getAccessToken()) {
  setAccessToken(token);
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return token;
  const message = { type: DRIVE_TOKEN_MESSAGE, token: token || "" };
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage(message);
  } catch {
    /* SW not ready */
  }
  navigator.serviceWorker.controller?.postMessage(message);
  return token;
}

export async function fetchDriveUser(token = getAccessToken(), fetchImpl = fetch) {
  if (!token) return "";
  try {
    const body = await driveGetJson(`${DRIVE_API}/about?fields=user`, token, fetchImpl);
    return body?.user?.emailAddress || body?.user?.displayName || "";
  } catch {
    return "";
  }
}

export async function openGooglePicker(token = getAccessToken()) {
  if (!isPickerConfigured()) {
    const err = new Error(
      "Google Picker needs GOOGLE_PICKER_API_KEY in docs/drive.js (see README)."
    );
    err.name = "DriveConfigError";
    throw err;
  }
  if (!token) throw new Error("Sign in with Google first.");
  await loadScript(GAPI_SRC);
  const gapi = globalThis.gapi;
  if (!gapi?.load) throw new Error("Google API script did not load.");
  await new Promise((resolve, reject) => {
    gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("Picker failed to load")) });
  });
  const pickerNs = globalThis.google?.picker;
  if (!pickerNs) throw new Error("Google Picker did not load.");

  return new Promise((resolve) => {
    const folders = (owned) => {
      const view = new pickerNs.DocsView(pickerNs.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes(DRIVE_FOLDER_MIME);
      if (owned === false) view.setOwnedByMe(false);
      return view;
    };
    const picker = new pickerNs.PickerBuilder()
      .addView(folders(true))
      .addView(folders(false))
      .enableFeature(pickerNs.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_PICKER_API_KEY)
      .setTitle("Pick the shared Library folder")
      .setCallback((data) => {
        if (data[pickerNs.Response.ACTION] === pickerNs.Action.PICKED) {
          const doc = data[pickerNs.Response.DOCUMENTS]?.[0];
          resolve(doc ? { id: doc[pickerNs.Document.ID], name: doc[pickerNs.Document.NAME] } : null);
          return;
        }
        if (data[pickerNs.Response.ACTION] === pickerNs.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

/**
 * Resolve a Library folder, walk it, and return {path,file} entries for buildLibrary.
 * `chooseFolder` / `pickWithPicker` are UI callbacks supplied by the player or /shelf/.
 */
export async function loadDriveEntries({
  token,
  folderId,
  folderName,
  chooseFolder,
  pickWithPicker,
  fetchImpl = fetch,
} = {}) {
  if (!token) throw new Error("Sign in with Google first.");
  let folder = folderId ? { id: folderId, name: folderName || LIBRARY_FOLDER_NAME } : null;
  if (!folder) {
    const found = await findLibraryFolders(token, fetchImpl);
    folder = chooseSoleLibraryFolder(found);
    if (!folder && found.length && typeof chooseFolder === "function") {
      folder = await chooseFolder(found);
    }
    if (!folder && typeof pickWithPicker === "function") {
      folder = await pickWithPicker();
    }
    if (!folder && !found.length) {
      const err = new Error(
        "No folder named Library was found in My Drive or Shared with me.\n\nAsk Jeff to share Library with this Google account, or pick the folder."
      );
      err.name = "DriveLibraryMissing";
      err.candidates = found;
      throw err;
    }
    if (!folder) {
      const err = new Error("Pick the shared Library folder to continue.");
      err.name = "AbortError";
      err.candidates = found;
      throw err;
    }
  }
  const walked = await walkDriveFolder(folder.id, token, {
    prefix: walkPrefixForFolder(folder),
    fetchImpl,
  });
  return { ...walked, folder };
}
