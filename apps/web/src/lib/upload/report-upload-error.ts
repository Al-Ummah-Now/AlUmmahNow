/**
 * Upload failures → admin Errors page, with what support needs to find out
 * why: the step that failed, how many files and how big, the HTTP status and
 * the server's own reference when the API answered with one. File names are
 * never sent (they can be personal).
 *
 * Every caught upload error goes through here (useBatchUpload,
 * BatchUploadManager, components/videoUpload). The returned reference is
 * shown to the user with the friendly message (uploadErrorMessage).
 */
import { ERROR_SCREEN_STRINGS } from '@al-ummah/shared-types';
import { reportError } from '@/lib/errors/reporter';

export type UploadStep = 'auth' | 'resume' | 'initiate' | 'queue' | 'start' | 'tus' | 'retry' | 'complete' | 'schedule' | 'thumbnail';

export interface UploadErrorContext {
  /** Every file of the batch, or the one file this error is about */
  files?: readonly File[];
  file?: File;
  videoId?: string;
  status?: number;
  /** ERR- reference the API answered with (X-Error-Ref / body.reference) */
  serverRef?: string;
  bytesUploaded?: number;
  attempt?: number;
  /** False when the UI does not show this failure (background); default true */
  shown?: boolean;
  /** single upload page or batch */
  flow?: 'single' | 'batch';
}

/** HTTP status of a failed request inside a tus-js-client error (DetailedError.originalResponse). */
export function uploadErrorStatus(error: unknown): number | undefined {
  try {
    const res = (error as { originalResponse?: { getStatus?: () => number } } | null)?.originalResponse;
    const status = res?.getStatus?.();
    return typeof status === 'number' && status > 0 ? status : undefined;
  } catch {
    return undefined;
  }
}

/** Reports an upload failure; returns its reference. Never throws. */
export function reportUploadError(step: UploadStep, error: unknown, ctx: UploadErrorContext = {}): string {
  const files = ctx.files ?? (ctx.file ? [ctx.file] : []);
  const totalBytes = files.reduce((n, f) => n + (f?.size ?? 0), 0);
  const status = ctx.status ?? uploadErrorStatus(error);
  const err =
    error instanceof Error
      ? error
      : Object.assign(new Error(typeof error === 'string' && error ? error : `Upload ${step} failed`), { name: 'UploadError' });
  return reportError(err, {
    kind: 'upload',
    shown: ctx.shown !== false,
    ...(status ? { status } : {}),
    extra: {
      step,
      flow: ctx.flow ?? 'batch',
      fileCount: files.length,
      totalBytes,
      ...(ctx.file ? { fileBytes: ctx.file.size, mimeType: ctx.file.type || 'unknown' } : files[0] ? { mimeType: files[0].type || 'unknown' } : {}),
      ...(ctx.videoId ? { videoId: ctx.videoId } : {}),
      ...(ctx.serverRef ? { serverRef: ctx.serverRef } : {}),
      ...(ctx.bytesUploaded !== undefined ? { bytesUploaded: ctx.bytesUploaded } : {}),
      ...(ctx.attempt !== undefined ? { attempt: ctx.attempt } : {}),
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    },
  });
}

/** "<friendly message> (Reference: ERR-XXXX-XXXX)" in the page's language. */
export function uploadErrorMessage(friendly: string, ref: string, lang: string): string {
  if (!ref) return friendly;
  const strings = ERROR_SCREEN_STRINGS[lang === 'ar' ? 'ar' : 'en'];
  return `${friendly} (${strings.reference}: ${ref})`;
}
