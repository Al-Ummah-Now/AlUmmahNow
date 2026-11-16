/**
 * Platform settings → Credentials (/api/platform-credentials): Super Admin only, write only (the
 * value is sealed, never returned or logged), audited, and the Cloudflare media token's test
 * reports which permissions are missing. Workers read the admin-set value before the binding.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  credentialMaster,
  forgetPlatformCredential,
  openPlatformCredential,
  platformCredentialKey,
  resolvePlatformCredential,
} from '@al-ummah/shared-types';
import platformCredentialsRouter from '../src/routers/platformCredentials.router';
import { testCloudflareMedia } from '../src/lib/platform-credentials';
import { sqliteD1 } from './d1-sqlite';
import { MemoryR2 } from './r2-fake';

const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789-_QZ';
const OTHER = 'Zyxwvutsrqponmlkjihgfedcba9876543210-_AB';
const MASTER = 'internal-api-key-for-tests-0123456789';

type Perms = { verify?: number; account?: boolean; zone?: boolean; purge?: boolean; status?: string };

/** A fake api.cloudflare.com: which permissions the token has. */
function cloudflare(perms: Perms = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname.endsWith('/tokens/verify')) {
      const status = perms.verify ?? 200;
      return json({ success: status === 200, result: { status: perms.status ?? 'active' } }, status);
    }
    if (url.pathname.endsWith('/graphql')) {
      const query = String(JSON.parse(String(init?.body)).query);
      const allowed = query.includes('zones') ? perms.zone !== false : perms.account !== false;
      return json(allowed ? { data: { viewer: {} }, errors: null } : { data: null, errors: [{ message: 'not authorized for that account' }] });
    }
    if (url.pathname.endsWith('/purge_cache')) return json({ success: perms.purge !== false }, perms.purge === false ? 403 : 200);
    return json({}, 404);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function setup(roles: string[], binding = 'binding-token-value-0000000000000000') {
  // Never the real api.cloudflare.com: a test that forgets its fake gets a refusal
  globalThis.fetch = (async () => new Response('{}', { status: 599 })) as typeof fetch;
  const env = { REPORTS_DB: sqliteD1(), global_settings: new MemoryR2(), INTERNAL_API_KEY: MASTER, CF_ANALYTICS_TOKEN: binding, CLOUDFLARE_ACCOUNT_ID: 'acct' };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'super-1', email: 'boss@example.com', roles, payload: { name: 'Super Admin' } } as never);
    await next();
  });
  app.route('/api/platform-credentials', platformCredentialsRouter);
  const req = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init, env as never);
    return { status: res.status, text: await res.clone().text(), body: (await res.json()) as any };
  };
  const audit = async () => (await env.REPORTS_DB.prepare('SELECT key, old_value, new_value, actor_id FROM site_settings_log ORDER BY created_at').all<any>()).results ?? [];
  return { env, req, audit };
}

const put = (json: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  forgetPlatformCredential();
});

describe('/api/platform-credentials', () => {
  it('is Super Admin only: admins and moderators are refused before anything is read or written', async () => {
    for (const roles of [['admin'], ['moderator'], []]) {
      const { req, audit, env } = setup(roles);
      assert.equal((await req('/api/platform-credentials')).status, 403);
      assert.equal((await req('/api/platform-credentials/cloudflare-media', put({ value: TOKEN }))).status, 403);
      assert.equal((await req('/api/platform-credentials/cloudflare-media/test', { method: 'POST' })).status, 403);
      assert.equal((await audit()).length, 0);
      assert.equal(env.global_settings.data.size, 0);
    }
  });

  it('lists the Cloudflare media token as read from the Secrets Store until it is replaced', async () => {
    const { req } = setup(['super_admin']);
    const res = await req('/api/platform-credentials');
    assert.equal(res.status, 200);
    const [view] = res.body.result;
    assert.equal(view.id, 'cloudflare-media');
    assert.equal(view.secretsStoreName, 'media-cdn-api-token');
    assert.equal(view.source, 'binding');
    assert.equal(view.present, true);
    assert.equal(view.last4, null, 'nothing about the Secrets Store value is shown');
    assert.deepEqual(view.usedBy.map((u: any) => u.binding).sort(), ['CF_ANALYTICS_TOKEN', 'MEDIA_ANALYTICS_TOKEN', 'MEDIA_CDN_API_TOKEN']);
    assert.doesNotMatch(res.text, /binding-token-value/);
  });

  it('replaces the token write-only: sealed, tested, audited without the value, and never sent back', async () => {
    const { req, audit, env } = setup(['super_admin']);
    const cf = cloudflare();
    globalThis.fetch = cf.fetchImpl;
    const res = await req('/api/platform-credentials/cloudflare-media', put({ value: `  ${TOKEN}  ` }));
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, new RegExp(TOKEN.slice(0, 20)));
    const { view, test } = res.body.result;
    assert.equal(view.source, 'admin');
    assert.equal(view.last4, TOKEN.slice(-4));
    assert.equal(view.updatedBy, 'super-1');
    assert.equal(view.updatedByName, 'Super Admin');
    assert.equal(test.ok, true);
    assert.equal(test.code, 'ok');
    assert.deepEqual(view.test.checks.map((c: any) => c.name), ['token', 'account_analytics', 'zone_analytics', 'cache_purge']);
    // Purge test hits a made-up URL only
    assert.ok(cf.calls.some((c) => c.endsWith('/purge_cache')));

    // Sealed: the stored file has no value, and opens only with the master under this id
    const raw = env.global_settings.data.get(platformCredentialKey('cloudflare-media'))!;
    assert.doesNotMatch(raw, new RegExp(TOKEN.slice(0, 20)));
    assert.equal(await openPlatformCredential('cloudflare-media', MASTER, JSON.parse(raw)), TOKEN);
    assert.equal(await openPlatformCredential('cloudflare-media', 'another-master-0123456789', JSON.parse(raw)), null);

    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, 'platform-credential:cloudflare-media');
    assert.deepEqual(JSON.parse(rows[0].old_value), { source: 'binding', present: true, last4: null });
    assert.deepEqual(JSON.parse(rows[0].new_value), { source: 'admin', present: true, last4: TOKEN.slice(-4), action: 'replaced' });
    assert.doesNotMatch(JSON.stringify(rows), new RegExp(TOKEN.slice(0, 20)));
  });

  it('Workers read the admin-set token before the Secrets Store binding (and the binding while none is set)', async () => {
    const { req, env } = setup(['super_admin']);
    assert.equal(await resolvePlatformCredential(env as never, 'cloudflare-media', 'from-binding'), 'from-binding');
    globalThis.fetch = cloudflare().fetchImpl;
    await req('/api/platform-credentials/cloudflare-media', put({ value: TOKEN }));
    forgetPlatformCredential();
    assert.equal(await resolvePlatformCredential(env as never, 'cloudflare-media', 'from-binding'), TOKEN);
    // A master rotated since: the file no longer opens, the binding is used, the page says set it again
    const rotated = { ...env, INTERNAL_API_KEY: 'rotated-master-0123456789abcdef' };
    forgetPlatformCredential();
    assert.equal(await resolvePlatformCredential(rotated as never, 'cloudflare-media', 'from-binding'), 'from-binding');
    assert.ok(await credentialMaster(rotated as never));
  });

  it('refuses a value that is not a Cloudflare token before writing or auditing anything', async () => {
    const { req, audit, env } = setup(['super_admin']);
    for (const value of ['short', 'has spaces in it but is long enough to pass', 42, null]) {
      const res = await req('/api/platform-credentials/cloudflare-media', put({ value }));
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'invalid_token');
    }
    assert.equal((await req('/api/platform-credentials/other', put({ value: TOKEN }))).status, 404);
    assert.equal((await audit()).length, 0);
    assert.equal(env.global_settings.data.size, 0);
  });

  it('Test checks the token in use and names each missing permission; the result is audited and kept', async () => {
    const { req, audit } = setup(['super_admin']);
    globalThis.fetch = cloudflare({ zone: false, purge: false }).fetchImpl;
    const res = await req('/api/platform-credentials/cloudflare-media/test', { method: 'POST' });
    assert.equal(res.status, 200);
    const { test, view } = res.body.result;
    assert.equal(test.ok, false);
    assert.equal(test.code, 'missing_permissions');
    assert.deepEqual(test.checks.filter((c: any) => !c.ok).map((c: any) => c.name), ['zone_analytics', 'cache_purge']);
    assert.equal(view.test.code, 'missing_permissions', 'the page shows the last test of the binding value');
    const [row] = await audit();
    assert.deepEqual(JSON.parse(row.new_value), { action: 'tested', source: 'binding', last4: null, ok: false, code: 'missing_permissions', missing: ['zone_analytics', 'cache_purge'] });
    // Replacing the token drops the old test from the view (it spoke for another value)
    globalThis.fetch = cloudflare().fetchImpl;
    await req('/api/platform-credentials/cloudflare-media', put({ value: OTHER }));
    const after = (await req('/api/platform-credentials')).body.result[0];
    assert.equal(after.test.code, 'ok');
  });

  it('Test with nothing set says so', async () => {
    const { req } = setup(['super_admin'], '');
    const res = await req('/api/platform-credentials/cloudflare-media/test', { method: 'POST' });
    assert.equal(res.body.result.test.code, 'none');
    assert.equal(res.body.result.view.present, false);
  });
});

describe('testCloudflareMedia', () => {
  it('a token Cloudflare refuses fails every check; an expired one is "inactive"', async () => {
    const refused = await testCloudflareMedia(TOKEN, 'acct', cloudflare({ verify: 401 }).fetchImpl);
    assert.equal(refused.code, 'invalid');
    assert.ok(refused.checks.every((c) => !c.ok));
    assert.equal((await testCloudflareMedia(TOKEN, 'acct', cloudflare({ status: 'expired' }).fetchImpl)).code, 'inactive');
  });

  it('account analytics missing is reported on its own', async () => {
    const r = await testCloudflareMedia(TOKEN, 'acct', cloudflare({ account: false }).fetchImpl);
    assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.name), ['account_analytics']);
  });
});
