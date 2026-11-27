/**
 * TUS Protocol Proxy for Bunny.net
 *
 * This module implements a secure proxy for the TUS (Tus Resumable Upload) protocol
 * that forwards requests to Bunny.net while hiding the actual endpoint from clients.
 *
 * Architecture:
 * Client (tus-js-client) → API Proxy (this) → Bunny.net TUS Server
 *
 * Security Benefits:
 * - Bunny.net credentials never exposed to client
 * - Complete control over authentication and authorization
 * - Ability to add custom rate limiting and monitoring
 * - Can inject metadata and modify requests as needed
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { can, requestIdOf } from '@al-ummah/shared-types';
import { roleOnRecord } from '../../../lib/channelAccess';
import { markExpectedRetry } from '../../../middleware/logging';
import { getAuthContext } from '../../../middleware/auth';
import { bunnyTusRequestHeaders, getTusSessionKey, parseTusMetadata, tusUploadIndexKey, type TusProxySession } from '../../../lib/bunny/tus';
import { markUploadComplete } from '../../../lib/uploads/lifecycle';
import { teePatch } from '../../../lib/media/originals';
import { uploadsToBunny } from '../../../lib/media/ingest';
import { isSourceChanged } from '../../../lib/media/source-changed';
import { deleteR2Upload, MAX_R2_PATCH_BYTES, R2PartConflict, r2UploadOffset, writeR2Part } from '../../../lib/media/r2-tus';
import type { VideoMediaProviders } from '@al-ummah/shared-types';
import R2Repository, { rethrowBusy } from '../../../lib/r2Repo';
import { Video as BusinessVideo } from '../../../lib/types';
import Queue, { MessageType } from '../../../lib/queue';
import { logger } from '../../../lib/logger';

// TUS Protocol Constants
const TUS_VERSION = '1.0.0';
/** Tus-Max-Size: 5 GB */
const TUS_MAX_SIZE = 5368709120;
const TUS_EXTENSIONS = ['creation', 'creation-with-upload', 'termination', 'concatenation'];
const BUNNY_TUS_ENDPOINT = 'https://video.bunnycdn.com/tusupload';

/**
 * How long a proxy upload session lives. It is written once (POST) and only
 * read afterwards, so a long life costs nothing; 1 hour made a big file (or a
 * bulk queue) outlive its session, and every later HEAD/PATCH got 404.
 */
export const TUS_UPLOAD_SESSION_TTL_SECONDS = 7 * 24 * 3600;

/** Seconds a client should wait before retrying a transient failure. */
const RETRY_AFTER_SECONDS = 5;

// Upload metadata stored in KV for session management: written once by POST,
// then only read (SCALABILITY-AUDIT AV-24). `uploadOffset` is the offset at
// creation; the live offset is always Bunny's.
interface TusUploadSession {
  videoId: string;
  userId: string;
  bunnyUploadUrl?: string;
  /** 'r2': our own TUS target writes the bytes into the originals bucket (lib/media/r2-tus.ts) */
  target?: 'bunny' | 'r2';
  fileSize: number;
  uploadOffset: number;
  createdAt: string;
  expiresAt: string;
  metadata?: Record<string, string>;
  /** An admin's import: see TusProxySession.adminImport */
  adminImport?: true;
  /** The video's uploadRound when this upload was created */
  uploadRound?: number;
}

interface UploadRecord {
  userId?: string | null;
  channelId?: string | null;
  uploadStatus?: string;
  abandoned?: unknown;
  isDeleted?: boolean;
  media?: VideoMediaProviders;
  fileSize?: number;
  processingIssue?: unknown;
  uploadRound?: number;
}

/** Whether an upload may go on: `gone` answers like an unknown upload, `closed` is 410 (the file is sent again in a new one), `unavailable` is retried. */
type LiveUpload = { kind: 'open'; record: UploadRecord } | { kind: 'gone' } | { kind: 'closed' } | { kind: 'unavailable' };

// The durable copy of the session on the video record (R2) lets HEAD and
// PATCH answer from Bunny while KV is unavailable or the KV entry is gone, and
// uploadResume hand the same Bunny upload back. Cleared on completion.
export type { VideoTusUpload } from '../../../lib/uploads/lifecycle';
import type { VideoTusUpload } from '../../../lib/uploads/lifecycle';

/**
 * Proxy upload ids are `<uploadKey>.<videoId>`: uploadKey is new for every
 * created upload (KV `tus:upload:<uploadKey>`), and the video id lets the proxy
 * find the durable copy of the session without KV. Older ids (the initiate
 * session id alone) still resolve through KV.
 */
export function buildTusUploadId(sessionId: string, videoId: string): string {
  return `${sessionId}.${videoId}`;
}

export function parseTusUploadId(uploadId: string): { sessionId: string; videoId?: string } | null {
  if (!/^[A-Za-z0-9-]{1,64}(\.[A-Za-z0-9-]{1,64})?$/.test(uploadId)) return null;
  const [sessionId, videoId] = uploadId.split('.');
  return { sessionId, videoId };
}

/**
 * Per-isolate cache of sessions already read. A miss (cold isolate, a new
 * Worker version after a deploy) only costs a KV read: nothing an upload needs
 * lives only in memory.
 */
const SESSION_CACHE_MAX = 500;
const SESSION_CACHE_MS = 10 * 60 * 1000;
const sessionCache = new Map<string, { session: TusUploadSession; at: number }>();

function cacheSession(sessionId: string, session: TusUploadSession): void {
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) sessionCache.delete(oldest);
  }
  sessionCache.set(sessionId, { session, at: Date.now() });
}

function cachedSession(sessionId: string): TusUploadSession | null {
  const hit = sessionCache.get(sessionId);
  if (!hit) return null;
  if (Date.now() - hit.at > SESSION_CACHE_MS) {
    sessionCache.delete(sessionId);
    return null;
  }
  return hit.session;
}

/** Test hook: forget every cached session. */
export function clearTusSessionCache(): void {
  sessionCache.clear();
}

type SessionLookup =
  | { kind: 'found'; session: TusUploadSession }
  /** `why`: where the session was looked for and what was there (categories only; for the server log, never the answer: #1957) */
  | { kind: 'missing'; why: string }
  | { kind: 'unavailable' };

/**
 * A transient failure (Bunny 5xx/429, a network error, KV or R2 unavailable):
 * the client must retry, never start the upload over.
 */
function isTransientUpstreamStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408 || status === 401 || status === 403;
}

/**
 * TUS Proxy Router
 * Handles all TUS protocol operations as a proxy to Bunny.net
 */
export class TusProxy {
  private env: any;
  private authContext: any;

  constructor(env: any, authContext: any) {
    this.env = env;
    this.authContext = authContext;
  }

  /**
   * Get KV namespace for TUS sessions
   */
  private getSessionStore() {
    return this.env.TUS_SESSIONS;
  }

  /**
   * Generate session key for KV storage
   */
  private getSessionKey(sessionId: string): string {
    return `tus:upload:${sessionId}`;
  }

  /**
   * Create Bunny.net authorization headers (a fresh signature per request, so
   * nothing signed at initiate time can expire under a long upload).
   */
  private async createBunnyHeaders(videoId: string): Promise<Record<string, string>> {
    return bunnyTusRequestHeaders(this.env, videoId);
  }

  /** 503 + Retry-After: tus-js-client retries PATCH/POST on any 5xx. */
  private retryLater(message: string): Response {
    return new Response(JSON.stringify({ error: message, retryable: true }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(RETRY_AFTER_SECONDS),
        'Tus-Resumable': TUS_VERSION,
        'Cache-Control': 'no-store',
      },
    });
  }

  /**
   * 423 + Retry-After for HEAD. tus-js-client treats any other non-2xx HEAD
   * answer as "upload gone" and creates a NEW upload from byte 0; a 423 is the
   * one status it retries (same upload URL, same offset).
   */
  private headRetryLater(): Response {
    return new Response(null, {
      status: 423,
      headers: {
        'Retry-After': String(RETRY_AFTER_SECONDS),
        'Tus-Resumable': TUS_VERSION,
        'Cache-Control': 'no-store',
      },
    });
  }

  /**
   * Find the session for a proxy upload id: isolate cache, then KV, then the
   * durable copy on the video record. `unavailable` when a store failed and
   * nothing was found, so callers answer "retry" instead of "gone".
   */
  private async resolveSession(uploadId: string): Promise<SessionLookup> {
    const parsed = parseTusUploadId(uploadId);
    if (!parsed) return { kind: 'missing', why: 'upload id is not session.video' };
    const { sessionId, videoId } = parsed;

    const cached = cachedSession(sessionId);
    if (cached && (!videoId || cached.videoId === videoId)) return { kind: 'found', session: cached };

    let storeFailed = false;
    // What each store held, for the server log of a PATCH that finds no session (#1957: a PATCH answered 404 right after its upload was created)
    let kvState = 'not read';
    let recordState = videoId ? 'not read' : 'no video id in the upload id';
    try {
      const raw = await this.getSessionStore().get(this.getSessionKey(sessionId));
      kvState = raw ? 'found' : 'empty';
      if (raw) {
        const session: TusUploadSession = JSON.parse(raw);
        if (!videoId || session.videoId === videoId) {
          cacheSession(sessionId, session);
          return { kind: 'found', session };
        }
        kvState = 'for another video';
      }
    } catch (error) {
      storeFailed = true;
      kvState = 'failed';
      logger.warn('[TUS Proxy] KV session read failed, trying the video record', {
        uploadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (videoId) {
      try {
        // Read the bucket directly: R2Repository.getObject turns an R2 error
        // into "missing", and a missing session would restart the upload.
        const object = await this.env.videos.get(videoId);
        const video = object ? await object.json() as (z.infer<typeof BusinessVideo> & { tusUpload?: VideoTusUpload }) : null;
        const durable = video?.tusUpload;
        recordState = !video ? 'no video record' : !durable ? 'no session on the record' : durable.sessionId !== sessionId ? 'another session on the record' : !(durable.bunnyUploadUrl || durable.target === 'r2') ? 'session without a target' : 'found';
        if (video && durable && durable.sessionId === sessionId && (durable.bunnyUploadUrl || durable.target === 'r2')) {
          const session: TusUploadSession = {
            videoId,
            // The uploader: a channel member's upload is owned by the channel owner
            userId: video.uploadedBy ?? video.userId,
            bunnyUploadUrl: durable.bunnyUploadUrl,
            ...(durable.target === 'r2' ? { target: 'r2' as const } : {}),
            fileSize: durable.fileSize,
            uploadOffset: 0,
            createdAt: durable.createdAt,
            expiresAt: durable.createdAt,
            ...(durable.adminImport ? { adminImport: true as const } : {}),
            ...(durable.uploadRound ? { uploadRound: durable.uploadRound } : {}),
          };
          cacheSession(sessionId, session);
          return { kind: 'found', session };
        }
      } catch (error) {
        storeFailed = true;
        recordState = 'failed';
        logger.warn('[TUS Proxy] Video record read failed', {
          uploadId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return storeFailed ? { kind: 'unavailable' } : { kind: 'missing', why: `session store: ${kvState}; video record: ${recordState}` };
  }

  /**
   * Whether the upload may go on now, read again on every step: the video is still there and not
   * abandoned, and the uploader may upload to its channel today (lib/channelAccess.ts: the live
   * channel decides, so a channel that moved or a role that was taken away stops the upload). An
   * admin's import needs no role on the channel. A store that cannot be read is `unavailable`.
   */
  private async liveUpload(session: Pick<TusUploadSession, 'videoId' | 'userId' | 'adminImport' | 'metadata' | 'uploadRound'>): Promise<LiveUpload> {
    try {
      const object = await this.env.videos.get(session.videoId);
      if (!object) return { kind: 'gone' };
      const record = (await object.json()) as UploadRecord;
      if (record.abandoned || record.isDeleted) return { kind: 'gone' };
      if (can(await roleOnRecord(this.env, record, session.userId), 'video.upload') || (await this.isAdminImport(session))) {
        // Its bytes were not the file, or it was opened again since (uploads/placeholder.ts reuseFields)
        const closed = isSourceChanged(record) || (session.uploadRound ?? 0) !== (record.uploadRound ?? 0);
        return closed ? { kind: 'closed' } : { kind: 'open', record };
      }
      logger.info('[TUS Proxy] The uploader may not upload to this channel (any more)', { videoId: session.videoId, channelId: record.channelId });
      return { kind: 'gone' };
    } catch (error) {
      logger.warn('[TUS Proxy] Video or channel record unavailable', { videoId: session.videoId, error: error instanceof Error ? error.message : String(error) });
      return { kind: 'unavailable' };
    }
  }

  /** An admin's import: marked on the upload, or (uploads from before the mark) on the session it was created with. */
  private async isAdminImport(session: Pick<TusUploadSession, 'userId' | 'adminImport' | 'metadata'>): Promise<boolean> {
    if (session.adminImport) return true;
    const id = session.metadata?.tusSessionId;
    if (!id) return false;
    const raw = await this.getSessionStore().get(getTusSessionKey(id));
    const stored = raw ? (JSON.parse(raw) as Partial<TusProxySession>) : null;
    return stored?.adminImport === true && stored.userId === session.userId;
  }

  /**
   * Our own target holds the only copy of the bytes: they may change only while the upload is
   * unfinished (the same rule as POST).
   */
  private ownTargetFinished(record: UploadRecord): boolean {
    return !(record.uploadStatus === 'initiated' || record.uploadStatus === 'uploading' || !record.uploadStatus);
  }

  /** Our own target: the offset is what the originals bucket holds from byte 0. */
  private async headR2(session: TusUploadSession, uploadId: string): Promise<Response> {
    let offset: number;
    try {
      offset = await r2UploadOffset(this.env, session.videoId, parseTusUploadId(uploadId)?.sessionId ?? uploadId);
    } catch (error) {
      logger.warn('[TUS Proxy] Originals bucket unavailable on HEAD; client retries', { uploadId, error: error instanceof Error ? error.message : String(error) });
      return this.headRetryLater();
    }
    if (session.fileSize > 0 && offset >= session.fileSize) await this.markUploaded(session, uploadId);
    return new Response(null, {
      status: 200,
      headers: {
        'Upload-Offset': String(Math.min(offset, session.fileSize || offset)),
        'Upload-Length': String(session.fileSize),
        'Tus-Resumable': TUS_VERSION,
        'Cache-Control': 'no-store',
        'Access-Control-Expose-Headers': 'Upload-Offset, Upload-Length, Tus-Resumable',
      },
    });
  }

  /**
   * Our own target: one PATCH is one part at its offset. The offset must be where the stored bytes
   * end (409 otherwise: the client asks HEAD and resumes); the length must be known (411).
   */
  private async patchR2(c: any, session: TusUploadSession, uploadId: string, record: UploadRecord): Promise<Response> {
    const uploadKey = parseTusUploadId(uploadId)?.sessionId ?? uploadId;
    const offsetHeader = c.req.header('Upload-Offset');
    const lengthHeader = c.req.header('Content-Length');
    if (!offsetHeader || !/^\d+$/.test(offsetHeader)) return c.json({ error: 'Upload-Offset is required' }, 400);
    if (!lengthHeader || !/^\d+$/.test(lengthHeader)) return c.json({ error: 'Content-Length is required' }, 411);
    const offset = parseInt(offsetHeader, 10);
    const length = parseInt(lengthHeader, 10);
    if (length > MAX_R2_PATCH_BYTES) return c.json({ error: 'Chunk too large' }, 413);
    if (offset + length > session.fileSize) return c.json({ error: 'Chunk goes past Upload-Length' }, 400);
    const body = c.req.raw.body as ReadableStream<Uint8Array> | null;
    if (!body && length > 0) return c.json({ error: 'No request body' }, 400);
    if (this.ownTargetFinished(record)) return c.json({ error: 'Upload already completed' }, 409);
    let stored: number;
    try {
      stored = await r2UploadOffset(this.env, session.videoId, uploadKey);
    } catch (error) {
      logger.warn('[TUS Proxy] Originals bucket unavailable on PATCH; client retries', { uploadId, error: error instanceof Error ? error.message : String(error) });
      return this.retryLater('Upload storage unavailable, retry');
    }
    if (offset !== stored) {
      return new Response(JSON.stringify({ error: 'Offset mismatch' }), { status: 409, headers: { 'Content-Type': 'application/json', 'Tus-Resumable': TUS_VERSION, 'Upload-Offset': String(stored) } });
    }
    if (length > 0) {
      try {
        await writeR2Part(this.env, { videoId: session.videoId, uploadKey, offset, length, body: body!, createOnly: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof R2PartConflict || /\(10058\)|Reduce your concurrent request rate for the same object/i.test(message)) {
          markExpectedRetry(c);
          logger.warn('[TUS Proxy] Chunk write contended; client retries', { uploadId, offset, length, error: message });
          return this.retryLater('Upload storage busy, retry');
        }
        logger.warn('[TUS Proxy] Could not store a chunk; client retries', { uploadId, offset, length, error: message });
        return this.retryLater('Upload storage unavailable, retry');
      }
    }
    const newOffset = offset + length;
    if (newOffset >= session.fileSize && !(await this.markUploaded(session, uploadId))) return c.json({ error: 'Upload not found' }, 404);
    return new Response(null, {
      status: 204,
      headers: {
        'Upload-Offset': String(newOffset),
        'Tus-Resumable': TUS_VERSION,
        'Access-Control-Expose-Headers': 'Upload-Offset, Tus-Resumable',
      },
    });
  }

  /**
   * Every byte is stored (Bunny or our own target): lib/uploads/lifecycle.ts (idempotent, never
   * throws). Checked once more first: the channel can move while the last chunk is on its way. False
   * when the upload may not finish; when the stores cannot say, the next HEAD or the sweep marks it.
   */
  private async markUploaded(session: TusUploadSession, uploadId: string): Promise<boolean> {
    const live = await this.liveUpload(session);
    if (live.kind === 'gone' || live.kind === 'closed') return false;
    if (live.kind === 'unavailable') return true;
    await markUploadComplete(this.env, { videoId: session.videoId, userId: session.userId, fileSize: session.fileSize, uploadId, uploadKey: parseTusUploadId(uploadId)?.sessionId });
    return true;
  }

  /**
   * OPTIONS - Handle CORS preflight and TUS capabilities
   */
  async handleOptions(c: any): Promise<Response> {
    logger.debug('[TUS Proxy] OPTIONS request');

    return new Response(null, {
      status: 204,
      headers: {
        'Tus-Resumable': TUS_VERSION,
        'Tus-Version': TUS_VERSION,
        'Tus-Max-Size': String(TUS_MAX_SIZE),
        'Tus-Extension': TUS_EXTENSIONS.join(','),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, HEAD, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Upload-Length, Upload-Offset, Tus-Resumable, Upload-Metadata, Upload-Defer-Length, Upload-Concat',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Expose-Headers': 'Upload-Offset, Location, Tus-Resumable, Tus-Version, Tus-Max-Size, Tus-Extension, Upload-Length, Upload-Metadata, Retry-After',
      },
    });
  }

  /**
   * POST - Create new upload
   */
  async handlePost(c: any): Promise<Response> {
    const userId = this.authContext?.userId;
    if (!userId) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    try {
      // Parse TUS headers
      const uploadLength = c.req.header('Upload-Length');
      const uploadMetadata = c.req.header('Upload-Metadata');
      const uploadDeferLength = c.req.header('Upload-Defer-Length');

      logger.debug('[TUS Proxy] POST - Create upload', {
        userId,
        uploadLength,
        uploadDeferLength,
      });

      // Parse metadata (base64 encoded key-value pairs)
      const metadata = this.parseUploadMetadata(uploadMetadata || '');
      // A repeated key could mean different things to the tier gate and here
      if (!metadata) return c.json({ error: 'Upload-Metadata keys must be unique' }, 400);
      const tusSessionId = metadata.tusSessionId;

      if (!tusSessionId || !/^[A-Za-z0-9-]{1,64}$/.test(tusSessionId)) {
        return c.json({ error: 'tusSessionId required in metadata' }, 400);
      }

      // Retrieve TUS session from KV (created during initiate or resume)
      const kv = this.getSessionStore();
      let sessionData: string | null;
      try {
        sessionData = await kv.get(`tus:session:${tusSessionId}`);
      } catch (error) {
        logger.warn('[TUS Proxy] KV unavailable reading the initiate session', { tusSessionId, error: error instanceof Error ? error.message : String(error) });
        return this.retryLater('Session store unavailable, retry');
      }

      if (!sessionData) {
        // The client asks uploadResume for a new session for the same video.
        return c.json({ error: 'TUS session not found or expired' }, 404);
      }

      const storedSession = JSON.parse(sessionData);
      const videoId = storedSession.videoId;

      // Verify ownership
      if (storedSession.userId !== userId) {
        return c.json({ error: 'Unauthorized' }, 403);
      }

      // Only an unfinished video takes a new upload: a long-lived session
      // must not let anyone replace a finished video's content at Bunny.
      const adminImport = storedSession.adminImport === true;
      const uploadRound: number | undefined = storedSession.uploadRound;
      const live = await this.liveUpload({ videoId, userId, uploadRound, ...(adminImport ? { adminImport: true as const } : {}) });
      if (live.kind === 'unavailable') return this.retryLater('Video store unavailable, retry');
      // Removed, abandoned by the upload reaper (deleted at Bunny), or on a channel the uploader may not upload to: gone
      if (live.kind === 'gone') return c.json({ error: 'Video not found' }, 404);
      if (live.kind === 'closed') return c.json({ error: 'Upload closed' }, 410);
      const declaredSize = live.record.fileSize;
      // Bunny takes the bytes only when it holds this video (lib/media/ingest.ts); otherwise our own target does
      const toBunny = uploadsToBunny(live.record);
      const videoStatus = live.record.uploadStatus;
      if (videoStatus === 'ready' || videoStatus === 'processing') {
        return c.json({ error: 'Upload already completed' }, 409);
      }

      let bunnyUploadUrl = '';
      if (!toBunny) {
        // Our own target stores parts by offset and needs the total size up front
        if (!uploadLength || !/^\d+$/.test(uploadLength) || parseInt(uploadLength, 10) <= 0) {
          return c.json({ error: 'Upload-Length is required' }, 400);
        }
        const length = parseInt(uploadLength, 10);
        if (length > TUS_MAX_SIZE) return c.json({ error: 'File too large' }, 413);
        // The file announced at initiate (the claim, the plan checks): the same size or nothing
        if (declaredSize && length !== declaredSize) return c.json({ error: 'Upload-Length does not match the file started at initiate' }, 400);
      } else {
        // Fresh Bunny signature: the one stored at initiate expires after an
        // hour, and a queued file in a bulk batch can start later than that.
        const requestHeaders: Record<string, string> = {
          ...(await this.createBunnyHeaders(videoId)),
          'Tus-Resumable': TUS_VERSION,
          'Upload-Metadata': uploadMetadata || '',
        };

        // Only include Upload-Length OR Upload-Defer-Length, never both
        if (uploadLength) {
          requestHeaders['Upload-Length'] = uploadLength;
        } else if (uploadDeferLength) {
          requestHeaders['Upload-Defer-Length'] = uploadDeferLength;
        }

        let bunnyResponse: Response;
        try {
          bunnyResponse = await fetch(storedSession.tusEndpoint || BUNNY_TUS_ENDPOINT, {
            method: 'POST',
            headers: requestHeaders,
          });
        } catch (error) {
          logger.warn('[TUS Proxy] Bunny.net POST network error', { videoId, error: error instanceof Error ? error.message : String(error) });
          return this.retryLater('Upload service unreachable, retry');
        }

        if (!bunnyResponse.ok) {
          let errorBody: string | null = null;
          try {
            errorBody = await bunnyResponse.text();
          } catch {
            // Ignore if can't read body
          }

          logger.error('[TUS Proxy] Bunny.net POST failed', {
            status: bunnyResponse.status,
            statusText: bunnyResponse.statusText,
            responseBody: errorBody,
            videoId,
          });
          if (isTransientUpstreamStatus(bunnyResponse.status)) return this.retryLater('Upload service busy, retry');
          return c.json({ error: 'Upload creation failed', details: errorBody }, bunnyResponse.status);
        }

        // Get the Location header from Bunny's response
        const bunnyLocation = bunnyResponse.headers.get('Location');
        if (!bunnyLocation) {
          logger.error('[TUS Proxy] No Location header in Bunny response', { videoId });
          return this.retryLater('Upload service gave no upload URL, retry');
        }

        // Convert relative URL to absolute URL if needed
        bunnyUploadUrl = bunnyLocation.startsWith('/')
          ? `https://video.bunnycdn.com${bunnyLocation}`
          : bunnyLocation;
      }

      const fileSize = parseInt(uploadLength || '0', 10);
      // A new key per created upload: a session is never overwritten, so no
      // location (or isolate cache) can read an old Bunny URL for it.
      const uploadKey = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const session: TusUploadSession = {
        videoId,
        userId,
        bunnyUploadUrl,
        ...(toBunny ? {} : { target: 'r2' as const }),
        fileSize,
        uploadOffset: 0,
        createdAt,
        expiresAt: new Date(Date.now() + TUS_UPLOAD_SESSION_TTL_SECONDS * 1000).toISOString(),
        metadata,
        ...(adminImport ? { adminImport: true as const } : {}),
        ...(uploadRound ? { uploadRound } : {}),
      };

      // Two copies, each written once per upload: KV (fast path) and the video
      // record (survives KV trouble and an expired KV entry). One is enough.
      const [kvWrite, durableWrite] = await Promise.allSettled([
        kv.put(this.getSessionKey(uploadKey), JSON.stringify(session), {
          expirationTtl: TUS_UPLOAD_SESSION_TTL_SECONDS,
        }).then(() =>
          // The per-user index an account erasure finds the session through (lib/privacy/upload-traces.ts)
          userId
            ? kv.put(tusUploadIndexKey(userId, uploadKey), '1', { expirationTtl: TUS_UPLOAD_SESSION_TTL_SECONDS })
            : undefined,
        ),
        new R2Repository<z.infer<typeof BusinessVideo> & { tusUpload?: VideoTusUpload }>(this.env.videos)
          .updateObject(videoId, (video) => {
            if (video.uploadStatus === 'ready' || video.uploadStatus === 'processing' || (video as UploadRecord).abandoned || (video as UploadRecord).isDeleted) return false;
            if (((video as UploadRecord).uploadRound ?? 0) !== (uploadRound ?? 0)) return false;
            video.tusUpload = { sessionId: uploadKey, bunnyUploadUrl, ...(toBunny ? {} : { target: 'r2' as const }), fileSize, createdAt, ...(adminImport ? { adminImport: true as const } : {}), ...(uploadRound ? { uploadRound } : {}) };
            return true;
          }),
      ]);
      if (kvWrite.status === 'rejected' && durableWrite.status === 'rejected') {
        logger.error('[TUS Proxy] Could not store the upload session anywhere', {
          videoId,
          kv: String(kvWrite.reason),
          r2: String(durableWrite.reason),
        });
        return this.retryLater('Session store unavailable, retry');
      }
      if (kvWrite.status === 'rejected') logger.warn('[TUS Proxy] KV session write failed; the video record holds it', { videoId, error: String(kvWrite.reason) });
      if (durableWrite.status === 'rejected') logger.warn('[TUS Proxy] Video record session write failed; KV holds it', { videoId, error: String(durableWrite.reason) });
      cacheSession(uploadKey, session);

      // Return proxy location: session id + video id (see buildTusUploadId)
      const proxyLocation = `${c.req.url.replace(/\/+$/, '')}/${buildTusUploadId(uploadKey, videoId)}`;

      return new Response(null, {
        status: 201,
        headers: {
          'Location': proxyLocation,
          'Tus-Resumable': TUS_VERSION,
          'Access-Control-Expose-Headers': 'Location, Tus-Resumable',
        },
      });

    } catch (error) {
      rethrowBusy(error);
      logger.error('[TUS Proxy] POST error', error);
      return this.retryLater('Failed to create upload, retry');
    }
  }

  /**
   * HEAD - Get upload offset. Answers from Bunny; every failure that is not
   * "this upload is gone" is a 423 so the client retries the same upload.
   */
  async handleHead(c: any, uploadId: string): Promise<Response> {
    try {
      const lookup = await this.resolveSession(uploadId);
      if (lookup.kind === 'unavailable') return this.headRetryLater();
      if (lookup.kind === 'missing') return new Response(null, { status: 404, headers: { 'Tus-Resumable': TUS_VERSION, 'Cache-Control': 'no-store' } });
      const session = lookup.session;

      // Verify ownership
      if (session.userId !== this.authContext?.userId) {
        return new Response(null, { status: 403 });
      }
      const live = await this.liveUpload(session);
      if (live.kind === 'unavailable') return this.headRetryLater();
      if (live.kind === 'gone') return new Response(null, { status: 404, headers: { 'Tus-Resumable': TUS_VERSION, 'Cache-Control': 'no-store' } });
      if (live.kind === 'closed') return new Response(null, { status: 410, headers: { 'Tus-Resumable': TUS_VERSION, 'Cache-Control': 'no-store' } });
      if (session.target === 'r2') return await this.headR2(session, uploadId);
      if (!session.bunnyUploadUrl) {
        return new Response(null, { status: 404, headers: { 'Tus-Resumable': TUS_VERSION, 'Cache-Control': 'no-store' } });
      }

      // Forward HEAD to Bunny.net
      let bunnyResponse: Response;
      try {
        const bunnyHeaders = await this.createBunnyHeaders(session.videoId);
        bunnyResponse = await fetch(session.bunnyUploadUrl, {
          method: 'HEAD',
          headers: {
            ...bunnyHeaders,
            'Tus-Resumable': TUS_VERSION,
          },
        });
      } catch (error) {
        logger.warn('[TUS Proxy] Bunny.net HEAD failed', { uploadId, error: error instanceof Error ? error.message : String(error) });
        return this.headRetryLater();
      }

      if (!bunnyResponse.ok) {
        // Only Bunny saying the upload is gone means the bytes are gone.
        if (bunnyResponse.status === 404 || bunnyResponse.status === 410) {
          logger.warn('[TUS Proxy] Bunny no longer has the upload', { uploadId, status: bunnyResponse.status });
          return new Response(null, { status: bunnyResponse.status, headers: { 'Tus-Resumable': TUS_VERSION, 'Cache-Control': 'no-store' } });
        }
        logger.warn('[TUS Proxy] Bunny.net HEAD answered an error; client retries', { uploadId, status: bunnyResponse.status });
        return this.headRetryLater();
      }

      // Get current offset from Bunny
      const uploadOffset = bunnyResponse.headers.get('Upload-Offset') || '0';
      const uploadLength = bunnyResponse.headers.get('Upload-Length') || session.fileSize.toString();

      // The session is written once, by POST (SCALABILITY-AUDIT AV-24): the
      // offset always comes from Bunny, so nothing is written back here. A
      // complete upload whose final PATCH could not mark the video is marked
      // now (idempotent).
      if (session.fileSize > 0 && parseInt(uploadOffset, 10) >= session.fileSize) {
        await this.markUploaded(session, uploadId);
      }

      return new Response(null, {
        status: 200,
        headers: {
          'Upload-Offset': uploadOffset,
          'Upload-Length': uploadLength,
          'Tus-Resumable': TUS_VERSION,
          'Cache-Control': 'no-store',
          'Access-Control-Expose-Headers': 'Upload-Offset, Upload-Length, Tus-Resumable',
        },
      });

    } catch (error) {
      logger.error('[TUS Proxy] HEAD error', { uploadId, error: error instanceof Error ? error.message : String(error) });
      return this.headRetryLater();
    }
  }

  /**
   * PATCH - Upload chunk
   * This is the most critical method - must stream data efficiently
   */
  async handlePatch(c: any, uploadId: string): Promise<Response> {
    try {
      // Parse headers
      const uploadOffset = c.req.header('Upload-Offset');
      const contentType = c.req.header('Content-Type');

      // Validate content type
      if (contentType !== 'application/offset+octet-stream') {
        return c.json({ error: 'Invalid Content-Type' }, 415);
      }

      const lookup = await this.resolveSession(uploadId);
      if (lookup.kind === 'unavailable') return this.retryLater('Session store unavailable, retry');
      if (lookup.kind === 'missing') {
        // The answer stays "Upload not found": a reason would tell a caller who has not been checked as the owner
        // whether a record exists. The cause goes to the log with the request's ray id, which the caller's response
        // also carries (cf-ray), so a PATCH that fails right after its create can be traced (#1957).
        logger.warn('[TUS Proxy] PATCH found no session for the upload', { uploadId, why: lookup.why, ray: requestIdOf(c.req.raw) });
        return c.json({ error: 'Upload not found' }, 404);
      }
      const session = lookup.session;

      // Verify ownership
      if (session.userId !== this.authContext?.userId) {
        return c.json({ error: 'Unauthorized' }, 403);
      }

      const live = await this.liveUpload(session);
      if (live.kind === 'unavailable') return this.retryLater('Video store unavailable, retry');
      if (live.kind === 'gone') return c.json({ error: 'Upload not found' }, 404);
      if (live.kind === 'closed') return c.json({ error: 'Upload closed' }, 410);

      if (session.target === 'r2') return await this.patchR2(c, session, uploadId, live.record);

      if (!session.bunnyUploadUrl) {
        logger.error('[TUS Proxy] No bunnyUploadUrl in session', { uploadId });
        return c.json({ error: 'Upload not found' }, 404);
      }

      // IMPORTANT: Stream the request body directly to Bunny.net
      // Don't buffer the entire file in memory!
      const requestBody = c.req.raw.body;

      if (!requestBody) {
        return c.json({ error: 'No request body' }, 400);
      }

      // Our own copy of the upload (docs/media-delivery/ORIGINALS.md): the body is teed, one branch to
      // Bunny exactly as before, one to R2 keyed by this PATCH's offset. Bunny's answer is the response.
      const lengthHeader = c.req.header('Content-Length');
      const copy = teePatch(this.env, requestBody, {
        videoId: session.videoId,
        uploadId: parseTusUploadId(uploadId)?.sessionId ?? uploadId,
        offset: parseInt(uploadOffset || '0', 10),
        length: lengthHeader !== undefined && /^\d+$/.test(lengthHeader) ? parseInt(lengthHeader, 10) : null,
      });

      let bunnyResponse: Response;
      try {
        const bunnyHeaders = await this.createBunnyHeaders(session.videoId);
        // Forward PATCH to Bunny.net with streaming
        bunnyResponse = await fetch(session.bunnyUploadUrl, {
          method: 'PATCH',
          headers: {
            ...bunnyHeaders,
            'Content-Type': 'application/offset+octet-stream',
            'Upload-Offset': uploadOffset || '0',
            'Tus-Resumable': TUS_VERSION,
          },
          body: copy.body, // Stream directly (the other tee branch goes to R2)
          // @ts-ignore - Cloudflare Workers specific
          duplex: 'half', // Required for streaming in Workers
        });
      } catch (error) {
        logger.warn('[TUS Proxy] Bunny.net PATCH network error; client retries', {
          uploadId,
          error: error instanceof Error ? error.message : String(error),
        });
        return this.retryLater('Upload service unreachable, retry');
      }

      if (!bunnyResponse.ok) {
        logger.error('[TUS Proxy] Bunny.net PATCH failed', {
          uploadId,
          status: bunnyResponse.status,
          statusText: bunnyResponse.statusText,
        });
        // 409 (offset mismatch) is retried by the client after a HEAD; 404/410
        // mean the upload is gone. Everything transient becomes a 503.
        if (bunnyResponse.status === 409 || bunnyResponse.status === 404 || bunnyResponse.status === 410) {
          return new Response(JSON.stringify({ error: 'Upload failed' }), {
            status: bunnyResponse.status,
            headers: { 'Content-Type': 'application/json', 'Tus-Resumable': TUS_VERSION },
          });
        }
        if (isTransientUpstreamStatus(bunnyResponse.status)) return this.retryLater('Upload service busy, retry');
        return c.json({ error: 'Upload failed' }, bunnyResponse.status);
      }

      // The R2 copy of this chunk is written (or given up on) before we answer
      await copy.stored;

      // Get updated offset from Bunny
      const newOffset = bunnyResponse.headers.get('Upload-Offset') || uploadOffset;

      // No session write per chunk (SCALABILITY-AUDIT AV-24): the stored offset
      // was never read, and a KV write per chunk ran into KV's one write per
      // second per key (a 500 mid-upload) and left other locations reading a
      // stale copy. The session stays as POST wrote it.
      const offsetNow = parseInt(newOffset || '0', 10);

      // Upload complete: mark it (never fails the chunk Bunny already took)
      if (offsetNow >= session.fileSize && !(await this.markUploaded(session, uploadId))) return c.json({ error: 'Upload not found' }, 404);

      return new Response(null, {
        status: 204,
        headers: {
          'Upload-Offset': newOffset || uploadOffset || '0',
          'Tus-Resumable': TUS_VERSION,
          'Access-Control-Expose-Headers': 'Upload-Offset, Tus-Resumable',
        },
      });

    } catch (error) {
      logger.error('[TUS Proxy] PATCH error', {
        uploadId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
      });
      return this.retryLater('Upload failed, retry');
    }
  }

  /**
   * DELETE - Terminate upload
   */
  async handleDelete(c: any, uploadId: string): Promise<Response> {
    try {
      logger.debug('[TUS Proxy] DELETE - Terminate upload', { uploadId });

      const lookup = await this.resolveSession(uploadId);
      if (lookup.kind === 'unavailable') return this.retryLater('Session store unavailable, retry');
      if (lookup.kind === 'missing') return new Response(null, { status: 404 });
      const session = lookup.session;

      // Verify ownership
      if (session.userId !== this.authContext?.userId) {
        return new Response(null, { status: 403 });
      }

      const live = await this.liveUpload(session);
      if (live.kind === 'unavailable') return this.retryLater('Video store unavailable, retry');
      if (live.kind === 'gone') return new Response(null, { status: 404 });
      if (live.kind === 'closed') return new Response(null, { status: 410 });

      if (session.target === 'r2') {
        // Never the bytes of a finished upload: they are the video's only copy
        if (this.ownTargetFinished(live.record)) return c.json({ error: 'Upload already completed' }, 409);
        await deleteR2Upload(this.env, session.videoId, parseTusUploadId(uploadId)?.sessionId ?? uploadId);
      } else {
        // Forward DELETE to Bunny.net
        const bunnyHeaders = await this.createBunnyHeaders(session.videoId);
        await fetch(session.bunnyUploadUrl!, {
          method: 'DELETE',
          headers: {
            ...bunnyHeaders,
            'Tus-Resumable': TUS_VERSION,
          },
        });
      }

      // Delete session from KV
      const parsed = parseTusUploadId(uploadId);
      if (parsed) {
        sessionCache.delete(parsed.sessionId);
        await this.getSessionStore().delete(this.getSessionKey(parsed.sessionId));
      }

      // Track upload cancellation
      const queue = new Queue(this.env.queue);
      await queue.send(MessageType.VideoUploadCancelled, {
        videoId: session.videoId,
        userId: session.userId,
        uploadId,
        timestamp: new Date().toISOString(),
      });

      return new Response(null, {
        status: 204,
        headers: {
          'Tus-Resumable': TUS_VERSION,
        },
      });

    } catch (error) {
      rethrowBusy(error);
      logger.error('[TUS Proxy] DELETE error', { uploadId, error });
      return this.retryLater('Failed to terminate upload, retry');
    }
  }

  /**
   * Parse TUS Upload-Metadata header
   * Format: key1 base64value1,key2 base64value2
   */
  private parseUploadMetadata(metadataHeader: string): Record<string, string> | null {
    return parseTusMetadata(metadataHeader);
  }
}

/**
 * Create Hono router for TUS endpoints
 */
export function createTusRouter(): Hono {
  const router = new Hono();

  // OPTIONS - Handle preflight and capabilities
  router.options('/', async (c) => {
    const authContext = getAuthContext(c);
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handleOptions(c);
  });

  router.options('/:uploadId', async (c) => {
    const authContext = getAuthContext(c);
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handleOptions(c);
  });

  // POST - Create upload
  router.post('/', async (c) => {
    const authContext = getAuthContext(c);
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handlePost(c);
  });

  // HEAD - Get upload offset.
  // Hono dispatches HEAD requests to GET routes (and drops the body), so a
  // route registered with router.on('HEAD') is never matched; without this
  // every resume check returned 404 and tus restarted uploads from byte 0.
  router.get('/:uploadId', async (c) => {
    if (c.req.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'POST, HEAD, PATCH, DELETE, OPTIONS' } });
    }
    const authContext = getAuthContext(c);
    const uploadId = c.req.param('uploadId');
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handleHead(c, uploadId);
  });

  // PATCH - Upload chunk
  router.patch('/:uploadId', async (c) => {
    const authContext = getAuthContext(c);
    const uploadId = c.req.param('uploadId');
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handlePatch(c, uploadId);
  });

  // DELETE - Terminate upload
  router.delete('/:uploadId', async (c) => {
    const authContext = getAuthContext(c);
    const uploadId = c.req.param('uploadId');
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handleDelete(c, uploadId);
  });

  return router;
}