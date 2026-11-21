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
import { billedCloudflare, meterUsageOf, type MeterUsage } from '../src/lib/cfBilling';
import { CF_METERS, type CfMeterKey } from '@al-ummah/shared-types';
import { analyticsFromRun, costsDashboard } from '../src/lib/costs';
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
    // The budget counts Cloudflare as billed: 80M D1 rows written is $30 past the 50M included
    await db.prepare("INSERT INTO ops_daily (day, resource_id, kind, env, name, writes, cost_usd, updated_at) VALUES ('2026-11-10', 'd1:al-ummah-now-d1', 'd1', 'production', 'al-ummah-now-d1', 80000000, 80, 'x')").run();
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

describe('Cloudflare billed estimate (COST-GAPS)', () => {
  it('maps each kind to its billed meters, KV writes without the lists and deletes', () => {
    assert.deepEqual(meterUsageOf({ kind: 'kv', requests: 0, cpu_ms: null, reads: 10, writes: 9, kv_lists: 3, kv_deletes: 2, log_events: null, logpush_requests: null, gb_seconds: null, stored_bytes: 1024 ** 3 }), {
      kv_reads: 10, kv_writes: 4, kv_lists: 3, kv_deletes: 2, kv_storage_gb: 1,
    });
    assert.deepEqual(meterUsageOf({ kind: 'queue', requests: 5, cpu_ms: null, reads: 5, writes: 5, kv_lists: null, kv_deletes: null, log_events: null, logpush_requests: null, gb_seconds: null, stored_bytes: null }), { queues_operations: 15 });
  });

  it('applies the allowances once to the month, projects the days left and averages storage over the month', () => {
    const now = new Date('2026-11-21T00:00:00Z'); // 20 days elapsed, 10 left
    const days = new Map<string, MeterUsage>();
    for (let d = 1; d <= 20; d++) days.set(`2026-11-${String(d).padStart(2, '0')}`, { d1_rows_written: 5e6, r2_storage_gb: 30 });
    days.set('2026-10-31', { d1_rows_written: 100e6 }); // last month: not in the month so far
    const b = billedCloudflare(days, now);
    // 100M written − 50M included = $50; projected 150M − 50M = $100
    assert.equal(b.mtd.lines.find((l) => l.key === 'd1_rows_written')!.cost, 50);
    assert.equal(b.projected.lines.find((l) => l.key === 'd1_rows_written')!.cost, 100);
    // 30 GB for 20 of 30 days = 20 GB-months so far, 30 projected; first 10 included
    assert.equal(b.usage.mtd.r2_storage_gb, 20);
    assert.equal(b.usage.projected.r2_storage_gb, 30);
    assert.equal(b.mtd.total, 50 + 0.15);
    assert.ok(b.mtd.listTotal > b.mtd.total, 'list price ignores the included usage');
  });

  it('the dashboard counts Cloudflare as billed, lists the meters, the fixed costs, idle cost, drivers and the stacked trend', async () => {
    const db = costsD1();
    const now = new Date('2026-11-21T12:00:00Z');
    for (let d = 1; d <= 20; d++) {
      const day = `2026-11-${String(d).padStart(2, '0')}`;
      await db.prepare("INSERT INTO ops_daily (day, resource_id, kind, env, name, requests, cpu_ms, log_events, logpush_requests, cost_usd, updated_at) VALUES (?, 'worker:al-ummah-now-production', 'worker', 'production', 'al-ummah-now-production', 2000000, 60000000, 3400000, 2000000, 1.5, 'x')").bind(day).run();
    }
    await db.prepare("INSERT INTO cost_fixed_items (id, name, amount_usd, period, start_date, end_date, note, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Apple Developer', 99, 'yearly', '2026-01-01', NULL, NULL, 'x', 'x')").run();
    const d = await costsDashboard({ COSTS_DB: db, REPORTS_DB: sqliteD1() } as never, now);
    // 40M requests (−10M) $9, 1.2B CPU ms (−30M) $23.40, 68M log events (−20M) $28.80, 40M Logpush (−10M) $1.50
    assert.equal(d.cloudflare.billedMtd, 62.7);
    assert.equal(d.budget.parts.cloudflare.mtd, 62.7);
    assert.ok(d.cloudflare.listMtd > d.cloudflare.billedMtd);
    assert.deepEqual(d.cloudflare.lines.filter((l) => l.cost > 0).map((l) => l.key).sort(), ['logpush_requests', 'logs_events', 'workers_cpu_ms', 'workers_requests']);
    // Meters with no al-ummah source are listed so the page can say why they are $0
    assert.ok(d.cloudflare.lines.some((l) => l.key === 'browser_hours' && l.source === 'none'));
    assert.equal(d.fixed.projected, 8.25);
    assert.equal(d.budget.parts.fixed.projected, 8.25);
    assert.ok(d.products.some((p) => p.product === 'fixed'));
    assert.equal(d.idle.parts.fixed, 8.25);
    assert.equal(d.drivers[0]!.id, 'worker:al-ummah-now-production');
    assert.deepEqual(d.trend.series.map((x) => x.key), ['production', 'stage', 'qa', 'bunny', 'containers', 'ai', 'resend', 'plan', 'fixed']);
    // Today (12:00 UTC) carries half its $0.28 daily share, so the month's days sum to its month to date
    assert.equal(d.trend.series.find((x) => x.key === 'fixed')!.values.at(-2), 0.28);
    assert.equal(d.trend.series.find((x) => x.key === 'fixed')!.values.at(-1), 0.14);
  });
});

describe('fixed and other costs (COST-GAPS)', () => {
  it('super admins add, change and remove them, each audited; admins only read; bad input refused', async () => {
    const admin = setup(['Admin']);
    assert.equal((await admin.req('/api/costs/fixed', send('POST', { name: 'Linear', amountUsd: 10, period: 'monthly', startDate: '2026-11-01' }))).status, 403);
    const { req, env } = setup(['Super Admin']);
    const bad = await req('/api/costs/fixed', send('POST', { name: 'Linear', amountUsd: -1, period: 'monthly', startDate: '2026-11-01' }));
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { field: string }).field, 'amountUsd');
    const made = await req('/api/costs/fixed', send('POST', { name: 'Apple Developer', amountUsd: 99, period: 'yearly', startDate: '2026-01-10', note: 'App Store' }));
    assert.equal(made.status, 201);
    const item = ((await made.json()) as { result: { id: string; amountUsd: number } }).result;
    assert.equal(item.amountUsd, 99);
    const changed = await req(`/api/costs/fixed/${item.id}`, send('PUT', { name: 'Apple Developer Program', amountUsd: 99, period: 'yearly', startDate: '2026-01-10', endDate: '2027-01-09' }));
    assert.equal(changed.status, 200);
    assert.equal((await admin.req('/api/costs/fixed')).status, 200, 'admins may read the list');
    const list = ((await (await req('/api/costs/fixed')).json()) as { result: { name: string; endDate: string | null }[] }).result;
    assert.deepEqual(list.map((x) => [x.name, x.endDate]), [['Apple Developer Program', '2027-01-09']]);
    assert.equal((await req(`/api/costs/fixed/${item.id}`, send('DELETE'))).status, 200);
    assert.equal((await req(`/api/costs/fixed/${item.id}`, send('DELETE'))).status, 404);
    const audits = (await env.REPORTS_DB.prepare('SELECT key, old_value, new_value FROM site_settings_log ORDER BY rowid').all<{ key: string; old_value: string | null; new_value: string | null }>()).results ?? [];
    assert.deepEqual(audits.map((a) => [a.key, a.old_value === null, a.new_value]).map(([k, o, n], i) => [k, o, i === 2 ? n : typeof n]), [
      [`costs:fixed:${item.id}`, true, 'string'],
      [`costs:fixed:${item.id}`, false, 'string'],
      [`costs:fixed:${item.id}`, false, '{"removed":true}'],
    ]);
  });
});

describe('a token Cloudflare refuses (no Account Analytics Read)', () => {
  const run = (status: string, detail: unknown) => ({ status, detail: JSON.stringify(detail), finished_at: '2026-11-21T10:05:00Z' });

  it('reads the hourly run: refused on 401/403, code 10000 or "not authorized"; ok and other failures are not', () => {
    assert.equal(analyticsFromRun(run('failed', { error: 'Cloudflare GraphQL returned no data: not authorized for that account' })).state, 'refused');
    assert.equal(analyticsFromRun(run('failed', { error: 'Cloudflare GraphQL answered HTTP 401' })).state, 'refused');
    assert.equal(analyticsFromRun(run('partial', { errors: ['Authentication error (10000)'] })).state, 'refused');
    assert.deepEqual(analyticsFromRun(run('ok', {})), { state: 'ok', at: '2026-11-21T10:05:00Z', via: 'run' });
    assert.equal(analyticsFromRun(run('failed', { error: 'collector is not configured (account id or COLLECT_ENVS missing)' })).state, 'unknown');
    assert.equal(analyticsFromRun(run('partial', { errors: ['dataset is not available'] })).state, 'unknown');
    assert.equal(analyticsFromRun(null).state, 'unknown');
  });

  it('the dashboard says so, and a super admin\'s "Check again" queues an hourly collection (admins may not)', async () => {
    const { req, env } = setup(['Super Admin']);
    await env.COSTS_DB.prepare("INSERT INTO collector_runs (id, kind, started_at, finished_at, status, detail) VALUES ('r1', 'hourly', '2026-11-21T10:00:00Z', '2026-11-21T10:05:00Z', 'failed', ?)")
      .bind(JSON.stringify({ token: 'release', error: 'Cloudflare GraphQL returned no data: not authorized for that account' }))
      .run();
    const body = (await (await req('/api/costs')).json()) as { result: { collector: { analytics: { state: string; via: string } } } };
    assert.deepEqual(body.result.collector.analytics, { state: 'refused', at: '2026-11-21T10:05:00Z', via: 'run' });

    const sent: unknown[] = [];
    (env as Record<string, unknown>).COST_JOBS_QUEUE = { send: async (b: unknown) => void sent.push(b) };
    const res = await req('/api/costs/collector/check', send('POST'));
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { result: unknown }).result, { queued: true, tested: false });
    assert.equal(sent.length, 1);
    assert.equal((sent[0] as { job: string; v: number }).job, 'hourly');

    const admin = setup(['Admin']);
    assert.equal((await admin.req('/api/costs/collector/check', send('POST'))).status, 403);
    // No queue and no token: nothing to run
    assert.equal((await setup(['Super Admin']).req('/api/costs/collector/check', send('POST'))).status, 503);
  });
});

/**
 * AUDIT-2 (2026-11-21): every tile on /costs is the sum of the rows it summarises. A month of
 * several resources in every env (each row priced at list from its own meters, as the collector
 * does), with fixed costs, through costsDashboard; then each total against its rows.
 */
describe('every Costs tile equals the sum of its rows', () => {
  it('Cloudflare, budget, products, envs, trend, fixed and idle all reconcile', async () => {
    const db = costsD1();
    const now = new Date('2026-11-21T12:00:00Z');
    const RES = [
      { id: 'worker:al-ummah-now-production', kind: 'worker', env: 'production', m: { requests: 1.8e6, cpu_ms: 4e7, log_events: 3e6, logpush_requests: 1.8e6 } },
      { id: 'worker:al-ummah-now-stage', kind: 'worker', env: 'stage', m: { requests: 4e4, cpu_ms: 6e5, log_events: 5e4 } },
      { id: 'd1:al-ummah-now-reports', kind: 'd1', env: 'production', m: { reads: 2e8, writes: 1.9e6 } },
      { id: 'd1:al-ummah-now-reports-qa', kind: 'd1', env: 'qa', m: { reads: 3e7, writes: 4e5 } },
      { id: 'r2:al-ummah-now-videos', kind: 'r2', env: 'production', m: { reads: 9e5, writes: 4e4 } },
      { id: 'kv:al-ummah-now-analytics-kv', kind: 'kv', env: 'production', m: { reads: 6e5, writes: 2e4, kv_lists: 1e3, kv_deletes: 500 } },
      { id: 'queue:al-ummah-now-videos', kind: 'queue', env: 'production', m: { writes: 5e5 } },
    ] as const;
    for (let d = 1; d <= 21; d++) {
      const day = `2026-11-${String(d).padStart(2, '0')}`;
      // QA storm on the 7th to 12th, like November's
      const storm = d >= 7 && d <= 12 ? 8 : 1;
      for (const r of RES) {
        const k = r.env === 'qa' ? storm : 1;
        const m: Record<string, number> = Object.fromEntries(Object.entries(r.m).map(([key, v]) => [key, v * k * (d === 21 ? 0.5 : 1)]));
        // List price, unrounded, as the collector prices a resource-day
        const cost = Object.entries(meterUsageOf({ kind: r.kind, ...m } as never)).reduce((acc, [key, used]) => acc + ((used ?? 0) / CF_METERS[key as CfMeterKey].unit) * CF_METERS[key as CfMeterKey].price, 0);
        const cols = Object.keys(m);
        await db
          .prepare(`INSERT INTO ops_daily (day, resource_id, kind, env, name, ${cols.join(', ')}, cost_usd, updated_at) VALUES (?, ?, ?, ?, ?, ${cols.map(() => '?').join(', ')}, ?, 'x')`)
          .bind(day, r.id, r.kind, r.env, r.id.split(':')[1], ...cols.map((c) => m[c]), cost)
          .run();
      }
    }
    for (const [i, [name, amount, period, start, end]] of ([['Apple Developer', 99, 'yearly', '2026-03-01', null], ['Linear', 10, 'monthly', '2026-06-01', null], ['ElevenLabs', 22, 'monthly', '2026-08-15', '2026-12-14']] as const).entries()) {
      await db.prepare('INSERT INTO cost_fixed_items (id, name, amount_usd, period, start_date, end_date, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, \'x\', \'x\')').bind(`00000000-0000-4000-8000-00000000000${i}`, name, amount, period, start, end).run();
    }
    const d = await costsDashboard({ COSTS_DB: db, REPORTS_DB: sqliteD1() } as never, now);
    const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(2)} vs ${b.toFixed(2)}`);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const L = d.cloudflare.lines;
    assert.ok(d.cloudflare.billedMtd > 0 && d.cloudflare.listMtd > d.cloudflare.billedMtd, 'a month with billed usage past the allowance');

    near(sum(L.map((l) => l.cost)), d.cloudflare.billedMtd, 0.015, 'Cloudflare billed lines = Billed so far');
    near(sum(L.map((l) => l.listCost)), d.cloudflare.listMtd, 0.06, 'Cloudflare list lines = At list price');
    near(sum(L.map((l) => l.projectedCost)), d.cloudflare.billedProjected, 0.015, 'Cloudflare month-end lines = Billed by month end');
    const parts = Object.values(d.budget.parts);
    near(sum(parts.map((p) => p.mtd)), d.budget.mtd, 0.015, 'Where it goes (so far) = budget month to date');
    near(sum(parts.map((p) => p.projected)), d.budget.projected, 0.015, 'Where it goes (month end) = forecast');
    near(d.budget.parts.cloudflare.mtd, d.cloudflare.billedMtd, 0.015, 'budget Cloudflare part = Billed so far');
    near(d.forecast.trailing, d.budget.projected, 0.015, 'forecast = budget projection');

    const product = (k: string) => d.products.find((p) => p.product === k)?.mtd ?? 0;
    const lineList = (keys: string[]) => sum(L.filter((l) => keys.includes(l.key)).map((l) => l.listCost));
    near(product('d1'), lineList(['d1_rows_read', 'd1_rows_written', 'd1_storage_gb']), 0.03, 'By product D1 = its Cloudflare lines');
    near(product('workers'), lineList(['workers_requests', 'workers_cpu_ms', 'logs_events', 'logpush_requests']), 0.03, 'By product Workers = its lines');
    const cfProducts = sum(['d1', 'workers', 'r2', 'kv', 'durable_objects', 'queues'].map(product));
    near(cfProducts, d.cloudflare.listMtd, 0.06, 'Cloudflare products = At list price');
    const productsTotal = sum(d.products.map((p) => p.mtd));
    near(productsTotal, d.budget.mtd + (d.cloudflare.listMtd - d.cloudflare.billedMtd), 0.06, 'products at list − included usage = billed month to date');
    near(sum(Object.values(d.envs)), productsTotal, 0.03, 'By environment = By product');
    near(d.envs.qa, sum(d.trend.series.find((s) => s.key === 'qa')!.values.filter((_, i) => d.trend.days[i]!.startsWith('2026-11'))), 0.03, 'QA tile = QA bars this month');
    const trendMonth = sum(d.trend.series.flatMap((s) => s.values.filter((_, i) => d.trend.days[i]!.startsWith('2026-11'))));
    near(trendMonth, productsTotal, 0.2, 'daily chart this month = By product (per-day cents)');

    near(d.budget.parts.fixed.projected, d.fixed.projected, 0.015, 'fixed part = fixed month end');
    // Apple $99/yr, Linear $10, ElevenLabs $22 (active Aug 15 – Dec 14, so all of November)
    near(d.fixed.projected, 99 / 12 + 10 + 22, 0.015, 'fixed month end = its list');
    near(d.fixed.mtd, (99 / 12 + 10 + 22) * (20.5 / 30), 0.015, 'fixed so far = the elapsed share of the list');
    near(sum(Object.values(d.idle.parts)), d.idle.monthlyUsd, 0.015, 'idle parts = idle');
    near(sum(Object.values(d.idle.byEnv)), d.idle.parts.cloudflare, 0.03, 'idle per env = idle Cloudflare');
    assert.ok(d.idle.monthlyUsd <= d.budget.projected, 'idle never exceeds the month-end forecast');
  });
});
