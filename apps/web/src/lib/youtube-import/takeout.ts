/**
 * The creator's Google Takeout files, read in the browser (wiki AUN-YT-IMPORT).
 *
 * A zip part is never loaded: only its index (range reads through File.slice)
 * and videos.csv, which is small. Video files may also be picked loose (already
 * extracted). Every video file becomes a TakeoutFile keyed zipName/entryName.
 */
import {
  baseName,
  isVideoFileName,
  isVideosCsv,
  openEntryStream,
  parseTakeoutVideosCsv,
  readZipIndex,
  ZipFormatError,
  type TakeoutFile,
  type TakeoutVideoRow,
  type YtFileMatch,
  type ZipEntry,
  type ZipRangeReader,
} from '@al-ummah/shared-types';
import type { UploadInput } from '@/lib/upload/resilient-tus';
import type { EntryOpener } from './zip-entry-reader';

/** Where a TakeoutFile's bytes are. */
export type TakeoutSource = { kind: 'zip'; zip: File; entry: ZipEntry } | { kind: 'loose'; file: File };

export interface TakeoutProblem {
  fileName: string;
  /** unreadable: not a zip or cut off; encrypted: password-protected */
  code: 'unreadable' | 'encrypted';
}

export interface TakeoutSet {
  files: TakeoutFile[];
  sources: Map<string, TakeoutSource>;
  csv: TakeoutVideoRow[];
  /** The picked files (zip parts and loose videos), by name */
  picked: string[];
  problems: TakeoutProblem[];
}

export const emptyTakeoutSet = (): TakeoutSet => ({ files: [], sources: new Map(), csv: [], picked: [], problems: [] });

export function fileRangeReader(file: Blob): ZipRangeReader {
  return async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer());
}

const fileSlicer = (file: Blob) => (start: number, end: number) => file.slice(start, end).stream() as ReadableStream<Uint8Array>;

const isZip = (file: File) => /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';

/**
 * Adds picked files to a set (a new set; the old one is not changed). A file
 * picked twice (same name and size) is read once.
 */
export async function addTakeoutFiles(set: TakeoutSet, picked: readonly File[], onReading?: (name: string) => void): Promise<TakeoutSet> {
  const next: TakeoutSet = { files: [...set.files], sources: new Map(set.sources), csv: [...set.csv], picked: [...set.picked], problems: [...set.problems] };
  for (const file of picked) {
    if (next.picked.includes(file.name)) continue;
    onReading?.(file.name);
    if (isZip(file)) {
      try {
        const read = fileRangeReader(file);
        const entries = await readZipIndex(read, file.size);
        for (const entry of entries) {
          if (entry.name.endsWith('/')) continue;
          if (isVideosCsv(entry.name)) {
            const text = await new Response(await openEntryStream(read, fileSlicer(file), entry)).text();
            next.csv.push(...parseTakeoutVideosCsv(text));
          } else if (isVideoFileName(entry.name)) {
            const key = `${file.name}/${entry.name}`;
            next.files.push({ key, zipName: file.name, entryName: entry.name, fileName: baseName(entry.name), size: entry.size });
            next.sources.set(key, { kind: 'zip', zip: file, entry });
          }
        }
        next.picked.push(file.name);
        next.problems = next.problems.filter((p) => p.fileName !== file.name);
      } catch (error) {
        next.problems.push({ fileName: file.name, code: error instanceof ZipFormatError && error.code === 'encrypted' ? 'encrypted' : 'unreadable' });
      }
    } else if (isVideosCsv(file.name)) {
      next.csv.push(...parseTakeoutVideosCsv(await file.text()));
      next.picked.push(file.name);
    } else if (isVideoFileName(file.name)) {
      next.files.push({ key: file.name, zipName: '', entryName: file.name, fileName: file.name, size: file.size });
      next.sources.set(file.name, { kind: 'loose', file });
      next.picked.push(file.name);
    }
  }
  return next;
}

/** Removes one picked file (a zip part with all its videos, or a loose file). */
export function removeTakeoutFile(set: TakeoutSet, name: string): TakeoutSet {
  const files = set.files.filter((f) => (f.zipName || f.fileName) !== name);
  const sources = new Map([...set.sources].filter(([key]) => files.some((f) => f.key === key)));
  return { ...set, files, sources, picked: set.picked.filter((p) => p !== name), problems: set.problems.filter((p) => p.fileName !== name) };
}

export function keyOfMatch(match: Pick<YtFileMatch, 'zipName' | 'entryName'>): string {
  return match.zipName ? `${match.zipName}/${match.entryName}` : match.entryName;
}

export function toFileMatch(file: TakeoutFile, by: YtFileMatch['by']): YtFileMatch {
  return { zipName: file.zipName, entryName: file.entryName, fileName: file.fileName, size: file.size, by };
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  wmv: 'video/x-ms-wmv',
  ts: 'video/mp2t',
};

export function mimeTypeOf(fileName: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  return MIME[ext] ?? 'video/mp4';
}

/** The input and opener the uploader needs for one source. */
export function uploadInputOf(source: TakeoutSource, fileName: string): { input: File | UploadInput; open: EntryOpener | null; size: number } {
  if (source.kind === 'loose') return { input: source.file, open: null, size: source.file.size };
  const { zip, entry } = source;
  return {
    input: { name: fileName, size: entry.size, type: mimeTypeOf(fileName), lastModified: zip.lastModified },
    open: () => openEntryStream(fileRangeReader(zip), fileSlicer(zip), entry),
    size: entry.size,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The initiate fingerprint of a zip entry (same entry → same unfinished video
 * on a retry): its place in the zip, as reading its bytes would mean
 * inflating it.
 */
export async function zipEntryFingerprint(zip: File, entry: ZipEntry, fileName: string): Promise<{ name: string; size: number; lastModified: number; hash: string }> {
  return {
    name: fileName,
    size: entry.size,
    lastModified: zip.lastModified,
    hash: await sha256Hex(`${zip.name}|${entry.name}|${entry.size}|${entry.localHeaderOffset}`),
  };
}
