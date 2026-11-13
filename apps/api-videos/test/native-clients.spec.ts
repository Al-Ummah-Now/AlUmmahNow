/**
 * Native apps and bot protection (docs/features/bot-protection.md, "Native apps"):
 * - every User-Agent our native clients send passes scriptedClientBlock in production
 *   under enforce, for every write method (TUS uploads use POST, PATCH, HEAD, DELETE);
 * - the native apps cannot run the Turnstile widget: a token Auth signed for a registered
 *   native client (its `aud`) is their Turnstile-equivalent. They sign up and sign in on
 *   Auth's web pages (system browser, Custom Tab, ASWebAuthenticationSession, device code),
 *   which carry Turnstile, so every such token belongs to an account that passed it;
 * - NATIVE_CLIENT_IDS in each environment lists exactly the registered native clients.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { humanCheckStatus, requireHuman, scriptedClientBlock } from '../src/middleware/bot-protection';
import { parseJsonc } from '../../../scripts/release/jsonc.ts';

/** Native OAuth clients per environment (Auth oauth_clients, read 2026-11-13). Production and stage share ids. */
export const NATIVE_CLIENTS = {
	production: {
		'Viewer (iOS / Android)': '567a2cbc-dab8-4d5c-9437-a9e61c7120f5',
		'Viewer (TV)': '111648c6-24e6-4c35-8bcf-f50ab5c0d96d',
		'Viewer (desktop)': 'f97abe68-ef61-41b6-bf08-d86650cc7cb3',
		'Studio (iOS / Android)': '6f8073c6-754b-4d63-bf80-0546214e0d62',
		'Studio (desktop)': '950e2b3b-6353-4472-affe-7c1f57f4e6a4',
	},
	qa: {
		'Viewer (iOS / Android)': '31389afb-d4f8-4c26-9492-4c77f4d07e65',
		'Viewer (TV)': '9c3a81c8-3f9c-4873-abb1-a51e4f1d9543',
		'Viewer (desktop)': 'ce7de8a4-59dd-4682-ab4d-105399105294',
		'Studio (iOS / Android)': '45364a42-21f4-4359-a76c-0a1e6615fd7b',
		'Studio (desktop)': '29b4792a-caad-4814-a83f-4337bc6a1aeb',
	},
} as const;

/** What each native client sends, from the app repos' main branches (2026-11-13). */
const NATIVE_USER_AGENTS: Record<string, string> = {
	// AlUmmahNowCore (Rust, reqwest): aun-api ApiConfig default, and with the app's prefix (aun-ffi)
	'Core, no prefix': 'aun-core/0.4.0',
	'Apple iOS / iPadOS via Core': 'AlUmmahNow-iOS/1.2.0 aun-core/0.4.0',
	'Apple macOS via Core': 'AlUmmahNow-macOS/1.2.0 aun-core/0.4.0',
	// Apple URLSession (StudioService, TUSTransfer background uploads)
	'Apple Studio URLSession': 'StudioIOS/1 CFNetwork/1498.700.2 Darwin/24.1.0',
	'Apple macOS URLSession': 'AlUmmahNow/1.0 CFNetwork/1568.100.1 Darwin/24.0.0',
	// Android: AppContainer userAgent via Core, OkHttp defaults, tus-java-client over HttpURLConnection
	'Android Studio via Core': 'AlUmmahNow-Studio-Android/1.0.0 aun-core/0.4.0',
	'Android OkHttp default': 'okhttp/4.12.0',
	'Android TUS (HttpURLConnection)': 'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP2A.240805.005)',
	// Desktop (C#): Studio Windows / Linux through Core, viewer apps' HttpClient
	'Studio Windows': 'AlUmmahNowStudioWindows/1.0.0 aun-core/0.4.0',
	'Studio Linux': 'AlUmmahNowStudioLinux/1.0.0 aun-core/0.4.0',
	'Viewer Windows': 'AlUmmahNowWindows/0.1',
	'Viewer Linux': 'AlUmmahNowLinux/0.1',
	// Core's telemetry sink may send none; Workers subrequests send none
	'no User-Agent': '',
};

const SCRIPTED = ['curl/8.4.0', 'python-requests/2.32.3', 'Go-http-client/2.0', 'Wget/1.21.4', 'Scrapy/2.11', 'Java/17.0.9'];

const prodEnforce = {
	ENVIRONMENT: 'production',
	TURNSTILE_MODE: 'enforce',
	TURNSTILE_SITE_KEY: '0x4AAAAAAA-real-site-key',
	TURNSTILE_SECRET: '0x4AAAAAAA-real-secret',
	NATIVE_CLIENT_IDS: Object.values(NATIVE_CLIENTS.production).join(','),
};

function jwt(payload: Record<string, unknown>): string {
	const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
	return `${b64({ alg: 'ES256' })}.${b64(payload)}.sig`;
}

function app(env: Record<string, unknown>) {
	const a = new Hono();
	// Stands in for optionalAuthMiddleware: the signature was verified there
	a.use('*', async (c, next) => {
		if (c.req.header('Authorization')) c.set('auth' as never, { userId: 'usr_native' } as never);
		await next();
	});
	a.use('/api/*', scriptedClientBlock());
	a.use('/api/videos/:id/comments', requireHuman('videos.comment', 'first'));
	a.use('/api/moderation/reports', requireHuman('videos.report', 'always'));
	a.get('/api/me/human-check', humanCheckStatus);
	a.all('/api/videos/tus/*', (c) => c.body(null, 204));
	a.post('/api/videos/:id/comments', (c) => c.json({ success: true }, 201));
	a.post('/api/moderation/reports', (c) => c.json({ success: true }, 201));
	return (path: string, init: RequestInit) => a.request(path, init, { ...env, ABUSE_EVENTS: { writeDataPoint: () => undefined } });
}

describe('native User-Agents in production under enforce', () => {
	const call = app(prodEnforce);
	for (const [name, ua] of Object.entries(NATIVE_USER_AGENTS)) {
		it(`${name} (${ua || 'none'}) may write, TUS included`, async () => {
			for (const method of ['POST', 'PATCH', 'DELETE']) {
				const res = await call('/api/videos/tus/abc', { method, headers: ua ? { 'User-Agent': ua } : {} });
				assert.equal(res.status, 204, `${method} refused`);
			}
		});
	}
	it('command-line clients are refused', async () => {
		for (const ua of SCRIPTED) {
			const res = await call('/api/videos/tus/abc', { method: 'PATCH', headers: { 'User-Agent': ua } });
			assert.equal(res.status, 403, ua);
		}
	});
});

describe('native clients skip the widget (signed token for a registered native client)', () => {
	const call = app(prodEnforce);
	for (const [name, id] of Object.entries(NATIVE_CLIENTS.production)) {
		it(`${name}: first comment and report go through without a Turnstile token`, async () => {
			const headers = { Authorization: `Bearer ${jwt({ aud: id, sub: 'usr_native' })}`, 'User-Agent': 'aun-core/0.4.0' };
			assert.equal((await call('/api/videos/v1/comments', { method: 'POST', headers })).status, 201);
			assert.equal((await call('/api/moderation/reports', { method: 'POST', headers })).status, 201);
			const status = (await (await call('/api/me/human-check?kind=report', { headers })).json()) as { result: { required: boolean } };
			assert.equal(status.result.required, false);
		});
	}
	it('a web-client token still needs the check; an unknown client id is not exempt', async () => {
		for (const aud of ['f0de3c30-0304-4ac4-86d6-1e185dec0439', 'not-a-native-client']) {
			const headers = { Authorization: `Bearer ${jwt({ aud, sub: 'usr_native' })}` };
			assert.equal((await call('/api/moderation/reports', { method: 'POST', headers })).status, 403, aud);
		}
	});
});

describe('NATIVE_CLIENT_IDS in the wrangler configs', () => {
	const dir = join(__dirname, '..');
	const read = (file: string) => parseJsonc(readFileSync(join(dir, file), 'utf8')) as {
		vars: Record<string, string>;
		env: Record<string, { vars: Record<string, string> }>;
	};
	const ids = (value: string | undefined) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean).sort();
	it('production and stage list exactly the registered native clients', () => {
		const config = read('wrangler.jsonc');
		const want = Object.values(NATIVE_CLIENTS.production).sort();
		assert.deepEqual(ids(config.vars.NATIVE_CLIENT_IDS), want);
		assert.deepEqual(ids(config.env.stage.vars.NATIVE_CLIENT_IDS), want);
	});
	it('QA lists its own native clients', () => {
		assert.deepEqual(ids(read('wrangler.qa.jsonc').vars.NATIVE_CLIENT_IDS), Object.values(NATIVE_CLIENTS.qa).sort());
	});
});
