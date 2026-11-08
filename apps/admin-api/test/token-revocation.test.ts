/**
 * #437: the API rejects access tokens of revoked sign-ins (account deleted,
 * signed out of all devices, password reset, suspended) and reads the
 * revocation list cheaply (isolate cache + KV edge cache).
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { authMiddleware } from '../src/middleware/auth';
import { __resetClientForTests } from '../src/lib/openauth-client';
import { CACHE_MS, KV_CACHE_TTL_S, clearRevocationCache, decodeVerifiedClaims, isRevoked, isTokenRevoked } from '../src/lib/token-revocation';

const ISSUER = 'https://auth.test.example';
const nowS = () => Math.floor(Date.now() / 1000);

function fakeKv(entries: Record<string, unknown> = {}) {
	const reads: Array<{ key: string; cacheTtl?: number }> = [];
	return {
		reads,
		entries,
		kv: {
			async get(key: string, opts?: { type?: string; cacheTtl?: number }) {
				reads.push({ key, cacheTtl: opts?.cacheTtl });
				return entries[key] ?? null;
			},
		} as unknown as KVNamespace,
	};
}

describe('revocation rules', () => {
	beforeEach(() => clearRevocationCache());

	it('a sign-in before `before` is revoked, even when the token was refreshed after it', () => {
		const e = { v: 1, before: 1000 };
		assert.equal(isRevoked(null, { iat: 1 }), false);
		assert.equal(isRevoked(e, { authTime: 999, iat: 5000 }), true);
		assert.equal(isRevoked(e, { authTime: 1000, iat: 1000 }), false);
		assert.equal(isRevoked(e, { iat: 999 }), true);
		assert.equal(isRevoked(e, {}), true);
		assert.equal(isRevoked({ v: 1 }, { iat: 1 }), false);
	});

	it('reads KV at most once per user per isolate window, with the edge cache on', async () => {
		const { kv, reads } = fakeKv({ 'u:usr_a': { v: 1, before: 2000 } });
		const t = 1_000_000;
		assert.equal(await isTokenRevoked(kv, { userId: 'usr_a', authTime: 1500 }, t), true);
		assert.equal(await isTokenRevoked(kv, { userId: 'usr_a', authTime: 2500 }, t + 1000), false);
		assert.equal(await isTokenRevoked(kv, { userId: 'usr_b', authTime: 1 }, t), false);
		assert.equal(await isTokenRevoked(kv, { userId: 'usr_b', authTime: 1 }, t + 5000), false);
		assert.deepEqual(reads, [
			{ key: 'u:usr_a', cacheTtl: KV_CACHE_TTL_S },
			{ key: 'u:usr_b', cacheTtl: KV_CACHE_TTL_S },
		]);
		// After the window the entry is read again (a revocation written meanwhile is seen)
		await isTokenRevoked(kv, { userId: 'usr_b', authTime: 1 }, t + CACHE_MS + 1);
		assert.equal(reads.length, 3);
	});

	it('fails open without a binding or when KV errors (tokens stay signature-checked and short-lived)', async () => {
		assert.equal(await isTokenRevoked(undefined, { userId: 'usr_a', iat: 1 }), false);
		const broken = { get: async () => { throw new Error('kv down'); } } as unknown as KVNamespace;
		assert.equal(await isTokenRevoked(broken, { userId: 'usr_a', iat: 1 }), false);
	});

	it('decodes the times of a verified token', () => {
		const payload = Buffer.from(JSON.stringify({ iat: 10, exp: 20, auth_time: 5 })).toString('base64url');
		assert.deepEqual(decodeVerifiedClaims(`h.${payload}.s`), { iat: 10, exp: 20, auth_time: 5 });
		assert.deepEqual(decodeVerifiedClaims('garbage'), {});
	});
});

describe('admin-api authMiddleware with the revocation list', () => {
	let realFetch: typeof fetch;
	let sign: (claims: Record<string, unknown>) => Promise<string>;

	beforeEach(async () => {
		__resetClientForTests();
		clearRevocationCache();
		const { publicKey, privateKey } = await generateKeyPair('ES256');
		const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
		sign = (claims) =>
			new SignJWT({ mode: 'access', type: 'user', properties: { id: 'usr_a', email: 'a@example.com' }, ...claims })
				.setProtectedHeader({ alg: 'ES256', kid: 'k1' })
				.setIssuer(ISSUER)
				.setAudience('client-1')
				.setSubject('user:abc')
				.setIssuedAt()
				.setExpirationTime('15m')
				.sign(privateKey);
		realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
			if (url.pathname === '/.well-known/oauth-authorization-server') {
				return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks.json` });
			}
			if (url.pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
			return new Response('not found', { status: 404 });
		}) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	const app = () => {
		const a = new Hono();
		a.use('/me', authMiddleware);
		a.get('/me', (c) => c.json({ userId: c.get('userId' as never), payload: (c.get('auth' as never) as any).payload }));
		return a;
	};
	const call = (token: string, env: Record<string, unknown>) =>
		app().request('/me', { headers: { Authorization: `Bearer ${token}` } }, { Issuer: ISSUER, ClientId: 'client-1', ENVIRONMENT: 'production', ...env });

	it('accepts a token with no revocation and reports its real iat/exp', async () => {
		const { kv } = fakeKv();
		const res = await call(await sign({ auth_time: nowS() - 60 }), { TOKEN_REVOCATIONS: kv });
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.equal(body.userId, 'usr_a');
		assert.ok(Math.abs(body.payload.exp - (nowS() + 900)) <= 2, 'the token exp, not a made-up hour');
		assert.ok(Math.abs(body.payload.iat - nowS()) <= 2);
	});

	it('rejects a token whose sign-in predates the revocation; a newer sign-in works', async () => {
		const { kv } = fakeKv({ 'u:usr_a': { v: 1, before: nowS() - 10 } });
		assert.equal((await call(await sign({ auth_time: nowS() - 3600 }), { TOKEN_REVOCATIONS: kv })).status, 401);
		clearRevocationCache();
		assert.equal((await call(await sign({ auth_time: nowS() - 5 }), { TOKEN_REVOCATIONS: kv })).status, 200);
	});

	it('without the binding nothing changes (rollout safety)', async () => {
		assert.equal((await call(await sign({ auth_time: nowS() - 3600 }), {})).status, 200);
	});
});
