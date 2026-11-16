/**
 * Email subscriptions on the public page (src/subscribe.ts, routes in src/index.ts): the
 * subscribe form (validation, rate limit, honeypot, no "already subscribed" leak, resend
 * cooldown, queue failure), confirm and unsubscribe (GET never changes anything, RFC 8058
 * one-click), the pages in en and ar, and the daily prune. SQL runs on SQLite.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { StatusNotifyJob } from '@al-ummah/shared-types';
import { CONFIRM_COOLDOWN_MINUTES, MAX_PER_IP_PER_HOUR, confirm, normalizeEmail, subscribe, tokenState, unsubscribe, type SubscribeEnv } from '../src/subscribe';
import { prune } from '../src/store';
import { renderConfirmPage, renderStatusPage, renderSubscribePage, renderUnsubscribedPage, renderUnsubscribePage } from '../src/render';
import worker from '../src/index';
import { sqliteD1 } from './d1-sqlite';

const NOW = new Date(Date.UTC(2026, 10, 14, 12, 0));

function env(opts: { failQueue?: boolean } = {}) {
  const jobs: StatusNotifyJob[] = [];
  const db = sqliteD1();
  const queue = {
    send: async (job: StatusNotifyJob) => {
      if (opts.failQueue) throw new Error('queue down');
      jobs.push(job);
    },
  } as unknown as Queue<StatusNotifyJob>;
  const e: SubscribeEnv & { ENVIRONMENT: string } = { STATUS_DB: db, STATUS_NOTIFY_QUEUE: queue, INTERNAL_API_KEY: 'test-key', ENVIRONMENT: 'qa' };
  return { env: e, db, jobs };
}

const rowOf = (db: D1Database, email: string) => db.prepare("SELECT * FROM subscribers WHERE kind = 'email' AND address = ?").bind(email).first<Record<string, string | null>>();

describe('subscribe', () => {
  it('normalises and validates addresses', () => {
    assert.equal(normalizeEmail('  Name@Example.COM '), 'name@example.com');
    for (const bad of ['', 'no-at', 'a@b', 'a b@c.com', `${'x'.repeat(250)}@example.com`, 42, null]) assert.equal(normalizeEmail(bad), null, String(bad));
  });

  it('stores a pending subscriber in the chosen language and queues one confirmation', async () => {
    const { env: e, db, jobs } = env();
    assert.equal(await subscribe(e, { email: 'Reader@Example.com', locale: 'ar', honeypot: '', ip: '1.1.1.1' }, NOW), 'sent');
    const row = await rowOf(db, 'reader@example.com');
    assert.equal(row?.status, 'pending');
    assert.equal(row?.locale, 'ar');
    assert.match(String(row?.token), /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(jobs, [{ v: 1, kind: 'status-confirm', subscriberId: row!.id }]);
  });

  it('answers the same for an active address and sends it nothing', async () => {
    const { env: e, db, jobs } = env();
    await subscribe(e, { email: 'a@example.com', locale: 'en', honeypot: '', ip: '1' }, NOW);
    await confirm(db, (await rowOf(db, 'a@example.com'))!.token);
    jobs.length = 0;
    assert.equal(await subscribe(e, { email: 'a@example.com', locale: 'en', honeypot: '', ip: '2' }, NOW), 'sent');
    assert.equal(jobs.length, 0);
  });

  it('resends a pending confirmation only after the cooldown; the latest language wins', async () => {
    const { env: e, db, jobs } = env();
    await subscribe(e, { email: 'p@example.com', locale: 'en', honeypot: '', ip: '1' }, NOW);
    const token = (await rowOf(db, 'p@example.com'))!.token;
    await subscribe(e, { email: 'p@example.com', locale: 'ar', honeypot: '', ip: '2' }, new Date(NOW.getTime() + 60_000));
    assert.equal(jobs.length, 1, 'within the cooldown: no second email');
    await subscribe(e, { email: 'p@example.com', locale: 'ar', honeypot: '', ip: '3' }, new Date(NOW.getTime() + (CONFIRM_COOLDOWN_MINUTES + 1) * 60_000));
    assert.equal(jobs.length, 2);
    const row = await rowOf(db, 'p@example.com');
    assert.equal(row?.locale, 'ar');
    assert.equal(row?.token, token, 'the link stays the same');
  });

  it('limits requests per IP per hour', async () => {
    const { env: e } = env();
    for (let i = 0; i < MAX_PER_IP_PER_HOUR; i++) assert.equal(await subscribe(e, { email: `u${i}@example.com`, locale: 'en', honeypot: '', ip: '9.9.9.9' }, NOW), 'sent');
    assert.equal(await subscribe(e, { email: 'late@example.com', locale: 'en', honeypot: '', ip: '9.9.9.9' }, NOW), 'limited');
    assert.equal(await subscribe(e, { email: 'other@example.com', locale: 'en', honeypot: '', ip: '8.8.8.8' }, NOW), 'sent', 'another IP is not limited');
    assert.equal(await subscribe(e, { email: 'next@example.com', locale: 'en', honeypot: '', ip: '9.9.9.9' }, new Date(NOW.getTime() + 3_600_000)), 'sent', 'the next hour starts again');
  });

  it('a filled honeypot stores and sends nothing but answers as usual', async () => {
    const { env: e, db, jobs } = env();
    assert.equal(await subscribe(e, { email: 'bot@example.com', locale: 'en', honeypot: 'http://spam', ip: '1' }, NOW), 'sent');
    assert.equal(await rowOf(db, 'bot@example.com'), null);
    assert.equal(jobs.length, 0);
  });

  it('a refused queue answers unavailable and lets the next try send at once', async () => {
    const { env: e, db } = env({ failQueue: true });
    assert.equal(await subscribe(e, { email: 'q@example.com', locale: 'en', honeypot: '', ip: '1' }, NOW), 'unavailable');
    assert.equal((await rowOf(db, 'q@example.com'))?.confirm_sent_at, null);
  });
});

describe('confirm and unsubscribe', () => {
  it('confirm activates; unknown tokens do nothing', async () => {
    const { env: e, db } = env();
    await subscribe(e, { email: 'c@example.com', locale: 'en', honeypot: '', ip: '1' }, NOW);
    const token = (await rowOf(db, 'c@example.com'))!.token!;
    assert.deepEqual(await tokenState(db, token), { state: 'pending', locale: 'en' });
    assert.equal(await confirm(db, token, NOW), 'active');
    assert.equal((await rowOf(db, 'c@example.com'))?.confirmed_at, NOW.toISOString());
    assert.equal(await confirm(db, token), 'active', 'twice is fine');
    assert.equal(await confirm(db, 'x'.repeat(43)), 'unknown');
    assert.equal(await confirm(db, '<script>'), 'unknown');
  });

  it('unsubscribe deletes the row and its deliveries', async () => {
    const { env: e, db } = env();
    await subscribe(e, { email: 'u@example.com', locale: 'en', honeypot: '', ip: '1' }, NOW);
    const row = (await rowOf(db, 'u@example.com'))!;
    await db.prepare("INSERT INTO deliveries (notification_id, subscriber_id, status, updated_at) VALUES ('n1', ?, 'sent', ?)").bind(row.id, NOW.toISOString()).run();
    assert.equal(await unsubscribe(db, row.token), true);
    assert.equal(await rowOf(db, 'u@example.com'), null);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM deliveries').first<{ n: number }>())?.n, 0);
    assert.equal(await unsubscribe(db, row.token), false);
  });

  it('prune drops week-old pending subscriptions, keeps active ones and recent pending ones', async () => {
    const { env: e, db } = env();
    const old = new Date(NOW.getTime() - 8 * 86_400_000);
    await subscribe(e, { email: 'old@example.com', locale: 'en', honeypot: '', ip: '1' }, old);
    await subscribe(e, { email: 'oldactive@example.com', locale: 'en', honeypot: '', ip: '2' }, old);
    await confirm(db, (await rowOf(db, 'oldactive@example.com'))!.token);
    await subscribe(e, { email: 'new@example.com', locale: 'en', honeypot: '', ip: '3' }, NOW);
    await db.prepare("INSERT INTO notifications (id, incident_id, event, created_at) VALUES ('old-n', 'i', 'created', ?)").bind(new Date(NOW.getTime() - 31 * 86_400_000).toISOString()).run();
    await prune(db, NOW);
    assert.equal(await rowOf(db, 'old@example.com'), null);
    assert.ok(await rowOf(db, 'oldactive@example.com'));
    assert.ok(await rowOf(db, 'new@example.com'));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM notifications').first<{ n: number }>())?.n, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM subscribe_limits').first<{ n: number }>())?.n, 1, "rate-limit rows from 8 days ago are gone, this hour's stays");
  });
});

describe('subscription pages', () => {
  const opts = (locale: 'en' | 'ar', path: string) => ({ locale, path, assetVersion: 'test', environment: 'production' });

  it('the subscribe form: labelled fields, language preselected, honeypot hidden, error announced', () => {
    const en = renderSubscribePage(opts('en', '/subscribe'));
    assert.match(en, /<html lang="en" dir="ltr">/);
    assert.match(en, /<label for="sub-email">Email address<\/label>/);
    assert.match(en, /<form class="sub-form" method="post" action="\/subscribe"/);
    assert.match(en, /value="en" checked/);
    assert.match(en, /class="hp" aria-hidden="true"/);
    const ar = renderSubscribePage(opts('ar', '/subscribe'), { error: 'invalid', email: '"><b>' });
    assert.match(ar, /<html lang="ar" dir="rtl">/);
    assert.match(ar, /action="\/ar\/subscribe"/);
    assert.match(ar, /value="ar" checked/);
    assert.match(ar, /role="alert"/);
    assert.match(ar, /aria-invalid="true"/);
    assert.ok(!ar.includes('"><b>'), 'the typed value is escaped');
  });

  it('confirm and unsubscribe pages post their token; the language switch keeps it', () => {
    const page = renderConfirmPage({ ...opts('en', '/subscribe/confirm'), search: '?t=abc' }, 'pending', 'abc');
    assert.match(page, /action="\/subscribe\/confirm"[^>]*><input type="hidden" name="t" value="abc">/);
    assert.match(page, /href="\/ar\/subscribe\/confirm\?t=abc"/);
    assert.match(renderConfirmPage(opts('en', '/subscribe/confirm'), 'unknown', ''), /This link has expired/);
    assert.match(renderUnsubscribePage(opts('ar', '/unsubscribe'), true, 'tok'), /action="\/ar\/unsubscribe"/);
    assert.match(renderUnsubscribePage(opts('en', '/unsubscribe'), false, ''), /You are unsubscribed/);
  });

  const summary = { environment: 'production', generatedAt: NOW.toISOString(), overall: 'operational', lastCheckedAt: null, components: [], active: [], upcoming: [], history: [] } as unknown as Parameters<typeof renderStatusPage>[0];

  it('the main page links to email updates (call to action and footer) while they are offered', () => {
    const page = renderStatusPage(summary, { ...opts('ar', ''), subscribe: true });
    assert.match(page, /data-testid="subscribe-cta"[\s\S]*href="\/ar\/subscribe"/);
    assert.match(page, /data-testid="footer-subscribe"/);
  });

  it('hidden when off: without email updates the page has no call to action, no footer link, no /subscribe link', () => {
    for (const locale of ['en', 'ar'] as const) {
      const page = renderStatusPage(summary, opts(locale, ''));
      assert.ok(!page.includes('subscribe-cta'), `${locale}: no call to action`);
      assert.ok(!page.includes('footer-subscribe'), `${locale}: no footer link`);
      assert.ok(!/href="(\/ar)?\/subscribe"/.test(page), `${locale}: no link to /subscribe`);
      assert.match(page, /feed\.atom/, `${locale}: the feeds stay`);
    }
  });

  it('hidden when off: an expired link and the unsubscribed page offer no Subscribe again', () => {
    const link = /href="(\/ar)?\/subscribe"/;
    for (const locale of ['en', 'ar'] as const) {
      const expired = renderConfirmPage(opts(locale, '/subscribe/confirm'), 'unknown', '');
      assert.ok(!link.test(expired), `${locale}: expired page has no link to /subscribe`);
      assert.ok(!expired.includes(locale === 'ar' ? 'اشترك مجددًا' : 'Subscribe again'), `${locale}: expired page does not invite subscribing again`);
      assert.ok(!link.test(renderUnsubscribedPage(opts(locale, '/unsubscribe'))), `${locale}: unsubscribed page has no link to /subscribe`);
      // While email updates are offered, both pages keep the way back
      assert.match(renderConfirmPage({ ...opts(locale, '/subscribe/confirm'), subscribe: true }, 'unknown', ''), link);
      assert.match(renderUnsubscribedPage({ ...opts(locale, '/unsubscribe'), subscribe: true }), link);
    }
  });
});

describe('routes', () => {
  const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const call = (e: unknown, path: string, init?: RequestInit) => (worker as { fetch(r: Request, e: unknown, c: ExecutionContext): Promise<Response> }).fetch(new Request(`https://status.example${path}`, init), e, ctx);
  const form = (fields: Record<string, string>, headers: Record<string, string> = {}): RequestInit => ({
    method: 'POST',
    body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '7.7.7.7', ...headers },
  });

  it('subscribe → 303 to the sent page; never cached; form-action self', async () => {
    const { env: e, db } = env();
    const res = await call(e, '/ar/subscribe', form({ email: 'route@example.com', locale: 'ar', website: '' }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/ar/subscribe/sent');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('content-security-policy') ?? '', /form-action 'self'/);
    assert.ok(await rowOf(db, 'route@example.com'));
    const sent = await call(e, '/ar/subscribe/sent');
    assert.equal(sent.status, 200);
    assert.match(await sent.text(), /تفقّد بريدك/);
  });

  it('hidden when off: without the notify queue /subscribe is not found, confirm and unsubscribe still work', async () => {
    const { env: e, db } = env();
    const off = { ...e, STATUS_NOTIFY_QUEUE: undefined };
    for (const path of ['/subscribe', '/ar/subscribe', '/subscribe/sent']) assert.equal((await call(off, path)).status, 404, `GET ${path}`);
    assert.equal((await call(off, '/subscribe', form({ email: 'off@example.com', locale: 'en', website: '' }))).status, 404, 'POST /subscribe');
    assert.equal(await rowOf(db, 'off@example.com'), null, 'nothing stored');
    assert.equal((await call(off, '/unsubscribe?t=unknown')).status, 200, 'unsubscribe stays');
    const home = await (await call(off, '/')).text();
    assert.ok(!home.includes('subscribe-cta') && !home.includes('footer-subscribe'), 'home page has no subscribe entry points');
  });

  it('a bad address re-renders the form with 400; a cross-site post is refused', async () => {
    const { env: e } = env();
    const bad = await call(e, '/subscribe', form({ email: 'nope', locale: 'en' }));
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /Enter a valid email address/);
    assert.equal((await call(e, '/subscribe', form({ email: 'x@example.com' }, { origin: 'https://evil.example' }))).status, 403);
  });

  it('GET confirm and GET unsubscribe change nothing; their buttons do; one-click unsubscribe works', async () => {
    const { env: e, db } = env();
    await subscribe(e, { email: 'flow@example.com', locale: 'en', honeypot: '', ip: '1' }, NOW);
    const token = (await rowOf(db, 'flow@example.com'))!.token!;
    const page = await call(e, `/subscribe/confirm?t=${token}`);
    assert.match(await page.text(), /Confirm subscription/);
    assert.equal((await rowOf(db, 'flow@example.com'))?.status, 'pending');
    const done = await call(e, '/subscribe/confirm', form({ t: token }, { origin: 'https://status.example' }));
    assert.match(await done.text(), /You are subscribed/);
    assert.equal((await rowOf(db, 'flow@example.com'))?.status, 'active');

    assert.match(await (await call(e, `/unsubscribe?t=${token}`)).text(), /Unsubscribe from status emails/);
    assert.ok(await rowOf(db, 'flow@example.com'));
    // RFC 8058: the mail provider posts List-Unsubscribe=One-Click to the link itself, from no origin
    const oneClick = await call(e, `/unsubscribe?t=${token}`, form({ 'List-Unsubscribe': 'One-Click' }));
    assert.equal(oneClick.status, 200);
    assert.equal(await rowOf(db, 'flow@example.com'), null);
  });

  it('POST elsewhere is 405', async () => {
    const { env: e } = env();
    assert.equal((await call(e, '/', { method: 'POST' })).status, 405);
  });
});
