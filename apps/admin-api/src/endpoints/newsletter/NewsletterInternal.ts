/**
 * /internal/newsletter/*: the www newsletter form and pages, called only by www's server
 * (X-API-Key: INTERNAL_API_KEY), which forwards the visitor's IP as X-Client-IP.
 *
 *   POST /subscribe    { email, locale, website?, turnstileToken? } → 202 { status: 'check_email' }
 *                      The same answer whether the address is new, pending or already subscribed
 *                      (no address lookup through the form). 403 human_check_required (+ siteKey)
 *                      when Turnstile is enforced and the token is missing or failed; 429 rate_limited.
 *   POST /confirm      { token } → { status: 'confirmed' | 'expired' | 'invalid' }
 *   POST /unsubscribe  { token } → { status: 'unsubscribed' | 'invalid' }
 */
import { Hono, type Context } from 'hono';
import type { AdminBindings } from '../../base/types';
import { checkHuman, recordAbuse } from '../../lib/bot-guard';
import { hashIp, safeEqual } from '../../lib/contact';
import { logger } from '../../lib/logger';
import { isNewsletterBot, newsletterRateLimit, parseSignup, TOKEN } from '../../lib/newsletter';
import { confirmSubscriber, requestSignup, setConfirmDelivery, unsubscribeByToken } from '../../lib/newsletter-store';
import { confirmJob, enqueueNewsletterMail, reportNewsletterFailure } from '../../lib/newsletter-mail';

type Env = { Bindings: AdminBindings };
type C = Context<Env>;

async function resolveKey(binding: AdminBindings['INTERNAL_API_KEY']): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) || '';
  } catch {
    return '';
  }
}

const app = new Hono<Env>();

app.use('*', async (c, next) => {
  const expected = await resolveKey(c.env.INTERNAL_API_KEY);
  if (!expected || !safeEqual(c.req.header('X-API-Key') ?? '', expected)) return c.json({ success: false, error: 'Unauthorized' }, 401);
  return next();
});

app.onError((error, c) => {
  logger.error('[Newsletter] Internal request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, error: 'internal_error' }, 500);
});

async function body(c: C): Promise<Record<string, unknown> | null> {
  try {
    const raw = await c.req.json();
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const CHECK_EMAIL = { success: true, result: { status: 'check_email' } } as const;

app.post('/subscribe', async (c) => {
  const env = c.env;
  const raw = await body(c);
  if (!raw) return c.json({ success: false, error: 'Invalid JSON' }, 400);
  // Bots get the same answer as people, and nothing is stored or sent
  if (isNewsletterBot(raw)) return c.json(CHECK_EMAIL, 202);
  const signup = parseSignup(raw);
  if (!signup) return c.json({ success: false, error: 'validation', errors: { email: 'invalid' } }, 400);

  const clientIp = c.req.header('X-Client-IP') || undefined;
  const token = typeof raw.turnstileToken === 'string' ? raw.turnstileToken : null;
  const human = await checkHuman(env as never, c.req.raw, token, 'www.newsletter', { ip: clientIp });
  if (!human.allowed) return c.json({ success: false, error: 'human_check_required', siteKey: env.TURNSTILE_SITE_KEY }, 403);

  const now = new Date();
  const ipHash = await hashIp(clientIp || 'unknown', await resolveKey(env.INTERNAL_API_KEY));
  const outcome = await requestSignup(env.REPORTS_DB, { ...signup, ipHash, now, perIpHour: newsletterRateLimit(env.ENVIRONMENT) });
  if (outcome.outcome === 'rate_limited') {
    recordAbuse(env as never, 'www.newsletter', 'rate_limited');
    return c.json({ success: false, error: 'rate_limited' }, 429, { 'Retry-After': '3600' });
  }
  if (outcome.outcome === 'send') {
    const job = confirmJob(outcome.subscriberId, outcome.token);
    if (!(await enqueueNewsletterMail(env, [job]))) {
      await setConfirmDelivery(env.REPORTS_DB, outcome.subscriberId, 'failed', 'could not queue the email');
      await reportNewsletterFailure(env, job, 'could not queue the email', 0);
    }
  }
  return c.json(CHECK_EMAIL, 202);
});

app.post('/confirm', async (c) => {
  const raw = await body(c);
  const token = typeof raw?.token === 'string' ? raw.token : '';
  if (!TOKEN.test(token)) return c.json({ success: true, result: { status: 'invalid' } });
  return c.json({ success: true, result: { status: await confirmSubscriber(c.env.REPORTS_DB, token, new Date()) } });
});

app.post('/unsubscribe', async (c) => {
  const raw = await body(c);
  const token = typeof raw?.token === 'string' ? raw.token : '';
  if (!TOKEN.test(token)) return c.json({ success: true, result: { status: 'invalid' } });
  return c.json({ success: true, result: { status: await unsubscribeByToken(c.env.REPORTS_DB, token, new Date()) } });
});

export default app;
