/**
 * Rate Limiting Middleware for Upload Endpoints
 *
 * SECURITY: This middleware prevents abuse by limiting the number of requests
 * per user within specific time windows. Counters live in D1 (SEARCH_DB) and
 * each request is checked and counted in one transaction, so the limits hold
 * across all Workers instances and against parallel requests
 * (docs/architecture/SCALABILITY-AUDIT.md, AV-14).
 *
 * Features:
 * - Per-user rate limits (by userId)
 * - Multiple time windows (minute, hour, day)
 * - Tier-based limits (free, pro, enterprise)
 * - Concurrent request leases that expire if never released
 * - Fails closed (503) when D1 cannot answer, so an outage is never a bypass
 */

import { Context } from 'hono';
import { logger } from '../lib/logger';
import { canClaimOfficialHandles } from '../lib/channelHandles';

/**
 * Super admins (the videos-side "Super Admin" role, the same check that
 * guards the official handles) are never upload limited: no session, hourly,
 * daily or concurrency limit. Owner decision 2026-11-10 after the prod
 * "Rate limit exceeded: hour" on their own bulk upload.
 */
export function isUploadUnlimited(c: Context): boolean {
  const auth = c.get('auth') as { payload?: { roles?: string[] } } | undefined;
  return canClaimOfficialHandles(auth?.payload?.roles);
}

/**
 * Rate limit tiers with different quotas
 */
export enum RateLimitTier {
  FREE = 'free',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

/**
 * Rate limit configuration per tier
 */
interface RateLimitConfig {
  perMinute: number;
  perHour: number;
  perDay: number;
  maxConcurrent: number;
}

/**
 * Rate limit configurations by tier
 */
const RATE_LIMITS: Record<RateLimitTier, RateLimitConfig> = {
  [RateLimitTier.FREE]: {
    perMinute: 2,
    perHour: 10,
    perDay: 50,
    maxConcurrent: 2,
  },
  [RateLimitTier.PRO]: {
    perMinute: 5,
    perHour: 50,
    perDay: 500,
    maxConcurrent: 5,
  },
  [RateLimitTier.ENTERPRISE]: {
    perMinute: 20,
    perHour: 200,
    perDay: 5000,
    maxConcurrent: 20,
  },
};

/**
 * Video upload SESSIONS (#290). Counted once per video when an upload is
 * initiated (initiate, batch initiate (one per video), direct and stream
 * upload), never per TUS chunk: the TUS POST/HEAD/PATCH/DELETE of an initiated
 * upload is authorised by its session (same user, checked in the TUS proxy).
 * A batch may hold 15 videos, so a fresh hour must fit one full batch.
 */
export type UploadLimitProfile = 'standard' | 'relaxed';

export const UPLOAD_SESSION_LIMITS: Record<UploadLimitProfile, RateLimitConfig> = {
  // Production
  standard: { perMinute: 15, perHour: 20, perDay: 50, maxConcurrent: 5 },
  // QA and stage: enforced (so the limiter path runs there) but roomy enough for E2E and seeding
  relaxed: { perMinute: 60, perHour: 300, perDay: 2000, maxConcurrent: 20 },
};

/** Operation name for upload sessions (counters from the old per-request limiter do not carry over) */
export const UPLOAD_SESSION_OPERATION = 'video_upload_session';

/**
 * Limits for upload sessions in this env, or null when not enforced.
 * UPLOAD_RATE_LIMIT ("standard" | "relaxed" | "off") wins; without it,
 * development and preview are not enforced and everything else is standard.
 */
export function uploadSessionLimits(env: { UPLOAD_RATE_LIMIT?: string; ENVIRONMENT?: string }): RateLimitConfig | null {
  const profile = env.UPLOAD_RATE_LIMIT;
  if (profile === 'off') return null;
  if (profile === 'standard' || profile === 'relaxed') return UPLOAD_SESSION_LIMITS[profile];
  const environment = env.ENVIRONMENT || 'development';
  return environment === 'development' || environment === 'preview' ? null : UPLOAD_SESSION_LIMITS.standard;
}

/** Upload sessions a request opens: one per video in a batch initiate (1..15), otherwise one. */
export async function uploadSessionWeight(c: Context): Promise<number> {
  if (!c.req.path.endsWith('/upload/batch/initiate')) return 1;
  try {
    const body = (await c.req.raw.clone().json()) as { videos?: unknown };
    return Array.isArray(body?.videos) ? Math.min(15, Math.max(1, body.videos.length)) : 1;
  } catch {
    return 1;
  }
}

/** Routes that open new upload sessions (POST only); everything else in an upload continues one */
export const UPLOAD_SESSION_PATHS = [
  '/api/videos/upload',
  '/api/videos/upload/initiate',
  '/api/videos/upload/batch/initiate',
] as const;

/**
 * Calls that continue an initiated upload but are not idempotent: the TUS
 * create (POST /api/videos/tus, which starts the Bunny upload for the session)
 * and complete. A separate, looser bucket than sessions so normal retries never
 * trip it, but one session cannot be replayed without bound. TUS PATCH/HEAD
 * stay unlimited (owner-checked, bounded by the upload's length).
 */
export const UPLOAD_CONTINUE_PATHS = ['/api/videos/tus', '/api/videos/upload/complete'] as const;
export const UPLOAD_CONTINUE_OPERATION = 'video_upload_continue';
export const UPLOAD_CONTINUE_LIMITS: Record<UploadLimitProfile, RateLimitConfig> = {
  standard: { perMinute: 30, perHour: 100, perDay: 300, maxConcurrent: 10 },
  relaxed: { perMinute: 120, perHour: 1000, perDay: 5000, maxConcurrent: 40 },
};

export function uploadContinueLimitMiddleware() {
  return rateLimitMiddleware(UPLOAD_CONTINUE_OPERATION, {
    limits: (env) => {
      const session = uploadSessionLimits(env as { UPLOAD_RATE_LIMIT?: string; ENVIRONMENT?: string });
      if (!session) return null;
      return session === UPLOAD_SESSION_LIMITS.relaxed ? UPLOAD_CONTINUE_LIMITS.relaxed : UPLOAD_CONTINUE_LIMITS.standard;
    },
    methods: ['POST'],
    exempt: isUploadUnlimited,
  });
}

/** The upload-session limiter mounted on UPLOAD_SESSION_PATHS in index.ts */
export function uploadSessionLimitMiddleware() {
  return rateLimitMiddleware(UPLOAD_SESSION_OPERATION, {
    limits: (env) => uploadSessionLimits(env as { UPLOAD_RATE_LIMIT?: string; ENVIRONMENT?: string }),
    weight: uploadSessionWeight,
    methods: ['POST'],
    exempt: isUploadUnlimited,
  });
}


/**
 * Time window durations in seconds
 */
const TIME_WINDOWS = {
  minute: 60,
  hour: 3600,
  day: 86400,
} as const;

type Period = keyof typeof TIME_WINDOWS;
const PERIODS: Period[] = ['minute', 'hour', 'day'];

/**
 * How long a request's concurrency lease lives if the request never releases
 * it (isolate killed mid-request). Far longer than any upload API call, far
 * shorter than the 25 h lockout the old KV counter could leak into.
 */
export const RATE_LIMIT_LEASE_SECONDS = 300;

/** Retry-After of a request refused because D1 could not answer */
export const RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 30;

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: {
    minute: number;
    hour: number;
    day: number;
  };
  resetAt: {
    minute: number;
    hour: number;
    day: number;
  };
  retryAfter?: number; // Seconds until next allowed request
  limitExceeded?: 'minute' | 'hour' | 'day' | 'concurrent';
  /** Concurrency lease of an allowed request; pass it to releaseRateLimit when the request ends */
  leaseId?: string;
  /** D1 could not answer: the request is refused (503), not counted */
  unavailable?: boolean;
}

/**
 * Get user's rate limit tier
 *
 * TODO: Implement tier detection from user profile/subscription
 * For now, defaults to FREE tier for all users
 */
function getUserTier(userId: string): RateLimitTier {
  // TODO: Query user's subscription tier from database
  // For MVP, all users are on FREE tier
  return RateLimitTier.FREE;
}

/** Start (epoch seconds) of the fixed window of `period` that holds `now`. */
function windowStart(period: Period, now: number): number {
  return now - (now % TIME_WINDOWS[period]);
}

const COUNT_IN_WINDOW =
  'COALESCE((SELECT count FROM upload_rate_windows WHERE user_id = ? AND operation = ? AND period = ? AND window_start >= ?), 0)';

/**
 * Checks the limits and, when they allow it, counts the request — in one D1
 * transaction (SCALABILITY-AUDIT AV-14). D1 runs a batch atomically and one at
 * a time, so N parallel requests can never all read the same old count: the
 * lease insert below is conditional on every limit still having room, and the
 * window counters only move when that lease was inserted. A refused request
 * changes nothing.
 *
 * Windows are fixed (aligned to the minute, hour and day); `concurrent` is the
 * number of unexpired leases.
 *
 * Fails closed: when D1 itself errors the request is refused as unavailable
 * (the middleware answers 503 with Retry-After), so overloading the database
 * can never switch the limits off. Contention does not error: requests queue.
 *
 * @param db - SEARCH_DB (migrations/search/0004_upload_rate_limits.sql)
 * @param userId - User ID
 * @param operation - Operation being rate limited (e.g., 'video_upload_session', 'image_upload')
 */
export async function checkRateLimit(
  db: D1Database,
  userId: string,
  operation: string,
  limits: RateLimitConfig = RATE_LIMITS[getUserTier(userId)],
  weight = 1,
  nowMs = Date.now()
): Promise<RateLimitResult> {
  const now = Math.floor(nowMs / 1000);
  const starts: Record<Period, number> = {
    minute: windowStart('minute', now),
    hour: windowStart('hour', now),
    day: windowStart('day', now),
  };
  const resetAt = {
    minute: starts.minute + TIME_WINDOWS.minute,
    hour: starts.hour + TIME_WINDOWS.hour,
    day: starts.day + TIME_WINDOWS.day,
  };
  const perPeriod: Record<Period, number> = { minute: limits.perMinute, hour: limits.perHour, day: limits.perDay };
  const leaseId = crypto.randomUUID();
  const countArgs = (period: Period) => [userId, operation, period, starts[period]];

  try {
    const results = await db.batch([
      // Leases whose request never released them
      db.prepare('DELETE FROM upload_rate_leases WHERE user_id = ? AND operation = ? AND expires_at <= ?').bind(userId, operation, now),
      // The request's lease, only if every limit still has room for it
      db
        .prepare(
          `INSERT INTO upload_rate_leases (user_id, operation, lease_id, expires_at)
           SELECT ?, ?, ?, ?
           WHERE (SELECT COUNT(*) FROM upload_rate_leases WHERE user_id = ? AND operation = ?) < ?
             AND ${COUNT_IN_WINDOW} + ? <= ?
             AND ${COUNT_IN_WINDOW} + ? <= ?
             AND ${COUNT_IN_WINDOW} + ? <= ?`
        )
        .bind(
          userId, operation, leaseId, now + RATE_LIMIT_LEASE_SECONDS,
          userId, operation, limits.maxConcurrent,
          ...countArgs('minute'), weight, perPeriod.minute,
          ...countArgs('hour'), weight, perPeriod.hour,
          ...countArgs('day'), weight, perPeriod.day
        ),
      // Count the request in each window, only if it got the lease; a later window starts over
      ...PERIODS.map((period) =>
        db
          .prepare(
            `INSERT INTO upload_rate_windows (user_id, operation, period, window_start, count)
             SELECT ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM upload_rate_leases WHERE user_id = ? AND operation = ? AND lease_id = ?)
             ON CONFLICT (user_id, operation, period) DO UPDATE SET
               count = CASE WHEN excluded.window_start > upload_rate_windows.window_start
                 THEN excluded.count ELSE upload_rate_windows.count + excluded.count END,
               window_start = MAX(upload_rate_windows.window_start, excluded.window_start)`
          )
          .bind(userId, operation, period, starts[period], weight, userId, operation, leaseId)
      ),
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM upload_rate_leases WHERE user_id = ? AND operation = ? AND lease_id = ?) AS granted,
             (SELECT COUNT(*) FROM upload_rate_leases WHERE user_id = ? AND operation = ?) AS leases,
             ${COUNT_IN_WINDOW} AS minute,
             ${COUNT_IN_WINDOW} AS hour,
             ${COUNT_IN_WINDOW} AS day`
        )
        .bind(userId, operation, leaseId, userId, operation, ...countArgs('minute'), ...countArgs('hour'), ...countArgs('day')),
    ]);
    const state = (results[results.length - 1].results as Array<Record<Period | 'granted' | 'leases', number>>)[0];
    const used = { minute: Number(state.minute), hour: Number(state.hour), day: Number(state.day) };
    const result: RateLimitResult = {
      allowed: Number(state.granted) > 0,
      remaining: {
        minute: Math.max(0, perPeriod.minute - used.minute),
        hour: Math.max(0, perPeriod.hour - used.hour),
        day: Math.max(0, perPeriod.day - used.day),
      },
      resetAt,
    };
    if (result.allowed) {
      result.leaseId = leaseId;
      return result;
    }
    // Refused: report the first limit that has no room (same order as the check)
    if (Number(state.leases) >= limits.maxConcurrent) {
      result.limitExceeded = 'concurrent';
      result.retryAfter = 60;
    } else {
      const period = PERIODS.find((p) => used[p] + weight > perPeriod[p]) ?? 'day';
      result.limitExceeded = period;
      result.retryAfter = Math.max(1, resetAt[period] - now);
    }
    return result;
  } catch (error) {
    logger.error('[SECURITY] Rate limit check failed; refusing the request', { error, userId, operation });
    return {
      allowed: false,
      unavailable: true,
      retryAfter: RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
      remaining: { minute: 0, hour: 0, day: 0 },
      resetAt,
    };
  }
}

/**
 * Release a request's concurrency lease
 *
 * Call this after the request completes (success or failure). A lease that is
 * never released expires after RATE_LIMIT_LEASE_SECONDS.
 */
export async function releaseRateLimit(db: D1Database, userId: string, operation: string, leaseId: string): Promise<void> {
  try {
    await db
      .prepare('DELETE FROM upload_rate_leases WHERE user_id = ? AND operation = ? AND lease_id = ?')
      .bind(userId, operation, leaseId)
      .run();
  } catch (error) {
    logger.error('[SECURITY] Failed to release rate limit', { error, userId, operation });
  }
}

/**
 * Deletes windows that ended more than a day ago and expired leases
 * (daily cron). Rows are rewritten in place while a user is active, so this
 * only drops users who stopped uploading.
 */
export async function pruneRateLimits(db: D1Database, nowMs = Date.now()): Promise<void> {
  const now = Math.floor(nowMs / 1000);
  await db.batch([
    db.prepare('DELETE FROM upload_rate_windows WHERE window_start < ?').bind(now - 2 * TIME_WINDOWS.day),
    db.prepare('DELETE FROM upload_rate_leases WHERE expires_at <= ?').bind(now),
  ]);
}

/**
 * Rate limiting middleware factory
 *
 * @param operation - Operation being rate limited (e.g., 'video_upload')
 * @returns Hono middleware
 *
 * @example
 * ```typescript
 * import { rateLimitMiddleware } from './middleware/rate-limit';
 *
 * app.post('/api/videos/upload',
 *   authMiddleware,
 *   rateLimitMiddleware('video_upload'),
 *   async (c) => {
 *     // Upload logic
 *   }
 * );
 * ```
 */
export interface RateLimitOptions {
  /** Limits for this env; null skips the check. Default: tier limits, skipped in development/preview. */
  limits?: (env: Record<string, unknown>, userId: string) => RateLimitConfig | null;
  /** How many units this request uses (default 1) */
  weight?: (c: Context) => Promise<number>;
  /** Only these methods are counted (default: all) */
  methods?: string[];
  /** Requests this returns true for are not limited or counted */
  exempt?: (c: Context) => boolean;
}

export function rateLimitMiddleware(operation: string, options: RateLimitOptions = {}) {
  return async (c: Context, next: () => Promise<void>) => {
    if (options.methods && !options.methods.includes(c.req.method)) return next();
    if (options.exempt?.(c)) return next();

    const resolveLimits =
      options.limits ??
      ((env: Record<string, unknown>, userId: string) => {
        const environment = (env.ENVIRONMENT as string) || 'development';
        return environment === 'development' || environment === 'preview' ? null : RATE_LIMITS[getUserTier(userId)];
      });

    // Get user ID from auth context
    const userId = c.get('userId');

    if (!userId) {
      // If no user ID, skip rate limiting (auth middleware should handle this)
      return next();
    }

    const limits = resolveLimits(c.env ?? {}, userId);
    if (!limits) {
      logger.info('[SECURITY] Rate limit not enforced in this environment', { operation });
      return next();
    }

    const db = c.env.SEARCH_DB as D1Database | undefined;

    if (!db) {
      logger.warn('[SECURITY] SEARCH_DB not configured, skipping rate limit check');
      return next();
    }

    // Check rate limit
    const weight = options.weight ? await options.weight(c) : 1;
    const result = await checkRateLimit(db, userId, operation, limits, weight);

    if (result.unavailable) {
      return c.json(
        { success: false, error: 'Upload limits are temporarily unavailable; try again shortly', retryAfter: result.retryAfter },
        503,
        { 'Retry-After': String(result.retryAfter) }
      );
    }

    if (!result.allowed) {
      logger.warn('[SECURITY] Rate limit exceeded', {
        userId,
        operation,
        limitExceeded: result.limitExceeded,
        retryAfter: result.retryAfter,
      });

      return c.json(
        {
          success: false,
          error: `Rate limit exceeded: ${result.limitExceeded}`,
          retryAfter: result.retryAfter,
          remaining: result.remaining,
          resetAt: result.resetAt,
        },
        429,
        {
          'Retry-After': String(result.retryAfter || 60),
          'X-RateLimit-Limit': String(
            result.limitExceeded === 'minute' ? limits.perMinute :
            result.limitExceeded === 'hour' ? limits.perHour :
            result.limitExceeded === 'concurrent' ? limits.maxConcurrent :
            limits.perDay
          ),
          'X-RateLimit-Remaining': String(
            result.limitExceeded === 'minute' ? result.remaining.minute :
            result.limitExceeded === 'hour' ? result.remaining.hour :
            result.remaining.day
          ),
          'X-RateLimit-Reset': String(
            result.limitExceeded === 'minute' ? result.resetAt.minute :
            result.limitExceeded === 'hour' ? result.resetAt.hour :
            result.resetAt.day
          ),
        }
      );
    }

    // Add rate limit info to response headers
    c.header('X-RateLimit-Remaining-Minute', String(result.remaining.minute));
    c.header('X-RateLimit-Remaining-Hour', String(result.remaining.hour));
    c.header('X-RateLimit-Remaining-Day', String(result.remaining.day));

    try {
      await next();
    } finally {
      // Release the concurrency lease after the request completes
      if (result.leaseId) await releaseRateLimit(db, userId, operation, result.leaseId);
    }
  };
}
