import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoCatalog, seriesIdForBook } from "../docs/shelf/catalog.js";
import {
  coverMark,
  coverSvg,
  coverUsesExternalImage,
  spineMetrics,
} from "../docs/shelf/covers.js";

describe("generated covers", () => {
  it("makes a distinct motif per series and never loads remote images", () => {
    const marks = new Set();
    for (const book of demoCatalog()) {
      const svg = coverSvg(book);
      const series = seriesIdForBook(book);
      marks.add(coverMark(series));
      assert.match(svg, new RegExp(`data-series="${series}"`));
      assert.equal(coverUsesExternalImage(svg), false);
      assert.doesNotMatch(svg, /<image\b/i);
      assert.match(svg, /<svg /);
    }
    assert.deepEqual([...marks].sort(), ["cell", "orbit", "seal"]);
    assert.notEqual(coverMark("school"), coverMark("munroe"));
    assert.notEqual(coverMark("munroe"), coverMark("immune"));
  });

  it("varies spine height and thickness", () => {
    const metrics = demoCatalog().map(spineMetrics);
    const heights = new Set(metrics.map((m) => m.height));
    const widths = new Set(metrics.map((m) => m.thickness));
    assert.ok(heights.size > 1);
    assert.ok(widths.size > 1);
    assert.ok(metrics.every((m) => m.height >= 168 && m.thickness >= 22));
    assert.ok(metrics.every((m) => m.lean >= -5 && m.lean <= 5));
  });

});
