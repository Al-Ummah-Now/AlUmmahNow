/**
 * Who may upload, and how much: creator tiers (lib/creatorTiers.ts) on every
 * route that opens or continues an upload.
 *
 * - No tier, or a tier without the uploads flag (Member, the default): 403
 *   `uploads_by_invitation` on every upload-session path, TUS create and
 *   upload complete. Nothing is created or counted. Live stream create
 *   answers 404 `feature_off` instead: without uploads, live is hidden
 *   (wiki "Product rules → Hidden when off").
 * - Unlimited tier or the videos "Super Admin" role: no limits, nothing counted.
 * - Any other tier: its limits, counted against the tier holder (the channel
 *   owner for an upload to a channel) in D1 (middleware/rate-limit.ts).
 *
 * Sessions are counted once per video when an upload is initiated, never per
 * TUS chunk. What never counts:
 *   - an initiate that fails or is refused (the units are given back),
 *   - a retry that reuses an unfinished upload of the same file (the
 *     response says `reused: true`; the idempotent initiate, #613),
 *   - resuming an upload (GET /upload/resume, TUS HEAD/PATCH: not limited),
 *   - an upload later flagged failed or abandoned (refundUploadSession, called
 *     by the lifecycle when it flags the upload).
 *
 * A batch that does not fit starts as many videos as fit and answers which
 * ones were deferred and when they can start (`uploadAllowance`).
 *
 * A limit hit is logged as a warning and recorded for the admin's Creators
 * page (upload_limit_hits), with a friendly `upload_limit` answer and
 * `retryAfter`; the client says when uploading works again.
 *
 * A tier with `importCountsAgainstLimits: false` gives a Move from YouTube
 * initiate (wiki AUN-YT-IMPORT) its session back once the initiate confirmed
 * a valid import item (confirmYoutubeImportItem); until then it counts like
 * any upload. The tier gate always applies.
 *
 * An admin import's TUS create (wiki TOOLS-ADMIN TA-5) skips the gate: the session was opened by
 * /internal/admin/import/initiate after admin-api checked imports:manage (isAdminImportTusCreate).
 *
 * UPLOAD_RATE_LIMIT="off" (and development/preview by default) stops counting
 * the limits; the tier gate itself applies everywhere.
 */
import type { Context } from 'hono';
import { channelRoleOf, CREATOR_ERROR_CODES, tierAllowsUploads, type CreatorTier } from '@al-ummah/shared-types';
import { logger } from '../lib/logger';
import { featureOff } from '../lib/features/off';
import { recordLimitHit, resolveCreator, type ResolvedCreator } from '../lib/creatorTiers';
import { getTusSessionKey, parseTusMetadata, type TusProxySession } from '../lib/bunny/tus';
import { loadChannelRecord, memberMayActAs } from '../lib/channelAccess';
import {
  checkRateLimit,
  RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
  refundRateLimit,
  releaseRateLimit,
  windowStart,
  type RateLimitConfig,
  type RateLimitResult,
} from './rate-limit';

/** Operation name for upload sessions */
export const UPLOAD_SESSION_OPERATION = 'video_upload_session';
/** TUS create and complete: a looser bucket so one session cannot be replayed without bound */
export const UPLOAD_CONTINUE_OPERATION = 'video_upload_continue';

/**
 * Routes that create video content (POST only): the upload sessions, plus the
 * direct video create (POST /api/videos makes a Bunny video) and live stream
 * create. Each needs a creator tier and counts as one session.
 */
export const UPLOAD_SESSION_PATHS = [
  '/api/videos',
  '/api/videos/',
  '/api/videos/upload',
  '/api/videos/upload/initiate',
  '/api/videos/upload/batch/initiate',
  '/api/live-streams',
  '/api/live-streams/',
] as const;

/**
 * Calls that continue an initiated upload but are not idempotent: the TUS
 * create (starts the Bunny upload for the session) and complete. TUS
 * PATCH/HEAD stay unlimited (owner-checked, bounded by the upload's length).
 */
export const UPLOAD_CONTINUE_PATHS = ['/api/videos/tus', '/api/videos/upload/complete'] as const;

export const MAX_BATCH_SIZE = 15;

export const UPLOADS_BY_INVITATION_MESSAGE = 'Uploads are off for this account';

/** Whether this env counts the tier limits ("off", development and preview do not). */
export function uploadLimitsEnforced(env: { UPLOAD_RATE_LIMIT?: string; ENVIRONMENT?: string }): boolean {
  const flag = env.UPLOAD_RATE_LIMIT;
  if (flag === 'off') return false;
  if (flag) return true;
  const environment = env.ENVIRONMENT || 'development';
  return environment !== 'development' && environment !== 'preview';
}

/** A tier's limits for upload sessions (no separate per-minute burst: the hour bounds it). */
export function sessionLimitsOf(tier: CreatorTier): RateLimitConfig {
  return { perMinute: tier.perHour, perHour: tier.perHour, perDay: tier.perDay, maxConcurrent: tier.maxConcurrent };
}

/** TUS create and complete: roomy enough that normal retries never trip it. */
export function continueLimitsOf(tier: CreatorTier): RateLimitConfig {
  return { perMinute: tier.perHour * 2, perHour: tier.perHour * 3, perDay: tier.perDay * 3, maxConcurrent: tier.maxConcurrent * 2 };
}

/** Upload sessions a request asks for: one per video in a batch initiate (1..15), otherwise one. */
export async function uploadSessionWeight(c: Context): Promise<number> {
  if (!c.req.path.endsWith('/upload/batch/initiate')) return 1;
  try {
    const body = (await c.req.raw.clone().json()) as { videos?: unknown };
    return Array.isArray(body?.videos) ? Math.min(MAX_BATCH_SIZE, Math.max(1, body.videos.length)) : 1;
  } catch {
    return 1;
  }
}

/** Context key the initiate sets once a Move from YouTube item is confirmed valid and recorded. */
export const YOUTUBE_IMPORT_CONFIRMED = 'youtubeImportConfirmed';

/** Called by the initiate after it checked and recorded the import item (never before). */
export function confirmYoutubeImportItem(c: Context): void {
  c.set(YOUTUBE_IMPORT_CONFIRMED as never, true as never);
}

/** How many `reused: true` entries a JSON answer carries (single or batch initiate). */
export function countReused(value: unknown, depth = 0): number {
  if (!value || typeof value !== 'object' || depth > 4) return 0;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countReused(v, depth + 1), 0);
  const record = value as Record<string, unknown>;
  if (record.reused === true) return 1;
  return Object.values(record).reduce((n: number, v) => n + countReused(v, depth + 1), 0);
}

type RolesAuth = { payload?: { roles?: string[] } } | undefined;

/** The `tusSessionId` of a TUS create's Upload-Metadata; null when missing, malformed or the header repeats a key. */
export function tusSessionIdOf(header: string | undefined): string | null {
  const id = parseTusMetadata(header)?.tusSessionId;
  return id && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

/**
 * The channel owner a TUS create uploads for (#759). tus-js-client sends no
 * `channelId` header, so channelIdMiddleware sets no `channelOwnerId`: the
 * initiate session names the channel, and the caller must still hold a role
 * on it that may upload. Null: the caller's own upload (their own tier).
 */
async function tusCreateChannelOwner(c: Context, userId: string): Promise<string | null> {
  if (c.req.method !== 'POST' || c.req.path !== '/api/videos/tus') return null;
  const sessionId = tusSessionIdOf(c.req.header('Upload-Metadata'));
  const kv = c.env?.TUS_SESSIONS as KVNamespace | undefined;
  if (!sessionId || !kv) return null;
  const raw = await kv.get(getTusSessionKey(sessionId));
  if (!raw) return null;
  const session = JSON.parse(raw) as Partial<TusProxySession>;
  if (session.userId !== userId || !session.channelId || session.channelId === userId) return null;
  const channel = await loadChannelRecord(c.env, session.channelId);
  if (!channel?.userId || channel.userId === userId) return null;
  return memberMayActAs(channelRoleOf(channel, userId), 'POST', c.req.path) ? channel.userId : null;
}

/**
 * True for the TUS create of a session an admin import opened (wiki TOOLS-ADMIN TA-5): admin-api
 * checked imports:manage and audited the initiate (/internal/admin/import/initiate), so the tier gate
 * and its counters do not apply. Only the session's own user (the importing admin) gets this; sessions
 * are written by the server only.
 */
export async function isAdminImportTusCreate(c: Context, userId: string): Promise<boolean> {
  if (c.req.method !== 'POST' || c.req.path !== '/api/videos/tus') return false;
  const sessionId = tusSessionIdOf(c.req.header('Upload-Metadata'));
  const kv = c.env?.TUS_SESSIONS as KVNamespace | undefined;
  if (!sessionId || !kv) return false;
  const raw = await kv.get(getTusSessionKey(sessionId));
  if (!raw) return false;
  const session = JSON.parse(raw) as Partial<TusProxySession>;
  return session.adminImport === true && session.userId === userId;
}

/** The tier that applies to this request (the channel owner's for a channel upload). */
export async function creatorOf(c: Context): Promise<ResolvedCreator> {
  const userId = c.get('userId') as string;
  const roles = (c.get('auth') as RolesAuth)?.payload?.roles;
  const channelOwnerId = (c.get('channelOwnerId') as string | undefined) ?? (await tusCreateChannelOwner(c, userId));
  return resolveCreator(c.env.SEARCH_DB as D1Database, { userId, roles, channelOwnerId });
}

export function invitationOnly(c: Context) {
  return c.json({ success: false, code: CREATOR_ERROR_CODES.uploadsByInvitation, error: UPLOADS_BY_INVITATION_MESSAGE }, 403);
}

function unavailable(c: Context, retryAfter = RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS) {
  return c.json(
    { success: false, code: 'upload_limits_unavailable', error: 'Uploads are briefly unavailable; try again shortly', retryAfter },
    503,
    { 'Retry-After': String(retryAfter) },
  );
}

function limitHit(c: Context, result: RateLimitResult, limits: RateLimitConfig) {
  const period = result.limitExceeded ?? 'hour';
  const retryAfter = result.retryAfter || 60;
  const limit = period === 'concurrent' ? limits.maxConcurrent : period === 'day' ? limits.perDay : limits.perHour;
  return c.json(
    {
      success: false,
      code: CREATOR_ERROR_CODES.uploadLimit,
      error: "You've reached the upload limit; try again later",
      limitExceeded: period,
      limit,
      retryAfter,
      retryAt: new Date(Date.now() + retryAfter * 1000).toISOString(),
      remaining: result.remaining,
      resetAt: result.resetAt,
    },
    429,
    { 'Retry-After': String(retryAfter), 'X-RateLimit-Limit': String(limit) },
  );
}

function setRemainingHeaders(c: Context, result: RateLimitResult) {
  c.header('X-RateLimit-Remaining-Hour', String(result.remaining.hour));
  c.header('X-RateLimit-Remaining-Day', String(result.remaining.day));
}

interface GateOptions {
  operation: string;
  limitsOf: (tier: CreatorTier) => RateLimitConfig;
  /** Session routes weigh a batch per video, may start part of it, and give back what created nothing */
  sessions: boolean;
}

function creatorUploadMiddleware(options: GateOptions) {
  return async (c: Context, next: () => Promise<void>) => {
    if (c.req.method !== 'POST') return next();
    const userId = c.get('userId') as string | undefined;
    // No user: the route's own auth answers 401
    if (!userId) return next();
    const db = c.env.SEARCH_DB as D1Database | undefined;
    if (!db) {
      logger.error('[Uploads] SEARCH_DB is not configured; refusing the upload');
      return unavailable(c);
    }
    try {
      if (!options.sessions && (await isAdminImportTusCreate(c, userId))) return next();
    } catch (error) {
      // Unreadable session: fall through to the normal gate
      logger.warn('[Uploads] Admin import session check failed', { userId, error: error instanceof Error ? error.message : String(error) });
    }

    let creator: ResolvedCreator;
    try {
      creator = await creatorOf(c);
    } catch (error) {
      logger.error('[Uploads] Creator tier lookup failed; refusing the upload', { userId, error: error instanceof Error ? error.message : String(error) });
      return unavailable(c);
    }
    if (!creator.tier || !tierAllowsUploads(creator.tier)) {
      logger.info('[Uploads] Upload refused: the tier allows no uploads', { userId, subjectId: creator.subjectId, tierId: creator.tier?.id ?? null, path: c.req.path });
      // Live is hidden without uploads, so its create answers like any other feature that is off
      if (/^\/api\/live-streams\/?$/.test(c.req.path)) return featureOff(c, 'live');
      return invitationOnly(c);
    }
    c.set('creatorTier', creator);
    if (creator.tier.unlimited || !uploadLimitsEnforced(c.env ?? {})) return next();

    const limits = options.limitsOf(creator.tier);
    const subject = creator.subjectId;
    const requested = options.sessions ? await uploadSessionWeight(c) : 1;
    let counted = requested;
    let result = await checkRateLimit(db, subject, options.operation, limits, requested);

    // A batch that does not fit whole starts as many videos as fit
    if (!result.allowed && !result.unavailable && options.sessions && requested > 1 && result.limitExceeded !== 'concurrent') {
      const fit = Math.min(requested - 1, result.remaining.minute, result.remaining.hour, result.remaining.day);
      if (fit > 0) {
        const partial = await checkRateLimit(db, subject, options.operation, limits, fit);
        if (partial.allowed) {
          counted = fit;
          c.set('uploadAllowance', { allowed: fit, requested, retryAfter: result.retryAfter ?? 60 });
          result = partial;
        }
      }
    }

    if (result.unavailable) return unavailable(c, result.retryAfter);
    if (!result.allowed) {
      logger.warn('[Uploads] Upload limit reached', {
        userId,
        subjectId: subject,
        tierId: creator.tier.id,
        operation: options.operation,
        limitExceeded: result.limitExceeded,
        retryAfter: result.retryAfter,
        requested,
      });
      await recordLimitHit(db, subject, result.limitExceeded ?? 'hour', creator.tier.id);
      return limitHit(c, result, limits);
    }

    setRemainingHeaders(c, result);
    let refund = 0;
    try {
      await next();
      if (options.sessions) {
        const status = c.res?.status ?? 500;
        if (status >= 400) refund = counted;
        else if (creator.tier.importCountsAgainstLimits === false && c.get(YOUTUBE_IMPORT_CONFIRMED as never)) {
          // Move from YouTube on a tier where imports are free: counted like any upload, given
          // back only once the initiate confirmed a valid import item
          refund = counted;
        } else {
          const payload = await c.res.clone().json().catch(() => null);
          refund = Math.min(counted, countReused(payload));
        }
      }
    } catch (error) {
      if (options.sessions) refund = counted;
      throw error;
    } finally {
      if (result.leaseId) await releaseRateLimit(db, subject, options.operation, result.leaseId);
      if (refund > 0) await refundRateLimit(db, subject, options.operation, refund);
    }
  };
}

/** Mounted on UPLOAD_SESSION_PATHS in index.ts */
export function uploadSessionLimitMiddleware() {
  return creatorUploadMiddleware({ operation: UPLOAD_SESSION_OPERATION, limitsOf: sessionLimitsOf, sessions: true });
}

/** Mounted on UPLOAD_CONTINUE_PATHS (TUS create, complete) in index.ts */
export function uploadContinueLimitMiddleware() {
  return creatorUploadMiddleware({ operation: UPLOAD_CONTINUE_OPERATION, limitsOf: continueLimitsOf, sessions: false });
}

/**
 * Gives back the session of an upload that was flagged failed or abandoned,
 * when it was started in a window that is still open. `subjectId` is the
 * tier holder it was counted against (the channel owner, else the uploader).
 */
export async function refundUploadSession(
  db: D1Database | undefined,
  subjectId: string,
  startedAt: string | number | undefined,
  opts: { source?: 'client' | 'sweep'; nowMs?: number } = {},
): Promise<boolean> {
  if (!db || !subjectId) return false;
  const at = typeof startedAt === 'number' ? startedAt : startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(at)) return false;
  // A failure the client reports itself is refunded only up to a daily cap:
  // otherwise initiate → report failed → initiate would never reach a limit.
  // Failures the server finds (the sweep) are always refunded.
  if (opts.source === 'client' && !(await takeClientRefund(db, subjectId, opts.nowMs ?? Date.now()))) {
    logger.warn('[Uploads] Client-reported failure not refunded: daily refund cap reached', { subjectId });
    return false;
  }
  await refundRateLimit(db, subjectId, UPLOAD_SESSION_OPERATION, 1, at);
  return true;
}

/** Refunds for failures the client reports, per tier holder and day. */
export const CLIENT_REFUNDS_PER_DAY = 20;
const CLIENT_REFUND_OPERATION = 'video_upload_client_refund';

/** Takes one client refund from today's allowance, atomically (one upsert). False when none is left. */
async function takeClientRefund(db: D1Database, subjectId: string, nowMs: number): Promise<boolean> {
  const window = windowStart('day', Math.floor(nowMs / 1000));
  const row = await db
    .prepare(
      `INSERT INTO upload_rate_windows (user_id, operation, period, window_start, count) VALUES (?, ?, 'day', ?, 1)
       ON CONFLICT (user_id, operation, period) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
         window_start = excluded.window_start
       WHERE upload_rate_windows.window_start <> excluded.window_start OR upload_rate_windows.count < ?
       RETURNING count`,
    )
    .bind(subjectId, CLIENT_REFUND_OPERATION, window, CLIENT_REFUNDS_PER_DAY)
    .first<{ count: number }>();
  return row !== null;
}
