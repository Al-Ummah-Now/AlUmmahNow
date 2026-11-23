/**
 * @jest-environment node
 *
 * #437, #762: apps/web checks TOKEN_REVOCATIONS on session reads and middleware,
 * and records verified access tokens on sign-out so copied session cookies stop
 * working immediately across web and APIs.
 */
jest.mock('@/lib/logger-server', () => ({ logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

import { NextRequest } from 'next/server';
import {
  CACHE_MS,
  clearRevocationCache,
  isTokenRevoked,
  isWebTokenRevoked,
  revokeVerifiedAccessToken,
  tokenHashKey,
  type RevocationKv,
} from '../token-revocation';
import { revokeTokensOnSignOut } from '../revoke-on-sign-out';
import { refreshSessionCookie } from '../middleware-refresh';

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
  const reads: string[] = [];
  const writes: Array<{ key: string; value: unknown; expirationTtl?: number }> = [];
  const kv: RevocationKv = {
    async get<T>(key: string) {
      reads.push(key);
      return (store.get(key)?.value as T) ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      const parsed = JSON.parse(value);
      store.set(key, { value: parsed, expirationTtl: opts?.expirationTtl });
      writes.push({ key, value: parsed, expirationTtl: opts?.expirationTtl });
    },
  };
  return { kv, store, reads, writes };
}

beforeEach(() => clearRevocationCache());

describe('web token revocation (#437, #762)', () => {
  it('revokes a verified access token with sid on sign-out and rejects a copied cookie immediately', async () => {
    const now = 1_800_000_000_000;
    const nowS = Math.floor(now / 1000);
    const token = makeJwt({ properties: { id: 'usr_1' }, sid: 'sid_abc', auth_time: nowS - 30, iat: nowS - 30, exp: nowS + 870 });
    const { kv, writes } = fakeKv();

    // Warm the isolate negative cache first (simulates a page load right before sign-out)
    expect(await isWebTokenRevoked(token, 'usr_1', { kv, now })).toBe(false);

    // Sign out revokes the verified access token
    await revokeTokensOnSignOut(
      [{ userId: 'usr_1', accessToken: token, refreshToken: 'user:1:r' }],
      {
        issuer: 'https://auth.example',
        clientId: 'web-client',
        fetch: (async () => new Response('{}')) as unknown as typeof fetch,
        kv,
        verifyAccessToken: async () => true,
        now,
      },
    );

    expect(writes).toHaveLength(1);
    expect(writes[0].key).toBe('s:sid_abc');
    expect(writes[0].expirationTtl).toBeGreaterThanOrEqual(60);
    expect(writes[0].expirationTtl).toBeLessThanOrEqual(1800);

    // Immediately rejected in the same isolate (no waiting for CACHE_MS)
    expect(await isWebTokenRevoked(token, 'usr_1', { kv, now: now + 100 })).toBe(true);

    // And rejected in a fresh isolate reading from KV
    clearRevocationCache();
    expect(await isWebTokenRevoked(token, 'usr_1', { kv, now: now + 100 })).toBe(true);

    // Another device of the same user (different sid) still works
    const otherDevice = makeJwt({ properties: { id: 'usr_1' }, sid: 'sid_other', auth_time: nowS - 30, iat: nowS - 30, exp: nowS + 870 });
    expect(await isWebTokenRevoked(otherDevice, 'usr_1', { kv, now: now + 100 })).toBe(false);
  });

  it('falls back to t:<sha256> when a signed-out token has no sid claim', async () => {
    const now = 1_800_000_000_000;
    const nowS = Math.floor(now / 1000);
    const token = makeJwt({ properties: { id: 'usr_1' }, iat: nowS - 10, exp: nowS + 890 });
    const { kv, writes } = fakeKv();

    expect(await revokeVerifiedAccessToken(kv, token, 'single_sign_out', now)).toBe(true);
    expect(writes[0].key).toBe(await tokenHashKey(token));
    expect(writes[0].key).not.toContain(token);
    expect(await isWebTokenRevoked(token, 'usr_1', { kv, now })).toBe(true);
  });

  it('refuses to write to KV when the access token signature does not verify (forged cookie protection)', async () => {
    const now = 1_800_000_000_000;
    const nowS = Math.floor(now / 1000);
    const forged = makeJwt({ properties: { id: 'usr_victim' }, sid: 'sid_victim', auth_time: nowS - 10, exp: nowS + 890 });
    const { kv, writes } = fakeKv();

    await revokeTokensOnSignOut(
      [{ userId: 'usr_victim', accessToken: forged, refreshToken: '' }],
      { issuer: 'https://auth.example', kv, verifyAccessToken: async () => false, now },
    );

    expect(writes).toHaveLength(0);
    expect(await isWebTokenRevoked(forged, 'usr_victim', { kv, now })).toBe(false);
  });

  it('does not overwrite an existing revocation entry with a later before timestamp', async () => {
    const now = 1_800_000_000_000;
    const nowS = Math.floor(now / 1000);
    const token = makeJwt({ properties: { id: 'usr_1' }, sid: 'sid_keep', auth_time: nowS - 100, exp: nowS + 800 });
    const { kv, writes } = fakeKv({ 's:sid_keep': { v: 1, before: nowS + 50, reason: 'admin_session_terminated' } });

    expect(await revokeVerifiedAccessToken(kv, token, 'single_sign_out', now)).toBe(true);
    expect(writes).toHaveLength(0);
    expect(await isTokenRevoked(kv, { userId: 'usr_1', sid: 'sid_keep', authTime: nowS - 100 }, now)).toBe(true);
  });

  it('caches user-wide revocations for CACHE_MS and rereads session misses', async () => {
    const now = 1_800_000_000_000;
    const nowS = Math.floor(now / 1000);
    const token = makeJwt({ properties: { id: 'usr_del' }, sid: 'sid_1', auth_time: nowS - 60, exp: nowS + 840 });
    const { kv, reads } = fakeKv({ 'u:usr_del': { v: 1, before: nowS - 10 } });

    expect(await isWebTokenRevoked(token, 'usr_del', { kv, now })).toBe(true);
    expect(await isWebTokenRevoked(token, 'usr_del', { kv, now: now + 2000 })).toBe(true);
    expect(reads.sort()).toEqual(['s:sid_1', 's:sid_1', 'u:usr_del']);

    // After CACHE_MS it reads KV again
    await isWebTokenRevoked(token, 'usr_del', { kv, now: now + CACHE_MS + 1 });
    expect(reads.sort()).toEqual(['s:sid_1', 's:sid_1', 's:sid_1', 'u:usr_del', 'u:usr_del']);
  });

  it('middleware marks a copied revoked session cookie needsSignIn without calling /token', async () => {
    const now = 1_800_000_000_000;
    const nowS = Math.floor(now / 1000);
    const token = makeJwt({ properties: { id: 'u1' }, sid: 'sid_revoked', auth_time: nowS - 30, iat: nowS - 30, exp: nowS + 870 });
    const { kv } = fakeKv({ 's:sid_revoked': { v: 1, before: nowS } });
    const fetchCalls: string[] = [];
    const cookieVal = JSON.stringify({
      activeUserId: 'u1',
      activeChannelId: null,
      accounts: {
        u1: { userId: 'u1', email: 'u1@example.com', displayName: 'u1', accessToken: token, refreshToken: 'r1', channels: [], activeChannelId: null, lastActivity: 1 },
      },
    });
    const req = new NextRequest('https://web.example/en/studio', {
      headers: { cookie: `al_ummah_session=${encodeURIComponent(cookieVal)}` },
    });

    const updated = await refreshSessionCookie(req, {
      issuer: 'https://auth.example',
      fetchImpl: (async (u: string | URL | Request) => { fetchCalls.push(String(u)); return new Response('{}'); }) as unknown as typeof fetch,
      now: () => now,
      revocationKv: kv,
    });

    expect(fetchCalls).toHaveLength(0);
    expect(updated).not.toBeNull();
    expect(JSON.parse(updated!).accounts.u1.needsSignIn).toBe(true);
  });
});
