import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildLibrary, shelfBadge } from "../docs/library.js";
import { parseEpub } from "../docs/epub.js";
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_PICKER_API_KEY,
  DRIVE_ERROR_KIND,
  DRIVE_ERROR_MESSAGES,
  DRIVE_FOLDER_MIME,
  DRIVE_READONLY_SCOPE,
  DRIVE_SESSION_KEY,
  LIBRARY_FOLDER_NAME,
  attachDriveMedia,
  childrenQuery,
  chooseSoleLibraryFolder,
  classifyDriveError,
  clearDriveSession,
  downloadDriveBuffer,
  driveAltMediaUrl,
  driveFileIdFromPath,
  driveFilesToEntries,
  driveListUrl,
  driveMediaPath,
  driveMediaProxyOutHeaders,
  driveProxyHeaders,
  findLibraryFolders,
  gisAuthFailure,
  isDriveFile,
  isDriveMediaPath,
  isGisCoopWindowClosedWarning,
  isGoogleClientConfigured,
  isPickerConfigured,
  isPlaceholderClientId,
  libraryFolderLabel,
  libraryFolderQuery,
  loadDriveEntries,
  loadDriveSession,
  sourceDialogActions,
  makeDriveFile,
  mimeForDriveName,
  planDriveMediaProxy,
  proxyDriveMediaRequest,
  rankLibraryFolders,
  resolveDriveItem,
  saveDriveSession,
  setAccessToken,
  setDriveRangeFetch,
  shouldNotifyDriveUnauthorized,
  shouldSkipDriveName,
  tokenClientOptions,
  uniqueDriveFolders,
  walkDriveFolder,
  walkPrefixForFolder,
} from "../docs/drive.js";

const FOLDER = DRIVE_FOLDER_MIME;

function folder(id, name, parents, extra = {}) {
  return { id, name, mimeType: FOLDER, parents, ...extra };
}

function audio(id, name, parents, size = 2048) {
  return { id, name, mimeType: "audio/mpeg", size, parents };
}

function epub(id, name, parents, size = 4096) {
  return { id, name, mimeType: "application/epub+zip", size, parents };
}

function cover(id, name, parents, size = 800) {
  return { id, name, mimeType: "image/jpeg", size, parents };
}

function munroeTree() {
  return [
    folder("lib", "Library"),
    folder("munroe", "門羅-WhatIf", ["lib"]),
    folder("listen", "listen", ["munroe"]),
    folder("ebooks", "ebooks", ["munroe"]),
    folder("book", "what-if-1", ["listen"]),
    audio("a1", "01 - Introduction.mp3", ["book"]),
    audio("a2", "02 - Global Windstorm.mp3", ["book"]),
    cover("c1", "cover.jpg", ["book"]),
    epub("e1", "what-if-1.epub", ["ebooks"]),
    folder("immune", "Immune", ["lib"]),
    folder("ilisten", "listen", ["immune"]),
    folder("iebooks", "ebooks", ["immune"]),
    audio("p1", "Immune-Part01.mp3", ["ilisten"]),
    audio("p2", "Immune-Part02.mp3", ["ilisten"]),
    epub("ie", "Immune.epub", ["iebooks"]),
    folder("hidden", "_source", ["lib"]),
    audio("ghost", "ghost.mp3", ["hidden"]),
    audio("empty", "empty-cloud.mp3", ["ilisten"], 0),
    { id: "pdf", name: "notes.pdf", mimeType: "application/pdf", size: 1000, parents: ["iebooks"] },
  ];
}

function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

function mockDriveFetch(tree) {
  return async (url) => {
    const u = new URL(url, "https://www.googleapis.com");
    const q = u.searchParams.get("q") || "";
    const parent = q.match(/'([^']+)' in parents/);
    let files = tree;
    if (parent) {
      files = tree.filter((item) => (item.parents || [])[0] === parent[1]);
    } else if (q.includes("name='Library'")) {
      files = tree.filter((item) => item.name === "Library" && item.mimeType === FOLDER);
      if (q.includes("sharedWithMe=true")) {
        files = files.filter((item) => item.sharedWithMe || item.shared);
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ files }),
      text: async () => JSON.stringify({ files }),
    };
  };
}

describe("Google Drive public client config", () => {
  it("ships the public Web Client ID so GIS can open without a paste alert", () => {
    assert.equal(
      GOOGLE_OAUTH_CLIENT_ID,
      "827714015808-hp9o0gl26mbcs8mmipjfu2dtuvv9vdo3.apps.googleusercontent.com"
    );
    assert.match(GOOGLE_OAUTH_CLIENT_ID, /\.apps\.googleusercontent\.com$/);
    assert.equal(isPlaceholderClientId(GOOGLE_OAUTH_CLIENT_ID), false);
    assert.equal(isGoogleClientConfigured(), true);
  });

  it("ships the referrer-restricted Picker API key", () => {
    assert.equal(GOOGLE_PICKER_API_KEY, "AIzaSyBaeZWLYArw6iH-5-ietM3AyI8MNLOYui4");
    assert.equal(isPickerConfigured(), true);
  });

  it("requests drive.readonly only", () => {
    assert.equal(DRIVE_READONLY_SCOPE, "https://www.googleapis.com/auth/drive.readonly");
    assert.equal(DRIVE_READONLY_SCOPE.includes("drive.file"), false);
    assert.equal(DRIVE_READONLY_SCOPE.includes("drive.appdata"), false);
  });

  it("detects a real-looking client id vs the placeholder", () => {
    assert.equal(isPlaceholderClientId(""), true);
    assert.equal(
      isPlaceholderClientId("123456789012-abcdef.apps.googleusercontent.com"),
      false
    );
  });
});

describe("Drive queries and media URLs", () => {
  it("searches My Drive and Shared with me for a Library folder", () => {
    assert.equal(
      libraryFolderQuery(),
      "name='Library' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    assert.match(libraryFolderQuery({ sharedWithMe: true }), /sharedWithMe=true/);
    assert.match(childrenQuery("abc"), /'abc' in parents/);
  });

  it("builds Drive list URLs with all-drives flags", () => {
    const url = new URL(driveListUrl({ q: libraryFolderQuery() }));
    assert.equal(url.searchParams.get("includeItemsFromAllDrives"), "true");
    assert.equal(url.searchParams.get("supportsAllDrives"), "true");
    assert.equal(url.searchParams.get("corpora"), "user");
  });

  it("maps same-origin /drive-media/ paths to a file id and forwards Range", () => {
    assert.equal(isDriveMediaPath("/library-listen/drive-media/file-1"), true);
    assert.equal(isDriveMediaPath("/styles.css"), false);
    assert.equal(driveFileIdFromPath("/library-listen/drive-media/file%2F1"), "file/1");
    assert.equal(driveMediaPath("abc"), "./drive-media/abc");
    assert.match(driveAltMediaUrl("abc"), /files\/abc\?alt=media/);
    assert.deepEqual(driveProxyHeaders({ Range: "bytes=0-99" }, "tok"), {
      Authorization: "Bearer tok",
      Range: "bytes=0-99",
    });
    assert.deepEqual(
      driveProxyHeaders({ get: (n) => (n === "Range" ? "bytes=2-3" : null) }, "tok"),
      { Authorization: "Bearer tok", Range: "bytes=2-3" }
    );
  });
});

describe("Drive folder ranking (Kerry / Daryl shared Library)", () => {
  it("uses a single Library folder whether owned or shared", () => {
    const shared = {
      id: "shared-lib",
      name: "Library",
      ownedByMe: false,
      shared: true,
      owners: [{ displayName: "Jeff" }],
    };
    assert.equal(chooseSoleLibraryFolder([shared])?.id, "shared-lib");
    assert.equal(libraryFolderLabel(shared), "Library (shared by Jeff)");
    assert.equal(
      libraryFolderLabel({ name: "Library", ownedByMe: true }),
      "Library (your Drive)"
    );
  });

  it("ranks an owned Library first but does not auto-pick when several exist", () => {
    const folders = rankLibraryFolders([
      { id: "s", name: "Library", ownedByMe: false, shared: true },
      { id: "s", name: "Library", ownedByMe: false },
      { id: "m", name: "Library", ownedByMe: true },
    ]);
    assert.deepEqual(
      folders.map((f) => f.id),
      ["m", "s"]
    );
    assert.equal(chooseSoleLibraryFolder(folders), null);
    assert.equal(uniqueDriveFolders(folders).length, 2);
  });
});

describe("Drive walker feeds the existing library pairing", () => {
  it("skips _source, hidden names, and empty audio the same way as the local walker", () => {
    assert.equal(shouldSkipDriveName("_source"), true);
    assert.equal(shouldSkipDriveName("_draft"), true);
    assert.equal(shouldSkipDriveName(".DS_Store"), true);
    assert.equal(shouldSkipDriveName("listen"), false);
    assert.deepEqual(walkPrefixForFolder({ name: "Library" }), ["Library"]);
  });

  it("follows Drive shortcuts to the target file", () => {
    const item = resolveDriveItem({
      id: "shortcut",
      name: "Immune.epub",
      mimeType: "application/vnd.google-apps.shortcut",
      shortcutDetails: {
        targetId: "real-epub",
        targetMimeType: "application/epub+zip",
      },
    });
    assert.equal(item.id, "real-epub");
    assert.equal(item.mimeType, "application/epub+zip");
  });

  it("builds Library/listen + ebooks paths that pair Immune and Munroe", () => {
    const entries = driveFilesToEntries(munroeTree(), {
      rootId: "lib",
      rootName: "Library",
    });
    const paths = entries.map((e) => e.path).sort();
    assert.ok(paths.includes("Library/Immune/listen/Immune-Part01.mp3"));
    assert.ok(paths.includes("Library/Immune/ebooks/Immune.epub"));
    assert.ok(paths.includes("Library/門羅-WhatIf/listen/what-if-1/01 - Introduction.mp3"));
    assert.ok(paths.includes("Library/門羅-WhatIf/ebooks/what-if-1.epub"));
    assert.equal(paths.some((p) => p.includes("_source")), false);
    assert.equal(paths.some((p) => p.includes("empty-cloud")), false);
    assert.equal(paths.some((p) => p.endsWith(".pdf")), false);
    assert.equal(entries.every((e) => isDriveFile(e.file)), true);

    const books = buildLibrary(entries);
    const immune = books.find((b) => b.id === "immune/immune");
    const whatIf = books.find((b) => b.id === "munroe/what-if-1");
    assert.equal(immune.chapters.length, 2);
    assert.equal(immune.ebook?.name, "Immune.epub");
    assert.equal(shelfBadge(immune), "Both");
    assert.equal(whatIf.chapters.length, 2);
    assert.equal(whatIf.coverFile?.driveId, "c1");
    assert.equal(whatIf.ebook?.file?.driveId, "e1");
    assert.equal(shelfBadge(whatIf), "Both");
  });

  it("walks Drive children through the mocked API and attaches stream URLs", async () => {
    const { entries, skipped } = await walkDriveFolder("lib", "tok", {
      prefix: ["Library"],
      fetchImpl: mockDriveFetch(munroeTree()),
    });
    assert.ok(skipped >= 1);
    const books = attachDriveMedia(buildLibrary(entries), {
      base: "https://bigdaddy109.github.io/library-listen/",
    });
    const immune = books.find((b) => b.id === "immune/immune");
    assert.equal(immune.source, "drive");
    assert.equal(
      immune.chapters[0].url,
      "https://bigdaddy109.github.io/library-listen/drive-media/p1"
    );
    assert.equal(immune.ebook.driveId, "ie");
  });

  it("finds a shared-with-me Library and walks it via loadDriveEntries", async () => {
    const tree = [
      folder("shared-lib", "Library", undefined, { shared: true, sharedWithMe: true, ownedByMe: false }),
      ...munroeTree().filter((item) => item.id !== "lib").map((item) =>
        item.parents?.[0] === undefined ? item : item
      ),
    ];
    tree.find((item) => item.id === "munroe").parents = ["shared-lib"];
    tree.find((item) => item.id === "immune").parents = ["shared-lib"];

    const found = await findLibraryFolders("tok", mockDriveFetch(tree));
    assert.equal(found.length, 1);
    assert.equal(found[0].id, "shared-lib");

    const result = await loadDriveEntries({
      token: "tok",
      fetchImpl: mockDriveFetch(tree),
    });
    assert.equal(result.folder.id, "shared-lib");
    const books = buildLibrary(result.entries);
    assert.ok(books.some((b) => b.id === "immune/immune"));
    assert.ok(books.some((b) => b.id === "munroe/what-if-1"));
  });

  it("asks the UI to choose when several Library folders exist", async () => {
    const tree = [
      folder("mine", "Library", undefined, { ownedByMe: true }),
      folder("shared-lib", "Library", undefined, { shared: true, sharedWithMe: true, ownedByMe: false }),
    ];
    let seen = [];
    const result = await loadDriveEntries({
      token: "tok",
      fetchImpl: mockDriveFetch(tree),
      chooseFolder: async (candidates) => {
        seen = candidates;
        return candidates.find((c) => c.id === "shared-lib");
      },
    });
    assert.equal(seen.length, 2);
    assert.equal(result.folder.id, "shared-lib");
  });

  it("auto-loads the ranked Library folder when several exist and no chooser is passed", async () => {
    const tree = [
      folder("mine", "Library", undefined, { ownedByMe: true }),
      folder("shared-lib", "Library", undefined, { shared: true, sharedWithMe: true, ownedByMe: false }),
    ];
    let pickerCalls = 0;
    const result = await loadDriveEntries({
      token: "tok",
      fetchImpl: mockDriveFetch(tree),
      pickWithPicker: async () => {
        pickerCalls += 1;
        return { id: "picked", name: "Library" };
      },
    });
    assert.equal(result.folder.id, "mine");
    assert.equal(pickerCalls, 0);
  });

  it("falls back to Google Picker only when no Library folder is found", async () => {
    let pickerCalls = 0;
    const result = await loadDriveEntries({
      token: "tok",
      fetchImpl: mockDriveFetch([]),
      pickWithPicker: async () => {
        pickerCalls += 1;
        return { id: "picked", name: "Library" };
      },
    });
    assert.equal(pickerCalls, 1);
    assert.equal(result.folder.id, "picked");
  });
});

describe("source dialog actions", () => {
  it("shows Sign in plus a local-folder link when signed out", () => {
    assert.deepEqual(sourceDialogActions({ signedIn: false }), {
      google: true,
      reload: false,
      signout: false,
      localLink: true,
      local: false,
      files: true,
      picker: false,
      advanced: true,
    });
  });

  it("shows Reload and Sign out only when signed in, with local picks under Advanced", () => {
    const actions = sourceDialogActions({ signedIn: true });
    assert.equal(actions.google, false);
    assert.equal(actions.reload, true);
    assert.equal(actions.signout, true);
    assert.equal(actions.localLink, false);
    assert.equal(actions.local, true);
    assert.equal(actions.files, true);
    assert.equal(actions.picker, false);
    assert.equal(actions.advanced, true);
  });
});

describe("Drive file adapter and session", () => {
  it("exposes driveId plus range slice for marker reads and full download for EPUB", async () => {
    const file = makeDriveFile({
      id: "ep",
      name: "Immune.epub",
      size: 8,
      mimeType: "application/epub+zip",
    });
    assert.equal(isDriveFile(file), true);
    assert.equal(file.name, "Immune.epub");
    assert.equal(mimeForDriveName("Immune.epub"), "application/epub+zip");

    const calls = [];
    setDriveRangeFetch(async (id, start, end) => {
      calls.push([id, start, end]);
      return new Uint8Array([1, 2, 3, 4]).buffer;
    });
    const part = await file.slice(2, 6).arrayBuffer();
    assert.equal(part.byteLength, 4);
    assert.deepEqual(calls, [["ep", 2, 6]]);
    setDriveRangeFetch(null);
  });

  it("stores the chosen folder id without an OAuth token", () => {
    const store = memoryStore();
    setAccessToken("must-not-be-written");
    saveDriveSession({ folderId: "lib", folderName: "Library", email: "kerry@example.com" }, store);
    assert.equal(JSON.parse(store.getItem(DRIVE_SESSION_KEY)).folderId, "lib");
    assert.equal(String(store.getItem(DRIVE_SESSION_KEY)).includes("must-not-be-written"), false);
    assert.equal(loadDriveSession(store).email, "kerry@example.com");
    clearDriveSession(store);
    assert.equal(loadDriveSession(store), null);
    setAccessToken(null);
  });
});

const COOP_WINDOW_CLOSED =
  "Cross-Origin-Opener-Policy policy would block the window.closed call.";

function putU16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function putU32(view, offset, value) {
  view.setUint32(offset, value, true);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const raw = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(raw);
    const local = new Uint8Array(30 + nameBytes.length + raw.length);
    const lv = new DataView(local.buffer);
    putU32(lv, 0, 0x04034b50);
    putU16(lv, 4, 20);
    putU32(lv, 14, crc);
    putU32(lv, 18, raw.length);
    putU32(lv, 22, raw.length);
    putU16(lv, 26, nameBytes.length);
    local.set(nameBytes, 30);
    local.set(raw, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    putU32(cv, 0, 0x02014b50);
    putU16(cv, 4, 20);
    putU16(cv, 6, 20);
    putU32(cv, 16, crc);
    putU32(cv, 20, raw.length);
    putU32(cv, 24, raw.length);
    putU16(cv, 28, nameBytes.length);
    putU32(cv, 42, offset);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  putU32(ev, 0, 0x06054b50);
  putU16(ev, 8, entries.length);
  putU16(ev, 10, entries.length);
  putU32(ev, 12, cdSize);
  putU32(ev, 16, offset);
  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const part of locals) {
    out.set(part, pos);
    pos += part.length;
  }
  for (const part of centrals) {
    out.set(part, pos);
    pos += part.length;
  }
  out.set(eocd, pos);
  return out.buffer;
}

function fixtureEpub() {
  return storeZip([
    { name: "mimetype", data: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      data: `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    },
    {
      name: "OEBPS/content.opf",
      data: `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Immune</dc:title>
    <dc:identifier id="id">immune</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`,
    },
    {
      name: "OEBPS/nav.xhtml",
      data: `<html xmlns="http://www.w3.org/1999/xhtml"><body>
        <nav epub:type="toc"><ol><li><a href="ch1.xhtml">Opening</a></li></ol></nav>
      </body></html>`,
    },
    {
      name: "OEBPS/ch1.xhtml",
      data: `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Opening</h1><p>Drive EPUB.</p></body></html>`,
    },
  ]);
}

describe("Drive user-visible errors", () => {
  it("treats GIS COOP window.closed as harmless and does not fail sign-in", () => {
    assert.equal(isGisCoopWindowClosedWarning(COOP_WINDOW_CLOSED), true);
    assert.equal(classifyDriveError({ message: COOP_WINDOW_CLOSED }).kind, DRIVE_ERROR_KIND.coop);
    assert.equal(gisAuthFailure({ message: COOP_WINDOW_CLOSED }), null);
    const opts = tokenClientOptions(() => {}, () => {});
    assert.equal("ux_mode" in opts, false);
    assert.equal(opts.scope, DRIVE_READONLY_SCOPE);
  });

  it("explains Testing-mode test-user denial, missing Library, and expired tokens", () => {
    const testUser = classifyDriveError({
      error: "access_denied",
      error_description: "Access denied: this app is currently being tested and can only be accessed by approved testers.",
    });
    assert.equal(testUser.kind, DRIVE_ERROR_KIND.testUser);
    assert.match(testUser.message, /test user/);
    assert.match(testUser.message, /Testing mode/);

    const denied = classifyDriveError({ error: "access_denied" });
    assert.equal(denied.kind, DRIVE_ERROR_KIND.accessDenied);
    assert.match(denied.message, /Choose Library folder/);

    const missing = classifyDriveError({ name: "DriveLibraryMissing" });
    assert.equal(missing.kind, DRIVE_ERROR_KIND.noLibrary);
    assert.equal(missing.message, DRIVE_ERROR_MESSAGES.noLibrary);

    const expired = classifyDriveError({ status: 401, name: "DriveAuthError" });
    assert.equal(expired.kind, DRIVE_ERROR_KIND.expired);
    assert.match(expired.message, /expired/);
    assert.match(expired.message, /用 Google 登入/);

    const closed = classifyDriveError({ type: "popup_closed" });
    assert.equal(closed.kind, DRIVE_ERROR_KIND.abort);
    assert.equal(closed.silent, true);
  });

  it("surfaces no Library and expired Drive HTTP as thrown errors the player can show", async () => {
    await assert.rejects(
      () => loadDriveEntries({ token: "tok", fetchImpl: mockDriveFetch([]) }),
      (err) => {
        assert.equal(err.name, "DriveLibraryMissing");
        assert.equal(err.kind, DRIVE_ERROR_KIND.noLibrary);
        assert.match(err.message, /Library/);
        return true;
      }
    );

    const unauthorized = async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => JSON.stringify({ error: { message: "Invalid Credentials" } }),
    });
    await assert.rejects(() => findLibraryFolders("tok", unauthorized), (err) => {
      assert.equal(err.name, "DriveAuthError");
      assert.equal(err.kind, DRIVE_ERROR_KIND.expired);
      assert.equal(err.message, DRIVE_ERROR_MESSAGES.expired);
      return true;
    });

    const forbidden = async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () =>
        JSON.stringify({
          error: { code: 403, message: "The user does not have sufficient permissions for this file." },
        }),
    });
    await assert.rejects(() => findLibraryFolders("tok", forbidden), (err) => {
      assert.equal(err.kind, DRIVE_ERROR_KIND.noLibrary);
      assert.match(err.message, /share Library/);
      return true;
    });

    await assert.rejects(
      () => downloadDriveBuffer("p1", "tok", unauthorized),
      (err) => {
        assert.equal(err.kind, DRIVE_ERROR_KIND.expired);
        return true;
      }
    );
  });
});

describe("Drive audio proxy and EPUB reader", () => {
  it("forwards Range to Drive alt=media and never caches the bytes", async () => {
    const plan = planDriveMediaProxy({ fileId: "p1", range: "bytes=0-1023", token: "tok" });
    assert.equal(plan.ok, true);
    assert.match(plan.dest, /files\/p1\?alt=media/);
    assert.equal(plan.headers.Authorization, "Bearer tok");
    assert.equal(plan.headers.Range, "bytes=0-1023");
    assert.deepEqual(
      driveMediaProxyOutHeaders({
        get: (name) =>
          ({
            "content-type": "audio/mpeg",
            "content-range": "bytes 0-1023/5000",
            "content-length": "1024",
            "accept-ranges": "bytes",
          })[name],
      }),
      {
        "Cache-Control": "no-store",
        "Content-Type": "audio/mpeg",
        "Content-Length": "1024",
        "Content-Range": "bytes 0-1023/5000",
        "Accept-Ranges": "bytes",
      }
    );
    assert.equal(shouldNotifyDriveUnauthorized(401), true);
    assert.equal(planDriveMediaProxy({ fileId: "p1", token: "" }).status, 401);

    let seen = null;
    const proxied = await proxyDriveMediaRequest(
      { fileId: "p1", range: "bytes=200-399", token: "tok" },
      async (url, init) => {
        seen = { url, init };
        return {
          ok: false,
          status: 206,
          statusText: "Partial Content",
          headers: {
            get: (name) => (name === "content-range" ? "bytes 200-399/9000" : null),
          },
          arrayBuffer: async () => new Uint8Array([9, 8]).buffer,
        };
      }
    );
    assert.match(seen.url, /alt=media/);
    assert.equal(seen.init.headers.Range, "bytes=200-399");
    assert.equal(proxied.status, 206);
    assert.equal(proxied.headers["Cache-Control"], "no-store");
    assert.equal(proxied.headers["Content-Range"], "bytes 200-399/9000");
    assert.equal(proxied.notifyUnauthorized, false);

    const expired = await proxyDriveMediaRequest(
      { fileId: "p1", range: "bytes=0-1", token: "tok" },
      async () => ({ ok: false, status: 401, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) })
    );
    assert.equal(expired.status, 401);
    assert.equal(expired.notifyUnauthorized, true);
  });

  it("keeps the service worker Range proxy in lockstep with the tested helper", () => {
    const sw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../docs/sw.js"), "utf8");
    assert.match(sw, /request\.headers\.get\("Range"\)/);
    assert.match(sw, /Cache-Control", "no-store"/);
    assert.match(sw, /DRIVE_UNAUTHORIZED_MESSAGE/);
    assert.match(sw, /res\.status === 401/);
    assert.match(sw, /alt=media/);
    assert.match(sw, /library-listen-shell-v\d+/);
  });

  it("opens a Drive EPUB buffer with the existing reader", async () => {
    const buf = fixtureEpub();
    const file = makeDriveFile({
      id: "ie",
      name: "Immune.epub",
      size: buf.byteLength,
      mimeType: "application/epub+zip",
    });
    setDriveRangeFetch(async (id, start, end) => {
      assert.equal(id, "ie");
      assert.equal(start, 0);
      assert.equal(end, buf.byteLength);
      return buf;
    });
    const pub = await parseEpub(await file.arrayBuffer());
    setDriveRangeFetch(null);
    assert.equal(pub.title, "Immune");
    assert.equal(pub.spine.length, 1);
    assert.equal(pub.spine[0].title, "Opening");
    assert.match(new TextDecoder().decode(pub.read("OEBPS/ch1.xhtml")), /Drive EPUB/);
  });

  it("keeps local folder pick on the homepage", () => {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../docs/index.html"), "utf8");
    assert.match(html, /id="btn-google"/);
    assert.match(html, /id="btn-pick-main"/);
    assert.match(html, /Use a local folder instead/);
    assert.match(html, /Choose Library folder/);
    assert.match(html, /id="btn-pick-files"/);
    assert.match(html, /id="drive-status"/);
    assert.match(html, /id="btn-sheet-reload"/);
    assert.match(html, /Reload library/);
    assert.match(html, /id="source-sheet-advanced"/);
    assert.match(html, />Advanced</);
    assert.match(html, /id="btn-sheet-signout"/);
    assert.match(html, /Sign out/);
  });
});
