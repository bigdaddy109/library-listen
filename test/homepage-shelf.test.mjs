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
  it("puts 書架 / 封面牆 and search-first on the root page", () => {
    assert.match(home, /class="shell-shelf"/);
    assert.match(home, />書架</);
    assert.match(home, /data-view="spines"/);
    assert.match(home, /data-view="covers"/);
    assert.match(home, /封面牆/);
    assert.doesNotMatch(home, /data-view="topics"/);
    assert.doesNotMatch(home, /主題卡片/);
    assert.match(home, /id="series-chips"/);
    assert.match(home, /id="stage"/);
    assert.match(home, /id="book-layer"/);
    const searchAt = home.indexOf('id="shelf-query"');
    const viewsAt = home.indexOf('class="view-toggle"');
    assert.ok(searchAt > 0 && viewsAt > searchAt, "search comes before view toggles");
  });

  it("keeps Drive sign-in, source sheet, player, and Immune Concepts (no Read/ebook UI)", () => {
    assert.match(home, /id="btn-google"/);
    assert.match(home, /用 Google 登入/);
    assert.match(home, /id="btn-pick-main"/);
    assert.match(home, /改用本機資料夾/);
    assert.match(home, /id="source-sheet"/);
    assert.match(home, /id="btn-sheet-reload"/);
    assert.match(home, /重新載入書庫/);
    assert.match(home, /id="source-sheet-advanced"/);
    assert.match(home, /id="btn-sheet-signout"/);
    assert.match(home, /id="player-bar"/);
    assert.doesNotMatch(home, /id="tab-read"/);
    assert.doesNotMatch(home, /id="reader-frame"/);
    assert.doesNotMatch(home, /主題卡片/);
    assert.match(home, /id="tab-concepts"/);
    assert.match(home, /id="concept-list"/);
    assert.match(home, /id="btn-offline"/);
    assert.match(home, /id="read-this-book"/);
    assert.match(home, /id="player-read-this-book"/);
    assert.match(classic, /id="read-this-book"/);
    assert.match(classic, /id="player-read-this-book"/);
    assert.doesNotMatch(home, /application\/pdf|\.pdf/i);
  });

  it("shares one absolute og:image on a single line for every HTML page", () => {
    const image = "https://bigdaddy109.github.io/library-listen/og-image.png";
    const og = `<meta property="og:image" content="${image}" />`;
    const twitter = `<meta name="twitter:image" content="${image}" />`;
    for (const [label, html] of [
      ["docs/index.html", home],
      ["docs/classic/index.html", classic],
      ["docs/shelf/index.html", shelf],
    ]) {
      assert.ok(html.split("\n").some((line) => line.includes(og)), `${label} og:image`);
      assert.ok(
        html.split("\n").some((line) => line.includes(twitter)),
        `${label} twitter:image`
      );
      assert.match(html, /<meta property="og:title" content="[^"]+" \/>/);
      assert.match(html, /<meta property="og:description" content="[^"]+" \/>/);
      assert.match(html, /<meta property="og:image:width" content="1200" \/>/);
      assert.match(html, /<meta property="og:image:height" content="630" \/>/);
      assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
    }
    assert.match(sw, /"\.\/og-image\.png"/);
  });

  it("keeps the old dark player at /classic/ and redirects /shelf/ home", () => {
    assert.match(classic, /data-shell="classic"/);
    assert.match(classic, /聽共享的 Library/);
    assert.match(classic, /id="shelf"/);
    assert.match(classic, /src="\.\.\/app\.js\?v=\d+"/);
    assert.match(classic, /href="\.\.\/"/);
    assert.match(home, /href="\.\/classic\/index\.html"/);
    assert.match(shelf, /location\.replace\("\.\.\/"\)/);
    assert.match(sw, /library-listen-shell-v\d+/);
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

  it("defaults to the cover wall and zooms covers in 2D before the hinge", () => {
    const css = readFileSync(join(ROOT, "docs/shelf/shelf.css"), "utf8");
    const js = readFileSync(join(ROOT, "docs/shelf/shelf.js"), "utf8");
    const covers = home.indexOf('data-view="covers"');
    assert.ok(covers > 0 && covers < home.indexOf('data-view="spines"'), "cover wall is the first tab");
    assert.match(home, /data-view="covers" aria-pressed="true"/);
    assert.match(home, /data-view="spines" aria-pressed="false"/);
    assert.doesNotMatch(js, /renderTopics|topicMotifSvg|topic-card/);
    assert.doesNotMatch(css, /\.topics\b|\.topic-card\b|\.topic-chart\b/);
    assert.doesNotMatch(js, /startViewTransition/);
    assert.match(js, /showCoverSpread\(book, \{ opened: false \}\)/);
    assert.match(js, /flipMorph/);
    assert.match(js, /flipBook\(true\)/);
    assert.match(css, /\.cover-ghost\b/);
    const zoomAt = css.indexOf("/* Cover wall → book phase 1");
    const flipAt = css.indexOf("/* Book flip phase 2");
    assert.ok(zoomAt > 0 && flipAt > zoomAt, "zoom block then flip block");
    const zoom = css.slice(zoomAt, flipAt);
    assert.doesNotMatch(zoom, /perspective|rotate[XYZ3]|preserve-3d|translate3d/);
  });

  it("書架 taps share openCoverBook (zoom → hinge); spines carry cover art for the morph", () => {
    const css = readFileSync(join(ROOT, "docs/shelf/shelf.css"), "utf8");
    const js = readFileSync(join(ROOT, "docs/shelf/shelf.js"), "utf8");
    const openFn = js.slice(js.indexOf("function openFromShelf"), js.indexOf("function drawRootClass"));
    assert.match(openFn, /if \(!phaseHint\) \{\s*openCoverBook\(book\);\s*return;/);
    assert.doesNotMatch(openFn, /state\.view === "covers"/);
    assert.doesNotMatch(openFn, /playDraw|is-drawing|book-3d/);
    assert.match(js, /\.cover-card, \.spine/);
    assert.match(js, /btn\.querySelector\("\.cover-art"\)\.innerHTML = coverSvg\(book\)/);
    assert.match(css, /\.spine \.cover-art\s*\{/);
    assert.match(css, /\.spine \.cover-art\s*\{[^}]*opacity:\s*0/);
  });

  it("opens the book by swinging the front board left on its spine (rotateY only)", () => {
    const css = readFileSync(join(ROOT, "docs/shelf/shelf.css"), "utf8");
    const js = readFileSync(join(ROOT, "docs/shelf/shelf.js"), "utf8");
    const flip = css.slice(css.indexOf("/* Book flip phase 2"), css.indexOf("\n.book-layer {"));
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
    assert.match(css, /\.draw-root\.is-cover\.is-closed \.page\.right \.actions/);
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
    assert.match(sw, /library-listen-shell-v\d+/);
  });
});
