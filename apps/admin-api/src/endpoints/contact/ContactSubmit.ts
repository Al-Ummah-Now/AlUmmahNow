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
import { type ContactInput, CONTACT_LIMITS, hashIp, isLikelyBot, rateLimitsFor, safeEqual, validateContactInput } from '../../lib/contact';
import { insertContactMessage, recordDelivery } from '../../lib/contact-store';
import { enqueueContactMail, reportContactMailFailure } from '../../lib/contact-mail-queue';

async function resolveKey(binding: AdminBindings['INTERNAL_API_KEY']): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) || '';
  } catch {
    return '';
  }
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
    logger.debug('[Contact] Dropped a likely bot submission');
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

  logger.debug('[Contact] Message received', { id, signedIn: !!user });
  // Mail is sent by the queue consumer (lib/contact-mail-queue.ts), never on this request
  const jobs = (['notify', 'ack'] as const).map((kind) => ({ v: 1 as const, kind, messageId: id }));
  if (!(await enqueueContactMail(env, jobs))) {
    // Stored, but the mail could not be queued: flag it for an admin to retry
    for (const job of jobs) {
      await recordDelivery(env.REPORTS_DB, { messageId: id, kind: job.kind, status: 'failed', error: 'could not queue the email', now: new Date() });
      await reportContactMailFailure(env, job, 'could not queue the email', 0);
    }
  }
  return c.json({ success: true, result: { id } }, 201);
}
