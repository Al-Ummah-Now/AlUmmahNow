/**
 * Internal routes for admin-api (PROCESSOR service binding, X-API-Key = INTERNAL_API_KEY).
 * The processor owns NOTIFICATIONS_DB, so admin-web's staff device list, "Sign out this
 * device" and the review timings go through here.
 *
 *   GET    /internal/push-devices?userId=            a user's devices (token hints only)
 *   DELETE /internal/push-devices/:installId?userId= remove one device of that user
 *   GET    /internal/review-alerts/stats?days=14      daily held → decided timings (UTC days)
 *   POST   /internal/review-alerts/events             queue a ReviewAlertPayload (held, opened, claimed, decided)
 */
import { MessageType, isReviewAlertPayload, type ReviewAlertPayload } from '@al-ummah/shared-types';
import type { Logger } from '@al-ummah/logger';
import type { QueueEnvironment } from '../types';
import { reviewTimings } from './store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const USER_ID = /^[A-Za-z0-9_:.@-]{1,128}$/;
const INSTALL_ID = /^[A-Za-z0-9_-]{8,64}$/;

interface DeviceRow {
  install_id: string;
  app: string;
  platform: string;
  provider: string;
  token: string;
  locale: string | null;
  app_version: string | null;
  created_at: number;
  updated_at: number;
}

function tokenHint(provider: string, token: string): string {
  let raw = token;
  if (provider === 'webpush') {
    try {
      raw = String(JSON.parse(token).endpoint ?? '');
    } catch {
      raw = '';
    }
  }
  return `…${raw.slice(-6)}`;
}

/** Queues a review alert event (the producer side for callers without the queue binding). */
export async function queueReviewAlert(env: Pick<QueueEnvironment, 'REVIEW_ALERTS_QUEUE'>, payload: ReviewAlertPayload): Promise<boolean> {
  if (!env.REVIEW_ALERTS_QUEUE) return false;
  await env.REVIEW_ALERTS_QUEUE.send({
    id: `review-alert-${payload.reviewId}-${payload.event}-${payload.at}`,
    type: MessageType.ReviewAlert,
    timestamp: Date.now(),
    payload: payload as unknown as Record<string, unknown>,
  });
  return true;
}

export async function handleReviewAlertsInternal(request: Request, url: URL, env: QueueEnvironment, logger: Logger): Promise<Response> {
  if (url.pathname === '/internal/review-alerts/events' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    // escalate is scheduled by the consumer itself, never from outside
    if (!isReviewAlertPayload(body) || body.event === 'escalate') return json({ error: 'invalid_event' }, 400);
    if (!(await queueReviewAlert(env, body))) return json({ error: 'REVIEW_ALERTS_QUEUE not bound' }, 503);
    return json({ queued: true }, 202);
  }

  const db = env.NOTIFICATIONS_DB;
  if (!db) return json({ error: 'NOTIFICATIONS_DB not bound' }, 503);

  if (url.pathname === '/internal/review-alerts/stats' && request.method === 'GET') {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 14) || 14));
    const now = Date.now();
    const startOfToday = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
    return json({ days: await reviewTimings(db, startOfToday - (days - 1) * 86400000, now + 1) });
  }

  const userId = url.searchParams.get('userId') ?? '';
  if (!USER_ID.test(userId)) return json({ error: 'userId is required' }, 400);

  if (url.pathname === '/internal/push-devices' && request.method === 'GET') {
    const { results } = await db
      .prepare('SELECT install_id, app, platform, provider, token, locale, app_version, created_at, updated_at FROM push_devices WHERE user_id = ? ORDER BY updated_at DESC, install_id')
      .bind(userId)
      .all<DeviceRow>();
    return json({
      devices: (results ?? []).map((r) => ({
        installId: r.install_id,
        app: r.app,
        platform: r.platform,
        provider: r.provider,
        tokenHint: tokenHint(r.provider, r.token),
        locale: r.locale,
        appVersion: r.app_version,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  }

  const match = url.pathname.match(/^\/internal\/push-devices\/([^/]+)$/);
  if (match && request.method === 'DELETE') {
    const installId = decodeURIComponent(match[1] ?? '');
    if (!INSTALL_ID.test(installId)) return json({ error: 'invalid installId' }, 400);
    const res = await db.prepare('DELETE FROM push_devices WHERE install_id = ? AND user_id = ?').bind(installId, userId).run();
    const deleted = ((res.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
    logger.info('[ReviewAlerts] Device removed by staff', { userId, installId, deleted });
    return json({ deleted }, deleted ? 200 : 404);
  }

  return json({ error: 'Not found' }, 404);
}
