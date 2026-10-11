import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  applyScrollFraction,
  clampFraction,
  mimeForPath,
  parseEpub,
  rewriteSpineHtml,
  scrollFraction,
  spineCfi,
  spineIndexForChapter,
  spineIndexFromCfi,
  spineLabel,
  chapterMatchCore,
  unzip,
  zipPath,
} from "../docs/epub.js";

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

function putU16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function putU32(view, offset, value) {
  view.setUint32(offset, value, true);
}

/** Build a zip. `method` is "store" (default) or "deflate". */
function buildZip(entries, method = "store") {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const raw = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const nameBytes = new TextEncoder().encode(name);
    const stored = method === "deflate" ? deflateRawSync(raw) : raw;
    const zipMethod = method === "deflate" ? 8 : 0;
    const crc = crc32(raw);
    const local = new Uint8Array(30 + nameBytes.length + stored.length);
    const lv = new DataView(local.buffer);
    putU32(lv, 0, 0x04034b50);
    putU16(lv, 4, 20);
    putU16(lv, 8, zipMethod);
    putU32(lv, 14, crc);
    putU32(lv, 18, stored.length);
    putU32(lv, 22, raw.length);
    putU16(lv, 26, nameBytes.length);
    local.set(nameBytes, 30);
    local.set(stored, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    putU32(cv, 0, 0x02014b50);
    putU16(cv, 4, 20);
    putU16(cv, 6, 20);
    putU16(cv, 10, zipMethod);
    putU32(cv, 16, crc);
    putU32(cv, 20, stored.length);
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
  return buildZip([
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
    <dc:title>Solo Title</dc:title>
    <dc:identifier id="id">solo</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`,
    },
    {
      name: "OEBPS/nav.xhtml",
      data: `<html xmlns="http://www.w3.org/1999/xhtml"><body>
        <nav epub:type="toc"><ol>
          <li><a href="ch1.xhtml">Opening</a></li>
          <li><a href="ch2.xhtml">Later</a></li>
        </ol></nav>
      </body></html>`,
    },
    {
      name: "OEBPS/ch1.xhtml",
      data: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>
        <h1>Opening</h1>
        <img src="images/cover.png" alt="cover"/>
        <script>window.evil = true</script>
        <p>First spine.</p>
      </body></html>`,
    },
    {
      name: "OEBPS/ch2.xhtml",
      data: `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Later</h1><p>Second spine.</p></body></html>`,
    },
    { name: "OEBPS/images/cover.png", data: new Uint8Array([137, 80, 78, 71]) },
  ]);
}

describe("unzip + parseEpub", () => {
  it("reads a store-method EPUB spine and nav titles", async () => {
    const pub = await parseEpub(fixtureEpub());
    assert.equal(pub.title, "Solo Title");
    assert.equal(pub.spine.length, 2);
    assert.equal(pub.spine[0].title, "Opening");
    assert.equal(pub.spine[1].title, "Later");
    assert.equal(pub.spine[0].path, "OEBPS/ch1.xhtml");
    assert.ok(pub.read("OEBPS/ch1.xhtml"));
    assert.ok(pub.read("OEBPS/images/cover.png"));
  });

  it("inflates a deflate-method zip", async () => {
    const files = await unzip(buildZip([{ name: "hello.txt", data: "deflated hello" }], "deflate"));
    assert.equal(new TextDecoder().decode(files.get("hello.txt")), "deflated hello");
  });

  it("skips PDF-shaped files that are not zips", async () => {
    await assert.rejects(() => parseEpub(new TextEncoder().encode("%PDF-1.4").buffer), /zip|EPUB/i);
  });
});

describe("CFI + paths", () => {
  it("round-trips spine indexes through epubcfi(/6/N!)", () => {
    assert.equal(spineCfi(0), "epubcfi(/6/2!)");
    assert.equal(spineCfi(1), "epubcfi(/6/4!)");
    assert.equal(spineIndexFromCfi("epubcfi(/6/2!)"), 0);
    assert.equal(spineIndexFromCfi("epubcfi(/6/4!)"), 1);
    assert.equal(spineIndexFromCfi("epubcfi(/6/6[ch]!/4/2:0)"), 2);
    assert.equal(spineIndexFromCfi(""), 0);
  });

  it("resolves relative zip paths and clamps scroll fractions", () => {
    assert.equal(zipPath("OEBPS/", "images/cover.png"), "OEBPS/images/cover.png");
    assert.equal(zipPath("OEBPS/text/", "../images/a.png"), "OEBPS/images/a.png");
    assert.equal(zipPath("OEBPS/", "ch1.xhtml#frag"), "OEBPS/ch1.xhtml");
    assert.equal(clampFraction(1.4), 1);
    assert.equal(clampFraction(-2), 0);
    assert.equal(scrollFraction({ scrollTop: 25, scrollHeight: 200, clientHeight: 100 }), 0.25);
    const el = { scrollTop: 0, scrollHeight: 200, clientHeight: 100 };
    applyScrollFraction(el, 0.5);
    assert.equal(el.scrollTop, 50);
  });
});

describe("rewriteSpineHtml", () => {
  it("strips scripts, rewrites local images, and injects reader CSS", () => {
    const html = rewriteSpineHtml(
      `<html><head></head><body><img src="images/cover.png"/><script>alert(1)</script><a href="#note">note</a></body></html>`,
      (href) => (href === "images/cover.png" ? "blob:cover" : null)
    );
    assert.match(html, /blob:cover/);
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /data-library-listen-reader/);
    assert.match(html, /href="#note"/);
  });
});

describe("spineIndexForChapter", () => {
  const spine = (titles) => titles.map((title, index) => ({ index, title }));
  const chapters = (titles) => titles.map((title, index) => ({ id: `${index}`, title }));

  it("matches audio / m4b titles onto TOC labels before using index", () => {
    assert.equal(chapterMatchCore("Part 01"), "1");
    assert.equal(chapterMatchCore("Chapter 2"), "2");
    const items = spine(["Cover", "Part 01", "Part 02", "Part 03"]);
    const chs = chapters(["Part 01", "Part 02", "Part 03"]);
    assert.equal(spineIndexForChapter(items, chs, 0), 1);
    assert.equal(spineIndexForChapter(items, chs, 2), 3);
    assert.equal(
      spineIndexForChapter(spine(["Opening", "Later", "Closing"]), chapters(["Later"]), 0),
      1
    );
    assert.equal(
      spineIndexForChapter(
        spine(["Chapter 1", "Chapter 2", "Chapter 3"]),
        chapters(["Chapter 2"]),
        0
      ),
      1
    );
    assert.equal(
      spineIndexForChapter(
        spine(["Global Windstorm", "New York"]),
        chapters(["02 - Global Windstorm"]),
        0
      ),
      0
    );
  });

  it("falls back to equal-count or proportional index when titles do not match", () => {
    const items = spine(["Opening", "Later", "Closing"]);
    const parts = chapters(["Part 01", "Part 02", "Part 03", "Part 04", "Part 05"]);
    assert.equal(spineIndexForChapter(items, parts, 0), 0);
    assert.equal(spineIndexForChapter(items, parts, 4), 2);
    const paired = spine(["A", "B", "C"]);
    assert.equal(spineIndexForChapter(paired, chapters(["One", "Two", "Three"]), 1), 1);
    assert.equal(spineIndexForChapter([], chapters(["Part 01"]), 0), 0);
  });
});

describe("spineLabel", () => {
  it("labels a spine item without inventing a file-name title", () => {
    assert.equal(spineLabel({ title: "Opening", index: 0 }, 0, 2), "Opening · 1 of 2");
    assert.equal(spineLabel({ title: "", index: 1 }, 1, 2), "2 of 2");
    assert.equal(mimeForPath("OEBPS/images/cover.png"), "image/png");
    assert.equal(mimeForPath("nav.xhtml"), "application/xhtml+xml");
  });
});
