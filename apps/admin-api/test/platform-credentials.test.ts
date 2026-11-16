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
      return json({ success: status === 200, result: { id: 'tok-1', status: perms.status ?? 'active' } }, status);
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
    assert.deepEqual(JSON.parse(rows[0].new_value), { action: 'replaced', last4: TOKEN.slice(-4) });
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

// ---------------------------------------------------------------------------
// Create / Rotate with the token manager
// ---------------------------------------------------------------------------

const MANAGER = 'Manager0123456789abcdefghijklmnopqrstuv';
const HAND_MADE = 'HandMade0123456789abcdefghijklmnopqrstu';

/** A fake Cloudflare account: tokens (by value), permission groups, and a Secrets Store the Workers read. */
function account(opts: { managerGroups?: string[]; failMintedTest?: boolean; storeRefuses?: boolean } = {}) {
  const store = new Map<string, string>([['media-cdn-api-token', HAND_MADE], ['cloudflare-token-manager', MANAGER]]);
  const tokens = new Map<string, { id: string; name: string }>([
    [MANAGER, { id: 'tok-manager', name: 'hand-made manager' }],
    [HAND_MADE, { id: 'tok-hand', name: 'CI deploy token' }],
  ]);
  const deleted: string[] = [];
  const minted: { name: string; policies: any[] }[] = [];
  const binding = (name: string) => ({ get: async () => store.get(name) ?? '' });
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const token = String((init?.headers as Record<string, string>)?.Authorization ?? '').replace('Bearer ', '');
    const json = (result: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, result }), { status });
    const me = tokens.get(token);
    const p = url.pathname.replace('/client/v4', '');
    if (p.endsWith('/tokens/verify')) return me && !deleted.includes(me.id) ? json({ id: me.id, status: 'active' }) : json(null, 401);
    if (!me || deleted.includes(me.id)) return json(null, 401);
    const isManager = me.id === 'tok-manager';
    if (p.endsWith('/tokens/permission_groups')) return isManager ? json([
      { id: 'g-acct', name: 'Account Analytics Read', scopes: ['com.cloudflare.api.account'] },
      { id: 'g-zone', name: 'Analytics Read', scopes: ['com.cloudflare.api.account.zone'] },
      { id: 'g-purge', name: 'Cache Purge', scopes: ['com.cloudflare.api.account.zone'] },
    ]) : json(null, 403);
    const tok = /\/accounts\/acct\/tokens(?:\/([^/]+))?$/.exec(p);
    if (tok) {
      if (!isManager) return json(null, 403);
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body));
        const value = `Minted${minted.length}abcdefghijklmnopqrstuvwxyz0123`;
        minted.push(body);
        tokens.set(value, { id: `tok-minted-${minted.length}`, name: body.name });
        return json({ id: `tok-minted-${minted.length}`, value });
      }
      if (method === 'DELETE') { deleted.push(tok[1]!); return json({ id: tok[1] }); }
      const found = [...tokens.values()].find((t) => t.id === tok[1]);
      if (tok[1] === 'tok-manager') return json({ id: 'tok-manager', name: found?.name, policies: [{ effect: 'allow', permission_groups: (opts.managerGroups ?? ['API Tokens Write', 'Account Secrets Store Write']).map((name) => ({ name })) }] });
      return found ? json({ id: found.id, name: found.name }) : json(null, 404);
    }
    const secrets = /\/secrets_store\/stores\/[^/]+\/secrets(?:\/([^/]+))?$/.exec(p);
    if (secrets) {
      if (!isManager || opts.storeRefuses) return json(null, 403);
      if (method === 'GET') return json([{ id: `s-${url.searchParams.get('search')}`, name: url.searchParams.get('search') }]);
      store.set(secrets[1]!.replace(/^s-/, ''), JSON.parse(String(init?.body)).value);
      return json({ id: secrets[1] });
    }
    // The media checks: everything allowed, unless the minted token is meant to fail
    const failing = opts.failMintedTest && me.id.startsWith('tok-minted');
    if (p.endsWith('/graphql')) return new Response(JSON.stringify(failing ? { data: null, errors: [{ message: 'no' }] } : { data: { viewer: {} }, errors: null }));
    if (p.endsWith('/purge_cache')) return json({}, failing ? 403 : 200);
    return json(null, 404);
  }) as typeof fetch;
  return { store, tokens, deleted, minted, binding, fetchImpl };
}

function mintSetup(cfAccount: ReturnType<typeof account>) {
  const t = setup(['super_admin']);
  Object.assign(t.env, { CF_ANALYTICS_TOKEN: cfAccount.binding('media-cdn-api-token'), CF_TOKEN_MANAGER: cfAccount.binding('cloudflare-token-manager') });
  globalThis.fetch = cfAccount.fetchImpl;
  return t;
}

describe('Create / Rotate with the token manager', () => {
  it('mints a token with exactly the media permissions, stores it in the Secrets Store, and keeps a hand-made previous token', async () => {
    const cfAccount = account();
    const { req, audit } = mintSetup(cfAccount);
    const list = (await req('/api/platform-credentials')).body.result;
    assert.equal(list.find((v: any) => v.id === 'cloudflare-media').canMint, true);
    const res = await req('/api/platform-credentials/cloudflare-media/create', { method: 'POST' });
    assert.equal(res.status, 200, res.text);
    const { view, test, previousRevoked, previousKept } = res.body.result;
    assert.equal(test.ok, true);
    assert.equal(previousRevoked, false);
    assert.equal(previousKept, 'not_minted_here', 'the CI deploy token is never revoked');
    assert.deepEqual(cfAccount.deleted, []);
    // Exactly the needed groups, on our account and our zone only
    const [{ policies, name }] = cfAccount.minted;
    assert.match(name, /^al-ummah-now admin-minted cloudflare-media /);
    assert.deepEqual(policies.map((p: any) => [Object.keys(p.resources)[0], p.permission_groups.map((g: any) => g.id)]), [
      ['com.cloudflare.api.account.acct', ['g-acct']],
      ['com.cloudflare.api.account.zone.fada86a0f215bda23dbe19de7226b49f', ['g-zone', 'g-purge']],
    ]);
    // In the Secrets Store, where every Worker reads it; the page says so without the value
    assert.match(cfAccount.store.get('media-cdn-api-token')!, /^Minted0/);
    assert.equal(view.source, 'binding');
    assert.equal(view.minted.tokenId, 'tok-minted-1');
    assert.equal(view.test.code, 'ok');
    assert.doesNotMatch(res.text, /Minted0abc/);
    const rows = (await audit()).map((r: any) => JSON.parse(r.new_value));
    assert.deepEqual(rows.map((r: any) => r.action), ['rotated', 'previous_token']);
    assert.doesNotMatch(JSON.stringify(rows), /Minted0abc/);
  });

  it('a second Rotate revokes the token minted here before', async () => {
    const cfAccount = account();
    const { req } = mintSetup(cfAccount);
    await req('/api/platform-credentials/cloudflare-media/create', { method: 'POST' });
    const res = await req('/api/platform-credentials/cloudflare-media/create', { method: 'POST' });
    assert.equal(res.body.result.previousRevoked, true);
    assert.deepEqual(cfAccount.deleted, ['tok-minted-1']);
    assert.match(cfAccount.store.get('media-cdn-api-token')!, /^Minted1/);
  });

  it('a new token that fails the test is deleted and nothing changes', async () => {
    const cfAccount = account({ failMintedTest: true });
    const { req, audit } = mintSetup(cfAccount);
    const t0 = Date.now();
    const res = await req('/api/platform-credentials/cloudflare-media/create', { method: 'POST' });
    assert.ok(Date.now() - t0 < 30_000);
    assert.equal(res.status, 502);
    assert.equal(res.body.code, 'minted_token_failed');
    assert.deepEqual(cfAccount.deleted, ['tok-minted-1']);
    assert.equal(cfAccount.store.get('media-cdn-api-token'), HAND_MADE);
    assert.equal((await audit()).length, 0);
  });

  it('a Secrets Store refusal deletes the new token and leaves no audit row', async () => {
    const cfAccount = account({ storeRefuses: true });
    const { req, audit } = mintSetup(cfAccount);
    const res = await req('/api/platform-credentials/cloudflare-media/create', { method: 'POST' });
    assert.equal(res.status, 502);
    assert.equal(res.body.code, 'store_refused');
    assert.deepEqual(cfAccount.deleted, ['tok-minted-1']);
    assert.equal((await audit()).length, 0);
  });

  it('without a token manager (or with the placeholder) Create is refused and not offered', async () => {
    const cfAccount = account();
    const { req, env } = mintSetup(cfAccount);
    Object.assign(env, { CF_TOKEN_MANAGER: 'unset' });
    const media = (await req('/api/platform-credentials')).body.result.find((v: any) => v.id === 'cloudflare-media');
    assert.equal(media.canMint, false);
    const manager = (await req('/api/platform-credentials')).body.result.find((v: any) => v.id === 'cloudflare-token-manager');
    assert.equal(manager.present, false, 'the placeholder is not a token');
    const res = await req('/api/platform-credentials/cloudflare-media/create', { method: 'POST' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'no_manager');
    assert.equal((await req('/api/platform-credentials/cloudflare-token-manager/create', { method: 'POST' })).body.code, 'not_mintable');
  });

  it('the token manager test reads its own permissions and names a missing one', async () => {
    const cfAccount = account({ managerGroups: ['API Tokens Write'] });
    const { req } = mintSetup(cfAccount);
    const res = await req('/api/platform-credentials/cloudflare-token-manager/test', { method: 'POST' });
    const { test } = res.body.result;
    assert.equal(test.code, 'missing_permissions');
    assert.deepEqual(test.checks, [{ name: 'token', ok: true }, { name: 'mint_tokens', ok: true }, { name: 'secrets_store', ok: false }]);
  });

  it('with a token manager, a pasted token goes into the Secrets Store too', async () => {
    const cfAccount = account();
    const { req, env } = mintSetup(cfAccount);
    const res = await req('/api/platform-credentials/cloudflare-media', put({ value: TOKEN }));
    assert.equal(res.status, 200, res.text);
    assert.equal(cfAccount.store.get('media-cdn-api-token'), TOKEN);
    assert.equal(env.global_settings.data.has('credentials/cloudflare-media.json'), false, 'nothing sealed');
  });
});
