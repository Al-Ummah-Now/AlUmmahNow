/**
 * The video files the upload forms accept, in one place (issue #1938).
 *
 * Browsers name a file's type from the operating system, and they disagree with
 * the names people guess: MOV (every iPhone video) is `video/quicktime`, AVI is
 * `video/x-msvideo`, MKV is `video/x-matroska`, and a system without the codec
 * or file association gives an empty type. So a file is accepted by its MIME
 * type, or by its extension when the type says nothing (empty or generic). A
 * file whose type names another kind of file is refused whatever its extension.
 *
 * The list is what Desktop Studio takes and what Bunny and the transcoding
 * pipeline (ffmpeg) read, checked with real uploads on QA (the "Upload formats on
 * QA" workflow: Bunny and our transcoder encoded every one): MP4, M4V, MOV, WebM,
 * MKV, AVI, WMV and FLV. The server
 * (uploadInitiate, uploadBatchInitiate) accepts any `video/*`, so the type sent
 * to it is the format's canonical type, whatever alias the browser used.
 */

import { isArabicLocale, isolateText } from '@al-ummah/shared-types';

export interface VideoFormat {
  /** How the format is written in help text */
  label: string;
  /** Extensions without the dot */
  extensions: readonly string[];
  /** The type sent to the server */
  mimeType: string;
  /** Other names for the same format that browsers and tools use (lower case) */
  aliases: readonly string[];
}

export const VIDEO_FORMATS: readonly VideoFormat[] = [
  { label: 'MP4', extensions: ['mp4'], mimeType: 'video/mp4', aliases: [] },
  { label: 'M4V', extensions: ['m4v'], mimeType: 'video/x-m4v', aliases: ['video/m4v'] },
  { label: 'MOV', extensions: ['mov', 'qt'], mimeType: 'video/quicktime', aliases: ['video/mov'] },
  { label: 'WebM', extensions: ['webm'], mimeType: 'video/webm', aliases: [] },
  { label: 'MKV', extensions: ['mkv'], mimeType: 'video/x-matroska', aliases: ['video/matroska'] },
  { label: 'AVI', extensions: ['avi'], mimeType: 'video/x-msvideo', aliases: ['video/avi', 'video/msvideo', 'video/vnd.avi'] },
  { label: 'WMV', extensions: ['wmv'], mimeType: 'video/x-ms-wmv', aliases: ['video/wmv', 'video/x-ms-asf'] },
  { label: 'FLV', extensions: ['flv'], mimeType: 'video/x-flv', aliases: ['video/flv'] },
];

/** Types that say nothing about the file: the extension decides */
const GENERIC_TYPES: readonly string[] = ['', 'application/octet-stream', 'binary/octet-stream', 'application/x-unknown'];

/** The part of a File the check needs (a Move from YouTube entry has no File) */
export type VideoFileLike = Pick<File, 'name' | 'type'>;

function extensionOf(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? '';
}

function baseType(type: string): string {
  return type.split(';')[0]!.trim().toLowerCase();
}

/** The accepted format a file is, or null when the form must refuse it */
export function videoFormatOf(file: VideoFileLike): VideoFormat | null {
  const type = baseType(file.type ?? '');
  if (GENERIC_TYPES.includes(type)) {
    const ext = extensionOf(file.name);
    return VIDEO_FORMATS.find((f) => f.extensions.includes(ext)) ?? null;
  }
  return VIDEO_FORMATS.find((f) => f.mimeType === type || f.aliases.includes(type)) ?? null;
}

export function isAcceptedVideoFile(file: VideoFileLike): boolean {
  return videoFormatOf(file) !== null;
}

/**
 * The type to send to the server (initiate, batch initiate, TUS metadata). An
 * accepted file always has one; a file that is not accepted keeps its own.
 */
export function videoMimeTypeOf(file: VideoFileLike): string {
  return videoFormatOf(file)?.mimeType ?? file.type;
}

/** The file picker's `accept`: the extensions and the types, so a file with no type still shows */
export const VIDEO_PICKER_ACCEPT: string = [
  ...VIDEO_FORMATS.flatMap((f) => f.extensions.map((e) => `.${e}`)),
  ...VIDEO_FORMATS.flatMap((f) => [f.mimeType, ...f.aliases]),
].join(',');

/**
 * «MP4, M4V, …» for help text. Arabic copy takes the Arabic comma «،», and each name is its own bidi isolate
 * (isolateText, shared-types): the Arabic comma is neutral between two Latin names, so without it the whole list
 * is one left-to-right run, «يدعم» then MP4 at the far left, the list reading backwards and breaking oddly across
 * lines. Isolated, MP4 comes first, next to the text before it.
 */
export function videoFormatsText(lang: string): string {
  const arabic = isArabicLocale(lang);
  return VIDEO_FORMATS.map((f) => (arabic ? isolateText(f.label) : f.label)).join(arabic ? '، ' : ', ');
}
