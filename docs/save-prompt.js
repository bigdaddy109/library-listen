/**
 * Mid-listen save confirm() gate.
 *
 * The prompt is useful on iPhone Safari, where a folder permission does not
 * survive a restart. It is noisy on desktop, where the directory handle
 * already persists. Only offer it when there is no directory handle and the
 * book is not already saved on this device.
 */

export function shouldOfferSaveWhileListening({
  book,
  isPlayable = false,
  isOffline = false,
  hasDirectoryHandle = false,
} = {}) {
  return Boolean(book) && Boolean(isPlayable) && !isOffline && !hasDirectoryHandle;
}
