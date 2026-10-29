import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldOfferSaveWhileListening } from "../docs/save-prompt.js";

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
});
