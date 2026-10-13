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
    assert.match(sw, /library-listen-shell-v44/);
    assert.match(sw, /"\.\/classic\/index\.html"/);
  });

  it("defines the 3D draw and honors reduced motion in shelf CSS", () => {
    const css = readFileSync(join(ROOT, "docs/shelf/shelf.css"), "utf8");
    assert.match(css, /\.book-3d\b/);
    assert.match(css, /\.book-3d-scene\b/);
    assert.match(css, /\.draw-root\b/);
    assert.match(css, /transform-origin:\s*100% 50%/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /\.book-3d,/);
    assert.match(css, /\.spine-fore/);
    assert.match(css, /html\.no-book-3d/);
    assert.doesNotMatch(css, /-webkit-touch-callout/);
    assert.doesNotMatch(css, /\.draw-root\s*\{[^}]*transform-style:\s*preserve-3d/);
    assert.match(css, /\.book-3d-scene\s*\{[^}]*perspective:/);
    assert.match(home, /id="btn-google"/);
    assert.match(home, /id="source-sheet"/);
    assert.match(home, /href="\.\/classic\/index\.html"/);
  });

  it("defaults to the cover wall and zooms covers in 2D", () => {
    const css = readFileSync(join(ROOT, "docs/shelf/shelf.css"), "utf8");
    const js = readFileSync(join(ROOT, "docs/shelf/shelf.js"), "utf8");
    const covers = home.indexOf('data-view="covers"');
    assert.ok(covers > 0 && covers < home.indexOf('data-view="spines"'), "cover wall is the first tab");
    assert.match(home, /data-view="covers" aria-pressed="true"/);
    assert.match(home, /data-view="spines" aria-pressed="false"/);
    assert.match(js, /startViewTransition/);
    assert.match(js, /viewTransitionName/);
    assert.match(css, /::view-transition-group\(book-cover\)/);
    assert.match(css, /\.cover-ghost\b/);
    const zoomAt = css.indexOf("/* Cover wall → book");
    const flipAt = css.indexOf("/* Book flip:");
    assert.ok(zoomAt > 0 && flipAt > zoomAt, "zoom block then flip block");
    const zoom = css.slice(zoomAt, flipAt);
    assert.doesNotMatch(zoom, /perspective|rotate[XYZ3]|preserve-3d|translate3d/);
  });

  it("opens the book by swinging the front board on its spine (rotateY only)", () => {
    const css = readFileSync(join(ROOT, "docs/shelf/shelf.css"), "utf8");
    const js = readFileSync(join(ROOT, "docs/shelf/shelf.js"), "utf8");
    const flip = css.slice(css.indexOf("/* Book flip:"), css.indexOf("\n.book-layer {"));
    assert.match(flip, /\.cover-leaf\s*\{[^}]*transform-origin:\s*0 50%/);
    assert.match(flip, /\.cover-leaf\s*\{[^}]*transform-style:\s*preserve-3d/);
    assert.match(flip, /is-opened \.cover-leaf\s*\{[^}]*rotateY\(-180deg\)/);
    assert.match(flip, /-webkit-backface-visibility:\s*hidden/);
    assert.match(flip, /\.leaf-back\s*\{[^}]*rotateY\(180deg\)/);
    assert.match(flip, /perspective:/);
    assert.doesNotMatch(flip, /rotate[XZ]\(|translate3d|matrix3d|transition:/);
    assert.match(js, /class="cover-leaf"/);
    assert.match(js, /leaf-front/);
    assert.match(js, /leaf-back/);
  });

  it("picks up a new release: HTML revalidated, update checks on resume, no reload mid-chapter", () => {
    const app = readFileSync(join(ROOT, "docs/app.js"), "utf8");
    const fetchHtml = sw.slice(sw.indexOf('request.mode === "navigate"'));
    assert.match(fetchHtml.slice(0, 400), /fetch\(request, \{ cache: "no-cache" \}\)/);
    assert.match(app, /addEventListener\("visibilitychange"[\s\S]{0,120}checkForUpdate\(\)/);
    assert.match(app, /addEventListener\("pageshow"/);
    assert.match(app, /reg\?\.update\(\)/);
    assert.match(app, /function reloadWhenIdle\(\)[\s\S]{0,160}audio\.paused/);
    assert.match(app, /controllerchange[\s\S]{0,120}reloadWhenIdle\(\)/);
    assert.match(home, /id="app-version"/);
    assert.match(app, /searchParams\.get\("v"\)/);
  });

  it("dresses the open book as paper: lifting shadow, gutter, page-block edges", () => {
    const css = readFileSync(join(ROOT, "docs/shelf/shelf.css"), "utf8");
    const js = readFileSync(join(ROOT, "docs/shelf/shelf.js"), "utf8");
    assert.match(js, /class="page-shade"/);
    assert.match(js, /\.page\.right \.page-shade/);
    assert.match(css, /\.draw-root\.is-cover\.is-closed \.page-shade\s*\{[^}]*opacity:\s*1/);
    assert.match(css, /\.draw-root\.is-cover \.page\.right\s*\{[^}]*#f8f0e1/);
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
    assert.match(sw, /library-listen-shell-v44/);
  });
});
