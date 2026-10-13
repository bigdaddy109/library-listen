import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(join(ROOT, "docs/index.html"), "utf8");
const classic = readFileSync(join(ROOT, "docs/classic/index.html"), "utf8");
const shelf = readFileSync(join(ROOT, "docs/shelf/index.html"), "utf8");
const sw = readFileSync(join(ROOT, "docs/sw.js"), "utf8");

describe("homepage is the rice-paper shelf", () => {
  it("puts 書架 / 主題卡片 / 封面牆 and search-first on the root page", () => {
    assert.match(home, /class="shell-shelf"/);
    assert.match(home, />書架</);
    assert.match(home, /data-view="spines"/);
    assert.match(home, /data-view="topics"/);
    assert.match(home, /主題卡片/);
    assert.match(home, /data-view="covers"/);
    assert.match(home, /封面牆/);
    assert.match(home, /id="series-chips"/);
    assert.match(home, /id="stage"/);
    assert.match(home, /id="book-layer"/);
    const searchAt = home.indexOf('id="shelf-query"');
    const viewsAt = home.indexOf('class="view-toggle"');
    assert.ok(searchAt > 0 && viewsAt > searchAt, "search comes before view toggles");
  });

  it("keeps Drive sign-in, source sheet, player, EPUB, and Immune Concepts", () => {
    assert.match(home, /id="btn-google"/);
    assert.match(home, /用 Google 登入/);
    assert.match(home, /id="btn-pick-main"/);
    assert.match(home, /Use a local folder instead/);
    assert.match(home, /id="source-sheet"/);
    assert.match(home, /id="btn-sheet-reload"/);
    assert.match(home, /Reload library/);
    assert.match(home, /id="source-sheet-advanced"/);
    assert.match(home, /id="btn-sheet-signout"/);
    assert.match(home, /id="player-bar"/);
    assert.match(home, /id="tab-read"/);
    assert.match(home, /id="reader-frame"/);
    assert.match(home, /id="tab-concepts"/);
    assert.match(home, /id="concept-list"/);
    assert.match(home, /id="btn-offline"/);
    assert.doesNotMatch(home, /application\/pdf|\.pdf/i);
  });

  it("keeps the old dark player at /classic/ and redirects /shelf/ home", () => {
    assert.match(classic, /data-shell="classic"/);
    assert.match(classic, /Listen from your shared Library/);
    assert.match(classic, /id="shelf"/);
    assert.match(classic, /src="\.\.\/app\.js\?v=\d+"/);
    assert.match(classic, /href="\.\.\/"/);
    assert.match(home, /href="\.\/classic\/index\.html"/);
    assert.match(shelf, /location\.replace\("\.\.\/"\)/);
    assert.match(sw, /library-listen-shell-v37/);
    assert.match(sw, /"\.\/classic\/index\.html"/);
  });

  it("defines the 3D draw and honors reduced motion in shelf CSS", () => {
    const css = readFileSync(join(ROOT, "docs/shelf/shelf.css"), "utf8");
    assert.match(css, /\.book-3d\b/);
    assert.match(css, /\.draw-root\b/);
    assert.match(css, /transform-origin:\s*100% 50%/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /\.book-3d,/);
    assert.match(css, /\.spine-fore/);
    assert.match(css, /html\.no-book-3d/);
    assert.match(css, /-webkit-touch-callout/);
    assert.match(home, /id="btn-google"/);
    assert.match(home, /id="source-sheet"/);
    assert.match(home, /href="\.\/classic\/index\.html"/);
  });

  it("activates the new shell with skipWaiting and clients.claim inside waitUntil", () => {
    const install = sw.match(/addEventListener\("install",[\s\S]*?\n\}\);/);
    const activate = sw.match(/addEventListener\("activate",[\s\S]*?\n\}\);/);
    assert.ok(install, "install listener");
    assert.ok(activate, "activate listener");
    assert.match(install[0], /waitUntil/);
    assert.match(install[0], /skipWaiting/);
    assert.match(activate[0], /waitUntil/);
    assert.match(activate[0], /clients\.claim/);
    assert.match(sw, /library-listen-shell-v37/);
  });
});
