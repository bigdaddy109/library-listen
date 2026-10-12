import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLibrary, shelfBadge } from "../docs/library.js";
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_PICKER_API_KEY,
  DRIVE_FOLDER_MIME,
  DRIVE_READONLY_SCOPE,
  DRIVE_SESSION_KEY,
  LIBRARY_FOLDER_NAME,
  attachDriveMedia,
  childrenQuery,
  chooseSoleLibraryFolder,
  clearDriveSession,
  driveAltMediaUrl,
  driveFileIdFromPath,
  driveFilesToEntries,
  driveListUrl,
  driveMediaPath,
  driveProxyHeaders,
  findLibraryFolders,
  isDriveFile,
  isDriveMediaPath,
  isGoogleClientConfigured,
  isPickerConfigured,
  isPlaceholderClientId,
  libraryFolderLabel,
  libraryFolderQuery,
  loadDriveEntries,
  loadDriveSession,
  makeDriveFile,
  mimeForDriveName,
  rankLibraryFolders,
  resolveDriveItem,
  saveDriveSession,
  setAccessToken,
  setDriveRangeFetch,
  shouldSkipDriveName,
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
    };
  };
}

describe("Google Drive config placeholders", () => {
  it("keeps the OAuth client id as a named placeholder, not a real secret", () => {
    assert.match(GOOGLE_OAUTH_CLIENT_ID, /YOUR_GOOGLE_OAUTH_CLIENT_ID/);
    assert.match(GOOGLE_OAUTH_CLIENT_ID, /\.apps\.googleusercontent\.com$/);
    assert.equal(isPlaceholderClientId(GOOGLE_OAUTH_CLIENT_ID), true);
    assert.equal(isGoogleClientConfigured(), false);
    assert.doesNotMatch(GOOGLE_OAUTH_CLIENT_ID, /^\d{12}-/);
  });

  it("keeps the Picker API key as a named placeholder", () => {
    assert.match(GOOGLE_PICKER_API_KEY, /YOUR_GOOGLE_PICKER_API_KEY/);
    assert.equal(isPickerConfigured(), false);
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
