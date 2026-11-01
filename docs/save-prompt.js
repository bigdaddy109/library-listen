/**
 * Mid-listen save offer.
 *
 * Copies chapter bytes into IndexedDB so a phone can play after a restart.
 * It is not a library source. Desktop stays quiet; the Save button is enough there.
 * The offer is a dismissible notice, not a blocking dialog. "Not now" is stored
 * per book, so a later chapter of that book does not ask again.
 */

export const SAVE_OFFER_KEY = "librarylisten.saveOffer.v1";

export function shouldOfferSaveWhileListening({
  book,
  isPlayable = false,
  isOffline = false,
  phone = false,
  declined = false,
} = {}) {
  return Boolean(book) && Boolean(isPlayable) && !isOffline && Boolean(phone) && !declined;
}

export function readDeclinedSaveOffers(store) {
  try {
    const raw = store?.getItem?.(SAVE_OFFER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function isSaveOfferDeclined(bookId, store) {
  if (!bookId) return false;
  return Object.prototype.hasOwnProperty.call(readDeclinedSaveOffers(store), bookId);
}

export function declineSaveOffer(bookId, store) {
  if (!bookId || typeof store?.setItem !== "function") return false;
  const next = { ...readDeclinedSaveOffers(store), [bookId]: Date.now() };
  try {
    store.setItem(SAVE_OFFER_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
