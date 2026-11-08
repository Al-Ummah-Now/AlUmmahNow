/**
 * Rate Limiting Middleware for Upload Endpoints
 *
 * SECURITY: This middleware prevents abuse by limiting the number of requests
 * per user within specific time windows. It uses Cloudflare KV for distributed
 * rate limiting across all Workers instances.
 *
 * Features:
 * - Per-user rate limits (by userId)
 * - Multiple time windows (minute, hour, day)
 * - Tier-based limits (free, pro, enterprise)
 * - Concurrent upload tracking
 * - Graceful degradation if KV unavailable
 */

import { Context } from 'hono';
import { logger } from '../lib/logger';

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

/** KV operation for upload sessions (a new key: counters from the old per-request limiter do not carry over) */
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
  });
}

/** The upload-session limiter mounted on UPLOAD_SESSION_PATHS in index.ts */
export function uploadSessionLimitMiddleware() {
  return rateLimitMiddleware(UPLOAD_SESSION_OPERATION, {
    limits: (env) => uploadSessionLimits(env as { UPLOAD_RATE_LIMIT?: string; ENVIRONMENT?: string }),
    weight: uploadSessionWeight,
    methods: ['POST'],
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

/**
 * Rate limit state stored in KV
 */
interface RateLimitState {
  minute: number;
  hour: number;
  day: number;
  concurrent: number;
  lastReset: {
    minute: number;
    hour: number;
    day: number;
  };
}

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

/**
 * Get KV key for rate limit state
 */
function getRateLimitKey(userId: string, operation: string): string {
  return `rate_limit:${operation}:${userId}`;
}

/**
 * Initialize empty rate limit state
 */
function initRateLimitState(): RateLimitState {
  const now = Math.floor(Date.now() / 1000);
  return {
    minute: 0,
    hour: 0,
    day: 0,
    concurrent: 0,
    lastReset: {
      minute: now,
      hour: now,
      day: now,
    },
  };
}

/**
 * Check and update rate limits
 *
 * @param kv - Cloudflare KV namespace
 * @param userId - User ID
 * @param operation - Operation being rate limited (e.g., 'video_upload', 'image_upload')
 * @returns Rate limit result
 */
export async function checkRateLimit(
  kv: KVNamespace,
  userId: string,
  operation: string,
  limits: RateLimitConfig = RATE_LIMITS[getUserTier(userId)],
  weight = 1
): Promise<RateLimitResult> {
  const key = getRateLimitKey(userId, operation);
  const now = Math.floor(Date.now() / 1000);

  try {
    // Get current state from KV
    const stateStr = await kv.get(key);
    let state: RateLimitState = stateStr
      ? JSON.parse(stateStr)
      : initRateLimitState();

    // Reset counters if time windows expired
    if (now - state.lastReset.minute >= TIME_WINDOWS.minute) {
      state.minute = 0;
      state.lastReset.minute = now;
    }

    if (now - state.lastReset.hour >= TIME_WINDOWS.hour) {
      state.hour = 0;
      state.lastReset.hour = now;
    }

    if (now - state.lastReset.day >= TIME_WINDOWS.day) {
      state.day = 0;
      state.lastReset.day = now;
    }

    // Check limits
    const result: RateLimitResult = {
      allowed: true,
      remaining: {
        minute: Math.max(0, limits.perMinute - state.minute),
        hour: Math.max(0, limits.perHour - state.hour),
        day: Math.max(0, limits.perDay - state.day),
      },
      resetAt: {
        minute: state.lastReset.minute + TIME_WINDOWS.minute,
        hour: state.lastReset.hour + TIME_WINDOWS.hour,
        day: state.lastReset.day + TIME_WINDOWS.day,
      },
    };

    // Check concurrent uploads
    if (state.concurrent >= limits.maxConcurrent) {
      result.allowed = false;
      result.limitExceeded = 'concurrent';
      result.retryAfter = 60; // Retry after 1 minute
      return result;
    }

    // Check minute limit
    if (state.minute + weight > limits.perMinute) {
      result.allowed = false;
      result.limitExceeded = 'minute';
      result.retryAfter = Math.max(1, result.resetAt.minute - now);
      return result;
    }

    // Check hour limit
    if (state.hour + weight > limits.perHour) {
      result.allowed = false;
      result.limitExceeded = 'hour';
      result.retryAfter = Math.max(1, result.resetAt.hour - now);
      return result;
    }

    // Check day limit
    if (state.day + weight > limits.perDay) {
      result.allowed = false;
      result.limitExceeded = 'day';
      result.retryAfter = Math.max(1, result.resetAt.day - now);
      return result;
    }

    // Increment counters
    state.minute += weight;
    state.hour += weight;
    state.day += weight;
    state.concurrent++;
    result.remaining = {
      minute: Math.max(0, limits.perMinute - state.minute),
      hour: Math.max(0, limits.perHour - state.hour),
      day: Math.max(0, limits.perDay - state.day),
    };

    // Save updated state to KV (with 1 day TTL)
    await kv.put(key, JSON.stringify(state), {
      expirationTtl: TIME_WINDOWS.day + 3600, // 1 day + 1 hour buffer
    });

    return result;
  } catch (error) {
    logger.error('[SECURITY] Rate limit check failed', { error, userId, operation });

    // Graceful degradation: allow request if KV is unavailable
    // This prevents KV outages from blocking all uploads
    return {
      allowed: true,
      remaining: {
        minute: limits.perMinute,
        hour: limits.perHour,
        day: limits.perDay,
      },
      resetAt: {
        minute: now + TIME_WINDOWS.minute,
        hour: now + TIME_WINDOWS.hour,
        day: now + TIME_WINDOWS.day,
      },
    };
  }
}

/**
 * Release concurrent upload slot
 *
 * Call this after upload completes (success or failure)
 */
export async function releaseRateLimit(
  kv: KVNamespace,
  userId: string,
  operation: string
): Promise<void> {
  const key = getRateLimitKey(userId, operation);

  try {
    const stateStr = await kv.get(key);
    if (!stateStr) return;

    const state: RateLimitState = JSON.parse(stateStr);
    state.concurrent = Math.max(0, state.concurrent - 1);

    await kv.put(key, JSON.stringify(state), {
      expirationTtl: TIME_WINDOWS.day + 3600,
    });
  } catch (error) {
    logger.error('[SECURITY] Failed to release rate limit', { error, userId, operation });
  }
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
}

export function rateLimitMiddleware(operation: string, options: RateLimitOptions = {}) {
  return async (c: Context, next: () => Promise<void>) => {
    if (options.methods && !options.methods.includes(c.req.method)) return next();

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

    // Get KV namespace
    const kv = c.env.RATE_LIMIT_KV as KVNamespace;

    if (!kv) {
      logger.warn('[SECURITY] RATE_LIMIT_KV not configured, skipping rate limit check');
      return next();
    }

    // Check rate limit
    const weight = options.weight ? await options.weight(c) : 1;
    const result = await checkRateLimit(kv, userId, operation, limits, weight);

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
      // Release concurrent slot after request completes
      await releaseRateLimit(kv, userId, operation);
    }
  };
}

/**
 * Get rate limit status for a user
 *
 * Useful for showing users their current limits in UI
 */
export async function getRateLimitStatus(
  kv: KVNamespace,
  userId: string,
  operation: string
): Promise<{
  tier: RateLimitTier;
  limits: RateLimitConfig;
  current: RateLimitState;
}> {
  const tier = getUserTier(userId);
  const limits = RATE_LIMITS[tier];
  const key = getRateLimitKey(userId, operation);

  const stateStr = await kv.get(key);
  const state: RateLimitState = stateStr
    ? JSON.parse(stateStr)
    : initRateLimitState();

  return {
    tier,
    limits,
    current: state,
  };
}
