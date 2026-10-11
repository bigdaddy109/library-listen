import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldOfferSaveWhileListening } from "../docs/save-prompt.js";

const book = { id: "immune", title: "Immune" };

describe("shouldOfferSaveWhileListening", () => {
  it("offers on iPhone-style playback: playable, not offline, no directory handle", () => {
    assert.equal(
      shouldOfferSaveWhileListening({
        book,
        isPlayable: true,
        isOffline: false,
        hasDirectoryHandle: false,
      }),
      true
    );
  });

  it("stays quiet on desktop when the directory handle already persists", () => {
    assert.equal(
      shouldOfferSaveWhileListening({
        book,
        isPlayable: true,
        isOffline: false,
        hasDirectoryHandle: true,
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
        hasDirectoryHandle: false,
      }),
      false
    );
  });

  it("stays quiet when both a handle and an offline copy exist", () => {
    assert.equal(
      shouldOfferSaveWhileListening({
        book,
        isPlayable: true,
        isOffline: true,
        hasDirectoryHandle: true,
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
        hasDirectoryHandle: false,
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
        hasDirectoryHandle: false,
      }),
      false
    );
    assert.equal(shouldOfferSaveWhileListening(), false);
  });
});
