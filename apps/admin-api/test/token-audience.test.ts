/**
 * Access-token audience allowlist (security audit 2026-11-14): a token issued to a client that is
 * not one of admin-api's clients is logged (client id and route, never the token) in AUD_MODE
 * "log" and refused with 401 in "enforce".
 */
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { FIRST_PARTY_CLIENT_IDS } from '@al-ummah/shared-types';
import { authMiddleware, verifyAccessToken } from '../src/middleware/auth';
import { __resetClientForTests } from '../src/lib/openauth-client';
import { logger } from '../src/lib/logger';

const QA_ISSUER = 'https://auth.qa.alummahnow.net';
const QA = FIRST_PARTY_CLIENT_IDS.qa;
const PROD = FIRST_PARTY_CLIENT_IDS.production;

describe('authMiddleware audience check', () => {
	let realFetch: typeof fetch;
	let sign: (aud: string) => Promise<string>;
	let warns: Array<{ message: unknown; fields: unknown }>;

	beforeEach(async () => {
		__resetClientForTests();
		warns = [];
		mock.method(logger, 'warn', (message: unknown, fields: unknown) => warns.push({ message, fields }));
		const { publicKey, privateKey } = await generateKeyPair('ES256');
		const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
		sign = (aud) =>
			new SignJWT({ mode: 'access', type: 'user', properties: { id: 'usr_a', email: 'a@example.com' } })
				.setProtectedHeader({ alg: 'ES256', kid: 'k1' })
				.setIssuer(QA_ISSUER)
				.setAudience(aud)
				.setSubject('user:abc')
				.setIssuedAt()
				.setExpirationTime('15m')
				.sign(privateKey);
		realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
			if (url.pathname === '/.well-known/oauth-authorization-server') {
				return Response.json({ issuer: QA_ISSUER, jwks_uri: `${QA_ISSUER}/.well-known/jwks.json` });
			}
			if (url.pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
			return new Response('not found', { status: 404 });
		}) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		mock.restoreAll();
	});

	const call = (token: string, env: Record<string, unknown>) => {
		const app = new Hono();
		app.use('/api/me', authMiddleware);
		app.get('/api/me', (c) => c.json({ userId: c.get('userId' as never) }));
		return app.request('/api/me', { headers: { Authorization: `Bearer ${token}` } }, { Issuer: QA_ISSUER, ClientId: QA.web, ENVIRONMENT: 'qa', ...env });
	};
	const mismatches = () => warns.filter((w) => (w.fields as { event?: string } | undefined)?.event === 'aud_mismatch');

	it('an allowed client passes without a log, in every mode', async () => {
		for (const mode of [undefined, 'enforce']) {
			for (const aud of [QA.adminWeb, QA.web, QA.adminAndroid, QA.adminTools]) assert.equal((await call(await sign(aud), { AUD_MODE: mode })).status, 200, `${aud} ${mode}`);
		}
		assert.equal(mismatches().length, 0);
	});

	it('log mode: another client\'s token still passes, and the log has the client id and route but no token', async () => {
		const token = await sign(QA.www);
		assert.equal((await call(token, {})).status, 200);
		const [w] = mismatches();
		assert.ok(w, 'a mismatch is logged');
		assert.deepEqual(w.fields, { event: 'aud_mismatch', service: 'admin-api', mode: 'log', clientId: QA.www, client: 'www@qa', issuer: QA_ISSUER, route: 'GET /api/me' });
		assert.ok(!JSON.stringify(warns).includes(token.split('.')[2]), 'never the token');
	});

	it('enforce mode: another client\'s token is a 401', async () => {
		assert.equal((await call(await sign(QA.cms), { AUD_MODE: 'enforce' })).status, 401);
		assert.equal((await call(await sign(PROD.web), { AUD_MODE: 'enforce' })).status, 401, 'a production token on QA');
		assert.equal(mismatches().length, 2);
	});

	it('verifyAccessToken (site domains, contact) checks the same way, with the route', async () => {
		const env = { Issuer: QA_ISSUER, ClientId: QA.adminWeb, ENVIRONMENT: 'qa' };
		assert.ok(await verifyAccessToken(await sign(QA.web), env, 'GET /api/site-domains'));
		assert.equal(mismatches().length, 0);
		assert.equal(await verifyAccessToken(await sign(QA.sites), { ...env, AUD_MODE: 'enforce' }, 'POST /contact'), null);
		assert.equal((mismatches()[0].fields as { route?: string }).route, 'POST /contact');
	});

	it('Auth admin tokens pass on POST /api/translate/fields only, in enforce mode', async () => {
		const token = await sign(QA.authAdmin);
		const app = new Hono();
		app.use('/api/*', authMiddleware);
		app.post('/api/translate/fields', (c) => c.json({ ok: true }));
		app.get('/api/translate/fields', (c) => c.json({ ok: true }));
		app.post('/api/categories', (c) => c.json({ ok: true }));
		const env = { Issuer: QA_ISSUER, ClientId: QA.adminWeb, ENVIRONMENT: 'qa', AUD_MODE: 'enforce' };
		const req = (method: string, path: string, t = token) => app.request(path, { method, headers: { Authorization: `Bearer ${t}` } }, env);
		assert.equal((await req('POST', '/api/translate/fields')).status, 200);
		assert.equal(mismatches().length, 0, 'no mismatch on its route');
		assert.equal((await req('GET', '/api/translate/fields')).status, 401, 'another method');
		assert.equal((await req('POST', '/api/categories')).status, 401, 'another route');
		assert.equal((await req('POST', '/api/translate/fields', await sign(QA.authProfile))).status, 401, 'another client on the route');
		assert.equal((await req('POST', '/api/translate/fields', await sign(PROD.authAdmin))).status, 401, "production's Auth admin on QA");
	});

	it('off: no check, no log', async () => {
		assert.equal((await call(await sign(QA.cms), { AUD_MODE: 'off' })).status, 200);
		assert.equal(mismatches().length, 0);
	});
});
