/**
 * Reading a Google Takeout zip without loading it (wiki AUN-YT-IMPORT).
 *
 * Takeout parts are up to 50 GB. The Studio wizard reads only the zip's index
 * (the central directory at the end of the file) through range reads, lists
 * the video files and videos.csv, and streams each chosen entry, inflated,
 * into the normal resumable upload. Nothing here needs the whole file.
 *
 * Supports stored (0) and deflated (8) entries and zip64 (parts over 4 GB,
 * entries over 4 GB, more than 65535 entries). Encrypted entries are refused.
 */

/** Reads bytes [start, end) of the zip. */
export type ZipRangeReader = (start: number, end: number) => Promise<Uint8Array>;

export interface ZipEntry {
  /** Path inside the zip, '/'-separated */
  name: string;
  /** 0 stored, 8 deflated */
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the entry's local header */
  localHeaderOffset: number;
  encrypted: boolean;
}

export class ZipFormatError extends Error {
  constructor(readonly code: 'not_zip' | 'truncated' | 'unsupported' | 'encrypted', message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const MAX_COMMENT = 0xffff;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A 64-bit little-endian value as a number (exact up to 2^53, far beyond any zip). */
function u64(dv: DataView, at: number): number {
  return dv.getUint32(at, true) + dv.getUint32(at + 4, true) * 0x1_0000_0000;
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes);
  // Takeout writes UTF-8 names; a zip without the flag is still read as UTF-8, falling back to Latin-1
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  }
}

/** The zip's entries, read from its central directory (two or three range reads). */
export async function readZipIndex(read: ZipRangeReader, size: number): Promise<ZipEntry[]> {
  if (!(size >= 22)) throw new ZipFormatError('not_zip', 'Not a zip file');
  const tailStart = Math.max(0, size - (22 + MAX_COMMENT + 20));
  const tail = await read(tailStart, size);
  const dv = view(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError('not_zip', 'Not a zip file (no end record)');

  let count = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);

  const locator = eocd - 20;
  if (locator >= 0 && dv.getUint32(locator, true) === EOCD64_LOCATOR_SIG) {
    const eocd64Offset = u64(dv, locator + 8);
    const rec = await read(eocd64Offset, Math.min(size, eocd64Offset + 56));
    const rv = view(rec);
    if (rec.length < 56 || rv.getUint32(0, true) !== EOCD64_SIG) throw new ZipFormatError('truncated', 'Damaged zip64 end record');
    count = u64(rv, 32);
    cdSize = u64(rv, 40);
    cdOffset = u64(rv, 48);
  }
  if (cdOffset + cdSize > size) throw new ZipFormatError('truncated', 'The zip is incomplete (was the download finished?)');

  const cd = await read(cdOffset, cdOffset + cdSize);
  const cv = view(cd);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== CDH_SIG) throw new ZipFormatError('truncated', 'Damaged zip index');
    const flags = cv.getUint16(p + 8, true);
    const method = cv.getUint16(p + 10, true);
    let compressedSize = cv.getUint32(p + 20, true);
    let uncompressed = cv.getUint32(p + 24, true);
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    let localHeaderOffset = cv.getUint32(p + 42, true);
    const name = decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x0800) !== 0);
    // zip64 extended information: only the fields whose 32-bit value is 0xFFFFFFFF are present, in this order
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cv.getUint16(e, true);
      const len = cv.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        const end = e + 4 + len;
        if (uncompressed === 0xffffffff && q + 8 <= end) {
          uncompressed = u64(cv, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff && q + 8 <= end) {
          compressedSize = u64(cv, q);
          q += 8;
        }
        if (localHeaderOffset === 0xffffffff && q + 8 <= end) localHeaderOffset = u64(cv, q);
      }
      e += 4 + len;
    }
    entries.push({ name, method, compressedSize, size: uncompressed, localHeaderOffset, encrypted: (flags & 0x1) !== 0 });
    p = extraEnd + commentLen;
  }
  return entries;
}

/** Where an entry's data starts (after its local header, whose extra field may differ from the index). */
export async function entryDataOffset(read: ZipRangeReader, entry: ZipEntry): Promise<number> {
  const header = await read(entry.localHeaderOffset, entry.localHeaderOffset + 30);
  const hv = view(header);
  if (header.length < 30 || hv.getUint32(0, true) !== LFH_SIG) throw new ZipFormatError('truncated', `Damaged entry ${entry.name}`);
  return entry.localHeaderOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
}

/** Refuses what cannot be streamed: encrypted entries and methods other than stored or deflated. */
export function assertStreamable(entry: ZipEntry): void {
  if (entry.encrypted) throw new ZipFormatError('encrypted', `${entry.name} is encrypted`);
  if (entry.method !== 0 && entry.method !== 8) throw new ZipFormatError('unsupported', `${entry.name} uses an unsupported compression (${entry.method})`);
}

/**
 * The entry's uncompressed bytes as a stream. `slice(start, end)` returns the
 * raw bytes of the zip as a stream (in a browser: `file.slice(start, end).stream()`).
 */
export async function openEntryStream(
  read: ZipRangeReader,
  slice: (start: number, end: number) => ReadableStream<Uint8Array>,
  entry: ZipEntry,
): Promise<ReadableStream<Uint8Array>> {
  assertStreamable(entry);
  const start = await entryDataOffset(read, entry);
  const raw = slice(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  // Read from globalThis when called: a direct reference makes Next's Edge bundles (admin-web's
  // instrumentation imports this package) refuse to build, though nothing there unzips
  const Decompression = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!Decompression) throw new Error('DecompressionStream is not available in this runtime');
  return raw.pipeThrough(new Decompression('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

/** Video files Takeout exports (YouTube keeps the uploaded container). */
export const TAKEOUT_VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'm4v', '3gp', 'mpg', 'mpeg', 'wmv', 'ts'] as const;

export function isVideoFileName(name: string): boolean {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return !!m && (TAKEOUT_VIDEO_EXTENSIONS as readonly string[]).includes(m[1]!.toLowerCase());
}

/** The base name of a zip path ("Takeout/YouTube and YouTube Music/videos/My talk.mp4" → "My talk.mp4"). */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Takeout's video-metadata CSV, in any language folder name: ".../video metadata/videos.csv". */
export function isVideosCsv(path: string): boolean {
  return /(^|\/)videos\.csv$/i.test(path);
}
