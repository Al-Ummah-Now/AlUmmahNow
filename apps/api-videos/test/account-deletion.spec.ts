import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { AccountDeletionPost, AccountExportGet } from '../src/endpoints/account/account';
import { REAUTH_MAX_AGE_SECONDS, authTimeOf, isRecentSignIn } from '../src/lib/account-deletion';

/**
 * In-app account deletion (Epic 9.7): a recent sign-in is checked before any
 * content is erased; content is erased (resumable), then the identity is
 * deleted at auth with the user's own token; auth failures are retryable.
 */

const ME = 'usr_me';
const ISSUER = 'https://auth.test';
const json = { 'Content-Type': 'application/json' };

/** Unsigned JWT: the route only reads claims (the auth middleware verified the signature). */
function jwt(claims: Record<string, unknown>) {
	const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}
const now = () => Math.floor(Date.now() / 1000);
const fresh = () => jwt({ auth_time: now() - 30, properties: { id: ME } });
const stale = () => jwt({ auth_time: now() - REAUTH_MAX_AGE_SECONDS - 60, properties: { id: ME } });

function env() {
	return {
		Issuer: ISSUER,
		profiles: new MemoryBucket({ [ME]: { id: ME, email: 'me@example.com' } }),
		channels: new MemoryBucket(),
		channel_sections: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		videos: new MemoryBucket(),
		watch_history: new MemoryBucket({ [`${ME}:v1`]: { id: `${ME}:v1`, userId: ME, videoId: 'v1' } }),
		community_posts: new MemoryBucket(),
		playlists: new MemoryBucket(),
		'upload-defaults': new MemoryBucket(),
		reports: new MemoryBucket(),
		subtitles: new MemoryBucket(),
		queue: new MemoryQueue(),
	};
}

const routes = (r: any) => {
	r.post('/api/account/deletion', AccountDeletionPost);
	r.get('/api/account/export', AccountExportGet);
};

let authCalls: Array<{ url: string; method: string; auth: string | null }> = [];
let authResponse: () => Response = () => new Response(JSON.stringify({ deleted: true }), { status: 200 });
const realFetch = globalThis.fetch;

beforeEach(() => {
	authCalls = [];
	authResponse = () => new Response(JSON.stringify({ deleted: true }), { status: 200 });
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		authCalls.push({ url: String(input), method: init?.method ?? 'GET', auth: headers.get('Authorization') });
		return authResponse();
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

function del(e: ReturnType<typeof env>, token: string, body: unknown = { confirm: 'DELETE' }) {
	return buildApp(routes, { userId: ME }).request(
		'/api/account/deletion',
		{ method: 'POST', headers: { ...json, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) },
		e,
	);
}

describe('recent sign-in', () => {
	it('reads auth_time and allows up to 10 minutes', () => {
		assert.equal(authTimeOf(jwt({ auth_time: 123 })), 123);
		assert.equal(authTimeOf('garbage'), undefined);
		const t = 1_800_000_000_000;
		assert.equal(isRecentSignIn(t / 1000 - 600, t), true);
		assert.equal(isRecentSignIn(t / 1000 - 601, t), false);
		assert.equal(isRecentSignIn(undefined, t), false);
	});
});

describe('POST /api/account/deletion', () => {
	it('erases content, then deletes the identity at auth with the same token', async () => {
		const e = env();
		const token = fresh();
		const res = await del(e, token);
		assert.equal(res.status, 200, await res.clone().text());
		const body = (await res.json()) as any;
		assert.equal(body.status, 'deleted');
		assert.equal(e.profiles.read(ME) ?? null, null, 'profile erased');
		assert.equal(e.watch_history.read(`${ME}:v1`) ?? null, null, 'history erased');
		assert.deepEqual(authCalls, [{ url: `${ISSUER}/account`, method: 'DELETE', auth: `Bearer ${token}` }]);
	});

	it('a stale sign-in is refused before anything is erased', async () => {
		const e = env();
		const res = await del(e, stale());
		assert.equal(res.status, 401);
		assert.equal(((await res.json()) as any).code, 'insufficient_user_authentication');
		assert.match(res.headers.get('www-authenticate') ?? '', /max_age=600/);
		assert.ok(e.profiles.read(ME), 'nothing erased');
		assert.equal(authCalls.length, 0);
	});

	it('a token without auth_time (issued before it existed) counts as stale', async () => {
		const e = env();
		assert.equal((await del(e, jwt({ properties: { id: ME } }))).status, 401);
		assert.ok(e.profiles.read(ME));
	});

	it('needs the explicit confirmation', async () => {
		const e = env();
		const res = await del(e, fresh(), {});
		assert.equal(res.status, 400);
		assert.ok(e.profiles.read(ME));
	});

	it('auth unreachable or failing: 502 auth_unavailable, and a retry finishes', async () => {
		const e = env();
		authResponse = () => new Response('boom', { status: 503 });
		const first = await del(e, fresh());
		assert.equal(first.status, 502);
		assert.equal(((await first.json()) as any).code, 'auth_unavailable');
		assert.equal(e.profiles.read(ME) ?? null, null, 'content already erased');

		authResponse = () => new Response(JSON.stringify({ deleted: true }), { status: 200 });
		const retry = await del(e, fresh());
		assert.equal(retry.status, 200);
		assert.equal(((await retry.json()) as any).status, 'deleted');
	});

	it('auth asking for a fresh sign-in is passed through for the app to re-authenticate', async () => {
		const e = env();
		authResponse = () => new Response(JSON.stringify({ error: 'insufficient_user_authentication' }), { status: 401 });
		const res = await del(e, fresh());
		assert.equal(res.status, 401);
		assert.equal(((await res.json()) as any).code, 'insufficient_user_authentication');
	});
});

describe('GET /api/account/export', () => {
	it('merges the content export with the auth export', async () => {
		const e = env();
		authResponse = () => new Response(JSON.stringify({ source: 'auth', account: { id: ME } }), { status: 200 });
		const res = await buildApp(routes, { userId: ME }).request('/api/account/export', { headers: { Authorization: `Bearer ${fresh()}` } }, e);
		assert.equal(res.status, 200);
		assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
		const body = (await res.json()) as any;
		assert.equal(body.account.account.id, ME);
		assert.ok(body.content);
		assert.equal(authCalls[0].url, `${ISSUER}/account/export`);
	});

	it('still returns the content when auth is unreachable', async () => {
		const e = env();
		globalThis.fetch = (async () => {
			throw new Error('offline');
		}) as typeof fetch;
		const res = await buildApp(routes, { userId: ME }).request('/api/account/export', { headers: { Authorization: `Bearer ${fresh()}` } }, e);
		const body = (await res.json()) as any;
		assert.equal(res.status, 200);
		assert.equal(body.account, null);
		assert.equal(body.accountError, 'identity service unreachable');
	});
});
