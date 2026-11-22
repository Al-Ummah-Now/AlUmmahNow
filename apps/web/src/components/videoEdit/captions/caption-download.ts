/**
 * Saving one video's caption file from Studio (AUN-CAPTIONS, QF 2026-11-22). The file comes from the
 * same-origin route app/studio-download/captions (the creator's session goes with it), which passes
 * the videos API's file through untouched: Quran text is filled there, at download time, with the
 * attribution inside. Nothing here reads or changes the text — the bytes are saved as they arrive,
 * under the API's attachment name.
 */

export type CaptionDownloadFormat = 'vtt' | 'srt';
/** The published track of a language, or its caption draft */
export type CaptionDownloadSource = 'track' | 'draft';

export const CAPTION_DOWNLOAD_FORMATS: readonly CaptionDownloadFormat[] = ['vtt', 'srt'];

export function captionDownloadPath(videoId: string, language: string, format: CaptionDownloadFormat, source: CaptionDownloadSource): string {
  return `/studio-download/captions/${encodeURIComponent(videoId)}/${source}/${encodeURIComponent(language)}.${format}`;
}

/** The file name of a Content-Disposition header (RFC 6266 `filename*` first), else `fallback`. */
export function attachmentFilename(header: string | null, fallback: string): string {
  if (header) {
    const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
    if (extended) {
      try {
        return clean(decodeURIComponent(extended.trim())) || fallback;
      } catch {
        // malformed escape: fall through to the plain name
      }
    }
    const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(header);
    const name = plain?.[1] ?? plain?.[2]?.trim();
    if (name) return clean(name) || fallback;
  }
  return fallback;
}

/** No path parts in a saved name */
const clean = (name: string) => name.replace(/[/\\]/g, '_').trim();

export type CaptionDownloadResult = { ok: true; filename: string } | { ok: false; status: number };

export interface CaptionDownloadDeps {
  fetch?: typeof fetch;
  /** Saves the blob under the name (default: an object URL clicked through a temporary <a download>) */
  save?: (blob: Blob, filename: string) => void;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers start the save after click() returns
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Fetches the file with the session and saves it; a refused or failed request saves nothing. */
export async function downloadCaptionFile(
  opts: { videoId: string; language: string; format: CaptionDownloadFormat; source: CaptionDownloadSource },
  deps: CaptionDownloadDeps = {},
): Promise<CaptionDownloadResult> {
  const doFetch = deps.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(captionDownloadPath(opts.videoId, opts.language, opts.format, opts.source), { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!response.ok) return { ok: false, status: response.status };
  const blob = await response.blob();
  const filename = attachmentFilename(response.headers.get('content-disposition'), `${opts.videoId}-${opts.language}.${opts.format}`);
  (deps.save ?? saveBlob)(blob, filename);
  return { ok: true, filename };
}
