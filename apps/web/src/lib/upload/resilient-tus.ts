/**
 * Resilient TUS uploads: a file never restarts from byte 0 unless Bunny really
 * lost its bytes.
 *
 * What went wrong in production (v2026.11.09.5): the API TUS proxy answered
 * 500 on PATCH, then 500 on HEAD. tus-js-client answers any HEAD error other
 * than 423 by creating a NEW upload, so every file restarted from 0; and its
 * five retries (~38 s) did not outlast a deploy. Here:
 * - HEAD 5xx/429/408/401 answers are turned into 423 (the one HEAD status
 *   tus-js-client retries), so a transient HEAD failure resumes the same
 *   upload at the server's offset;
 * - retries back off with jitter for ~15 minutes, and start over (still at the
 *   server's offset) a few more times after that;
 * - every request carries a fresh access token (long uploads outlive tokens);
 * - a 404/410 (session or upload gone) re-authorises the SAME video through
 *   uploadResume instead of failing or creating a new video;
 * - uploads are fingerprinted per video, so a reload resumes the stored URL;
 * - progress never goes backwards while reconnecting.
 */
import * as tus from 'tus-js-client';

/** Chunk size: see apps/web/src/lib/upload/README.md "Chunk size" for the QA measurements. */
export const DEFAULT_TUS_CHUNK_SIZE = 50 * 1024 * 1024;

/**
 * Base retry schedule (ms): quick retries for blips, then a minute apart, for
 * ~15 minutes in all (a deploy, a KV or Bunny incident). tus-js-client resets
 * the attempt counter whenever bytes are accepted, so this is per stall.
 */
export const BASE_RETRY_DELAYS_MS: readonly number[] = [
  0, 1000, 2000, 4000, 8000, 15000, 30000, 30000,
  ...Array.from({ length: 13 }, () => 60000),
];

/**
 * Chunk size set in localStorage (`aun:tus-chunk-size`, bytes): lets the
 * release E2E upload a small file in several chunks. Bounded to 1-90 MB
 * (Workers accept up to 100 MB per request).
 */
export const CHUNK_SIZE_OVERRIDE_KEY = 'aun:tus-chunk-size';
export function chunkSizeOverride(): number | undefined {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(CHUNK_SIZE_OVERRIDE_KEY) : null;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 1024 * 1024 && n <= 90 * 1024 * 1024 ? Math.floor(n) : undefined;
  } catch {
    return undefined;
  }
}

/** After the whole schedule fails, start over this many more times (60 s apart). */
export const EXTRA_RETRY_CYCLES = 3;
export const EXTRA_RETRY_CYCLE_DELAY_MS = 60000;

/** 404/410 re-authorisations per stall (via uploadResume). */
export const MAX_REAUTHORISATIONS = 3;

/**
 * The schedule with ±25% jitter, so many files (and many users) that failed
 * together do not retry in lockstep.
 */
export function jitteredRetryDelays(base: readonly number[] = BASE_RETRY_DELAYS_MS, random: () => number = Math.random): number[] {
  return base.map((d) => (d === 0 ? 0 : Math.round(d * (0.75 + random() * 0.5))));
}

export type TusFailureAction = 'retry' | 'refresh-auth' | 'reauthorise' | 'fatal';

/**
 * What to do about a failed TUS request, from its HTTP status (undefined/0 =
 * network error, CORS-less gateway error or aborted connection).
 */
export function classifyTusFailure(status: number | undefined | null): TusFailureAction {
  if (!status) return 'retry';
  if (status === 401) return 'refresh-auth';
  if (status === 404 || status === 410) return 'reauthorise';
  if (status >= 500 || status === 408 || status === 409 || status === 423 || status === 425 || status === 429) return 'retry';
  return 'fatal';
}

/**
 * HEAD answers that must not make tus-js-client create a new upload: it does
 * that for every non-2xx HEAD except 423, so these become 423 (retried).
 */
export function shouldMaskHeadStatus(method: string, status: number): boolean {
  if (method.toUpperCase() !== 'HEAD') return false;
  return status === 0 || status >= 500 || status === 408 || status === 429 || status === 401;
}

export function failureStatus(error: unknown): number | undefined {
  const res = (error as tus.DetailedError | undefined)?.originalResponse;
  return res ? res.getStatus() : undefined;
}

/** Fingerprint per video and file, so a reload resumes this video's upload URL. */
export function uploadFingerprint(file: Pick<File, 'name' | 'size' | 'lastModified'>, videoId: string): string {
  return `aun-tus:${videoId}:${file.name}:${file.size}:${file.lastModified}`;
}

/** Wraps the default stack: masks transient HEAD failures as 423, reports 401s. */
export class ResilientHttpStack implements tus.HttpStack {
  constructor(
    private readonly inner: tus.HttpStack = new tus.DefaultHttpStack({}),
    private readonly onUnauthorized?: () => void,
  ) {}

  getName(): string {
    return 'ResilientHttpStack';
  }

  createRequest(method: string, url: string): tus.HttpRequest {
    const req = this.inner.createRequest(method, url);
    const onUnauthorized = this.onUnauthorized;
    return {
      getMethod: () => req.getMethod(),
      getURL: () => req.getURL(),
      setHeader: (h, v) => req.setHeader(h, v),
      getHeader: (h) => req.getHeader(h),
      setProgressHandler: (fn) => req.setProgressHandler(fn),
      abort: () => req.abort(),
      getUnderlyingObject: () => req.getUnderlyingObject(),
      send: async (body) => {
        const res = await req.send(body);
        const status = res.getStatus();
        if (status === 401) onUnauthorized?.();
        if (!shouldMaskHeadStatus(req.getMethod(), status)) return res;
        return {
          getStatus: () => 423,
          getHeader: (h: string) => res.getHeader(h),
          getBody: () => res.getBody(),
          getUnderlyingObject: () => res.getUnderlyingObject(),
        };
      },
    };
  }
}

/** What uploadResume said about a video. */
export type ReauthoriseResult =
  | { kind: 'grant'; tusSessionId: string; tusUploadId?: string }
  | { kind: 'completed' }
  | { kind: 'gone'; message: string };

/**
 * Ask the API to re-authorise an unfinished upload of the same video.
 * Throws on transient failures (network, 5xx) so the caller retries.
 */
export async function requestUploadResume(
  apiUrl: string,
  videoId: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<ReauthoriseResult> {
  const res = await fetchImpl(`${apiUrl.replace(/\/+$/, '')}/api/videos/upload/resume/${encodeURIComponent(videoId)}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    completed?: boolean;
    error?: string;
    result?: { tusSessionId?: string; tusUploadId?: string };
  };
  if (res.ok && body.result?.tusSessionId) {
    return { kind: 'grant', tusSessionId: body.result.tusSessionId, tusUploadId: body.result.tusUploadId };
  }
  if (res.status === 409 && body.completed) return { kind: 'completed' };
  if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) {
    throw new Error(`upload resume ${res.status}`);
  }
  return { kind: 'gone', message: body.error || `Upload cannot be resumed (${res.status})` };
}

export function tusEndpointFor(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/api/videos/tus`;
}

export function apiUrlFromTusEndpoint(endpoint: string): string {
  return endpoint.replace(/\/api\/videos\/tus\/?$/, '');
}

export interface ResilientUploadOptions {
  file: File;
  /** The API TUS proxy endpoint (…/api/videos/tus). */
  endpoint: string;
  videoId: string;
  tusSessionId: string;
  /** An existing proxy upload to resume (full URL), e.g. from uploadResume. */
  uploadUrl?: string;
  chunkSize?: number;
  metadata?: Record<string, string>;
  /** "Bearer <token>" for each request; force=true after a 401. */
  getAuthorization: (force: boolean) => Promise<string | null>;
  /** uploadResume for this video. */
  reauthorise: (videoId: string) => Promise<ReauthoriseResult>;
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
  onReconnecting?: (reconnecting: boolean) => void;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  retryDelays?: number[];
  /** Test seams. */
  httpStack?: tus.HttpStack;
  urlStorage?: tus.UrlStorage;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One file's upload. Keeps the same video through every failure: transient
 * ones are retried at the server's offset, a lost session/upload is
 * re-authorised through uploadResume, and only a fatal error (or the video
 * being gone) reaches onError.
 */
export class ResilientUpload {
  private upload: tus.Upload | null = null;
  private sessionId: string;
  private uploadUrl: string | undefined;
  private authStale = false;
  private aborted = false;
  private finished = false;
  private reconnecting = false;
  private floor = 0;
  private reauthorisations = 0;
  private extraCycles = 0;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: ResilientUploadOptions) {
    this.sessionId = opts.tusSessionId;
    this.uploadUrl = opts.uploadUrl;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get videoId(): string {
    return this.opts.videoId;
  }

  isReconnecting(): boolean {
    return this.reconnecting;
  }

  /**
   * Start or resume (also the user's Pause→Resume and Retry): the stored URL
   * for this video's fingerprint, else a new upload. Fresh retry budgets.
   */
  async start(): Promise<void> {
    this.reauthorisations = 0;
    this.extraCycles = 0;
    await this.resume();
  }

  private async resume(): Promise<void> {
    this.aborted = false;
    if (this.finished) return;
    if (!this.upload) this.upload = this.build();
    const upload = this.upload;
    if (!upload.url) {
      const previous = await upload.findPreviousUploads().catch(() => []);
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
    }
    if (this.aborted) return;
    upload.start();
  }

  /** Pause (keeps the stored URL) or cancel (removeFingerprint). */
  async abort(removeFingerprint = false): Promise<void> {
    this.aborted = true;
    this.setReconnecting(false);
    await this.upload?.abort(removeFingerprint).catch(() => undefined);
  }

  private setReconnecting(value: boolean): void {
    if (this.reconnecting === value) return;
    this.reconnecting = value;
    this.opts.onReconnecting?.(value);
  }

  private build(): tus.Upload {
    const { file, endpoint, videoId } = this.opts;
    return new tus.Upload(file, {
      endpoint,
      uploadUrl: this.uploadUrl ?? null,
      chunkSize: chunkSizeOverride() ?? this.opts.chunkSize ?? DEFAULT_TUS_CHUNK_SIZE,
      retryDelays: this.opts.retryDelays ?? jitteredRetryDelays(),
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      fingerprint: async (f: File) => uploadFingerprint(f, videoId),
      ...(this.opts.urlStorage ? { urlStorage: this.opts.urlStorage } : {}),
      httpStack: new ResilientHttpStack(this.opts.httpStack, () => {
        this.authStale = true;
      }),
      metadata: {
        filename: file.name,
        filetype: file.type,
        ...(this.opts.metadata || {}),
        tusSessionId: this.sessionId,
        videoId,
      },
      onBeforeRequest: async (req) => {
        const force = this.authStale;
        this.authStale = false;
        const authorization = await this.opts.getAuthorization(force);
        if (authorization) req.setHeader('Authorization', authorization);
      },
      onAfterResponse: (req, res) => {
        // A new upload (the old one's bytes are gone) starts again from 0
        if (req.getMethod() === 'POST' && res.getStatus() === 201) this.floor = 0;
      },
      onShouldRetry: (error) => {
        if (this.aborted) return false;
        const action = classifyTusFailure(failureStatus(error));
        if (action === 'refresh-auth') this.authStale = true;
        if (action === 'retry' || action === 'refresh-auth') {
          this.setReconnecting(true);
          return true;
        }
        return false;
      },
      onProgress: (sent, total) => {
        // Never backwards: a retried chunk re-sends bytes already counted
        this.floor = Math.max(this.floor, sent);
        this.opts.onProgress?.(this.floor, total);
      },
      onChunkComplete: () => {
        this.reauthorisations = 0;
        this.extraCycles = 0;
        this.setReconnecting(false);
      },
      onSuccess: () => {
        this.finished = true;
        this.setReconnecting(false);
        this.opts.onSuccess?.();
      },
      onError: (error) => {
        void this.handleError(error);
      },
    });
  }

  private async handleError(error: Error): Promise<void> {
    if (this.aborted || this.finished) return;
    const action = classifyTusFailure(failureStatus(error));

    if (action === 'reauthorise' && this.reauthorisations < MAX_REAUTHORISATIONS) {
      this.reauthorisations++;
      this.setReconnecting(true);
      const result = await this.reauthoriseWithRetry();
      if (this.aborted) return;
      if (!result) return this.fail(error);
      if (result.kind === 'completed') {
        this.finished = true;
        this.setReconnecting(false);
        this.opts.onSuccess?.();
        return;
      }
      if (result.kind === 'gone') return this.fail(new Error(result.message));
      this.sessionId = result.tusSessionId;
      this.uploadUrl = result.tusUploadId ? `${this.opts.endpoint.replace(/\/+$/, '')}/${result.tusUploadId}` : undefined;
      this.upload = this.build();
      await this.resume();
      return;
    }

    if ((action === 'retry' || action === 'refresh-auth') && this.extraCycles < EXTRA_RETRY_CYCLES) {
      this.extraCycles++;
      this.setReconnecting(true);
      await this.sleep(EXTRA_RETRY_CYCLE_DELAY_MS);
      if (this.aborted) return;
      // A fresh tus.Upload (fresh retry schedule) on the same upload URL
      if (this.upload?.url) this.uploadUrl = this.upload.url;
      this.upload = this.build();
      await this.resume();
      return;
    }

    this.fail(error);
  }

  private async reauthoriseWithRetry(): Promise<ReauthoriseResult | null> {
    const delays = jitteredRetryDelays([0, 2000, 5000, 15000, 30000, 60000]);
    for (const delay of delays) {
      if (delay) await this.sleep(delay);
      if (this.aborted) return null;
      try {
        return await this.opts.reauthorise(this.opts.videoId);
      } catch {
        // transient: next delay
      }
    }
    return null;
  }

  private fail(error: Error): void {
    this.setReconnecting(false);
    this.opts.onError?.(error);
  }
}
