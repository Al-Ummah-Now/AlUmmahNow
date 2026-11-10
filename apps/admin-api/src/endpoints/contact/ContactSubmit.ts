/**
 * POST /internal/contact: a Contact us message from the videos site.
 *
 * Called only by the web app's /api/contact route (X-API-Key: INTERNAL_API_KEY),
 * which forwards the visitor's IP (X-Client-IP, for the rate limit), user agent
 * and, when signed in, the account's access token. With a token the account's
 * email replaces the form's.
 */
import type { Context } from 'hono';
import type { AdminBindings } from '../../base/types';
import { logger } from '../../lib/logger';
import { verifyAccessToken } from '../../middleware/auth';
import { type ContactInput, CONTACT_LIMITS, hashIp, isLikelyBot, isSinkAddress, rateLimitsFor, safeEqual, validateContactInput } from '../../lib/contact';
import { getContactMessage, insertContactMessage, setDeliveryStatus, type ContactMessageRow } from '../../lib/contact-store';
import { renderAcknowledgement, renderInboxNotification, sendContactEmail } from '../../lib/contact-email';

async function resolveKey(binding: AdminBindings['INTERNAL_API_KEY']): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) || '';
  } catch {
    return '';
  }
}

/** Support-inbox notification, then the sender's acknowledgement; statuses are recorded on the message. */
export async function deliverContactEmails(env: AdminBindings, m: ContactMessageRow): Promise<void> {
  const inbox = env.CONTACT_INBOX?.trim();
  let notify: string;
  if (!inbox) notify = 'skipped';
  // A test message (E2E address outside production) never reaches the real inbox
  else if (isSinkAddress(m.email, env.ENVIRONMENT)) notify = 'sunk';
  else {
    const result = await sendContactEmail(env, renderInboxNotification(m, { to: inbox, adminUrl: env.ADMIN_WEB_URL, environment: env.ENVIRONMENT }), {
      idempotencyKey: `contact-notify-${m.id}`,
    });
    notify = result.status;
    if (result.error) logger.error('[Contact] Inbox notification not sent', { id: m.id, status: result.status, error: result.error });
  }
  if (!inbox) logger.warn('[Contact] CONTACT_INBOX is not set: no support-inbox notification', { id: m.id });

  const ack = await sendContactEmail(env, renderAcknowledgement(m, { replyTo: inbox || undefined, environment: env.ENVIRONMENT }), {
    idempotencyKey: `contact-ack-${m.id}`,
  });
  if (ack.error) logger.error('[Contact] Acknowledgement not sent', { id: m.id, status: ack.status, error: ack.error });

  await setDeliveryStatus(env.REPORTS_DB, m.id, 'notify_status', notify);
  await setDeliveryStatus(env.REPORTS_DB, m.id, 'ack_status', ack.status);
}

export async function contactSubmit(c: Context<{ Bindings: AdminBindings }>): Promise<Response> {
  const env = c.env;
  const expected = await resolveKey(env.INTERNAL_API_KEY);
  if (!expected || !safeEqual(c.req.header('X-API-Key') ?? '', expected)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }

  // Bots get the same answer as people, and nothing is stored or sent
  if (isLikelyBot(raw)) {
    logger.info('[Contact] Dropped a likely bot submission');
    return c.json({ success: true, result: { id: null } }, 201);
  }

  let user: { id: string; email: string } | null = null;
  const authorization = c.req.header('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    const payload = await verifyAccessToken(authorization.slice(7), env);
    if (!payload?.sub) return c.json({ success: false, error: 'Invalid or expired authentication token' }, 401);
    user = { id: payload.sub, email: payload.email || '' };
  }

  const validation = validateContactInput(raw, user?.email || null);
  if ('errors' in validation) return c.json({ success: false, error: 'validation', errors: validation.errors }, 400);

  const id = crypto.randomUUID();
  const userAgent = (c.req.header('X-Client-User-Agent') || '').slice(0, CONTACT_LIMITS.userAgentMax) || null;
  const ipHash = await hashIp(c.req.header('X-Client-IP') || 'unknown', expected);
  const stored = await insertContactMessage(
    env.REPORTS_DB,
    { ...(validation as { value: ContactInput }).value, id, userId: user?.id ?? null, userAgent, ipHash, now: new Date() },
    rateLimitsFor(env.ENVIRONMENT),
  );
  if (!stored) {
    logger.warn('[Contact] Rate limited', { userId: user?.id });
    return c.json({ success: false, error: 'rate_limited' }, 429, { 'Retry-After': '3600' });
  }

  logger.info('[Contact] Message received', { id, signedIn: !!user });
  const row = await getContactMessage(env.REPORTS_DB, id);
  if (row) {
    const work = deliverContactEmails(env, row).catch((error) => logger.error('[Contact] Email delivery failed', { id, error: String(error) }));
    try {
      c.executionCtx.waitUntil(work);
    } catch {
      await work;
    }
  }
  return c.json({ success: true, result: { id } }, 201);
}
