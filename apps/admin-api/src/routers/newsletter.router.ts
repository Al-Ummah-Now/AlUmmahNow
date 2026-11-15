/**
 * /api/newsletter/* — the videos admin's Newsletter page (AlUmmahNowUI#6). Behind authMiddleware +
 * adminMiddleware (src/index.ts); every route needs `newsletter:manage` (admins and super admins).
 * Every change is recorded in admin_audit_log (REPORTS_DB).
 *
 *   GET    /subscribers?status=&q=&limit=&offset=   newest first; counts per status
 *   DELETE /subscribers/:id                         erase a subscriber (privacy request)
 *   GET    /issues?limit=&offset=                   newest first, with delivery counts
 *   POST   /issues                                  { subject_en?, subject_ar?, body_en?, body_ar? } → a draft
 *   GET    /issues/:id                              one issue with its delivery counts
 *   PATCH  /issues/:id                              edit a draft
 *   DELETE /issues/:id                              delete a draft
 *   POST   /issues/:id/send                         both languages filled in → sending (queued fan-out)
 */
import { Hono, type Context } from 'hono';
import type { AdminBindings, AuthContext } from '../base/types';
import { audit } from '../lib/authModeration';
import { logger } from '../lib/logger';
import { cleanIssueInput, missingForSend, type SubscriberStatus } from '../lib/newsletter';
import {
  createIssue,
  deleteDraft,
  deleteSubscriber,
  deliveryCounts,
  getIssue,
  listIssues,
  listSubscribers,
  revertToDraft,
  startSending,
  subscriberCounts,
  updateDraft,
  type SubscriberRow,
} from '../lib/newsletter-store';
import { enqueueNewsletterMail, fanoutJob } from '../lib/newsletter-mail';
import { hasPermission, normalizeRoles } from '../lib/roles';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const emailOf = (c: C) => (c.get('auth') as { email?: string } | undefined)?.email ?? null;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATUSES: SubscriberStatus[] = ['pending', 'confirmed', 'unsubscribed'];

app.use('*', async (c, next) => {
  if (!hasPermission(normalizeRoles(c.get('auth')?.roles), 'newsletter:manage')) {
    logger.warn('[Newsletter] Permission denied', { userId: actorOf(c), path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The newsletter:manage permission is required' }, 403);
  }
  return next();
});

app.onError((error, c) => {
  logger.error('[Newsletter] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

const bad = (c: C, error: string, extra: Record<string, unknown> = {}) => c.json({ success: false, code: 'bad_request', error, ...extra }, 400);
const notFound = (c: C, what = 'issue') => c.json({ success: false, code: 'not_found', error: `No such ${what}` }, 404);
const int = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Never the unsubscribe token: it is a capability link. */
const publicSubscriber = ({ unsubscribe_token: _t, ...rest }: SubscriberRow) => rest;

app.get('/subscribers', async (c) => {
  const status = c.req.query('status') as SubscriberStatus | undefined;
  if (status && !STATUSES.includes(status)) return bad(c, 'Unknown status');
  const q = (c.req.query('q') ?? '').trim().slice(0, 200) || undefined;
  const limit = int(c.req.query('limit'), 50, 1, 100);
  const offset = int(c.req.query('offset'), 0, 0, 1_000_000);
  const [list, counts] = await Promise.all([listSubscribers(c.env.REPORTS_DB, { status, q, limit, offset }), subscriberCounts(c.env.REPORTS_DB)]);
  return c.json({ success: true, result: { items: list.items.map(publicSubscriber), total: list.total, counts, limit, offset } });
});

app.delete('/subscribers/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return notFound(c, 'subscriber');
  const row = await deleteSubscriber(c.env.REPORTS_DB, id);
  if (!row) return notFound(c, 'subscriber');
  // The address itself is not kept in the audit log (it was erased on request)
  await audit(c.env.REPORTS_DB, { actorId: actorOf(c), actorEmail: emailOf(c), action: 'newsletter.subscriber.delete', targetType: 'newsletter_subscriber', targetId: id, metadata: { status: row.status } });
  return c.json({ success: true });
});

app.get('/issues', async (c) => {
  const limit = int(c.req.query('limit'), 20, 1, 100);
  const offset = int(c.req.query('offset'), 0, 0, 1_000_000);
  const [list, counts] = await Promise.all([listIssues(c.env.REPORTS_DB, { limit, offset }), subscriberCounts(c.env.REPORTS_DB)]);
  return c.json({ success: true, result: { ...list, subscribers: counts, limit, offset } });
});

app.post('/issues', async (c) => {
  const parsed = cleanIssueInput(await c.req.json().catch(() => ({})));
  if ('error' in parsed) return bad(c, parsed.error);
  const issue = await createIssue(c.env.REPORTS_DB, parsed.value, actorOf(c), new Date());
  await audit(c.env.REPORTS_DB, { actorId: actorOf(c), actorEmail: emailOf(c), action: 'newsletter.issue.create', targetType: 'newsletter_issue', targetId: issue.id });
  return c.json({ success: true, result: issue }, 201);
});

app.get('/issues/:id', async (c) => {
  const id = c.req.param('id');
  const issue = ID.test(id) ? await getIssue(c.env.REPORTS_DB, id) : null;
  if (!issue) return notFound(c);
  const [counts, subscribers] = await Promise.all([deliveryCounts(c.env.REPORTS_DB, id), subscriberCounts(c.env.REPORTS_DB)]);
  return c.json({ success: true, result: { ...issue, counts, subscribers } });
});

app.patch('/issues/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return notFound(c);
  const parsed = cleanIssueInput(await c.req.json().catch(() => ({})));
  if ('error' in parsed) return bad(c, parsed.error);
  const issue = await updateDraft(c.env.REPORTS_DB, id, parsed.value, new Date());
  if (!issue) {
    const current = await getIssue(c.env.REPORTS_DB, id);
    if (!current) return notFound(c);
    return c.json({ success: false, code: 'not_draft', error: 'This issue was already sent and can no longer be edited' }, 409);
  }
  await audit(c.env.REPORTS_DB, { actorId: actorOf(c), actorEmail: emailOf(c), action: 'newsletter.issue.edit', targetType: 'newsletter_issue', targetId: id, metadata: { fields: Object.keys(parsed.value) } });
  return c.json({ success: true, result: issue });
});

app.delete('/issues/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return notFound(c);
  if (!(await deleteDraft(c.env.REPORTS_DB, id))) {
    const current = await getIssue(c.env.REPORTS_DB, id);
    if (!current) return notFound(c);
    return c.json({ success: false, code: 'not_draft', error: 'A sent issue cannot be deleted' }, 409);
  }
  await audit(c.env.REPORTS_DB, { actorId: actorOf(c), actorEmail: emailOf(c), action: 'newsletter.issue.delete', targetType: 'newsletter_issue', targetId: id });
  return c.json({ success: true });
});

app.post('/issues/:id/send', async (c) => {
  const id = c.req.param('id');
  const issue = ID.test(id) ? await getIssue(c.env.REPORTS_DB, id) : null;
  if (!issue) return notFound(c);
  if (issue.status !== 'draft') return c.json({ success: false, code: 'not_draft', error: 'This issue was already sent' }, 409);
  const missing = missingForSend(issue);
  if (missing.length) return bad(c, 'Fill in the subject and text in both languages before sending', { missing });
  const now = new Date();
  if (!(await startSending(c.env.REPORTS_DB, id, actorOf(c), now))) return c.json({ success: false, code: 'not_draft', error: 'This issue was already sent' }, 409);
  if (!(await enqueueNewsletterMail(c.env, [fanoutJob(id)]))) {
    await revertToDraft(c.env.REPORTS_DB, id, now);
    return c.json({ success: false, code: 'queue_unavailable', error: 'Could not start sending. Nothing was sent; try again.' }, 503);
  }
  const subscribers = await subscriberCounts(c.env.REPORTS_DB);
  await audit(c.env.REPORTS_DB, { actorId: actorOf(c), actorEmail: emailOf(c), action: 'newsletter.issue.send', targetType: 'newsletter_issue', targetId: id, metadata: { confirmed: subscribers.confirmed } });
  return c.json({ success: true, result: { ...(await getIssue(c.env.REPORTS_DB, id)), subscribers } }, 202);
});

export default app;
