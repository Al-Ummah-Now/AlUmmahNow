/**
 * Tier requests in admin-api (wiki AUN-TIER-REQUESTS): who may decide, the
 * audit rows, the queued delivery job (in-app notice + email, idempotent, in
 * the user's language), its failure flag on the Errors page and Retry.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import type { AccountEmailContact } from '@al-ummah/shared-types';
import contentRouter from '../src/routers/content.router';
import { contactMailConsumer } from '../src/lib/contact-mail-queue';
import { processTierRequestMailJob, renderTierRequestEmail, tierRequestMailJob, type TierRequestMailJob } from '../src/lib/tier-request-mail';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';
import { sqliteD1 } from './d1-sqlite';

interface Req {
  id: string;
  userId: string;
  tierId: string;
  tierName: string;
  status: string;
  declineReason: string | null;
  decidedAt: string | null;
  currentTierId: string;
  emailStatus: string | null;
}

/** api-videos' internal tier request routes, with state. */
function fakeVideos(contact: Partial<AccountEmailContact> | null) {
  const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
  const requests = new Map<string, Req>();
  let decisions = 0;
  let allowed = true;
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetcher = {
    async fetch(input: string, init: RequestInit = {}) {
      const url = new URL(input);
      const path = url.pathname.replace('/internal/admin', '');
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method: init.method ?? 'GET', path, body });
      if (path === '/tier-requests/settings') {
        if ((init.method ?? 'GET') === 'PUT') {
          const previous = allowed;
          allowed = body?.allowed === true;
          return answer(200, { success: true, result: { previous, allowed, mode: allowed ? 'request' : 'closed' } });
        }
        return answer(200, { success: true, result: { allowed, mode: allowed ? 'request' : 'closed', providerEnabled: false, requestsAllowed: allowed } });
      }
      const m = path.match(/^\/tier-requests\/([^/]+)(?:\/(decide|notify|delivery))?$/);
      if (m) {
        const r = requests.get(decodeURIComponent(m[1]));
        if (!r) return answer(404, { success: false, code: 'tier_request_not_found', error: 'not found' });
        if (!m[2]) return answer(200, { success: true, result: { request: r } });
        if (m[2] === 'decide') {
          if (r.status !== 'pending') return answer(409, { success: false, code: 'tier_request_not_pending', error: 'decided' });
          r.status = body?.decision === 'approve' ? 'approved' : 'declined';
          r.declineReason = (body?.reason as string | null) ?? null;
          r.decidedAt = `2026-11-14T10:00:0${decisions++}.000Z`;
          return answer(200, { success: true, result: { request: r } });
        }
        if (m[2] === 'notify') return answer(200, { success: true, result: { queued: true, decidedAt: r.decidedAt } });
        if (m[2] === 'delivery') {
          if (typeof body?.emailStatus === 'string') r.emailStatus = body.emailStatus;
          return answer(200, { success: true, result: { recorded: true } });
        }
      }
      if (/^\/users\/[^/]+\/account-email$/.test(path)) {
        if (!contact) return answer(404, { success: false, code: 'user_not_found', error: 'user_not_found' });
        return answer(200, { success: true, result: { userId: 'usr_1', email: null, displayName: '', accountEmail: true, locale: 'en', savedLocale: null, ...contact } });
      }
      return answer(200, { success: true, result: {} });
    },
  };
  const add = (r: Partial<Req> & { id: string }) =>
    requests.set(r.id, { userId: 'usr_1', tierId: 'creator', tierName: 'Creator', status: 'pending', declineReason: null, decidedAt: null, currentTierId: 'member', emailStatus: null, ...r });
  return { fetcher, calls, requests, add };
}

function setup(contact: Partial<AccountEmailContact> | null = { email: 'yusuf@example.org', displayName: 'Yusuf' }) {
  const db = sqliteD1();
  const videos = fakeVideos(contact);
  const mail: unknown[] = [];
  const ingest: unknown[] = [];
  let queueDown = false;
  const env = {
    REPORTS_DB: db,
    VIDEOS: videos.fetcher,
    INTERNAL_API_KEY: 'internal-key',
    ENVIRONMENT: 'production',
    RESEND_API_KEY: 'k',
    VIDEOS_WEB_URL: 'https://alummahnow.net',
    CONTACT_MAIL_QUEUE: { send: async (body: unknown) => { if (queueDown) throw new Error('queue down'); mail.push(body); } },
    ERRORS_QUEUE: { send: async (body: unknown) => { ingest.push(body); } },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles') ?? '';
    c.set('auth' as never, { userId: 'admin-1', email: 'admin@alummahnow.net', payload: { name: 'Admin One' }, roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  app.route('/api/content', contentRouter);
  const call = async (path: string, init: { method?: string; roles: string; json?: unknown }) => {
    const res = await app.request(
      path,
      { method: init.method ?? 'GET', headers: { 'x-test-roles': init.roles, 'content-type': 'application/json' }, ...(init.json ? { body: JSON.stringify(init.json) } : {}) },
      env,
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const audit = async () =>
    ((await db.prepare("SELECT key, old_value, new_value, actor_id FROM site_settings_log WHERE key LIKE 'content:%' ORDER BY created_at, id").bind().all()) as { results: Record<string, string>[] }).results;
  return { env, db, videos, mail, ingest, call, audit, setQueueDown: (v: boolean) => (queueDown = v) };
}

function msg(body: TierRequestMailJob, attempts = 1) {
  const m = { id: 'q1', body, attempts, acked: false, retried: undefined as undefined | { delaySeconds?: number } };
  return Object.assign(m, { ack: () => { m.acked = true; }, retry: (o?: { delaySeconds?: number }) => { m.retried = o ?? {}; } });
}

describe('tier requests: decisions', () => {
  it('"Allow tier requests": every admin reads it; only creators:manage changes it, audited with the previous value (Undo)', async () => {
    const { call, audit } = setup();
    assert.equal((await call('/api/content/tier-requests/settings', { roles: 'moderator' })).body.result.allowed, true);
    assert.equal((await call('/api/content/tier-requests/settings', { method: 'PUT', roles: 'moderator', json: { allowed: false } })).status, 403);
    assert.equal((await call('/api/content/tier-requests/settings', { method: 'PUT', roles: 'admin', json: {} })).status, 400);
    const off = await call('/api/content/tier-requests/settings', { method: 'PUT', roles: 'admin', json: { allowed: false } });
    assert.deepEqual(off.body.result, { previous: true, allowed: false, mode: 'closed' });
    await call('/api/content/tier-requests/settings', { method: 'PUT', roles: 'admin', json: { allowed: true, undo: true } });
    const rows = await audit();
    assert.deepEqual(rows.map((r) => r.key), ['content:tier-request:settings', 'content:tier-request:settings']);
    assert.deepEqual(JSON.parse(rows[0].old_value), { allowed: true });
    assert.deepEqual(JSON.parse(rows[1].new_value).details, { allowed: true, undo: true });
  });

  it('only creators:manage may decide; every admin may read the queue', async () => {
    const s = setup();
    s.videos.add({ id: 'r1' });
    assert.equal((await s.call('/api/content/tier-requests', { roles: 'moderator' })).status, 200);
    const refused = await s.call('/api/content/tier-requests/r1/approve', { method: 'POST', roles: 'moderator' });
    assert.equal(refused.status, 403);
    assert.equal(s.videos.requests.get('r1')?.status, 'pending');
  });

  it('approving: audited as a tier change on the user (with the request) and on the request; the delivery is queued', async () => {
    const s = setup();
    s.videos.add({ id: 'r1' });
    const res = await s.call('/api/content/tier-requests/r1/approve', { method: 'POST', roles: 'admin' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.result.request.status, 'approved');
    const rows = await s.audit();
    const user = rows.find((r) => r.key === 'content:user:usr_1');
    assert.deepEqual(JSON.parse(user!.new_value), { action: 'creator-tier', details: { tierId: 'creator', source: 'admin', tierRequest: 'r1' } });
    assert.deepEqual(JSON.parse(user!.old_value), { tierId: null, source: null }, 'Member is "no tier" in the audit, as for a hand change');
    assert.equal(user!.actor_id, 'admin-1');
    assert.ok(rows.some((r) => r.key === 'content:tier-request:r1' && JSON.parse(r.new_value).action === 'approve'));
    assert.deepEqual(s.mail, [tierRequestMailJob('r1', '2026-11-14T10:00:00.000Z')]);
    const again = await s.call('/api/content/tier-requests/r1/approve', { method: 'POST', roles: 'admin' });
    assert.equal(again.status, 409);
    assert.equal(s.mail.length, 1, 'nothing queued for a refused second decision');
  });

  it('declining: optional reason (trimmed, capped at 500), audited on the request, delivery queued', async () => {
    const s = setup();
    s.videos.add({ id: 'r2' });
    const res = await s.call('/api/content/tier-requests/r2/decline', { method: 'POST', roles: 'admin', json: { reason: `  Add a link to your channel.${' x'.repeat(400)}` } });
    assert.equal(res.status, 200);
    const sent = s.videos.calls.find((c) => c.path === '/tier-requests/r2/decide');
    assert.equal(sent?.body?.decision, 'decline');
    assert.equal(String(sent?.body?.reason).length, 500);
    const row = (await s.audit()).find((r) => r.key === 'content:tier-request:r2');
    assert.equal(JSON.parse(row!.new_value).action, 'decline');
    assert.equal(s.mail.length, 1);
    s.videos.add({ id: 'r3' });
    await s.call('/api/content/tier-requests/r3/decline', { method: 'POST', roles: 'admin' });
    assert.equal(s.videos.calls.find((c) => c.path === '/tier-requests/r3/decide')?.body?.reason, null, 'no reason is fine');
  });

  it('if the delivery cannot even be queued, the Errors page gets an item with Retry; the decision stands', async () => {
    const s = setup();
    s.videos.add({ id: 'r4' });
    s.setQueueDown(true);
    const res = await s.call('/api/content/tier-requests/r4/approve', { method: 'POST', roles: 'admin' });
    assert.equal(res.status, 200);
    assert.equal(s.videos.requests.get('r4')?.status, 'approved');
    assert.match(JSON.stringify(s.ingest), /tier-request-delivery/);
  });
});

describe('tier requests: delivery', () => {
  const realFetch = globalThis.fetch;
  let sent: { body: Record<string, unknown>; key?: string }[] = [];
  let respond: () => Response = () => new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
  beforeEach(() => {
    sent = [];
    respond = () => new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push({ body: JSON.parse(String(init.body)), key: (init.headers as Record<string, string>)['Idempotency-Key'] });
      return respond();
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const decided = (s: ReturnType<typeof setup>, over: Partial<Req> = {}) => s.videos.add({ id: 'r1', status: 'approved', decidedAt: '2026-11-14T10:00:00.000Z', ...over });

  it('renders the approval and the decline (with its note) in English and Arabic, linking to /upgrade, never a price', () => {
    const en = renderTierRequestEmail({ to: 'a@b.c', name: 'Yusuf', locale: 'en', approved: true, tierName: 'Creator', reason: null, origin: 'https://alummahnow.net', environment: 'qa' });
    assert.equal(en.subject, '[qa] Your request for Creator was approved');
    assert.match(en.text, /https:\/\/alummahnow\.net\/en\/upgrade/);
    const ar = renderTierRequestEmail({ to: 'a@b.c', name: 'يوسف', locale: 'ar', approved: false, tierName: 'صانع محتوى', reason: 'أضف رابط قناتك', origin: 'https://alummahnow.net' });
    assert.equal(ar.subject, 'بخصوص طلبك للحصول على صانع محتوى');
    assert.match(ar.text, /ملاحظة من الفريق: أضف رابط قناتك/);
    assert.match(ar.html, /dir="rtl"/);
    assert.doesNotMatch(en.text + ar.text, /\$|price|USD|سعر/i);
  });

  it('notifies in-app and emails once, in the user\'s email language, through the contact mail consumer', async () => {
    const s = setup({ email: 'yusuf@example.org', displayName: 'Yusuf', locale: 'ar' });
    decided(s);
    const m = msg(tierRequestMailJob('r1', '2026-11-14T10:00:00.000Z'));
    await contactMailConsumer({ messages: [m] }, s.env as never);
    assert.ok(m.acked);
    assert.ok(s.videos.calls.some((c) => c.method === 'POST' && c.path === '/tier-requests/r1/notify'));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body.to, ['yusuf@example.org']);
    assert.match(String(sent[0].body.subject), /تمت الموافقة/);
    assert.equal(sent[0].key, 'tier-request-r1-2026-11-14T10:00:00.000Z');
    assert.equal(s.videos.requests.get('r1')?.emailStatus, 'sent');
    // A retry (or a duplicate message): the notice is deduplicated by api-videos, the email is not sent again
    assert.equal(await processTierRequestMailJob(s.env as never, msg(tierRequestMailJob('r1', '2026-11-14T10:00:00.000Z'))), 'done');
    assert.equal(sent.length, 1);
  });

  it('does nothing for a decision that is not this one (decided again since) or a missing request', async () => {
    const s = setup();
    decided(s, { decidedAt: '2026-11-15T00:00:00.000Z' });
    assert.equal(await processTierRequestMailJob(s.env as never, msg(tierRequestMailJob('r1', '2026-11-14T10:00:00.000Z'))), 'done');
    assert.equal(await processTierRequestMailJob(s.env as never, msg(tierRequestMailJob('gone', '2026-11-14T10:00:00.000Z'))), 'done');
    assert.equal(sent.length, 0);
    assert.ok(!s.videos.calls.some((c) => c.path.endsWith('/notify')));
  });

  it('respects "Email me about my account" off and a missing address (the in-app notice still goes)', async () => {
    const off = setup({ email: 'yusuf@example.org', accountEmail: false });
    decided(off);
    assert.equal(await processTierRequestMailJob(off.env as never, msg(tierRequestMailJob('r1', '2026-11-14T10:00:00.000Z'))), 'done');
    assert.equal(off.videos.requests.get('r1')?.emailStatus, 'disabled');
    assert.ok(off.videos.calls.some((c) => c.path.endsWith('/notify')));
    const none = setup(null);
    decided(none);
    assert.equal(await processTierRequestMailJob(none.env as never, msg(tierRequestMailJob('r1', '2026-11-14T10:00:00.000Z'))), 'done');
    assert.equal(none.videos.requests.get('r1')?.emailStatus, 'no_address');
    assert.equal(sent.length, 0);
  });

  it('retries a passing failure, then records it, flags the Errors page; Retry queues the same decision again', async () => {
    const s = setup();
    decided(s);
    respond = () => new Response('busy', { status: 503 });
    const job = tierRequestMailJob('r1', '2026-11-14T10:00:00.000Z');
    assert.equal(await processTierRequestMailJob(s.env as never, msg(job, 1)), 'retry');
    assert.equal(await processTierRequestMailJob(s.env as never, msg(job, 6)), 'failed');
    assert.equal(s.videos.requests.get('r1')?.emailStatus, 'failed');
    assert.match(JSON.stringify(s.ingest), /tier-request:r1/);
    assert.match(JSON.stringify(s.ingest), /tier-request-delivery/);

    const retry = await BUILTIN_RETRIES['tier-request-delivery'](s.env as never, { id: 'r1', decidedAt: '2026-11-14T10:00:00.000Z' }, 'a1');
    assert.deepEqual([retry.ok, retry.status], [true, 'resolved']);
    assert.deepEqual(s.mail, [job]);
    const stale = await BUILTIN_RETRIES['tier-request-delivery'](s.env as never, { id: 'r1', decidedAt: 'older' }, 'a2');
    assert.match(stale.result, /decided again/);
    const gone = await BUILTIN_RETRIES['tier-request-delivery'](s.env as never, { id: 'nope', decidedAt: 'x' }, 'a3');
    assert.equal(gone.status, 'dismissed');
  });

  it('api-videos down while notifying: retried, never emailed before the notice is queued', async () => {
    const s = setup();
    decided(s);
    const real = s.videos.fetcher.fetch;
    s.videos.fetcher.fetch = async (input: string, init?: RequestInit) =>
      input.endsWith('/notify') ? new Response(JSON.stringify({ success: false, code: 'notification_not_queued', error: 'x' }), { status: 503 }) : real(input, init);
    assert.equal(await processTierRequestMailJob(s.env as never, msg(tierRequestMailJob('r1', '2026-11-14T10:00:00.000Z'), 2)), 'retry');
    assert.equal(sent.length, 0);
  });
});
