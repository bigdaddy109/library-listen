/** Opening a different book loads it paused. Safe to import from Node tests. */

import { resumeFileSeconds } from "./markers.js";

function savedChapterRecord(record, chapterId) {
  if (!record || !chapterId) return null;
  const saved = record.chapters?.[chapterId];
  if (saved && Number.isFinite(saved.positionSeconds)) return saved;
  if (record.chapterId === chapterId && Number.isFinite(record.positionSeconds)) {
    return {
      positionSeconds: record.positionSeconds,
      chapterDurationSeconds: record.chapterDurationSeconds ?? null,
      updatedAt: record.updatedAt,
    };
  }
  return null;
}

/**
 * Shelf and book-card opens cue this chapter and do not start audio.
 * `autoplay` is always false: the play button starts playback later.
 * Reading progress does not write it.
 */
export function planPausedOpen({ book, loadedBookId = null, progress = null } = {}) {
  const chapters = book?.chapters || [];
  const record = progress?.[book?.id] || null;
  let chapterIndex = 0;
  if (record?.chapterId) {
    const found = chapters.findIndex((chapter) => chapter.id === record.chapterId);
    if (found >= 0) chapterIndex = found;
  }
  const chapter = chapters[chapterIndex] || null;
  const saved = savedChapterRecord(record, chapter?.id);
  const sameBook = !!book?.id && loadedBookId === book.id;
  return {
    bookId: book?.id || null,
    sameBook,
    autoplay: false,
    pausePrevious: !sameBook && !!loadedBookId,
    cue: !sameBook && !!chapter,
    chapterIndex,
    chapterId: chapter?.id || null,
    seekSeconds: chapter ? resumeFileSeconds(saved, chapter) : 0,
  };
}

/**
 * While a newly opened book is only cued, refuse writes that would replace
 * its saved spot with 0 or with the previous book's playhead.
 * A matching time after the user has started playback may be saved.
 */
export function allowProgressWrite({
  holdBookId = null,
  writingBookId = null,
  paused = false,
  seekPlaced = false,
  currentTime = 0,
  seekSeconds = 0,
  srcReady = false,
} = {}) {
  if (!writingBookId) return false;
  if (!holdBookId || writingBookId !== holdBookId) return true;
  if (paused || !seekPlaced || !srcReady) return false;
  const time = Number.isFinite(currentTime) ? currentTime : 0;
  const target = Number.isFinite(seekSeconds) ? seekSeconds : 0;
  return Math.abs(time - target) <= 1.25;
}
