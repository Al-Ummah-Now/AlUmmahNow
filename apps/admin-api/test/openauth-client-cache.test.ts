/**
 * The auth client must not fetch the issuer's discovery document or JWKS per
 * request: N verifies through getClient(env) make at most one fetch of each.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { CLIENT_TTL_MS, __resetClientForTests, getClient } from '../src/lib/openauth-client';
import { subjects } from '../src/middleware/auth-subjects';

const ISSUER = 'https://auth.test.example';
const env = { Issuer: ISSUER, ClientId: 'client-1' };

let calls: string[] = [];
let realFetch: typeof fetch;
let sign: (sub: string) => Promise<string>;

beforeEach(async () => {
	__resetClientForTests();
	calls = [];
	const { publicKey, privateKey } = await generateKeyPair('ES256');
	const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
	sign = (sub) =>
		new SignJWT({ mode: 'access', type: 'user', properties: { id: sub, email: `${sub}@example.com` } })
			.setProtectedHeader({ alg: 'ES256', kid: 'k1' })
			.setIssuer(ISSUER)
			.setAudience('client-1')
			.setSubject(sub)
			.setExpirationTime('1h')
			.sign(privateKey);
	realFetch = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
		calls.push(url.pathname);
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

const count = (path: string) => calls.filter((p) => p === path).length;

describe('getClient (per-isolate OpenAuth client)', () => {
	it('verifies N tokens with at most one discovery and one JWKS fetch', async () => {
		const N = 25;
		for (let i = 0; i < N; i++) {
			const client = await getClient(env);
			const result = await client.verify(subjects, await sign(`usr_${i}`));
			assert.ok(!('err' in result && result.err), `verify ${i} failed`);
		}
		assert.equal(count('/.well-known/oauth-authorization-server'), 1);
		assert.equal(count('/.well-known/jwks.json'), 1);
	});

	it('rebuilds the client after the TTL (picks up a rotated key)', async () => {
		let t = 1_000_000;
		const a = await getClient(env, () => t);
		t += CLIENT_TTL_MS - 1;
		assert.equal(await getClient(env, () => t), a);
		t += 1;
		assert.notEqual(await getClient(env, () => t), a);
	});

	it('uses a separate client for a different issuer or client id', async () => {
		const a = await getClient(env);
		assert.notEqual(await getClient({ ...env, ClientId: 'client-2' }), a);
	});
});
