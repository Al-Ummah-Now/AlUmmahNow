/**
 * /api/costs/* (COST-1): who may see and change what, keys sealed and never returned or audited,
 * connection tests on recorded API answers, editable alert settings driving the alert tick,
 * opt-in alert emails (once per subscriber, en and ar), the weekly digest's hour, the dashboard.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { openCostCredential, type CostCredentialRow } from '@al-ummah/shared-types';
import costsRouter from '../src/routers/costs.router';
import { envLines, productLines, runWeeklyDigest, testBunny, testCloudflare, testResend, topMovers, CF_API } from '../src/lib/costs';
import { localTime, processCostAlertMailJob, queueCostEmails, renderCostEmail } from '../src/lib/cost-alert-mail';
import { syncCostAlerts, type AlertSink, type ResourceDay } from '../src/lib/opsCost';
import { sqliteD1 } from './d1-sqlite';

const INTERNAL = 'qa-internal-api-key-0123456789';
const CF_TOKEN = 'cf-read-only-token-abcdefghijklmnopWXYZ';

function costsD1(): D1Database {
  const dir = join(process.cwd(), '..', 'cost-monitor', 'migrations');
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = db.prepare(sql);
    const p = args.map((a) => (a === undefined ? null : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...p), success: true, meta: { changes: 0 } };
    const r = stmt.run(...p);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  };
  const st = (sql: string, args: unknown[] = []) => ({
    bind: (...n: unknown[]) => st(sql, n),
    first: async <T>() => (exec(sql, args).results[0] as T) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
  });
  return { prepare: (sql: string) => st(sql), batch: async (list: { run: () => Promise<unknown> }[]) => { const out = []; for (const x of list) out.push(await x.run()); return out; } } as unknown as D1Database;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Cloudflare answers as recorded for a read-only token: verify, GraphQL, the six listings. */
function cloudflareFetch(opts: { analytics?: boolean; deny?: string[]; invalid?: boolean } = {}): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${CF_TOKEN}`);
    if (url.endsWith('/user/tokens/verify')) return opts.invalid ? json({ success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] }, 401) : json({ success: true, result: { id: 'tok', status: 'active' } });
    if (url.endsWith('/tokens/verify')) return json({ success: false }, 401);
    if (url === `${CF_API}/graphql`) {
      return opts.analytics === false
        ? json({ data: null, errors: [{ message: 'not authorized for that account', path: ['viewer', 'accounts'] }] })
        : json({ data: { viewer: { accounts: [{ w: [{ sum: { requests: 1234 } }] }] } }, errors: null });
    }
    for (const name of opts.deny ?? []) if (url.includes(`/${name === 'kv' ? 'storage/kv' : name === 'd1' ? 'd1' : name === 'workers' ? 'workers/scripts' : name === 'r2' ? 'r2' : name === 'queues' ? 'queues' : 'containers'}`)) return json({ success: false }, 403);
    return json({ success: true, result: [] });
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function setup(roles: string[], auth: Record<string, unknown> = {}) {
  const env = { COSTS_DB: costsD1(), REPORTS_DB: sqliteD1(), INTERNAL_API_KEY: INTERNAL, ENVIRONMENT: 'qa' };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles, email: 'owner@example.com', payload: { name: 'Owner' }, ...auth } as never);
    await next();
  });
  app.route('/api/costs', costsRouter);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  return { req, env };
}
const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { 'Content-Type': 'application/json' } });

describe('costs permissions', () => {
  it('moderators get nothing; admins see the dashboard but cannot set keys or settings', async () => {
    assert.equal((await setup(['Moderator']).req('/api/costs')).status, 403);
    const admin = setup(['Admin']);
    const res = await admin.req('/api/costs');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
    const body = (await res.json()) as { result: { canManage: boolean; connections: { set: boolean }[] } };
    assert.equal(body.result.canManage, false);
    assert.deepEqual(body.result.connections.map((c) => c.set), [false, false, false]);
    assert.equal((await admin.req('/api/costs/credentials/cloudflare', send('PUT', { value: CF_TOKEN }))).status, 403);
    assert.equal((await admin.req('/api/costs/settings', send('PUT', { budgetUsd: 100 }))).status, 403);
    assert.equal((await admin.req('/api/costs/credentials')).status, 403);
  });

  it('works with no data, no token and no budget set: budget is null and collector state is "unknown"', async () => {
    const res = await setup(['Super Admin']).req('/api/costs');
    const body = (await res.json()) as { result: { budget: { mtd: number; capUsd: number | null; share: number | null; projectedShare: number | null }; collector: { tokenSource: string } } };
    assert.equal(body.result.budget.capUsd, null);
    assert.equal(body.result.budget.share, null);
    assert.equal(body.result.budget.projectedShare, null);
    assert.equal(body.result.collector.tokenSource, 'unknown');
  });
});

describe('credentials', () => {
  it('a super admin sets a key: sealed at rest, tested, audited by last4 only, never returned', async () => {
    const { req, env } = setup(['Super Admin']);
    globalThis.fetch = cloudflareFetch();
    assert.equal((await req('/api/costs/credentials/cloudflare', send('PUT', { value: 'short' }))).status, 400);
    assert.equal((await req('/api/costs/credentials/stripe', send('PUT', { value: CF_TOKEN }))).status, 400);
    const res = await req('/api/costs/credentials/cloudflare', send('PUT', { value: CF_TOKEN }));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes(CF_TOKEN));
    const out = JSON.parse(text).result;
    assert.equal(out.view.last4, 'WXYZ');
    assert.equal(out.view.updatedByName, 'Owner');
    assert.equal(out.test.code, 'cf_ok');

    const row = (await env.COSTS_DB.prepare('SELECT * FROM cost_credentials').first<CostCredentialRow>())!;
    assert.ok(!row.ciphertext.includes('WXYZ'));
    assert.equal(await openCostCredential(row, { INTERNAL_API_KEY: INTERNAL }), CF_TOKEN);
    const log = (await env.REPORTS_DB.prepare("SELECT key, old_value, new_value, actor_id FROM site_settings_log WHERE key LIKE 'costs:%'").all<{ key: string; new_value: string; old_value: string; actor_id: string }>()).results;
    assert.equal(log.length, 1);
    assert.equal(log[0]!.key, 'costs:credential:cloudflare');
    assert.ok(!JSON.stringify(log).includes(CF_TOKEN));
    assert.equal(JSON.parse(log[0]!.new_value).last4, 'WXYZ');

    const dash = await (await req('/api/costs')).text();
    assert.ok(!dash.includes(CF_TOKEN));
    assert.equal(JSON.parse(dash).result.connections[0].last4, 'WXYZ');
  });

  it('Test checks the stored key again; Remove deletes it; both audited', async () => {
    const { req, env } = setup(['Super Admin']);
    assert.equal((await req('/api/costs/credentials/bunny/test', send('POST'))).status, 404);
    globalThis.fetch = (async () => json({ ThisMonthCharges: 3.2, Balance: 10 })) as typeof fetch;
    await req('/api/costs/credentials/bunny', send('PUT', { value: 'bunny-account-key-0123456789abcdef' }));
    globalThis.fetch = (async () => json({}, 401)) as typeof fetch;
    const t = (await (await req('/api/costs/credentials/bunny/test', send('POST'))).json()) as { result: { test: { ok: boolean; code: string }; view: { test: { ok: boolean } } } };
    assert.equal(t.result.test.code, 'bunny_invalid');
    assert.equal(t.result.view.test.ok, false);
    assert.equal((await req('/api/costs/credentials/bunny', send('DELETE'))).status, 200);
    assert.equal(await env.COSTS_DB.prepare('SELECT * FROM cost_credentials').first(), null);
    const actions = (await env.REPORTS_DB.prepare("SELECT new_value FROM site_settings_log WHERE key = 'costs:credential:bunny' ORDER BY created_at, rowid").all<{ new_value: string }>()).results.map((r) => JSON.parse(r.new_value).action);
    assert.deepEqual(actions, ['set', 'tested', 'removed']);
  });

  it('a rotated master secret shows the key as unreadable instead of failing', async () => {
    const { req, env } = setup(['Super Admin']);
    globalThis.fetch = cloudflareFetch();
    await req('/api/costs/credentials/cloudflare', send('PUT', { value: CF_TOKEN }));
    (env as { INTERNAL_API_KEY: string }).INTERNAL_API_KEY = 'rotated-internal-api-key-9876543210';
    const list = (await (await req('/api/costs/credentials')).json()) as { result: { unreadable?: boolean }[] };
    assert.equal(list.result[0]!.unreadable, true);
  });

  it('keeps the code and checks of a partial Cloudflare test; admins without ops:manage get them without the message', async () => {
    const { req, env } = setup(['Super Admin']);
    globalThis.fetch = cloudflareFetch({ deny: ['d1', 'queues'] });
    await req('/api/costs/credentials/cloudflare', send('PUT', { value: CF_TOKEN }));
    type View = { test: { ok: boolean; code: string; checks: { name: string; ok: boolean }[]; message: string } };
    const stored = ((await (await req('/api/costs/credentials')).json()) as { result: View[] }).result[0]!.test;
    assert.equal(stored.code, 'cf_partial');
    assert.deepEqual(stored.checks.filter((c) => !c.ok).map((c) => c.name), ['d1', 'queues']);
    assert.match(stored.message, /cannot list d1, queues/);
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId: 'admin-2', roles: ['Admin'], email: 'a@example.com', payload: {} } as never);
      await next();
    });
    app.route('/api/costs', costsRouter);
    const seen = ((await (await app.request('/api/costs', undefined, env as never)).json()) as { result: { connections: View[] } }).result.connections[0]!.test;
    assert.equal(seen.code, 'cf_partial');
    assert.equal(seen.checks.length, stored.checks.length);
    assert.equal(seen.message, '');
  });

  it('the budget meter uses the levels and the budget from the alert settings', async () => {
    const { req } = setup(['Super Admin']);
    assert.equal((await req('/api/costs/settings', send('PUT', { budgetUsd: 300, budgetLevels: [0.9, 0.6] }))).status, 200);
    const budget = ((await (await req('/api/costs')).json()) as { result: { budget: { capUsd: number; levels: number[] } } }).result.budget;
    assert.equal(budget.capUsd, 300);
    assert.deepEqual(budget.levels, [0.6, 0.9]);
  });
});

describe('connection tests (recorded answers)', () => {
  it('Cloudflare: ok, partial listing access, no analytics, invalid', async () => {
    assert.equal((await testCloudflare(CF_TOKEN, 'acc', cloudflareFetch())).code, 'cf_ok');
    const partial = await testCloudflare(CF_TOKEN, 'acc', cloudflareFetch({ deny: ['d1', 'queues'] }));
    assert.equal(partial.code, 'cf_partial');
    assert.equal(partial.ok, true);
    assert.match(partial.message, /d1, queues/);
    assert.equal((await testCloudflare(CF_TOKEN, 'acc', cloudflareFetch({ analytics: false }))).code, 'cf_no_analytics');
    assert.equal((await testCloudflare(CF_TOKEN, 'acc', cloudflareFetch({ invalid: true }))).code, 'cf_invalid');
  });

  it('Bunny needs the account key; Resend needs a full-access key', async () => {
    assert.equal((await testBunny('k', (async () => json({ ThisMonthCharges: 1 })) as typeof fetch)).code, 'bunny_ok');
    assert.equal((await testBunny('k', (async () => json({ VideoLibraryId: 1 })) as typeof fetch)).code, 'bunny_not_account');
    assert.equal((await testResend('re_x', (async () => json({ object: 'list', data: [] })) as typeof fetch)).code, 'resend_ok');
    const restricted = (async () => json({ statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails' }, 401)) as typeof fetch;
    assert.equal((await testResend('re_x', restricted)).code, 'resend_sending_only');
  });
});

describe('settings and alerts', () => {
  it('validates and audits settings changes', async () => {
    const { req, env } = setup(['Super Admin']);
    assert.equal((await req('/api/costs/settings', send('PUT', { budgetUsd: -1 }))).status, 400);
    assert.equal((await req('/api/costs/settings', send('PUT', { nope: 1 }))).status, 400);
    assert.equal((await req('/api/costs/settings', send('PUT', { budgetLevels: [3] }))).status, 400);
    const ok = (await (await req('/api/costs/settings', send('PUT', { budgetUsd: 300, budgetLevels: [0.9, 0.25], spikeFactor: 3 }))).json()) as { result: { budgetUsd: number; budgetLevels: number[] } };
    assert.equal(ok.result.budgetUsd, 300);
    assert.deepEqual(ok.result.budgetLevels, [0.25, 0.9]);
    const log = await env.REPORTS_DB.prepare("SELECT old_value, new_value FROM site_settings_log WHERE key = 'costs:settings'").first<{ old_value: string; new_value: string }>();
    assert.equal(JSON.parse(log!.old_value).budgetUsd, null);
    assert.equal(JSON.parse(log!.new_value).spikeFactor, 3);
    const cleared = (await (await req('/api/costs/settings', send('PUT', { budgetUsd: null }))).json()) as { result: { budgetUsd: number | null } };
    assert.equal(cleared.result.budgetUsd, null);
  });

  it('budget alerts stay quiet while the monthly budget is unset', async () => {
    const db = costsD1();
    const now = new Date('2026-11-14T15:00:00Z');
    await db.prepare("INSERT INTO ops_daily (day, resource_id, kind, env, name, cost_usd, updated_at) VALUES ('2026-11-10', 'worker:videos', 'worker', 'production', 'videos', 900, 'x')").run();
    const reported: unknown[] = [];
    const sink: AlertSink = { report: async (events) => void reported.push(...events), resolve: async () => undefined };
    const out = await syncCostAlerts({ COSTS_DB: db, ENVIRONMENT: 'production' } as never, sink, now);
    assert.equal(out.opened, 0);
    assert.deepEqual(reported, []);
  });

  it('the alert tick follows the settings and emails each new alert to its subscribers once', async () => {
    const db = costsD1();
    const now = new Date('2026-11-14T15:00:00Z');
    await db.prepare("INSERT INTO cost_settings (key, value, updated_at) VALUES ('alerts', ?, 'x')").bind(JSON.stringify({ budgetUsd: 50, budgetLevels: [0.5], projectedAlert: false })).run();
    await db.prepare("INSERT INTO ops_daily (day, resource_id, kind, env, name, cost_usd, updated_at) VALUES ('2026-11-10', 'worker:videos', 'worker', 'production', 'videos', 30, 'x')").run();
    for (const kind of ['budget', 'spike']) await db.prepare("INSERT INTO cost_alert_subscriptions (user_id, kind, email, locale, created_at) VALUES ('u1', ?, 'owner@example.com', 'ar', 'x')").bind(kind).run();
    const sent: unknown[] = [];
    const queueEnv = { COSTS_DB: db, CONTACT_MAIL_QUEUE: { sendBatch: async (m: unknown[]) => void sent.push(...m), send: async () => undefined } as never };
    const sink: AlertSink = { report: async () => undefined, resolve: async () => undefined };
    const notify = async (fresh: { kind: 'budget' | 'spike'; key: string; data: never }[]) => {
      for (const a of fresh) await queueCostEmails(queueEnv, a.kind, a.key, a.data, now);
    };
    const first = await syncCostAlerts({ COSTS_DB: db, ENVIRONMENT: 'production' } as never, sink, now, notify as never);
    assert.ok(first.opened >= 1);
    assert.equal(sent.length, 1, 'one email: the 50% level of a $50 budget');
    await syncCostAlerts({ COSTS_DB: db, ENVIRONMENT: 'production' } as never, sink, now, notify as never);
    assert.equal(sent.length, 1, 'already open: not emailed again');
    const row = await db.prepare('SELECT fingerprint, status, kind FROM cost_alert_deliveries').first<{ fingerprint: string; status: string; kind: string }>();
    assert.deepEqual({ ...row }, { fingerprint: 'ops-cost:budget:2026-11:50', status: 'queued', kind: 'budget' });
  });

  it('the mail job sends in the subscriber language, once; unsubscribed means skipped', async () => {
    const db = costsD1();
    const now = new Date('2026-11-14T15:00:00Z');
    await db.prepare("INSERT INTO cost_alert_subscriptions (user_id, kind, email, locale, created_at) VALUES ('u1', 'spike', 'owner@example.com', 'ar', 'x')").run();
    const queueEnv = { COSTS_DB: db, CONTACT_MAIL_QUEUE: { sendBatch: async () => undefined } as never };
    await queueCostEmails(queueEnv, 'spike', 'ops-cost:spike:qa:total', { type: 'spike', env: 'qa', name: 'qa total', resource: false, day: '2026-11-14', cost: 9.5, baseline: 1.25 }, now);
    const bodies: { subject: string; html: string; to: string[] }[] = [];
    globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json({ id: 'email-1' });
    }) as typeof fetch;
    const env = { COSTS_DB: db, REPORTS_DB: sqliteD1(), RESEND_API_KEY: 're_test_key_0123456789', ENVIRONMENT: 'qa', ADMIN_WEB_URL: 'https://admin.qa.alummahnow.net' };
    const msg = { id: 'm1', attempts: 1, body: { v: 1 as const, kind: 'cost-alert' as const, fingerprint: 'ops-cost:spike:qa:total', userId: 'u1' }, ack() {}, retry() {} };
    assert.equal(await processCostAlertMailJob(env as never, msg), 'done');
    assert.equal(await processCostAlertMailJob(env as never, msg), 'done');
    assert.equal(bodies.length, 1);
    assert.match(bodies[0]!.subject, /^\[qa\] التكاليف: قفزة في الإنفاق/);
    assert.match(bodies[0]!.html, /dir="rtl"/);
    assert.match(bodies[0]!.html, /https:\/\/admin\.qa\.alummahnow\.net\/costs/);
    assert.deepEqual(bodies[0]!.to, ['owner@example.com']);
  });

  it('renders every email kind in English too', () => {
    const base = { to: 'a@example.com', locale: 'en' as const, environment: 'production' };
    assert.equal(renderCostEmail({ ...base, payload: { type: 'budget', month: '2026-11', level: 0.8, mtd: 320, cap: 400, projected: 420 } }).subject, 'Costs: 80% of the monthly budget used');
    assert.equal(renderCostEmail({ ...base, payload: { type: 'projected', month: '2026-11', mtd: 200, cap: 400, projected: 640 } }).subject, 'Costs: projected to go over the monthly budget');
    const digest = renderCostEmail({ ...base, payload: { type: 'digest', week: '2026-11-16', mtd: 120, cap: 400, projected: 310, lastWeek: 50, weekBefore: 40, products: [{ product: 'bunny', mtd: 60 }], envs: { production: 80, qa: 10, stage: 0, account: 30 }, movers: [{ label: 'videos-qa', env: 'qa', change: 4.5 }], openAlerts: 1 } });
    assert.match(digest.text, /Bunny/);
    assert.match(digest.text, /\+\$4\.50/);
    assert.doesNotMatch(digest.text, /Stage/, 'zero environments are left out');
    const unsetDigest = renderCostEmail({ ...base, payload: { type: 'digest', week: '2026-11-16', mtd: 120, cap: null, projected: 310, lastWeek: 50, weekBefore: 40, products: [], envs: {}, movers: [], openAlerts: 0 } });
    assert.match(unsetDigest.text, /Not set/);
  });
});

describe('subscriptions and digest', () => {
  it('each admin subscribes only themselves, at their account address; no email, no subscription', async () => {
    const { req, env } = setup(['Admin']);
    assert.equal((await req('/api/costs/subscriptions/me', send('PUT', { kinds: ['nope'] }))).status, 400);
    const res = (await (await req('/api/costs/subscriptions/me', send('PUT', { kinds: ['digest', 'budget'], locale: 'ar', email: 'attacker@example.com' }))).json()) as { result: { kinds: string[]; email: string } };
    assert.deepEqual(res.result.kinds, ['budget', 'digest']);
    assert.equal(res.result.email, 'owner@example.com');
    const rows = (await env.COSTS_DB.prepare('SELECT user_id, email, locale FROM cost_alert_subscriptions').all<{ email: string }>()).results;
    assert.ok(rows.every((r) => r.email === 'owner@example.com'));
    await req('/api/costs/subscriptions/me', send('PUT', { kinds: [] }));
    assert.equal((await env.COSTS_DB.prepare('SELECT COUNT(*) AS n FROM cost_alert_subscriptions').first<{ n: number }>())!.n, 0);
    assert.equal((await setup(['Admin'], { email: undefined, payload: {} }).req('/api/costs/subscriptions/me', send('PUT', { kinds: ['spike'] }))).status, 400);
  });

  it("the digest goes out on the settings' weekday and hour in New York time, once", async () => {
    // 2026-11-16 is a Monday; 14:00 UTC = 09:00 EST
    assert.deepEqual(localTime(new Date('2026-11-16T14:00:00Z')), { weekday: 1, hour: 9, date: '2026-11-16' });
    const db = costsD1();
    await db.prepare("INSERT INTO cost_alert_subscriptions (user_id, kind, email, locale, created_at) VALUES ('u1', 'digest', 'owner@example.com', 'en', 'x')").run();
    const sent: unknown[] = [];
    const env = { COSTS_DB: db, REPORTS_DB: sqliteD1(), CONTACT_MAIL_QUEUE: { sendBatch: async (m: unknown[]) => void sent.push(...m) } };
    assert.equal(await runWeeklyDigest(env as never, new Date('2026-11-16T13:00:00Z')), 0);
    assert.equal(await runWeeklyDigest(env as never, new Date('2026-11-17T14:00:00Z')), 0);
    assert.equal(await runWeeklyDigest(env as never, new Date('2026-11-16T14:00:00Z')), 1);
    assert.equal(await runWeeklyDigest(env as never, new Date('2026-11-16T14:05:00Z')), 0);
    assert.equal(sent.length, 1);
    const payload = JSON.parse((await db.prepare('SELECT payload FROM cost_alert_deliveries').first<{ payload: string }>())!.payload);
    assert.equal(payload.type, 'digest');
    assert.equal(payload.cap, null);
  });
});

describe('dashboard maths', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const rows: ResourceDay[] = [];
  for (let n = 1; n <= 14; n++) {
    rows.push({ day: day(n), env: 'qa', resource_id: 'worker:al-ummah-web-qa', name: 'al-ummah-web-qa', kind: 'worker', cost: n <= 7 ? 3 : 1 });
    rows.push({ day: day(n), env: 'production', resource_id: 'd1:al-ummah-now-reports', name: 'al-ummah-now-reports', kind: 'd1', cost: n <= 7 ? 0.5 : 1 });
  }
  const extras = { bunny: [{ day: day(1), cost: 2 }], containers: [], ai: [{ day: day(2), cost: 0.25 }], resend: [] };

  it('products: month to date, projection and the two weeks compared, plus the plan', () => {
    const lines = productLines(rows, extras, now);
    const workers = lines.find((l) => l.product === 'workers')!;
    assert.equal(workers.last7, 21);
    assert.equal(workers.prev7, 7);
    assert.ok(lines.some((l) => l.product === 'plan'));
    assert.ok(lines.some((l) => l.product === 'bunny'));
  });

  it('movers rank the biggest increases and decreases', () => {
    const m = topMovers(rows, productLines(rows, extras, now), now);
    assert.equal(m.up[0]!.id, 'worker:al-ummah-web-qa');
    assert.equal(m.up[0]!.change, 14);
    assert.equal(m.up[0]!.monthlyImpact, 60);
    assert.equal(m.down[0]!.id, 'd1:al-ummah-now-reports');
  });

  it('environments: Cloudflare by env, account-wide costs and the plan under account', () => {
    const e = envLines(rows, [], { ...extras, sources: { containers: 'none' } }, now);
    assert.ok(e.qa! > e.production!);
    assert.ok(e.account! >= 2.25);
  });
});
