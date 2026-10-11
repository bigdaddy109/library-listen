/** Read m4b/m4a chapter markers. Safe to import from Node tests. */

const MARKER_EXT = new Set(["m4b", "m4a"]);

export function extOfName(name) {
  const i = String(name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isSingleAudioFileBook(book) {
  const chapters = book?.chapters || [];
  if (chapters.length !== 1) return false;
  const name = chapters[0].file?.name || chapters[0].id || "";
  return MARKER_EXT.has(extOfName(name));
}

export function chapterStart(chapter) {
  const start = chapter?.start;
  return Number.isFinite(start) && start > 0 ? start : 0;
}

export function isAudiobook(book) {
  return book?.kind === "audiobook";
}

export function resolvedChapterDuration(chapter, savedDuration) {
  if (Number.isFinite(savedDuration) && savedDuration > 0) return savedDuration;
  const start = chapterStart(chapter);
  if (Number.isFinite(chapter?.end)) {
    const span = chapter.end - start;
    if (span > 0 && Number.isFinite(span)) return span;
  }
  if (Number.isFinite(chapter?.duration) && chapter.duration > 0) return chapter.duration;
  return null;
}

export function chapterRelativePosition(chapter, filePosition) {
  const raw = Number.isFinite(filePosition) ? filePosition - chapterStart(chapter) : 0;
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

export function filePositionFromDisplay(chapter, displaySeconds) {
  const shown = Number.isFinite(displaySeconds) ? Math.max(0, displaySeconds) : 0;
  return chapterStart(chapter) + shown;
}

export function liveChapterDuration(chapter, fileDuration) {
  const marked = resolvedChapterDuration(chapter, null);
  if (marked) return marked;
  if (Number.isFinite(fileDuration) && fileDuration > 0) {
    return Math.max(0, fileDuration - chapterStart(chapter));
  }
  return null;
}

export function chapterIndexAtTime(chapters, time) {
  if (!chapters?.length) return -1;
  const t = Number.isFinite(time) ? time : 0;
  for (let i = 0; i < chapters.length; i += 1) {
    const item = chapters[i];
    const start = chapterStart(item);
    const nextStart = i + 1 < chapters.length ? chapterStart(chapters[i + 1]) : Number.POSITIVE_INFINITY;
    const end = Number.isFinite(item.end) ? item.end : nextStart;
    if (t >= start && t < end) return i;
  }
  return chapters.length - 1;
}

/**
 * Resume seek target in file seconds.
 * Saved position is file-absolute; duration is chapter-relative (native progress shape).
 */
export function resumeFileSeconds(saved, chapter) {
  const start = chapterStart(chapter);
  if (!saved || !Number.isFinite(saved.positionSeconds)) return start;
  const relative = chapterRelativePosition(chapter, saved.positionSeconds);
  const dur = resolvedChapterDuration(chapter, saved.chapterDurationSeconds);
  if (dur > 0 && relative >= dur - 2) return start;
  return start + relative;
}

export function chapterFileKey(chapter) {
  if (chapter?.file?.name) return chapter.file.name;
  return String(chapter?.id || "").split("#")[0];
}

export function offlineChapterBlob(saved, chapter) {
  if (!saved) return null;
  if (saved.has(chapter.id)) return saved.get(chapter.id);
  const key = chapterFileKey(chapter);
  if (key && saved.has(key)) return saved.get(key);
  return null;
}

export function uniqueChapterFiles(chapters) {
  const seen = new Set();
  const files = [];
  for (const ch of chapters || []) {
    const file = ch.file;
    if (!file) continue;
    const key = chapterFileKey(ch);
    if (seen.has(key)) continue;
    seen.add(key);
    files.push({ key, file });
  }
  return files;
}

export function chaptersFromMarkers(fileName, markers, file) {
  return markers.map((marker, index) => {
    const start = Number.isFinite(marker.start) ? Math.max(0, marker.start) : 0;
    const nextStart = Number.isFinite(markers[index + 1]?.start)
      ? markers[index + 1].start
      : null;
    const end = Number.isFinite(marker.end) ? marker.end : nextStart;
    const duration =
      Number.isFinite(end) && end > start
        ? end - start
        : Number.isFinite(marker.duration) && marker.duration > 0
          ? marker.duration
          : null;
    const title = String(marker.title || "").trim();
    return {
      id: `${fileName}#${index}`,
      index,
      title: title || `Chapter ${index + 1}`,
      file,
      url: null,
      start,
      end: Number.isFinite(end) ? end : null,
      duration,
    };
  });
}

export function snapshotChapter(ch) {
  return {
    id: ch.id,
    title: ch.title,
    start: Number.isFinite(ch.start) ? ch.start : undefined,
    end: Number.isFinite(ch.end) ? ch.end : undefined,
    duration: Number.isFinite(ch.duration) ? ch.duration : undefined,
  };
}

export function restoreChapterFields(ch, index) {
  return {
    start: Number.isFinite(ch.start) ? ch.start : 0,
    end: Number.isFinite(ch.end) ? ch.end : null,
    duration: Number.isFinite(ch.duration) ? ch.duration : null,
    index,
  };
}

function sourceFrom(input) {
  if (input instanceof Uint8Array) {
    return {
      size: input.byteLength,
      read(offset, length) {
        return input.subarray(offset, offset + length);
      },
    };
  }
  if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) {
    return sourceFrom(new Uint8Array(input));
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return {
      size: input.size,
      async read(offset, length) {
        const buf = await input.slice(offset, offset + length).arrayBuffer();
        return new Uint8Array(buf);
      },
    };
  }
  throw new Error("Unsupported chapter source");
}

async function readBytes(source, offset, length) {
  if (length <= 0) return new Uint8Array(0);
  if (offset >= source.size) return new Uint8Array(0);
  const want = Math.min(length, source.size - offset);
  const got = await source.read(offset, want);
  return got instanceof Uint8Array ? got : new Uint8Array(got);
}

function u16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes, offset) {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>>
    0
  );
}

function u64(bytes, offset) {
  return u32(bytes, offset) * 2 ** 32 + u32(bytes, offset + 4);
}

function boxType(bytes, offset) {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

function decodeText(bytes) {
  if (!bytes.length) return "";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function parseBoxes(bytes, start = 0, end = bytes.length) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(bytes, offset);
    const type = boxType(bytes, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = u64(bytes, offset + 8);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header) break;
    const boxEnd = Math.min(offset + size, end);
    boxes.push({
      type,
      offset,
      header,
      size: boxEnd - offset,
      payload: bytes.subarray(offset + header, boxEnd),
    });
    offset = boxEnd;
  }
  return boxes;
}

function children(box) {
  return parseBoxes(box.payload);
}

function findBoxes(boxes, type) {
  const out = [];
  for (const box of boxes) {
    if (box.type === type) out.push(box);
    if (
      box.type === "moov" ||
      box.type === "trak" ||
      box.type === "mdia" ||
      box.type === "minf" ||
      box.type === "stbl" ||
      box.type === "udta" ||
      box.type === "tref" ||
      box.type === "edts" ||
      box.type === "meta"
    ) {
      const nested =
        box.type === "meta" && box.payload.length >= 4
          ? parseBoxes(box.payload, 4)
          : children(box);
      out.push(...findBoxes(nested, type));
    }
  }
  return out;
}

function parseChplPayload(payload, dataOffset) {
  if (payload.length < dataOffset + 4) return [];
  const count = u32(payload, dataOffset);
  if (count <= 0 || count > 4096) return [];
  const markers = [];
  let offset = dataOffset + 4;
  for (let i = 0; i < count; i += 1) {
    if (offset + 9 > payload.length) return [];
    const start = u64(payload, offset) / 10_000_000;
    const titleLen = payload[offset + 8];
    offset += 9;
    if (offset + titleLen > payload.length) return [];
    const title = decodeText(payload.subarray(offset, offset + titleLen)).trim();
    offset += titleLen;
    if (!Number.isFinite(start) || start < 0) return [];
    markers.push({ start, title });
  }
  for (let i = 0; i < markers.length; i += 1) {
    const next = markers[i + 1];
    if (next) markers[i].end = next.start;
  }
  return markers;
}

function parseNeroChapters(moovBoxes) {
  const chpl = findBoxes(moovBoxes, "chpl")[0];
  if (!chpl) return [];
  const withReserved = parseChplPayload(chpl.payload, 5);
  const withoutReserved = parseChplPayload(chpl.payload, 4);
  return withReserved.length >= withoutReserved.length ? withReserved : withoutReserved;
}

function parseFullBoxEntries(payload, entrySize, readEntry) {
  if (payload.length < 8) return [];
  const count = u32(payload, 4);
  const out = [];
  let offset = 8;
  for (let i = 0; i < count; i += 1) {
    if (offset + entrySize > payload.length) break;
    out.push(readEntry(payload, offset));
    offset += entrySize;
  }
  return out;
}

function parseStts(payload) {
  return parseFullBoxEntries(payload, 8, (bytes, offset) => ({
    count: u32(bytes, offset),
    duration: u32(bytes, offset + 4),
  }));
}

function parseStsc(payload) {
  return parseFullBoxEntries(payload, 12, (bytes, offset) => ({
    firstChunk: u32(bytes, offset),
    samplesPerChunk: u32(bytes, offset + 4),
    description: u32(bytes, offset + 8),
  }));
}

function parseStco(payload, wide) {
  return parseFullBoxEntries(payload, wide ? 8 : 4, (bytes, offset) =>
    wide ? u64(bytes, offset) : u32(bytes, offset)
  );
}

function parseStsz(payload) {
  if (payload.length < 12) return [];
  const sampleSize = u32(payload, 4);
  const count = u32(payload, 8);
  if (sampleSize) return Array.from({ length: count }, () => sampleSize);
  const sizes = [];
  let offset = 12;
  for (let i = 0; i < count; i += 1) {
    if (offset + 4 > payload.length) break;
    sizes.push(u32(payload, offset));
    offset += 4;
  }
  return sizes;
}

function expandSampleDurations(stts) {
  const durations = [];
  for (const entry of stts) {
    for (let i = 0; i < entry.count; i += 1) durations.push(entry.duration);
  }
  return durations;
}

function sampleOffsets(stsc, chunkOffsets, sampleSizes) {
  const samplesPerChunk = [];
  for (let i = 0; i < stsc.length; i += 1) {
    const first = stsc[i].firstChunk;
    const next = i + 1 < stsc.length ? stsc[i + 1].firstChunk : chunkOffsets.length + 1;
    for (let chunk = first; chunk < next; chunk += 1) {
      samplesPerChunk.push(stsc[i].samplesPerChunk);
    }
  }
  const offsets = [];
  let sample = 0;
  for (let c = 0; c < chunkOffsets.length; c += 1) {
    let pos = chunkOffsets[c];
    const n = samplesPerChunk[c] ?? 0;
    for (let i = 0; i < n; i += 1) {
      offsets.push(pos);
      pos += sampleSizes[sample] || 0;
      sample += 1;
    }
  }
  return offsets;
}

function parseTkhdId(payload) {
  const version = payload[0];
  return version === 1 ? u32(payload, 20) : u32(payload, 12);
}

function parseMdhdTimescale(payload) {
  const version = payload[0];
  return version === 1 ? u32(payload, 20) : u32(payload, 12);
}

function parseHdlrType(payload) {
  if (payload.length < 12) return "";
  return boxType(payload, 8);
}

function parseChapRefs(trakBoxes) {
  const tref = trakBoxes.find((b) => b.type === "tref");
  if (!tref) return [];
  const ids = [];
  for (const box of children(tref)) {
    if (box.type !== "chap") continue;
    for (let i = 0; i + 4 <= box.payload.length; i += 4) {
      ids.push(u32(box.payload, i));
    }
  }
  return ids;
}

function parseTrack(trak) {
  const boxes = children(trak);
  const mdia = boxes.find((b) => b.type === "mdia");
  const mdiaBoxes = mdia ? children(mdia) : [];
  const minf = mdiaBoxes.find((b) => b.type === "minf");
  const minfBoxes = minf ? children(minf) : [];
  const stbl = minfBoxes.find((b) => b.type === "stbl");
  const stblBoxes = stbl ? children(stbl) : [];
  const tkhd = boxes.find((b) => b.type === "tkhd");
  const mdhd = mdiaBoxes.find((b) => b.type === "mdhd");
  const hdlr = mdiaBoxes.find((b) => b.type === "hdlr");
  return {
    id: tkhd ? parseTkhdId(tkhd.payload) : 0,
    handler: hdlr ? parseHdlrType(hdlr.payload) : "",
    timescale: mdhd ? parseMdhdTimescale(mdhd.payload) : 0,
    chapRefs: parseChapRefs(boxes),
    stts: stblBoxes.find((b) => b.type === "stts")?.payload,
    stsc: stblBoxes.find((b) => b.type === "stsc")?.payload,
    stsz: stblBoxes.find((b) => b.type === "stsz")?.payload,
    stco: stblBoxes.find((b) => b.type === "stco")?.payload,
    co64: stblBoxes.find((b) => b.type === "co64")?.payload,
  };
}

function titleFromSample(sample) {
  if (sample.length < 2) return "";
  const len = u16(sample, 0);
  if (len > 0 && 2 + len <= sample.length) {
    return decodeText(sample.subarray(2, 2 + len)).replace(/\0+$/g, "").trim();
  }
  return decodeText(sample).replace(/\0+/g, " ").trim();
}

async function parseQuickTimeChapters(source, tracks) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const referenced = [];
  for (const track of tracks) {
    for (const id of track.chapRefs) {
      const found = byId.get(id);
      if (found && !referenced.includes(found)) referenced.push(found);
    }
  }
  const textTracks = referenced.length
    ? referenced
    : tracks.filter((t) => t.handler === "text" || t.handler === "sbtl");
  for (const track of textTracks) {
    if (!track.stts || !track.stsz || !track.stsc) continue;
    const chunkOffsets = track.co64
      ? parseStco(track.co64, true)
      : track.stco
        ? parseStco(track.stco, false)
        : [];
    const sizes = parseStsz(track.stsz);
    const durations = expandSampleDurations(parseStts(track.stts));
    const offsets = sampleOffsets(parseStsc(track.stsc), chunkOffsets, sizes);
    if (!sizes.length || !offsets.length) continue;
    const timescale = track.timescale || 1000;
    const markers = [];
    let time = 0;
    const n = Math.min(sizes.length, offsets.length);
    for (let i = 0; i < n; i += 1) {
      const sample = await readBytes(source, offsets[i], sizes[i]);
      const start = time / timescale;
      const dur = (durations[i] || 0) / timescale;
      time += durations[i] || 0;
      markers.push({
        start,
        end: dur > 0 ? start + dur : undefined,
        title: titleFromSample(sample),
      });
    }
    if (markers.length) return markers;
  }
  return [];
}

async function findMoov(source) {
  let offset = 0;
  while (offset + 8 <= source.size) {
    const header = await readBytes(source, offset, 16);
    if (header.length < 8) break;
    let size = u32(header, 0);
    const type = boxType(header, 4);
    let headerSize = 8;
    if (size === 1) {
      if (header.length < 16) break;
      size = u64(header, 8);
      headerSize = 16;
    } else if (size === 0) {
      size = source.size - offset;
    }
    if (size < headerSize) break;
    if (type === "moov") {
      const payload = await readBytes(source, offset + headerSize, size - headerSize);
      return parseBoxes(payload);
    }
    offset += size;
  }
  return [];
}

export async function readMp4Chapters(input) {
  const source = sourceFrom(input);
  if (source.size < 16) return [];
  try {
    const moov = await findMoov(source);
    if (!moov.length) return [];
    const tracks = findBoxes(moov, "trak").map(parseTrack);
    const quicktime = await parseQuickTimeChapters(source, tracks);
    if (quicktime.length) return quicktime;
    return parseNeroChapters(moov);
  } catch {
    return [];
  }
}

export async function applyAudiobookMarkers(books, readChapters = readMp4Chapters) {
  for (const book of books || []) {
    if (!isSingleAudioFileBook(book)) continue;
    const file = book.chapters[0].file;
    if (!file) continue;
    const markers = await readChapters(file);
    if (!markers.length) continue;
    book.kind = "audiobook";
    book.chapters = chaptersFromMarkers(file.name || book.chapters[0].id, markers, file);
  }
  return books;
}
