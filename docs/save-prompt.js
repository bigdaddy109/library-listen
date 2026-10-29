/**
 * Mid-listen save confirm() gate.
 *
 * Copies chapter bytes into IndexedDB so a phone can play after a restart.
 * It is not a library source. Desktop stays quiet; the Save button is enough there.
 */

export function shouldOfferSaveWhileListening({
  book,
  isPlayable = false,
  isOffline = false,
  phone = false,
} = {}) {
  return Boolean(book) && Boolean(isPlayable) && !isOffline && Boolean(phone);
}
