/**
 * Edge bot protection (middleware/bot-protection.ts): Workers Rate Limiting per
 * user/IP, Turnstile on reports and an account's first comment, scripted clients
 * refused in production with Turnstile enforced. Test keys only: no network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { edgeRateLimit, humanCheckStatus, isCloudflareEgress, limiterKey, requireHuman, scriptedClientBlock, tokenClientId } from '../src/middleware/bot-protection';
import { checkHuman, hasValidBypass, signBypass, TEST_SECRETS, TEST_SITE_KEYS, TEST_TOKEN, turnstileMode, verifyTurnstileToken } from '../src/lib/bot-guard';

type Point = string[];

function limiter(max: number) {
	const counts = new Map<string, number>();
	return {
		keys: counts,
		limit: async ({ key }: { key: string }) => {
			const n = (counts.get(key) ?? 0) + 1;
			counts.set(key, n);
			return { success: n <= max };
		},
	};
}

function kv() {
	const store = new Map<string, string>();
	return { store, get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) };
}

function jwt(payload: Record<string, unknown>): string {
	const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
	return `${b64({ alg: 'ES256' })}.${b64(payload)}.sig`;
}

function app(env: Record<string, unknown>, user: string | null = 'usr_1') {
	const points: Point[] = [];
	const e = { ABUSE_EVENTS: { writeDataPoint: (p: { blobs?: string[] }) => void points.push(p.blobs ?? []) }, ...env };
	const a = new Hono();
	a.use('*', async (c, next) => {
		if (user) c.set('auth' as never, { userId: user } as never);
		await next();
	});
	a.use('/api/*', scriptedClientBlock());
	a.use('/api/videos/:id/comments', edgeRateLimit('COMMENT_LIMITER', 'videos.comment'));
	a.use('/api/videos/:id/comments', requireHuman('videos.comment', 'first'));
	a.use('/api/moderation/reports', requireHuman('videos.report', 'always'));
	a.use('/api/search', edgeRateLimit('SEARCH_LIMITER', 'videos.search', ['GET']));
	a.post('/api/videos/:id/comments', (c) => c.json({ success: true }, 201));
	a.post('/api/moderation/reports', (c) => c.json({ success: true }, 201));
	a.get('/api/search', (c) => c.json({ success: true }));
	a.get('/api/me/human-check', humanCheckStatus);
	const call = (path: string, init: RequestInit = {}) => a.request(path, init, e);
	return { call, points, env: e };
}

const enforce = { TURNSTILE_MODE: 'enforce', TURNSTILE_SITE_KEY: TEST_SITE_KEYS.pass, TURNSTILE_SECRET: TEST_SECRETS.pass, ENVIRONMENT: 'stage' };

describe('edgeRateLimit', () => {
	it('counts per user and answers 429 rate_limited with Retry-After', async () => {
		const COMMENT_LIMITER = limiter(2);
		const { call, points } = app({ COMMENT_LIMITER });
		const statuses = [];
		for (let i = 0; i < 3; i++) statuses.push((await call('/api/videos/v1/comments', { method: 'POST' })).status);
		assert.deepEqual(statuses, [201, 201, 429]);
		const res = await call('/api/videos/v1/comments', { method: 'POST' });
		assert.equal(res.headers.get('Retry-After'), '60');
		assert.equal(((await res.json()) as { code: string }).code, 'rate_limited');
		assert.deepEqual([...COMMENT_LIMITER.keys.keys()], ['u:usr_1']);
		assert.deepEqual(points[0], ['videos', 'videos.comment', 'rate_limited', 'development']);
	});

	it('anonymous: keyed by client IP; Cloudflare Worker egress is never a key', async () => {
		const SEARCH_LIMITER = limiter(1);
		const { call } = app({ SEARCH_LIMITER }, null);
		assert.equal((await call('/api/search', { headers: { 'CF-Connecting-IP': '203.0.113.7' } })).status, 200);
		assert.equal((await call('/api/search', { headers: { 'CF-Connecting-IP': '203.0.113.7' } })).status, 429);
		for (let i = 0; i < 5; i++) assert.equal((await call('/api/search', { headers: { 'CF-Connecting-IP': '2a06:98c0:3600::103' } })).status, 200);
		assert.ok(isCloudflareEgress('2A06:98C0:3600::103'));
	});

	it('other methods, a missing binding and a failing binding let the request through', async () => {
		const failing = { limit: async () => { throw new Error('down'); } };
		assert.equal((await app({ COMMENT_LIMITER: failing }).call('/api/videos/v1/comments', { method: 'POST' })).status, 201);
		assert.equal((await app({}).call('/api/videos/v1/comments', { method: 'POST' })).status, 201);
	});
});

describe('requireHuman', () => {
	it('mode off (the default): no check', async () => {
		assert.equal((await app({}).call('/api/moderation/reports', { method: 'POST' })).status, 201);
	});

	it('reports: always need a token', async () => {
		const { call, points } = app(enforce);
		const refused = await call('/api/moderation/reports', { method: 'POST' });
		assert.equal(refused.status, 403);
		const body = (await refused.json()) as { code: string; siteKey: string };
		assert.equal(body.code, 'human_check_required');
		assert.equal(body.siteKey, TEST_SITE_KEYS.pass);
		assert.equal((await call('/api/moderation/reports', { method: 'POST', headers: { 'X-Turnstile-Token': TEST_TOKEN } })).status, 201);
		assert.equal((await call('/api/moderation/reports', { method: 'POST', headers: { 'X-Turnstile-Token': TEST_TOKEN } })).status, 201);
		assert.deepEqual(points.map((p) => p[2]), ['turnstile_missing', 'turnstile_pass', 'turnstile_pass']);
	});

	it('first comment: needs a token once, then the account is remembered', async () => {
		const HUMAN_VERIFIED = kv();
		const { call } = app({ ...enforce, HUMAN_VERIFIED });
		assert.equal((await call('/api/videos/v1/comments', { method: 'POST' })).status, 403);
		assert.equal((await call('/api/videos/v1/comments', { method: 'POST', headers: { 'X-Turnstile-Token': TEST_TOKEN } })).status, 201);
		assert.equal(HUMAN_VERIFIED.store.get('h:usr_1'), '1');
		assert.equal((await call('/api/videos/v1/comments', { method: 'POST' })).status, 201);
	});

	it('monitor never refuses', async () => {
		const { call, points } = app({ ...enforce, TURNSTILE_MODE: 'monitor', TURNSTILE_SECRET: TEST_SECRETS.fail });
		assert.equal((await call('/api/moderation/reports', { method: 'POST', headers: { 'X-Turnstile-Token': TEST_TOKEN } })).status, 201);
		assert.equal(points[0][2], 'turnstile_fail');
	});

	it('tokens issued to our native apps are not asked', async () => {
		const { call } = app({ ...enforce, NATIVE_CLIENT_IDS: 'native-1, native-2' });
		const headers = { Authorization: `Bearer ${jwt({ aud: 'native-2', sub: 'usr_1' })}` };
		assert.equal((await call('/api/moderation/reports', { method: 'POST', headers })).status, 201);
		const web = { Authorization: `Bearer ${jwt({ aud: 'web-client', sub: 'usr_1' })}` };
		assert.equal((await call('/api/moderation/reports', { method: 'POST', headers: web })).status, 403);
	});

	it('a signed bypass works outside production only', async () => {
		const value = await signBypass('s3cret');
		const { call } = app({ ...enforce, BOT_BYPASS_SECRET: 's3cret' });
		assert.equal((await call('/api/moderation/reports', { method: 'POST', headers: { 'X-AUN-Bot-Bypass': value } })).status, 201);
		const prod = { ...enforce, ENVIRONMENT: 'production', TURNSTILE_SITE_KEY: '0x4AAAAAAA-real', TURNSTILE_SECRET: '0x4AAAAAAA-secret', BOT_BYPASS_SECRET: 's3cret' };
		assert.equal(await hasValidBypass(prod, new Request('https://x/', { headers: { 'X-AUN-Bot-Bypass': value } })), false);
	});
});

describe('scriptedClientBlock', () => {
	const prod = { ...enforce, ENVIRONMENT: 'production', TURNSTILE_SITE_KEY: '0x4AAAAAAA-real', TURNSTILE_SECRET: '0x4AAAAAAA-secret' };
	it('production + enforce: curl writes get 403, reads and Worker subrequests (no UA) do not', async () => {
		const { call } = app({ ...prod, TURNSTILE_MODE: 'enforce' });
		assert.equal((await call('/api/moderation/reports', { method: 'POST', headers: { 'User-Agent': 'curl/8.4.0' } })).status, 403);
		assert.equal((await call('/api/search', { headers: { 'User-Agent': 'curl/8.4.0' } })).status, 200);
		// No User-Agent (the web app's server actions): not a scripted client; the Turnstile check answers
		const noUa = (await (await call('/api/moderation/reports', { method: 'POST' })).json()) as { code: string };
		assert.equal(noUa.code, 'human_check_required');
	});
	it('off in production, or any mode outside production: not refused', async () => {
		assert.equal((await app({ ...prod, TURNSTILE_MODE: 'off' }).call('/api/moderation/reports', { method: 'POST', headers: { 'User-Agent': 'curl/8.4.0' } })).status, 201);
		const staged = app(enforce);
		const res = await staged.call('/api/moderation/reports', { method: 'POST', headers: { 'User-Agent': 'python-requests/2.31', 'X-Turnstile-Token': TEST_TOKEN } });
		assert.equal(res.status, 201);
	});
});

describe('bot-guard core', () => {
	it('production refuses test keys', async () => {
		assert.equal(turnstileMode({ ENVIRONMENT: 'production', TURNSTILE_MODE: 'enforce', TURNSTILE_SITE_KEY: TEST_SITE_KEYS.pass }), 'off');
		assert.equal((await verifyTurnstileToken({ ENVIRONMENT: 'production', TURNSTILE_SECRET: TEST_SECRETS.pass }, 't')).outcome, 'error');
	});
	it('a siteverify outage is let through in enforce', async () => {
		const down = (async () => new Response('x', { status: 502 })) as unknown as typeof fetch;
		const env = { TURNSTILE_MODE: 'enforce', TURNSTILE_SITE_KEY: '0x4real', TURNSTILE_SECRET: '0x4secret' };
		assert.deepEqual(await checkHuman(env, new Request('https://x/'), 't', 'e', { fetcher: down }), { allowed: true, outcome: 'error' });
	});
	it('reads the token client from aud', () => {
		const c = { req: { header: (n: string) => (n === 'Authorization' ? `Bearer ${jwt({ aud: ['abc'] })}` : undefined) } };
		assert.equal(tokenClientId(c as never), 'abc');
		const none = { req: { header: () => undefined }, get: () => undefined };
		assert.equal(limiterKey(none as never), null);
	});
});

describe('GET /api/me/human-check', () => {
	it('required until the account is verified; reports always; off and native never', async () => {
		const HUMAN_VERIFIED = kv();
		const { call } = app({ ...enforce, HUMAN_VERIFIED, NATIVE_CLIENT_IDS: 'native-1' });
		const read = async (q: string, headers: Record<string, string> = {}) =>
			((await (await call(`/api/me/human-check?${q}`, { headers })).json()) as { result: { required: boolean; siteKey: string | null } }).result;
		assert.deepEqual(await read('kind=comment'), { required: true, siteKey: TEST_SITE_KEYS.pass });
		HUMAN_VERIFIED.store.set('h:usr_1', '1');
		assert.equal((await read('kind=comment')).required, false);
		assert.equal((await read('kind=report')).required, true);
		assert.equal((await read('kind=report', { Authorization: `Bearer ${jwt({ aud: 'native-1' })}` })).required, false);
		assert.deepEqual((await (await app({}).call('/api/me/human-check?kind=report')).json() as { result: unknown }).result, { required: false, siteKey: null });
	});
});
