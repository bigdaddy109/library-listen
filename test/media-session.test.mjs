import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARTWORK_SIZE,
  artworkLayout,
  isIOSDevice,
  lockScreenActions,
  svgCoverToPngUrl,
} from "../docs/media-session.js";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

describe("lock-screen controls", () => {
  it("recognises iPhone and iPadOS, not desktop Mac or Android", () => {
    assert.equal(isIOSDevice({ userAgent: IPHONE }), true);
    assert.equal(isIOSDevice({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 5 }), true, "iPadOS");
    assert.equal(isIOSDevice({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 }), false);
    assert.equal(isIOSDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)", platform: "Linux armv8l", maxTouchPoints: 5 }), false);
    assert.equal(isIOSDevice({}), false);
  });

  it("gives iOS ±skip buttons instead of track arrows; desktop keeps chapter arrows", () => {
    const ios = lockScreenActions({ ios: true });
    assert.deepEqual(ios.clear, ["previoustrack", "nexttrack"]);
    assert.ok(ios.register.includes("seekbackward") && ios.register.includes("seekforward"));
    assert.ok(!ios.register.includes("nexttrack") && !ios.register.includes("previoustrack"));
    const desk = lockScreenActions({ ios: false });
    assert.deepEqual(desk.clear, []);
    for (const name of ["play", "pause", "seekto", "seekbackward", "seekforward", "previoustrack", "nexttrack"]) {
      assert.ok(desk.register.includes(name), name);
    }
  });
});

describe("lock-screen artwork", () => {
  it("centres a portrait cover in the square with a margin", () => {
    const at = artworkLayout(160, 220, ARTWORK_SIZE);
    assert.equal(ARTWORK_SIZE, 512);
    assert.equal(at.height, 451);
    assert.equal(at.width, 328);
    assert.equal(at.x, 92);
    assert.equal(at.y, 31);
    assert.ok(at.x + at.width <= 512 && at.y + at.height <= 512);
  });

  it("returns no URL where there is no DOM to rasterise in", async () => {
    assert.equal(await svgCoverToPngUrl('<svg viewBox="0 0 160 220"></svg>'), "");
  });
});
