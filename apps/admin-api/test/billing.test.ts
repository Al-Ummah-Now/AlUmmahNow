/**
 * Payments page API (wiki AUN-SUBS): billing:* permissions per role, audit rows
 * with the values they replace (dropped when api-videos refuses), credentials
 * written to Secrets Store and never to D1, the audit log or a response, and
 * the Errors page Retry of a payments job needing that job's own permission.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { hasContentPermission, paymentSecretName, type NeedsActionRetry } from '@al-ummah/shared-types';
import billingRouter from '../src/routers/billing.router';
import { retryPermissions } from '../src/lib/errors-actions';
import { UNSET_VALUE, writeCredential } from '../src/lib/billing-secrets';
import { STEP_UP_ROUTES } from '../src/middleware/step-up-routes';
import { sqliteD1 } from './d1-sqlite';

const SECRET_VALUE = 'pdl_sdbx_apikey_SYNTHETIC_0123456789';

interface Call { method: string; path: string; body: any; actor: string | null }

/** api-videos /internal/billing/*: canned answers per "METHOD path". */
function fakeVideos(routes: Record<string, (call: Call) => { status?: number; result?: unknown; code?: string }> = {}) {
  const calls: Call[] = [];
  const fetcher = {
    async fetch(input: string, init: RequestInit = {}) {
      const url = new URL(input);
      const headers = new Headers(init.headers);
      const call: Call = { method: init.method ?? 'GET', path: url.pathname, body: typeof init.body === 'string' ? JSON.parse(init.body) : null, actor: headers.get('X-Admin-Actor') };
      calls.push(call);
      const handler = routes[`${call.method} ${call.path.replace('/internal/billing', '')}`];
      const out = handler ? handler(call) : { status: 404, code: 'billing_not_found' };
      const status = out.status ?? 200;
      return new Response(JSON.stringify(status < 400 ? { success: true, result: out.result ?? {} } : { success: false, code: out.code, error: out.code }), { status, headers: { 'content-type': 'application/json' } });
    },
  };
  return { fetcher, calls };
}

/** Cloudflare's Secrets Store API, as the admin-api token sees it. */
const realFetch = globalThis.fetch;
function fakeCloudflare(existing: { id: string; name: string }[] = []) {
  const requests: { method: string; url: string; body: string | null; auth: string | null }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    requests.push({ method: init.method ?? 'GET', url, body: typeof init.body === 'string' ? init.body : null, auth: new Headers(init.headers).get('Authorization') });
    if ((init.method ?? 'GET') === 'GET') return Response.json({ success: true, result: existing });
    return Response.json({ success: true, result: { id: 'sec_new' } });
  }) as typeof fetch;
  return requests;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

const STORAGE = { CLOUDFLARE_ACCOUNT_ID: 'acct_1', PAYMENTS_SECRETS_STORE_ID: 'store_1', PAYMENTS_SECRETS_TOKEN: 'cf-token' };

function appFor(env: Record<string, unknown>) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles') ?? '';
    c.set('auth' as never, { userId: 'admin-1', roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  app.route('/api/billing', billingRouter as never);
  return (path: string, init: RequestInit & { roles: string; json?: unknown } = { roles: 'super_admin' }) => {
    const { roles, json, ...rest } = init;
    const headers: Record<string, string> = { 'x-test-roles': roles };
    if (json !== undefined) headers['content-type'] = 'application/json';
    return app.request(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body }, { INTERNAL_API_KEY: 'internal-key', ENVIRONMENT: 'qa', ...env });
  };
}

const auditRows = async (db: D1Database) =>
  ((await db.prepare(`SELECT key, old_value, new_value, actor_id FROM site_settings_log WHERE key LIKE 'content:%' ORDER BY created_at`).all()).results ?? []) as { key: string; old_value: string | null; new_value: string; actor_id: string }[];

describe('billing permissions', () => {
  it('admins read and manage; providers and refunds are super admin only; moderators see nothing', () => {
    for (const p of ['billing:read', 'billing:manage', 'billing:refund', 'billing:providers'] as const) assert.equal(hasContentPermission(['super_admin'], p), true, p);
    assert.equal(hasContentPermission(['admin'], 'billing:read'), true);
    assert.equal(hasContentPermission(['admin'], 'billing:manage'), true);
    assert.equal(hasContentPermission(['admin'], 'billing:refund'), false);
    assert.equal(hasContentPermission(['admin'], 'billing:providers'), false);
    assert.equal(hasContentPermission(['moderator'], 'billing:read'), false);
  });

  it('refuses before anything reaches api-videos, and writes no audit row', async () => {
    const db = sqliteD1();
    const { fetcher, calls } = fakeVideos();
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    assert.equal((await call('/api/billing/overview', { roles: 'moderator' })).status, 403);
    assert.equal((await call('/api/billing/payments/bpay_1/refund', { method: 'POST', roles: 'admin', json: { amount: null, reason: 'x' } })).status, 403);
    assert.equal((await call('/api/billing/providers/paddle', { method: 'PUT', roles: 'admin', json: { enabled: true } })).status, 403);
    assert.equal(calls.length, 0);
    assert.deepEqual(await auditRows(db), []);
  });
});

describe('billing changes are audited', () => {
  it('a provider change records the values it replaced', async () => {
    const db = sqliteD1();
    const { fetcher, calls } = fakeVideos({
      'PUT /providers/fake': () => ({ result: { previous: { enabled: false, mode: 'test', settings: {} }, provider: { id: 'fake', enabled: true } } }),
    });
    const res = await appFor({ REPORTS_DB: db, VIDEOS: fetcher })('/api/billing/providers/fake', { method: 'PUT', roles: 'super_admin', json: { enabled: true } });
    assert.equal(res.status, 200);
    assert.deepEqual(calls.map((c) => [c.method, c.path, c.actor]), [['PUT', '/internal/billing/providers/fake', 'admin-1']]);
    const [row] = await auditRows(db);
    assert.equal(row.key, 'content:billing-provider:fake');
    assert.deepEqual(JSON.parse(row.old_value!), { enabled: false, mode: 'test', settings: {} });
    assert.equal(JSON.parse(row.new_value).action, 'update');
  });

  it('drops the audit row when api-videos refuses', async () => {
    const db = sqliteD1();
    const { fetcher } = fakeVideos({ 'PUT /prices': () => ({ status: 400, code: 'invalid_billing_request' }) });
    const res = await appFor({ REPORTS_DB: db, VIDEOS: fetcher })('/api/billing/prices', { method: 'PUT', roles: 'admin', json: { tierId: 'creator', period: 'month', currency: 'USD', amount: -1 } });
    assert.equal(res.status, 400);
    assert.deepEqual(await auditRows(db), []);
  });

  it('an admin cancel and a super admin refund are audited with their details', async () => {
    const db = sqliteD1();
    const { fetcher } = fakeVideos({
      'POST /subscriptions/bsub_1/cancel': () => ({ result: { job: { id: 'j1' }, previous: { status: 'active', accessUntil: null } } }),
      'POST /payments/bpay_1/refund': () => ({ result: { job: { id: 'j2' } } }),
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    assert.equal((await call('/api/billing/subscriptions/bsub_1/cancel', { method: 'POST', roles: 'admin', json: { atPeriodEnd: false } })).status, 200);
    assert.equal((await call('/api/billing/payments/bpay_1/refund', { method: 'POST', roles: 'super_admin', json: { amount: 200, reason: 'duplicate charge' } })).status, 200);
    // Both rows can share a millisecond: order by key so the check never depends on the clock
    const rows = (await auditRows(db)).sort((a, b) => (a.key < b.key ? 1 : -1));
    assert.deepEqual(rows.map((r) => [r.key, JSON.parse(r.new_value).action]), [['content:billing-subscription:bsub_1', 'cancel-now'], ['content:billing-payment:bpay_1', 'refund']]);
    assert.deepEqual(JSON.parse(rows[0].old_value!), { status: 'active', accessUntil: null });
    assert.deepEqual(JSON.parse(rows[1].new_value).details, { amount: 200, reason: 'duplicate charge' });
  });
});

describe('credentials', () => {
  it('go to Secrets Store under the environment name; api-videos and the audit log only learn that one is set', async () => {
    const db = sqliteD1();
    const cf = fakeCloudflare();
    const { fetcher, calls } = fakeVideos({ 'POST /providers/paddle/credentials': () => ({ result: { provider: { id: 'paddle' } } }) });
    const res = await appFor({ REPORTS_DB: db, VIDEOS: fetcher, ...STORAGE })('/api/billing/providers/paddle/credentials', {
      method: 'PUT',
      roles: 'super_admin',
      json: { field: 'apiKey', mode: 'test', value: SECRET_VALUE },
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes(SECRET_VALUE), false, 'the value is never returned');
    assert.equal(JSON.parse(text).result.secretName, 'pay-paddle-api-key-test-qa');
    // GET (find by name), then POST (create) with scopes workers
    assert.deepEqual(cf.map((r) => r.method), ['GET', 'POST']);
    assert.match(cf[1].url, /\/accounts\/acct_1\/secrets_store\/stores\/store_1\/secrets$/);
    assert.deepEqual(JSON.parse(cf[1].body!), [{ name: 'pay-paddle-api-key-test-qa', value: SECRET_VALUE, scopes: ['workers'], comment: 'Payments credential, written from the videos admin (wiki AUN-SUBS)' }]);
    assert.equal(cf[1].auth, 'Bearer cf-token');
    assert.deepEqual(calls.map((c) => c.body), [{ field: 'apiKey', mode: 'test', cleared: false }]);
    const rows = await auditRows(db);
    assert.equal(rows.length, 1);
    assert.equal(JSON.stringify(rows).includes(SECRET_VALUE), false, 'the value is never audited');
    assert.equal(JSON.parse(rows[0].new_value).action, 'credential-set');
    const all = JSON.stringify((await db.prepare('SELECT * FROM site_settings_log').all()).results);
    assert.equal(all.includes(SECRET_VALUE), false);
  });

  it('an existing secret is updated in place; clearing writes "unset" rather than deleting it', async () => {
    const cf = fakeCloudflare([{ id: 'sec_9', name: 'pay-paygood-webhook-secret-live' }]);
    await writeCredential({ ...STORAGE, ENVIRONMENT: 'production' }, { provider: 'paygood', field: 'webhookSecret', mode: 'live', value: null });
    assert.deepEqual(cf.map((r) => r.method), ['GET', 'PATCH']);
    assert.match(cf[1].url, /\/secrets\/sec_9$/);
    assert.deepEqual(JSON.parse(cf[1].body!), { value: UNSET_VALUE });
  });

  it('names differ per environment so one store serves all of them', () => {
    assert.equal(paymentSecretName('paddle', 'apiKey', 'live', 'production'), 'pay-paddle-api-key-live');
    assert.equal(paymentSecretName('paddle', 'apiKey', 'live', 'stage'), 'pay-paddle-api-key-live-stage');
    assert.equal(paymentSecretName('paddle', 'webhookSecret', 'test', 'qa'), 'pay-paddle-webhook-secret-test-qa');
  });

  it('without the token the page says so and nothing is written', async () => {
    const db = sqliteD1();
    const cf = fakeCloudflare();
    const { fetcher, calls } = fakeVideos({ 'GET /overview': () => ({ result: { providers: [], tax: {}, prices: [], counts: { active: 0, pastDue: 0, failedEvents: 0 } } }) });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const overview = await (await call('/api/billing/overview', { roles: 'admin' })).json();
    assert.equal(overview.result.credentialStorage, false);
    const res = await call('/api/billing/providers/paddle/credentials', { method: 'PUT', roles: 'super_admin', json: { field: 'apiKey', mode: 'test', value: SECRET_VALUE } });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'credential_storage_unavailable');
    assert.equal(cf.length, 0);
    assert.equal(calls.filter((c) => c.path.includes('credentials')).length, 0);
    assert.deepEqual(await auditRows(db), []);
  });

  it('refuses values that are not keys, and the test provider', async () => {
    const call = appFor({ REPORTS_DB: sqliteD1(), VIDEOS: fakeVideos().fetcher, ...STORAGE });
    fakeCloudflare();
    for (const json of [{ field: 'apiKey', mode: 'test', value: '' }, { field: 'apiKey', mode: 'test', value: 'has space' }, { field: 'password', mode: 'test', value: 'x' }, { field: 'apiKey', mode: 'prod', value: 'x' }]) {
      assert.equal((await call('/api/billing/providers/paddle/credentials', { method: 'PUT', roles: 'super_admin', json })).status, 400, JSON.stringify(json));
    }
    assert.equal((await call('/api/billing/providers/fake/credentials', { method: 'PUT', roles: 'super_admin', json: { field: 'apiKey', mode: 'test', value: 'x' } })).status, 400);
    assert.equal((await call('/api/billing/providers/stripe', { method: 'PUT', roles: 'super_admin', json: {} })).status, 400);
  });
});

describe('step-up', () => {
  it('credentials, provider switches, refunds, cancels and comps need a recent sign-in', () => {
    const paths = STEP_UP_ROUTES.map((r) => `${r.method} ${r.path}`);
    for (const p of ['PUT /api/billing/providers/:id/credentials', 'PUT /api/billing/providers/:id', 'POST /api/billing/payments/:id/refund', 'POST /api/billing/subscriptions/:id/cancel', 'POST /api/billing/comps']) assert.ok(paths.includes(p), p);
  });
});

describe('Errors page Retry of a payments job', () => {
  const spec = (kind?: string): NeedsActionRetry => ({ kind: 'service', service: 'api-videos', path: '/internal/billing/jobs/retry', body: { jobId: 'j', ...(kind ? { kind } : {}) } });
  it('needs the action’s own permission', () => {
    assert.deepEqual(retryPermissions(spec('billing.refund')), ['billing:refund']);
    assert.deepEqual(retryPermissions(spec('billing.sync-prices')), ['billing:providers']);
    assert.deepEqual(retryPermissions(spec('billing.webhook')), ['billing:manage']);
    // No kind, or one that is not a billing job: every billing permission (deny by default)
    assert.deepEqual(retryPermissions(spec()), ['billing:read', 'billing:manage', 'billing:refund', 'billing:providers']);
    assert.deepEqual(retryPermissions(spec('user.erase')), ['billing:read', 'billing:manage', 'billing:refund', 'billing:providers']);
    assert.deepEqual(retryPermissions({ kind: 'service', service: 'api-videos', path: '/internal/captions/jobs/retry', body: {} }), []);
    assert.deepEqual(retryPermissions(null), []);
  });
});
