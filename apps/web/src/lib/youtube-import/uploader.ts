/**
 * Uploads the chosen Takeout files of an import, two at a time (wiki
 * AUN-YT-IMPORT). Each item goes through the normal upload: initiate (with
 * `youtubeImport`, so the server takes the item's metadata and records the
 * video), the resilient TUS upload (a zip entry streamed by its own reader,
 * a loose file as is), then complete. Processing and the thumbnail, caption
 * and playlist steps continue on the server; the page follows them by polling.
 */
import type { YtImportItem } from '@al-ummah/shared-types';
import { completeVideoUpload, initiateVideoUpload, type ApiResult } from '@/lib/api/upload-client';
import { fetchClientAuthToken, getClientAuthHeaders } from '@/lib/auth/client-token';
import { reportUploadError } from '@/lib/upload/report-upload-error';
import { ResilientUpload, grantedUploadUrl, reportUploadFailure, requestUploadResume, tusEndpointFor } from '@/lib/upload/resilient-tus';
import { tryFileFingerprint } from '@/lib/upload/fingerprint';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';
import { keyOfMatch, mimeTypeOf, uploadInputOf, zipEntryFingerprint, type TakeoutSet } from './takeout';
import type { LiveState } from './wizard';
import { zipEntryFileReader } from './zip-entry-reader';

export const IMPORT_CONCURRENCY = 2;

/** Refusal codes with their own message (t.studio.youtube.progress.errors). */
const KNOWN_CODES = new Set(['upload_limit', 'uploads_by_invitation', 'terms_required', 'youtube_item_taken', 'youtube_import_not_found']);

export function initiateErrorCode(result: Pick<ApiResult<unknown>, 'code'>): string {
  return result.code && KNOWN_CODES.has(result.code) ? result.code : 'generic';
}

export interface ImportUploaderOptions {
  importId: string;
  channelId: string;
  takeout: TakeoutSet;
  onState: (itemId: string, state: LiveState | null) => void;
  /** Called once when the server refuses with `terms_required`; the queue pauses until `resume()` is called. */
  onTermsRequired?: () => void;
  /** The server's import moved on without this page (another tab, a cancel): read it again */
  onServerChanged?: () => void;
  /** Test seams */
  deps?: Partial<UploaderDeps>;
}

export interface UploaderDeps {
  initiate: typeof initiateVideoUpload;
  complete: typeof completeVideoUpload;
  createUpload: (opts: ConstructorParameters<typeof ResilientUpload>[0]) => Pick<ResilientUpload, 'start' | 'abort'>;
}

const defaultDeps: UploaderDeps = {
  initiate: initiateVideoUpload,
  complete: completeVideoUpload,
  createUpload: (opts) => new ResilientUpload(opts),
};

export class ImportUploader {
  private queue: YtImportItem[] = [];
  private active = new Map<string, Pick<ResilientUpload, 'start' | 'abort'> | null>();
  private stopped = false;
  private pausedForTerms = false;
  private takeout: TakeoutSet;
  private readonly deps: UploaderDeps;

  constructor(private readonly opts: ImportUploaderOptions) {
    this.takeout = opts.takeout;
    this.deps = { ...defaultDeps, ...opts.deps };
  }

  /** New files picked (resume after a reload): later items read from them. */
  setTakeout(takeout: TakeoutSet): void {
    this.takeout = takeout;
  }

  has(itemId: string): boolean {
    return this.active.has(itemId) || this.queue.some((i) => i.id === itemId);
  }

  isPausedForTerms(): boolean {
    return this.pausedForTerms;
  }

  /** Queues items (already queued or running ones are ignored). */
  enqueue(items: readonly YtImportItem[]): void {
    if (this.stopped) return;
    if (this.pausedForTerms) {
      this.opts.onTermsRequired?.();
      return;
    }
    for (const item of items) {
      if (this.has(item.id)) continue;
      this.queue.push(item);
      this.opts.onState(item.id, { phase: 'waiting' });
    }
    this.pump();
  }

  /** Resumes the queue after the creator accepts Terms. */
  resume(): void {
    if (this.stopped || !this.pausedForTerms) return;
    this.pausedForTerms = false;
    for (const item of this.queue) {
      this.opts.onState(item.id, { phase: 'waiting' });
    }
    this.pump();
  }

  /** Stops every upload (Cancel import, leaving the page). Unfinished uploads keep their stored offsets. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.pausedForTerms = false;
    this.queue = [];
    await Promise.all([...this.active.values()].map((u) => u?.abort().catch(() => undefined)));
    this.active.clear();
  }

  private pump(): void {
    while (!this.stopped && !this.pausedForTerms && this.active.size < IMPORT_CONCURRENCY && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active.set(item.id, null);
      void this.run(item).finally(() => {
        this.active.delete(item.id);
        this.pump();
      });
    }
  }

  private fail(item: YtImportItem, errorCode: string, error?: unknown, step: 'initiate' | 'tus' | 'complete' = 'tus'): void {
    let reference: string | undefined;
    if (errorCode === 'generic' || errorCode === 'file') {
      reference = reportUploadError(step, error ?? errorCode, { flow: 'youtube-import', ...(item.videoId ? { videoId: item.videoId } : {}) });
    }
    this.opts.onState(item.id, { phase: 'failed', errorCode, ...(reference ? { reference } : {}) });
  }

  private async run(item: YtImportItem): Promise<void> {
    const { importId, channelId, onState } = this.opts;
    const source = item.match ? this.takeout.sources.get(keyOfMatch(item.match)) : undefined;
    if (!item.match || !source) {
      onState(item.id, { phase: 'needsFile' });
      return;
    }
    onState(item.id, { phase: 'preparing' });
    const fileName = item.match.fileName;
    const { input, open, size } = uploadInputOf(source, fileName);
    const fingerprint = source.kind === 'zip' ? await zipEntryFingerprint(source.zip, source.entry, fileName).catch(() => undefined) : await tryFileFingerprint(source.file);
    if (this.stopped) return;

    const initiated = await this.deps.initiate(
      {
        title: item.title,
        fileSize: size,
        mimeType: source.kind === 'loose' && source.file.type ? source.file.type : mimeTypeOf(fileName),
        ...(fingerprint ? { fingerprint } : {}),
        youtubeImport: { importId, itemId: item.id },
      },
      channelId,
    );
    if (!initiated.success || !initiated.result) {
      const code = initiateErrorCode(initiated);
      if (code === 'terms_required') {
        const firstPause = !this.pausedForTerms;
        this.pausedForTerms = true;
        // Put the item back at the front so resuming after acceptance retries it automatically
        if (!this.queue.some((q) => q.id === item.id)) this.queue.unshift(item);
        this.fail(item, code, Object.assign(new Error(initiated.error || 'terms_required'), { status: initiated.status }), 'initiate');
        if (firstPause) this.opts.onTermsRequired?.();
        return;
      }
      if (code === 'youtube_item_taken') {
        // Already processing or imported (another tab, an earlier try): the server's state takes over
        onState(item.id, { phase: 'processing' });
        this.opts.onServerChanged?.();
        return;
      }
      if (code === 'youtube_import_not_found') this.opts.onServerChanged?.();
      if (code === 'generic') logger.error('[YtImport] Initiate failed', { importId, itemId: item.id, status: initiated.status });
      this.fail(item, code, Object.assign(new Error(initiated.error || 'initiate failed'), { status: initiated.status, serverRef: initiated.serverRef }), 'initiate');
      return;
    }
    const { videoId, tusUploadId, authToken, reused } = initiated.result;
    let tusSessionId = initiated.result.tusSessionId ?? '';
    const endpoint = tusEndpointFor(getApiUrl());
    let uploadUrl = tusUploadId ? `${endpoint}/${tusUploadId}` : undefined;
    if (reused && !uploadUrl) {
      // The same item again (Try again, a reload): resume the same video's upload
      const resumed = await requestUploadResume(getApiUrl(), videoId, await getClientAuthHeaders()).catch(() => null);
      if (resumed?.kind === 'grant') {
        tusSessionId = resumed.tusSessionId;
        uploadUrl = grantedUploadUrl(endpoint, resumed, { size });
      } else if (resumed?.kind === 'completed') {
        // Its bytes already arrived: only the completion is missing
        const done = await this.deps.complete(videoId, channelId, size);
        if (done.success) onState(item.id, { phase: 'processing' });
        else this.fail({ ...item, videoId }, initiateErrorCode(done), new Error(done.error || 'complete failed'), 'complete');
        return;
      }
    }
    if (!tusSessionId) {
      this.fail({ ...item, videoId }, 'generic', new Error('No upload session'), 'initiate');
      return;
    }
    const fallback = authToken ? `Bearer ${authToken}` : null;

    await new Promise<void>((resolve) => {
      const upload = this.deps.createUpload({
        file: input,
        endpoint,
        videoId,
        tusSessionId,
        uploadUrl,
        metadata: { filename: fileName, filetype: mimeTypeOf(fileName), youtubeImportId: importId },
        ...(open ? { fileReader: zipEntryFileReader(open, size) } : {}),
        getAuthorization: async (force) => {
          const token = await fetchClientAuthToken(force);
          return token ? `Bearer ${token}` : fallback;
        },
        reauthorise: async (vid) => requestUploadResume(getApiUrl(), vid, await getClientAuthHeaders()),
        reportFailure: async (vid, reason) => reportUploadFailure(getApiUrl(), vid, await getClientAuthHeaders(), reason),
        onProgress: (sent, total) => onState(item.id, { phase: 'uploading', percent: total > 0 ? Math.floor((sent / total) * 100) : 0 }),
        onReconnecting: (reconnecting) => onState(item.id, { phase: 'uploading', reconnecting }),
        onError: (error) => {
          const unreadable = error?.name === 'EntryReadError' || error?.name === 'NotReadableError';
          this.fail({ ...item, videoId }, unreadable ? 'file' : 'generic', error, 'tus');
          resolve();
        },
        onSuccess: () => {
          void this.deps
            .complete(videoId, channelId, size)
            .then((done) => {
              if (done.success) onState(item.id, { phase: 'processing' });
              else this.fail({ ...item, videoId }, initiateErrorCode(done), Object.assign(new Error(done.error || 'complete failed'), { status: done.status }), 'complete');
            })
            .catch((error: unknown) => this.fail({ ...item, videoId }, 'generic', error, 'complete'))
            .finally(resolve);
        },
      });
      this.active.set(item.id, upload);
      if (this.stopped) {
        resolve();
        return;
      }
      upload.start().catch((error: unknown) => {
        this.fail({ ...item, videoId }, 'generic', error, 'tus');
        resolve();
      });
    });
  }
}
