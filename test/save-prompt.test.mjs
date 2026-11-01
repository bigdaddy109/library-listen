import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SAVE_OFFER_KEY,
  declineSaveOffer,
  isSaveOfferDeclined,
  shouldOfferSaveWhileListening,
} from "../docs/save-prompt.js";

const appJs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../docs/app.js"), "utf8");

function memoryStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

const book = { id: "immune", title: "Immune" };

describe("shouldOfferSaveWhileListening", () => {
  it("offers on a phone when the book can play and is not saved yet", () => {
    assert.equal(
      shouldOfferSaveWhileListening({
        book,
        isPlayable: true,
        isOffline: false,
        phone: true,
      }),
      true
    );
  });

  it("stays quiet on desktop", () => {
    assert.equal(
      shouldOfferSaveWhileListening({
        book,
        isPlayable: true,
        isOffline: false,
        phone: false,
      }),
      false
    );
  });

  it("stays quiet when the book is already saved on this device", () => {
    assert.equal(
      shouldOfferSaveWhileListening({
        book,
        isPlayable: true,
        isOffline: true,
        phone: true,
      }),
      false
    );
  });

  it("stays quiet when the book is not playable yet", () => {
    assert.equal(
      shouldOfferSaveWhileListening({
        book,
        isPlayable: false,
        isOffline: false,
        phone: true,
      }),
      false
    );
  });

  it("stays quiet with no book", () => {
    assert.equal(
      shouldOfferSaveWhileListening({
        book: null,
        isPlayable: true,
        isOffline: false,
        phone: true,
      }),
      false
    );
    assert.equal(shouldOfferSaveWhileListening(), false);
  });

  it("remembers not now for that book so another chapter does not ask", () => {
    const store = memoryStore();
    assert.equal(isSaveOfferDeclined(book.id, store), false);
    assert.equal(declineSaveOffer(book.id, store), true);
    assert.equal(isSaveOfferDeclined(book.id, store), true);
    assert.equal(isSaveOfferDeclined("munroe/what-if-1", store), false);
    const declined = isSaveOfferDeclined(book.id, store);
    assert.equal(
      shouldOfferSaveWhileListening({
        book,
        isPlayable: true,
        isOffline: false,
        phone: true,
        declined,
      }),
      false
    );
    const raw = JSON.parse(store.getItem(SAVE_OFFER_KEY));
    assert.equal(typeof raw[book.id], "number");
  });

  it("asks from a dismissible notice, not a blocking confirm", () => {
    assert.doesNotMatch(appJs, /confirm\(`Save/);
    assert.match(appJs, /id = "save-notice"/);
    assert.match(appJs, /Not now/);
    assert.match(appJs, /declineSaveOffer\(/);
    const collapseAt = appJs.indexOf('getElementById("btn-player-collapse")?.addEventListener');
    const collapse = appJs.slice(collapseAt, appJs.indexOf("});", collapseAt) + 3);
    assert.match(collapse, /setPlayerMinimized/);
    assert.doesNotMatch(collapse, /audio\.pause|confirm\(/);
    const minimizer = appJs.slice(
      appJs.indexOf("function setPlayerMinimized"),
      appJs.indexOf("function updatePlayerBar")
    );
    assert.doesNotMatch(minimizer, /audio\.pause|confirm\(/);
  });
});
