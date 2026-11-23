/**
 * #437, #762: admin-web checks TOKEN_REVOCATIONS in session verification and
 * middleware, and records verified access tokens on sign-out so copied
 * admin_session cookies stop working immediately.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import {
  clearRevocationCache,
  isAdminTokenRevoked,
  revokeVerifiedAccessToken,
  tokenHashKey,
  type RevocationKv,
} from '../src/lib/token-revocation';
import { verifySessionTokens, type VerifyOutcome } from '../src/lib/session-state';
import { refreshSessionMiddleware } from '../src/lib/session-middleware';
import { refreshTokensOf, revokeTokensOnSignOut } from '../src/lib/revoke-on-sign-out';
import { LEGACY_TOKEN_ISSUED_BEFORE_SECONDS } from '../src/lib/token-refresh';

function b64url(v: unknown): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url');
}

function makeJwt(claims: Record<string, unknown>): string {
  return `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url({ mode: 'access', type: 'user', ...claims })}.sig`;
}

function fakeKv(initial: Record<string, unknown> = {}) {
  const store = new Map<string, { value: unknown; expirationTtl?: number }>(
    Object.entries(initial).map(([k, v]) => [k, { value: v }]),
  );
  const writes: Array<{ key: string; value: unknown; expirationTtl?: number }> = [];
  const kv: RevocationKv = {
    async get<T>(key: string) {
      return (store.get(key)?.value as T) ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      const parsed = JSON.parse(value);
      store.set(key, { value: parsed, expirationTtl: opts?.expirationTtl });
      writes.push({ key, value: parsed, expirationTtl: opts?.expirationTtl });
    },
  };
  return { kv, store, writes };
}

beforeEach(() => clearRevocationCache());

describe('admin-web token revocation (#437, #762)', () => {
  const NOW = 1_800_000_000;
  const NOW_MS = NOW * 1000;
  const admin: VerifyOutcome = { subject: { properties: { id: 'usr_a', email: 'a@example.com', roles: ['Super Admin'] } } };

  it('sign-out records a verified access token in TOKEN_REVOCATIONS and immediately rejects copied cookies', async () => {
    const token = makeJwt({ properties: { id: 'usr_a' }, sid: 'sid_admin', auth_time: NOW - 30, iat: NOW - 30, exp: NOW + 870 });
    const { kv, writes } = fakeKv();

    // Read the token before sign-out
    assert.equal(await isAdminTokenRevoked(token, 'usr_a', { kv, now: NOW_MS }), false);

    const jar = {
      get: (name: string) =>
        name === 'admin_session'
          ? { value: JSON.stringify({ user: { id: 'usr_a' }, accessToken: token, refreshToken: 'user:a:r' }) }
          : undefined,
    };
    await revokeTokensOnSignOut(refreshTokensOf(jar), {
      issuer: 'https://auth.example',
      clientId: 'admin-client',
      fetch: (async () => new Response('{}')) as typeof fetch,
      kv,
      verifyAccessToken: async () => true,
      now: NOW_MS,
    });

    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, 's:sid_admin');

    // Immediately rejected in the same isolate and in a fresh isolate
    assert.equal(await isAdminTokenRevoked(token, 'usr_a', { kv, now: NOW_MS + 100 }), true);
    clearRevocationCache();
    assert.equal(await isAdminTokenRevoked(token, 'usr_a', { kv, now: NOW_MS + 100 }), true);
  });

  it('refuses to write to KV when the access token does not verify (forged cookie)', async () => {
    const forged = makeJwt({ properties: { id: 'usr_victim' }, sid: 'sid_victim', auth_time: NOW - 10, exp: NOW + 890 });
    const { kv, writes } = fakeKv();

    await revokeTokensOnSignOut([{ userId: '', accessToken: forged, refreshToken: '' }], {
      issuer: 'https://auth.example',
      kv,
      verifyAccessToken: async () => false,
      now: NOW_MS,
    });

    assert.equal(writes.length, 0);
    assert.equal(await isAdminTokenRevoked(forged, 'usr_victim', { kv, now: NOW_MS }), false);
  });

  it('falls back to t:<sha256> when the access token has no sid claim', async () => {
    const token = makeJwt({ properties: { id: 'usr_a' }, iat: NOW - 10, exp: NOW + 890 });
    const { kv, writes } = fakeKv();

    assert.equal(await revokeVerifiedAccessToken(kv, token, 'single_sign_out', NOW_MS), true);
    assert.equal(writes[0].key, await tokenHashKey(token));
    assert.equal(await isAdminTokenRevoked(token, 'usr_a', { kv, now: NOW_MS }), true);
  });

  it('verifySessionTokens treats a revoked token as signed-out (never tries to refresh)', async () => {
    const fresh = makeJwt({ iat: LEGACY_TOKEN_ISSUED_BEFORE_SECONDS + 60, exp: LEGACY_TOKEN_ISSUED_BEFORE_SECONDS + 960, sid: 'sid_gone' });
    const verdict = await verifySessionTokens(
      { accessToken: fresh, refreshToken: 'r' },
      async () => admin,
      { nowSeconds: LEGACY_TOKEN_ISSUED_BEFORE_SECONDS + 61, isRevoked: async () => true },
    );
    assert.deepEqual(verdict, { kind: 'signed-out' });
  });

  it('refreshSessionMiddleware clears admin_session and redirects to /login when the token is revoked', async () => {
    const token = makeJwt({ properties: { id: 'usr_a' }, sid: 'sid_gone', auth_time: NOW - 60, iat: NOW - 60, exp: NOW + 840 });
    const { kv } = fakeKv();
    // This request path saw the session before another bundle wrote the revocation.
    assert.equal(await isAdminTokenRevoked(token, 'usr_a', { kv, now: NOW_MS - 100 }), false);
    await kv.put!('s:sid_gone', JSON.stringify({ v: 1, before: NOW }));
    const req = new NextRequest('https://admin.qa.alummahnow.net/dashboard', {
      headers: {
        cookie: `admin_session=${encodeURIComponent(JSON.stringify({ user: { id: 'usr_a', email: 'a@example.com', role: 'admin' }, accessToken: token, refreshToken: 'r0' }))}`,
      },
    });
    const response = await refreshSessionMiddleware(req, {
      issuer: 'https://auth.qa.alummahnow.net',
      now: () => NOW_MS,
      verify: async () => { throw new Error("revoked sessions must not refresh"); },
      log: { info: () => {}, warn: () => {} },
      isRevoked: (t) => isAdminTokenRevoked(t, undefined, { kv, now: NOW_MS }),
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), 'https://admin.qa.alummahnow.net/login?return=%2Fdashboard');
    const cleared = response.headers.getSetCookie().find((c) => c.startsWith('admin_session='));
    assert.ok(cleared && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cleared), cleared);
  });
});
