/**
 * Access-token audience allowlist (security audit 2026-11-14): a token issued to a client that is
 * not one of api-videos' clients is logged (client id and route, never the token) in AUD_MODE
 * "log" and refused with 401 in "enforce".
 */
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import {
	FIRST_PARTY_CLIENT_IDS,
	SERVICE_AUDIENCES,
	allowedClientIds,
	audienceMode,
	authEnvironmentOf,
	checkAudience,
} from '@al-ummah/shared-types';
import { authMiddleware } from '../src/middleware/auth';
import { __resetClientForTests } from '../src/lib/openauth-client';
import { logger } from '../src/lib/logger';
import { privacyRouter } from '../src/routers/privacy.router';

const QA_ISSUER = 'https://auth.qa.alummahnow.net';
const PROD_ISSUER = 'https://auth.alummahnow.net';
const QA = FIRST_PARTY_CLIENT_IDS.qa;
const PROD = FIRST_PARTY_CLIENT_IDS.production;

describe('the first-party registry', () => {
	it('maps each Auth host to its registry; anything else is unknown', () => {
		assert.equal(authEnvironmentOf('https://auth.alummahnow.net'), 'production');
		assert.equal(authEnvironmentOf('https://auth.stage.alummahnow.net'), 'production');
		assert.equal(authEnvironmentOf(QA_ISSUER), 'qa');
		assert.equal(authEnvironmentOf('http://localhost:3301'), 'production');
		assert.equal(authEnvironmentOf('https://auth.alummahnow.net.evil.example'), null);
		assert.equal(authEnvironmentOf(undefined), null);
	});

	it('has no duplicate ids within an environment, and QA never reuses a production id (except authProfile)', () => {
		for (const env of ['production', 'qa'] as const) {
			const ids = Object.values(FIRST_PARTY_CLIENT_IDS[env]);
			assert.equal(new Set(ids).size, ids.length, env);
		}
		// Auth's profile app hard-codes 109a1087-... in every environment; issuer signature verification
		// still separates QA and production tokens.
		const sharedAcrossEnvs = new Set(['authProfile']);
		assert.equal(QA.authProfile, PROD.authProfile);
		const prod = new Set(Object.values(PROD));
		for (const [name, id] of Object.entries(QA)) {
			if (sharedAcrossEnvs.has(name)) continue;
			assert.ok(!prod.has(id), `${name}: ${id}`);
		}
	});

	it('each service takes the clients that call it, and never the CMS or Auth\'s own apps', () => {
		assert.ok(allowedClientIds('api-videos', QA_ISSUER).includes(QA.www), 'www reads /api/profile at sign-in');
		assert.ok(allowedClientIds('admin-api', QA_ISSUER).includes(QA.web), 'web forwards Studio site-domain calls');
		for (const svc of Object.keys(SERVICE_AUDIENCES) as Array<keyof typeof SERVICE_AUDIENCES>) {
			for (const id of [QA.cms, QA.authProfile, QA.authAdmin]) assert.ok(!allowedClientIds(svc, QA_ISSUER).includes(id), `${svc} ${id}`);
		}
		assert.deepEqual(allowedClientIds('web', 'https://auth.alummahnow.net'), [PROD.web]);
		assert.deepEqual(allowedClientIds('admin-web', 'https://auth.alummahnow.net'), [PROD.adminWeb]);
		assert.deepEqual(allowedClientIds('api-videos', 'https://unknown.example'), []);
	});

	it('AUD_MODE is log unless it says enforce or off', () => {
		assert.equal(audienceMode(undefined), 'log');
		assert.equal(audienceMode('enforced'), 'log');
		assert.equal(audienceMode(' Enforce '), 'enforce');
		assert.equal(audienceMode('off'), 'off');
	});

	it('a production token is a mismatch on QA (and the log names it)', () => {
		const v = checkAudience({ service: 'api-videos', aud: PROD.web, issuer: QA_ISSUER, mode: 'enforce', route: 'GET /x' });
		assert.equal(v.ok, false);
		assert.equal(v.log?.client, 'web@production');
		assert.equal(checkAudience({ service: 'api-videos', aud: [PROD.web, QA.web], issuer: QA_ISSUER, mode: 'enforce' }).ok, true);
		assert.equal(checkAudience({ service: 'api-videos', aud: undefined, issuer: QA_ISSUER, mode: 'enforce' }).ok, false);
		assert.equal(checkAudience({ service: 'api-videos', aud: 'x', issuer: QA_ISSUER, mode: 'off' }).mismatch, false);
	});
});

describe('authMiddleware audience check', () => {
	let realFetch: typeof fetch;
	let sign: (aud: string, issuer?: string) => Promise<string>;
	let warns: Array<{ message: unknown; fields: unknown }>;

	beforeEach(async () => {
		__resetClientForTests();
		warns = [];
		mock.method(logger, 'warn', (message: unknown, fields: unknown) => warns.push({ message, fields }));
		const { publicKey, privateKey } = await generateKeyPair('ES256');
		const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
		sign = (aud, issuer = QA_ISSUER) =>
			new SignJWT({ mode: 'access', type: 'user', properties: { id: 'usr_a', email: 'a@example.com' } })
				.setProtectedHeader({ alg: 'ES256', kid: 'k1' })
				.setIssuer(issuer)
				.setAudience(aud)
				.setSubject('user:abc')
				.setIssuedAt()
				.setExpirationTime('15m')
				.sign(privateKey);
		realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
			const origin = url.origin;
			if (url.pathname === '/.well-known/oauth-authorization-server') {
				return Response.json({ issuer: origin, jwks_uri: `${origin}/.well-known/jwks.json` });
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
			for (const aud of [QA.web, QA.www, QA.studioMobile]) assert.equal((await call(await sign(aud), { AUD_MODE: mode })).status, 200, `${aud} ${mode}`);
		}
		assert.equal(mismatches().length, 0);
	});

	it('log mode: another client\'s token still passes, and the log has the client id and route but no token', async () => {
		const token = await sign(QA.cms);
		assert.equal((await call(token, {})).status, 200);
		const [w] = mismatches();
		assert.ok(w, 'a mismatch is logged');
		assert.deepEqual(w.fields, { event: 'aud_mismatch', service: 'api-videos', mode: 'log', clientId: QA.cms, client: 'cms@qa', issuer: QA_ISSUER, route: 'GET /api/me' });
		assert.ok(!JSON.stringify(warns).includes(token.split('.')[2]), 'never the token');
	});

	it('enforce mode: another client\'s token is a 401', async () => {
		assert.equal((await call(await sign(QA.cms), { AUD_MODE: 'enforce' })).status, 401);
		assert.equal((await call(await sign(PROD.web), { AUD_MODE: 'enforce' })).status, 401, 'a production token on QA');
		assert.equal((await call(await sign(QA.authProfile), { AUD_MODE: 'enforce' })).status, 401, 'authProfile stays blocked on general routes');
		assert.equal(mismatches().length, 3);
	});

	it('enforce mode: authProfile is allowed only on DELETE /api/privacy/data (AlUmmahNowAuth#532)', async () => {
		const app = new Hono();
		app.use('/api/*', authMiddleware);
		app.route('/api/privacy', privacyRouter as never);
		const qaEnv = { Issuer: QA_ISSUER, ClientId: QA.web, ENVIRONMENT: 'qa', AUD_MODE: 'enforce' };
		const prodEnv = { Issuer: PROD_ISSUER, ClientId: PROD.web, ENVIRONMENT: 'production', AUD_MODE: 'enforce' };

		// QA authProfile passes auth on DELETE /api/privacy/data and reaches PrivacyErase (400 confirmation_required)
		const qaErase = await app.request(
			'/api/privacy/data',
			{ method: 'DELETE', headers: { Authorization: `Bearer ${await sign(QA.authProfile)}`, 'Content-Type': 'application/json' }, body: '{}' },
			qaEnv,
		);
		assert.equal(qaErase.status, 400);
		assert.equal(((await qaErase.json()) as { code?: string }).code, 'confirmation_required');

		// web remains allowed on DELETE /api/privacy/data
		const webErase = await app.request(
			'/api/privacy/data',
			{ method: 'DELETE', headers: { Authorization: `Bearer ${await sign(QA.web)}`, 'Content-Type': 'application/json' }, body: '{}' },
			qaEnv,
		);
		assert.equal(webErase.status, 400);

		// cms and authAdmin remain refused on DELETE /api/privacy/data
		assert.equal(
			(await app.request('/api/privacy/data', { method: 'DELETE', headers: { Authorization: `Bearer ${await sign(QA.cms)}` } }, qaEnv)).status,
			401,
			'cms refused on DELETE /api/privacy/data',
		);
		assert.equal(
			(await app.request('/api/privacy/data', { method: 'DELETE', headers: { Authorization: `Bearer ${await sign(QA.authAdmin)}` } }, qaEnv)).status,
			401,
			'authAdmin refused on DELETE /api/privacy/data',
		);

		// authProfile is refused on every other privacy route (export, consent)
		assert.equal(
			(await app.request('/api/privacy/export', { method: 'GET', headers: { Authorization: `Bearer ${await sign(QA.authProfile)}` } }, qaEnv)).status,
			401,
			'authProfile refused on GET /api/privacy/export',
		);
		assert.equal(
			(
				await app.request(
					'/api/privacy/consent',
					{ method: 'PUT', headers: { Authorization: `Bearer ${await sign(QA.authProfile)}`, 'Content-Type': 'application/json' }, body: '{}' },
					qaEnv,
				)
			).status,
			401,
			'authProfile refused on PUT /api/privacy/consent',
		);
		assert.equal(mismatches().length, 4);

		// Production issuer with PROD.authProfile is allowed on DELETE /api/privacy/data and refused on export
		__resetClientForTests();
		const prodErase = await app.request(
			'/api/privacy/data',
			{
				method: 'DELETE',
				headers: { Authorization: `Bearer ${await sign(PROD.authProfile, PROD_ISSUER)}`, 'Content-Type': 'application/json' },
				body: '{}',
			},
			prodEnv,
		);
		assert.equal(prodErase.status, 400);
		assert.equal(
			(await app.request('/api/privacy/export', { method: 'GET', headers: { Authorization: `Bearer ${await sign(PROD.authProfile, PROD_ISSUER)}` } }, prodEnv)).status,
			401,
			'prod authProfile refused on GET /api/privacy/export',
		);

		// log mode: authProfile on DELETE /api/privacy/data passes with no aud_mismatch warning
		__resetClientForTests();
		warns = [];
		const logErase = await app.request(
			'/api/privacy/data',
			{ method: 'DELETE', headers: { Authorization: `Bearer ${await sign(QA.authProfile)}`, 'Content-Type': 'application/json' }, body: '{}' },
			{ Issuer: QA_ISSUER, ClientId: QA.web, ENVIRONMENT: 'qa', AUD_MODE: 'log' },
		);
		assert.equal(logErase.status, 400);
		assert.equal(mismatches().length, 0, 'no aud_mismatch logged for authProfile on DELETE /api/privacy/data');
	});

	it('off: no check, no log', async () => {
		assert.equal((await call(await sign(QA.cms), { AUD_MODE: 'off' })).status, 200);
		assert.equal(mismatches().length, 0);
	});
});
