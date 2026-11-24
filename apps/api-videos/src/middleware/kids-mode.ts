/**
 * Server-side Kids Mode enforcement middleware (wiki E20 §4.2–§4.3, B2 & B3).
 *
 * When a valid Kids Mode session token (`X-Kids-Session` header or `aun_kids_session`
 * cookie) is present:
 * - Sets `c.set('kidsMode', ...)` so downstream handlers (`loggingMiddleware`, `VideoView`)
 *   suppress `userId`, `viewerId`, `discovery_viewers`, and user-attributed analytics.
 * - Rejects `block_403` routes (and any unclassified `/api/*` route, failing closed)
 *   with `403 kids_mode_restricted`.
 * - Short-circuits personal history/watch-state/analytics/QoE writes cleanly with zero
 *   D1, R2, or Queue writes.
 * - Restricts video/playlist reads (`allowlisted_only`) to moderator-approved
 *   catalog items matching the active age band constraint,
 *   and sanitizes video/playback JSON responses (`commentSettings: 'off'`,
 *   `autoplayNext: false`, omitting `playerLinks`, `endScreen`, and `cards`).
 */
import type { Context, Next } from 'hono';
import { apiError } from '../lib/api-error';
import {
  extractKidsSessionToken,
  isTargetAllowlistedInKidsCatalog,
  verifyKidsSessionToken,
} from '../lib/kids/parental-controls';
import { matchKidsRoutePolicy } from '../lib/kids/route-policy';

function sanitizeKidsResponseObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj };
  out.commentSettings = 'off';
  out.autoplayNext = false;
  delete out.playerLinks;
  delete out.endScreen;
  delete out.cards;
  return out;
}

function shouldSanitizeVideoResponse(path: string): boolean {
  return path.startsWith('/api/videos/') || path.startsWith('/api/v1/videos/');
}

export async function kidsModeMiddleware(c: Context, next: Next) {
  const rawToken = extractKidsSessionToken(c.req.raw);
  if (!rawToken) return next();

  c.set('kidsRequest', true);
  const normalizedPath = c.req.path.startsWith('/api/v1/')
    ? `/api/${c.req.path.slice('/api/v1/'.length)}`
    : c.req.path;
  const matched = matchKidsRoutePolicy(c.req.method, normalizedPath);
  if (matched) c.set('kidsRouteTemplate', matched.entry.path);

  // Parent PIN / SSO exit always reaches its handler so an expired/locked session can be cleared.
  if (c.req.method === 'POST' && normalizedPath === '/api/me/kids-mode/exit') {
    return next();
  }

  const claims = await verifyKidsSessionToken(c.env as never, rawToken);
  if (!claims) {
    // Fail closed if an expired/tampered `ak1.` session token is still attached to the device.
    return apiError(c, 403, 'kids_mode_restricted');
  }

  const authedUserId = (c.get('auth') as { userId?: string } | undefined)?.userId;
  if (authedUserId && authedUserId !== claims.uid) {
    return apiError(c, 403, 'kids_mode_restricted');
  }

  c.set('kidsMode', {
    active: true,
    userId: claims.uid,
    deviceId: claims.did,
    ageBand: claims.band,
    enteredAt: claims.iat,
  });

  // Never propagate parent channel context into Kids Mode requests
  c.set('channelId', undefined as never);
  c.set('channelRole', undefined as never);
  c.set('channelOwnerId', undefined as never);

  if (!matched) {
    return apiError(c, 403, 'kids_mode_restricted');
  }

  const { entry, params } = matched;
  if (entry.mode === 'admin_internal' || entry.mode === 'allow_public') {
    return next();
  }
  if (entry.mode === 'block_403') {
    return apiError(c, 403, 'kids_mode_restricted');
  }

  if (entry.targetType && entry.targetParam) {
    const targetId = params[entry.targetParam];
    const db = (c.env as { SEARCH_DB?: D1Database }).SEARCH_DB;
    if (!targetId || !db) {
      return apiError(c, 403, 'kids_mode_restricted');
    }
    const allowed = await isTargetAllowlistedInKidsCatalog(db, entry.targetType, targetId, {
      ageBand: claims.band,
    });
    if (!allowed) {
      return apiError(c, 403, 'kids_mode_restricted');
    }
  }

  if (entry.mode === 'suppress_attribution') {
    // View counter lets VideoView run (with ranking + viewerId + analytics queue suppressed).
    if (normalizedPath.endsWith('/view')) {
      return next();
    }
    if (normalizedPath === '/api/analytics/events') {
      return c.json({ success: true, accepted: 0, suppressed: true }, 202);
    }
    return c.json({ success: true, suppressed: true }, 200);
  }

  // `allowlisted_only`: run handler, then strip player links & disable comments/autoplay on video reads.
  await next();

  if (shouldSanitizeVideoResponse(normalizedPath) && c.res.status === 200) {
    const contentType = c.res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const body = (await c.res.clone().json()) as Record<string, unknown>;
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          const sanitized = sanitizeKidsResponseObject(body);
          if (sanitized.result && typeof sanitized.result === 'object' && !Array.isArray(sanitized.result)) {
            sanitized.result = sanitizeKidsResponseObject(sanitized.result as Record<string, unknown>);
          }
          const headers = new Headers(c.res.headers);
          headers.delete('content-length');
          c.res = new Response(JSON.stringify(sanitized), {
            status: c.res.status,
            statusText: c.res.statusText,
            headers,
          });
        }
      } catch {
        // Leave non-JSON or empty bodies untouched
      }
    }
  }
}
