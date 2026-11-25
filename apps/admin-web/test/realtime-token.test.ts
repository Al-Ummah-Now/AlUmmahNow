/** GET /api/realtime/token (lib/live/realtime-token.ts): who gets a ticket, and what happens to the session. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { handleRealtimeToken } from '../src/lib/live/realtime-token';
import { SESSION_COOKIE_NAME, parseSessionCookie } from '../src/lib/session-cookie';
import type { VerifiedRefresh } from '../src/lib/verified-refresh';
import type { PanelRole } from '../src/lib/roles';

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt = (ttl: number) => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'ES256' })}.${b64url({ mode: 'access', iat: now, exp: now + ttl })}.sig`;
};
const NEW = jwt(900);
const refreshedAs = (role: PanelRole): VerifiedRefresh => ({ kind: 'refreshed', tokens: { accessToken: NEW, refreshToken: 'r1' }, role });

async function run(opts: { ttl: number; valid?: boolean; role?: string; result?: VerifiedRefresh; site?: string; issuer?: string; cookies?: Record<string, string> }) {
  const accessToken = jwt(opts.ttl);
  const valid = opts.valid ?? opts.ttl > 0;
  const cookies = opts.cookies ?? { [SESSION_COOKIE_NAME]: JSON.stringify({ accessToken, refreshToken: 'r0' }) };
  const request = new NextRequest('https://admin.test/api/realtime/token', {
    headers: { 'sec-fetch-site': opts.site ?? 'same-origin', cookie: Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') },
  });
  const spent: string[] = [];
  const res = await handleRealtimeToken(request, {
    state: async () => (valid ? { session: { user: { role: opts.role ?? 'admin' }, accessToken }, expired: false } : { session: null, expired: Object.keys(cookies).length > 0 }),
    issuer: 'issuer' in opts ? opts.issuer : 'https://auth.test',
    refresh: async (_issuer, token) => {
      spent.push(token);
      return opts.result ?? refreshedAs('admin');
    },
  });
  const set = res.cookies.get(SESSION_COOKIE_NAME)?.value;
  assert.equal(res.headers.get('cache-control'), 'no-store');
  return { status: res.status, token: ((await res.json()) as { token?: string }).token, old: accessToken, spent, stored: set ? parseSessionCookie(set) : null, cleared: set === '', all: res.headers.getSetCookie() };
}

describe('GET /api/realtime/token', () => {
  it('a token with minutes left is handed out as it is', async () => {
    const r = await run({ ttl: 600 });
    assert.deepEqual([r.status, r.token, r.spent, r.all], [200, r.old, [], []]);
  });

  it('a token in its last two minutes, or past them, is refreshed and the new pair stored', async () => {
    for (const ttl of [60, -60]) {
      const r = await run({ ttl });
      assert.deepEqual([r.status, r.token, r.spent], [200, NEW, ['r0']], String(ttl));
      assert.deepEqual(r.stored, { accessToken: NEW, refreshToken: 'r1' });
    }
  });

  it('a refused refresh is 401 and ends the session, also while the old token is valid', async () => {
    for (const ttl of [60, -60]) {
      const r = await run({ ttl, result: { kind: 'invalid_grant' } });
      assert.deepEqual([r.status, r.token, r.cleared], [401, undefined, true], String(ttl));
      assert.equal(r.all.filter((c) => /^(admin_session|access_token|refresh_token)=;/.test(c)).length, 3);
    }
  });

  it('only a refresh that failed for now falls back to the valid token, and keeps the session', async () => {
    const valid = await run({ ttl: 60, result: { kind: 'transient', reason: 'HTTP 503' } });
    assert.deepEqual([valid.status, valid.token, valid.all], [200, valid.old, []]);
    const expired = await run({ ttl: -60, result: { kind: 'transient', reason: 'HTTP 503' } });
    assert.deepEqual([expired.status, expired.token, expired.all], [401, undefined, []]);
  });

  it('an account that lost its roles gets no ticket and no session', async () => {
    for (const ttl of [60, -60]) {
      const r = await run({ ttl, result: { kind: 'no_access' } });
      assert.deepEqual([r.status, r.token, r.cleared], [403, undefined, true], String(ttl));
    }
  });

  it('a review-only account gets no ticket, before and after a refresh', async () => {
    const before = await run({ ttl: 600, role: 'content_reviewer' });
    assert.deepEqual([before.status, before.token, before.spent], [403, undefined, []]);
    for (const ttl of [60, -60]) {
      const r = await run({ ttl, result: refreshedAs('senior_reviewer') });
      assert.deepEqual([r.status, r.token], [403, undefined], String(ttl));
      assert.deepEqual(r.stored, { accessToken: NEW, refreshToken: 'r1' }, 'its own pages keep working');
    }
  });

  it('the legacy cookie pair is refreshed and moved', async () => {
    const r = await run({ ttl: -60, cookies: { access_token: 'a', refresh_token: 'legacy' } });
    assert.deepEqual([r.status, r.spent, r.stored?.refreshToken], [200, ['legacy'], 'r1']);
    assert.equal(r.all.filter((c) => /^(access_token|refresh_token)=;/.test(c)).length, 2);
  });

  it('no session, another site, or no issuer to ask', async () => {
    assert.equal((await run({ ttl: -60, cookies: {} })).status, 401);
    assert.deepEqual([(await run({ ttl: 60, site: 'cross-site' })).status, (await run({ ttl: 60, site: 'cross-site' })).spent], [403, []]);
    assert.equal((await run({ ttl: -60, issuer: undefined })).status, 401);
    assert.equal((await run({ ttl: 60, issuer: undefined })).status, 200);
  });
});
