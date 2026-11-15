/**
 * Newsletter (AlUmmahNowUI#6): sign-up → confirmation email → confirm → issue fan-out → one email
 * per confirmed subscriber with unsubscribe link + headers → unsubscribe. SQL runs on node:sqlite
 * with the real migrations; Resend is a fetch stub.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { sqliteD1 } from './d1-sqlite';
import newsletterInternal from '../src/endpoints/newsletter/NewsletterInternal';
import newsletterRouter from '../src/routers/newsletter.router';
import { bodyBlocks, cleanIssueInput, hashToken, missingForSend, parseSignup, renderConfirmEmail, renderIssueEmail, isNewsletterBot } from '../src/lib/newsletter';
import { confirmSubscriber, getIssue, getSubscriber, requestSignup, unsubscribeByToken } from '../src/lib/newsletter-store';
import { contactMailConsumer } from '../src/lib/contact-mail-queue';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';
import type { NewsletterMailJob } from '../src/lib/newsletter-mail';

const realFetch = globalThis.fetch;
let calls: { body: Record<string, unknown>; key?: string }[] = [];
let respond: () => Response = () => new Response(JSON.stringify({ id: 're_1' }), { status: 200 });

beforeEach(() => {
  calls = [];
  respond = () => new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(String(init.body)), key: (init.headers as Record<string, string>)['Idempotency-Key'] });
    return respond();
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function setup(environment = 'production', extra: Record<string, unknown> = {}) {
  const db = sqliteD1();
  const queued: NewsletterMailJob[] = [];
  const dlq: Record<string, unknown>[] = [];
  const queue = { failing: false };
  const env = {
    REPORTS_DB: db,
    ENVIRONMENT: environment,
    INTERNAL_API_KEY: 'internal-key',
    RESEND_API_KEY: 'k',
    TURNSTILE_MODE: 'off',
    NEWSLETTER_SITE_URL: 'https://www.alummahnow.net',
    CONTACT_MAIL_QUEUE: {
      sendBatch: async (batch: { body: NewsletterMailJob }[]) => {
        if (queue.failing) throw new Error('queue down');
        queued.push(...batch.map((b) => b.body));
      },
    },
    ERRORS_DLQ: { send: async (b: Record<string, unknown>) => { dlq.push(b); } },
    ...extra,
  };
  const app = new Hono();
  app.route('/internal/newsletter', newsletterInternal as never);
  let roles = ['admin'];
  app.use('/api/newsletter/*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', email: 'admin@example.org', roles } as never);
    return next();
  });
  app.route('/api/newsletter', newsletterRouter as never);
  const internal = (path: string, body: unknown, headers: Record<string, string> = { 'X-API-Key': 'internal-key' }) =>
    app.request(`/internal/newsletter${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-Client-IP': '198.51.100.7', ...headers } }, env);
  const api = (method: string, path: string, body?: unknown) =>
    app.request(`/api/newsletter${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) }, env);
  /** Runs everything queued (and what that queues) through the real consumer. */
  async function drain(attempts = 1, rounds = Infinity) {
    const out: { kind: string; acked: boolean; retried: boolean }[] = [];
    while (queued.length && rounds-- > 0) {
      const batch = queued.splice(0, queued.length).map((body, i) => {
        const m = { id: `q${i}`, body, attempts, acked: false, retried: false };
        return Object.assign(m, { ack: () => { m.acked = true; }, retry: () => { m.retried = true; } });
      });
      await contactMailConsumer({ messages: batch as never }, env as never);
      out.push(...batch.map((m) => ({ kind: m.body.kind, acked: m.acked, retried: m.retried })));
      if (batch.every((m) => m.retried)) break;
    }
    return out;
  }
  return { db, env, queued, dlq, queue, internal, api, drain, setRoles: (r: string[]) => (roles = r) };
}

const tokenFrom = (html: string) => decodeURIComponent(/newsletter\/confirm\?token=([^"&<\s]+)/.exec(html)![1]!.replace(/&amp;/g, '&'));

describe('newsletter: pure parts', () => {
  it('parses a sign-up: lowercased address, en/ar only; bots are the hidden field', () => {
    assert.deepEqual(parseSignup({ email: ' Amina@Example.org ', locale: 'ar' }), { email: 'amina@example.org', locale: 'ar' });
    assert.deepEqual(parseSignup({ email: 'a@example.org', locale: 'fr' }), { email: 'a@example.org', locale: 'en' });
    assert.equal(parseSignup({ email: 'not an address' }), null);
    assert.equal(isNewsletterBot({ website: 'x' }), true);
    assert.equal(isNewsletterBot({ website: '' }), false);
  });

  it('issue text: limits, both languages needed to send, paragraphs and bare links', () => {
    assert.equal(cleanIssueInput({ subject_en: 'x'.repeat(151) }).ok, false);
    assert.deepEqual(cleanIssueInput({ subject_en: '  New  videos ', body_en: 'a\r\nb' }), { ok: true, value: { subject_en: 'New videos', body_en: 'a\nb' } });
    assert.deepEqual(missingForSend({ subject_en: 'S', subject_ar: '', body_en: 'B', body_ar: ' ' }), ['subject_ar', 'body_ar']);
    assert.deepEqual(bodyBlocks('First\n\nhttps://www.alummahnow.net/en/\n\n\nLast'), [
      { kind: 'p', text: 'First' },
      { kind: 'link', label: 'https://www.alummahnow.net/en/', url: 'https://www.alummahnow.net/en/' },
      { kind: 'p', text: 'Last' },
    ]);
  });

  it('the confirmation email links to www in the reader’s language (rtl for Arabic)', () => {
    const en = renderConfirmEmail({ to: 'a@example.org', locale: 'en', token: 'tok_abcdefghijklmnopqrstuvwxyz', site: 'https://www.alummahnow.net' });
    assert.match(en.html, /https:\/\/www\.alummahnow\.net\/en\/newsletter\/confirm\?token=tok_abcdefghijklmnopqrstuvwxyz/);
    assert.match(en.subject, /Confirm your Al Ummah Now newsletter subscription/);
    const ar = renderConfirmEmail({ to: 'a@example.org', locale: 'ar', token: 'tok_abcdefghijklmnopqrstuvwxyz', site: 'https://www.qa.alummahnow.net', environment: 'qa' });
    assert.match(ar.html, /dir="rtl"/);
    assert.match(ar.subject, /^\[qa\] أكّد اشتراكك/);
    assert.match(ar.text, /\/ar\/newsletter\/confirm\?token=/);
  });

  it('an issue email has the unsubscribe link and RFC 8058 one-click headers', () => {
    const issue = { subject_en: 'November', subject_ar: 'نوفمبر', body_en: 'Hello', body_ar: 'مرحبا' };
    const e = renderIssueEmail({ to: 'a@example.org', locale: 'ar', issue, unsubscribeToken: 'unsub_abcdefghijklmnopqrstu', site: 'https://www.alummahnow.net' });
    assert.equal(e.subject, 'نوفمبر');
    assert.match(e.html, /مرحبا/);
    assert.match(e.html, /إلغاء الاشتراك/);
    assert.deepEqual(e.headers, {
      'List-Unsubscribe': '<https://www.alummahnow.net/ar/newsletter/unsubscribe?token=unsub_abcdefghijklmnopqrstu>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});

describe('newsletter: sign-up, confirm, unsubscribe', () => {
  it('needs the internal API key', async () => {
    const { internal } = setup();
    assert.equal((await internal('/subscribe', { email: 'a@example.org' }, {})).status, 401);
  });

  it('double opt-in: pending + one queued confirmation; the link confirms; issues reach only confirmed', async () => {
    const { db, internal, queued, drain } = setup();
    const res = await internal('/subscribe', { email: 'Amina@Example.org', locale: 'ar', website: '' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { success: true, result: { status: 'check_email' } });
    assert.equal(queued.length, 1);
    assert.equal(queued[0]!.kind, 'newsletter_confirm');
    const row = await db.prepare('SELECT id, status, confirm_token_hash FROM newsletter_subscribers').first<{ id: string; status: string; confirm_token_hash: string }>();
    assert.equal(row!.status, 'pending');
    // Only the hash is stored
    assert.notEqual(row!.confirm_token_hash, (queued[0] as { token: string }).token);

    await drain();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.body.to, ['amina@example.org']);
    assert.match(String(calls[0]!.key), /^newsletter-confirm-/);
    assert.equal((await getSubscriber(db, row!.id))!.confirm_status, 'sent');

    const token = tokenFrom(String(calls[0]!.body.html));
    const ok = await internal('/confirm', { token });
    assert.deepEqual(await ok.json(), { success: true, result: { status: 'confirmed' } });
    // Clicking again still says confirmed
    assert.deepEqual(await (await internal('/confirm', { token })).json(), { success: true, result: { status: 'confirmed' } });
    assert.deepEqual(await (await internal('/confirm', { token: 'x'.repeat(43) })).json(), { success: true, result: { status: 'invalid' } });
  });

  it('the same answer for an address that is already subscribed, and no second email', async () => {
    const { db, internal, queued } = setup();
    const now = new Date();
    const s = await requestSignup(db, { email: 'a@example.org', locale: 'en', ipHash: 'x', now, perIpHour: 99 });
    assert.equal(s.outcome, 'send');
    await confirmSubscriber(db, (s as { token: string }).token, now);
    const res = await internal('/subscribe', { email: 'a@example.org', locale: 'en' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { success: true, result: { status: 'check_email' } });
    assert.equal(queued.length, 0);
  });

  it('a second request within 10 minutes sends nothing; later it sends a new link (the old one stops working)', async () => {
    const { db } = setup();
    const t0 = new Date('2026-11-14T10:00:00Z');
    const a = await requestSignup(db, { email: 'a@example.org', locale: 'en', ipHash: 'x', now: t0, perIpHour: 99 });
    assert.equal((await requestSignup(db, { email: 'a@example.org', locale: 'en', ipHash: 'x', now: new Date('2026-11-14T10:05:00Z'), perIpHour: 99 })).outcome, 'none');
    const b = await requestSignup(db, { email: 'a@example.org', locale: 'ar', ipHash: 'x', now: new Date('2026-11-14T10:11:00Z'), perIpHour: 99 });
    assert.equal(b.outcome, 'send');
    assert.equal(await confirmSubscriber(db, (a as { token: string }).token, new Date('2026-11-14T10:12:00Z')), 'invalid');
    assert.equal(await confirmSubscriber(db, (b as { token: string }).token, new Date('2026-11-14T10:12:00Z')), 'confirmed');
    assert.equal((await db.prepare('SELECT locale FROM newsletter_subscribers').first<{ locale: string }>())!.locale, 'ar');
  });

  it('a confirmation link expires after 7 days', async () => {
    const { db } = setup();
    const t0 = new Date('2026-11-01T10:00:00Z');
    const s = await requestSignup(db, { email: 'a@example.org', locale: 'en', ipHash: 'x', now: t0, perIpHour: 99 });
    assert.equal(await confirmSubscriber(db, (s as { token: string }).token, new Date('2026-11-08T10:00:01Z')), 'expired');
  });

  it('rate limits sign-ups per IP (429), bots get the normal answer and nothing is stored', async () => {
    const { db, internal } = setup('production');
    for (let i = 0; i < 10; i++) assert.equal((await internal('/subscribe', { email: `p${i}@example.org` })).status, 202);
    assert.equal((await internal('/subscribe', { email: 'p10@example.org' })).status, 429);
    const bot = setup();
    assert.equal((await bot.internal('/subscribe', { email: 'b@example.org', website: 'spam' })).status, 202);
    assert.equal((await bot.db.prepare('SELECT COUNT(*) AS n FROM newsletter_subscribers').first<{ n: number }>())!.n, 0);
    assert.equal((await internal('/subscribe', { email: 'nope' })).status, 400);
    void db;
  });

  it('Turnstile enforced: no token → 403 human_check_required with the site key', async () => {
    const { internal } = setup('production', { TURNSTILE_MODE: 'enforce', TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET: 'secret' });
    const res = await internal('/subscribe', { email: 'a@example.org' });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { success: false, error: 'human_check_required', siteKey: 'site-key' });
  });

  it('the queue refusing the confirmation marks it failed and reports it (DLQ without the token)', async () => {
    const { db, internal, queue, dlq } = setup();
    queue.failing = true;
    assert.equal((await internal('/subscribe', { email: 'a@example.org' })).status, 202);
    assert.equal((await db.prepare('SELECT confirm_status FROM newsletter_subscribers').first<{ confirm_status: string }>())!.confirm_status, 'failed');
    assert.equal(dlq.length, 1);
    assert.equal(JSON.stringify(dlq[0]).includes('"token"'), false);
  });

  it('unsubscribe by link: any state, idempotent; unknown links are invalid', async () => {
    const { db, internal } = setup();
    const s = await requestSignup(db, { email: 'a@example.org', locale: 'en', ipHash: 'x', now: new Date(), perIpHour: 99 });
    const { unsubscribe_token } = (await getSubscriber(db, (s as { subscriberId: string }).subscriberId))!;
    assert.deepEqual(await (await internal('/unsubscribe', { token: unsubscribe_token })).json(), { success: true, result: { status: 'unsubscribed' } });
    assert.equal(await unsubscribeByToken(db, unsubscribe_token, new Date()), 'unsubscribed');
    assert.deepEqual(await (await internal('/unsubscribe', { token: 'y'.repeat(43) })).json(), { success: true, result: { status: 'invalid' } });
    // The old confirmation link no longer subscribes them
    assert.equal(await confirmSubscriber(db, (s as { token: string }).token, new Date()), 'invalid');
  });
});

async function subscribed(db: D1Database, n: number, opts: { locale?: 'en' | 'ar'; prefix?: string } = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = await requestSignup(db, { email: `${opts.prefix ?? 's'}${i}@example.org`, locale: opts.locale ?? (i % 2 ? 'ar' : 'en'), ipHash: `ip${i}`, now: new Date(), perIpHour: 99 });
    await confirmSubscriber(db, (s as { token: string }).token, new Date());
    ids.push((s as { subscriberId: string }).subscriberId);
  }
  return ids;
}

const FULL = { subject_en: 'November on Al Ummah Now', subject_ar: 'نوفمبر على الأمة الآن', body_en: 'New channels this month.', body_ar: 'قنوات جديدة هذا الشهر.' };

describe('newsletter: admin issues and sending', () => {
  it('needs newsletter:manage (moderators are refused)', async () => {
    const { api, setRoles } = setup();
    setRoles(['moderator']);
    assert.equal((await api('GET', '/issues')).status, 403);
  });

  it('draft → send: every confirmed subscriber gets one email in their language; the issue ends sent; audited', async () => {
    const { db, api, drain } = setup();
    const ids = await subscribed(db, 3);
    // Pending and unsubscribed addresses get nothing
    await requestSignup(db, { email: 'pending@example.org', locale: 'en', ipHash: 'p', now: new Date(), perIpHour: 99 });
    const created = await (await api('POST', '/issues', { subject_en: FULL.subject_en })).json() as { result: { id: string; status: string } };
    assert.equal(created.result.status, 'draft');
    const id = created.result.id;
    const early = await api('POST', `/issues/${id}/send`);
    assert.equal(early.status, 400);
    assert.deepEqual(((await early.json()) as { missing: string[] }).missing, ['subject_ar', 'body_en', 'body_ar']);
    assert.equal((await api('PATCH', `/issues/${id}`, FULL)).status, 200);

    const sent = await api('POST', `/issues/${id}/send`);
    assert.equal(sent.status, 202);
    assert.equal((await api('POST', `/issues/${id}/send`)).status, 409);
    assert.equal((await api('PATCH', `/issues/${id}`, { body_en: 'changed' })).status, 409);
    assert.equal((await api('DELETE', `/issues/${id}`)).status, 409);

    calls = [];
    await drain();
    assert.equal(calls.length, 3);
    const subjects = calls.map((c) => c.body.subject).sort();
    assert.deepEqual(subjects, [FULL.subject_en, FULL.subject_en, FULL.subject_ar].sort());
    assert.ok(calls.every((c) => (c.body.headers as Record<string, string>)['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click'));
    assert.deepEqual(new Set(calls.map((c) => c.key)), new Set(ids.map((s) => `newsletter-${id}-${s}`)));
    const detail = (await (await api('GET', `/issues/${id}`)).json()) as { result: { status: string; counts: Record<string, number> } };
    assert.equal(detail.result.status, 'sent');
    assert.equal(detail.result.counts.sent, 3);
    const actions = await db.prepare("SELECT action FROM admin_audit_log WHERE target_type = 'newsletter_issue' ORDER BY created_at").all<{ action: string }>();
    assert.deepEqual((actions.results as { action: string }[]).map((a) => a.action), ['newsletter.issue.create', 'newsletter.issue.edit', 'newsletter.issue.send']);
  });

  it('fans out in pages of 100 and never sends twice when a job runs again', async () => {
    const { db, api, drain, queued } = setup();
    await subscribed(db, 205, { locale: 'en' });
    const { result } = (await (await api('POST', '/issues', FULL)).json()) as { result: { id: string } };
    await api('POST', `/issues/${result.id}/send`);
    const fanout = queued[0]!;
    await drain();
    assert.equal(calls.length, 205);
    // The first page again (a queue redelivery): no new emails
    queued.push(fanout);
    await drain();
    assert.equal(calls.length, 205);
    assert.equal((await getIssue(db, result.id))!.status, 'sent');
  });

  it('someone who unsubscribes before their email goes out is skipped', async () => {
    const { db, api, drain, queued } = setup();
    const [a] = await subscribed(db, 2);
    const { result } = (await (await api('POST', '/issues', FULL)).json()) as { result: { id: string } };
    await api('POST', `/issues/${result.id}/send`);
    // The fan-out only, then one unsubscribes before the sends run
    await drain(1, 1);
    assert.equal(queued.filter((j) => j.kind === 'newsletter_send').length, 2);
    await unsubscribeByToken(db, (await getSubscriber(db, a!))!.unsubscribe_token, new Date());
    await drain();
    const detail = (await (await api('GET', `/issues/${result.id}`)).json()) as { result: { counts: Record<string, number>; status: string } };
    assert.equal(detail.result.counts.skipped, 1);
    assert.equal(detail.result.counts.sent, 1);
    assert.equal(detail.result.status, 'sent');
    assert.ok(calls.every((c) => !(c.body.to as string[]).includes('s0@example.org')));
  });

  it('retries a 5xx with backoff; a final failure marks it failed, flags it, and Retry sends it again', async () => {
    const { db, env, api, drain, queued, dlq } = setup();
    const [sid] = await subscribed(db, 1, { locale: 'en' });
    const { result } = (await (await api('POST', '/issues', FULL)).json()) as { result: { id: string } };
    await api('POST', `/issues/${result.id}/send`);
    await drain(); // fan-out (the send itself succeeds here; make it fail on the retry path below)
    // Reset to a fresh queued delivery and fail it for good
    await db.prepare("UPDATE newsletter_deliveries SET status = 'queued'").run();
    await db.prepare("UPDATE newsletter_issues SET status = 'sending'").run();
    respond = () => new Response('busy', { status: 503 });
    const job: NewsletterMailJob = { v: 1, kind: 'newsletter_send', issueId: result.id, subscriberId: sid! };
    queued.push(job);
    const retried = await drain(1);
    assert.equal(retried[0]!.retried, true);
    // The queue redelivers it; the last attempt gives up
    queued.push(job);
    const final = await drain(6);
    assert.equal(final[0]!.acked, true);
    const row = await db.prepare('SELECT status FROM newsletter_deliveries').first<{ status: string }>();
    assert.equal(row!.status, 'failed');
    assert.equal((await getIssue(db, result.id))!.status, 'sent');
    assert.ok(dlq.some((d) => d.type === 'newsletter_mail'));

    respond = () => new Response(JSON.stringify({ id: 're_2' }), { status: 200 });
    const out = await BUILTIN_RETRIES['newsletter-email']!(env as never, { kind: 'issue', id: result.id }, 'a1');
    assert.equal(out.ok, true);
    assert.equal((await getIssue(db, result.id))!.status, 'sending');
    calls = [];
    await drain();
    assert.equal(calls.length, 1);
    assert.equal((await getIssue(db, result.id))!.status, 'sent');
  });

  it('Retry of a failed confirmation sends a new link while still pending', async () => {
    const { db, env, queued } = setup();
    const s = await requestSignup(db, { email: 'a@example.org', locale: 'en', ipHash: 'x', now: new Date(), perIpHour: 99 });
    const id = (s as { subscriberId: string }).subscriberId;
    const out = await BUILTIN_RETRIES['newsletter-email']!(env as never, { kind: 'confirm', id }, 'a1');
    assert.equal(out.ok, true);
    assert.equal(queued.length, 1);
    const newToken = (queued[0] as { token: string }).token;
    assert.equal((await db.prepare('SELECT confirm_token_hash FROM newsletter_subscribers').first<{ confirm_token_hash: string }>())!.confirm_token_hash, await hashToken(newToken));
    await confirmSubscriber(db, newToken, new Date());
    assert.equal((await BUILTIN_RETRIES['newsletter-email']!(env as never, { kind: 'confirm', id }, 'a2')).result, 'Nothing to send (confirmed)');
  });

  it('the queue refusing the fan-out leaves a draft (nothing sent) and answers 503', async () => {
    const { api, queue } = setup();
    const { result } = (await (await api('POST', '/issues', FULL)).json()) as { result: { id: string } };
    queue.failing = true;
    assert.equal((await api('POST', `/issues/${result.id}/send`)).status, 503);
    assert.equal(((await (await api('GET', `/issues/${result.id}`)).json()) as { result: { status: string } }).result.status, 'draft');
  });

  it('subscribers list hides unsubscribe tokens; erase removes the row and is audited without the address', async () => {
    const { db, api } = setup();
    const [id] = await subscribed(db, 2);
    const list = (await (await api('GET', '/subscribers?status=confirmed&q=s1')).json()) as { result: { items: Record<string, unknown>[]; total: number; counts: Record<string, number> } };
    assert.equal(list.result.total, 1);
    assert.equal(list.result.counts.confirmed, 2);
    assert.equal('unsubscribe_token' in list.result.items[0]!, false);
    assert.equal((await api('DELETE', `/subscribers/${id}`)).status, 200);
    assert.equal(await getSubscriber(db, id!), null);
    const a = await db.prepare("SELECT metadata FROM admin_audit_log WHERE action = 'newsletter.subscriber.delete'").first<{ metadata: string }>();
    assert.equal(a!.metadata.includes('@'), false);
  });
});
