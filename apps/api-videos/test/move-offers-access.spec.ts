/**
 * Who may read channel move offers, through the mounted app (src/index.ts): the sign-in, the feature
 * switch, the ban and the pending-deletion middleware and the handlers, as a request meets them.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import worker from '../src/index';
import { __resetClientForTests } from '../src/lib/openauth-client';
import { clearRevocationCache } from '../src/lib/token-revocation';
import { channelReportUnderReview } from '../src/lib/channelReportStatus';
import { forgetCachedBan, writeBan, deleteBan } from '../src/lib/admin/bans';
import { recordDeletion, removeDeletion } from '../src/lib/admin/deletions';
import { forgetPendingUserDeletion } from '../src/lib/admin/pendingUserDeletion';
import { MemoryBucket, MemoryQueue } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const ISSUER = 'https://auth.test.example';
let sign: (userId: string) => Promise<string>;
let realFetch: typeof fetch;

before(async () => {
	const { publicKey, privateKey } = await generateKeyPair('ES256');
	const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
	sign = (userId) =>
		new SignJWT({ mode: 'access', type: 'user', properties: { id: userId, email: `${userId}@test.example` } })
			.setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(ISSUER).setAudience('client-1').setSubject(`user:${userId}`).setIssuedAt().setExpirationTime('15m').sign(privateKey);
	realFetch = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const { pathname } = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
		if (pathname === '/.well-known/oauth-authorization-server') return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks.json` });
		if (pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
		return new Response('not found', { status: 404 });
	}) as typeof fetch;
});
after(() => {
	globalThis.fetch = realFetch;
});

const [FROM, TO, OWNER_NOW] = ['usr_from', 'usr_to', 'usr_owner'];
const PARTIES = [FROM, TO, OWNER_NOW];
beforeEach(() => {
	__resetClientForTests();
	clearRevocationCache();
	for (const id of [...PARTIES, 'usr_stranger']) {
		forgetCachedBan(id);
		forgetPendingUserDeletion(id);
	}
});

const profile = (id: string, extra: Record<string, unknown> = {}) => ({ id, email: `${id}@test.example`, displayName: `Name of ${id.slice(4)}`, channels: [], ...extra });

function setup() {
	const db = new SqliteD1();
	db.db.prepare(`INSERT INTO feature_switches (key, enabled, version, updated_by, updated_at) VALUES ('channelMove', 1, 1, 'usr_super', 'now')`).run();
	db.db.prepare(`INSERT INTO channel_move_offers (id, channel_id, from_user_id, to_user_id, status, created_at, expires_at, updated_at) VALUES ('o1', 'ch1', ?, ?, 'offered', '2026', '2099', '2026')`).run(FROM, TO);
	const profiles = new MemoryBucket(Object.fromEntries([...PARTIES, 'usr_stranger'].map((id) => [id, profile(id)])));
	const env = {
		SEARCH_DB: db,
		profiles,
		channels: new MemoryBucket({ ch1: { id: 'ch1', userId: OWNER_NOW, name: 'Morning', handle: 'morning', members: [{ userId: TO, role: 'admin' }] } }),
		videos: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		queue: new MemoryQueue(),
		Issuer: ISSUER,
		ClientId: 'client-1',
		ENVIRONMENT: 'qa',
		INTERNAL_API_KEY: 'k'.repeat(40),
	} as Record<string, unknown>;
	const pending: Promise<unknown>[] = [];
	const get = async (userId: string | null, path: string, method = 'GET') => {
		const res = await worker.fetch(new Request(`https://videos.test${path}`, { method, ...(method === 'POST' ? { body: '{}' } : {}), headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: `Bearer ${await sign(userId)}` } : {}) } }), env as never, { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as never);
		const text = await res.text();
		await Promise.allSettled(pending.splice(0));
		return { status: res.status, text, body: JSON.parse(text) as any };
	};
	return { env, profiles, get };
}

/** The reads each party gets an answer from. */
const READS: Record<string, string[]> = {
	[FROM]: ['/api/move-offers', '/api/move-offers/o1'],
	[TO]: ['/api/move-offers', '/api/move-offers/o1'],
	[OWNER_NOW]: ['/api/move-offers/o1', '/api/channels/ch1/move-offers', '/api/channels/ch1/move-receivers'],
};
const NAMES = /Name of|Morning/;

/** A Secrets Store binding as a Worker has it: an RPC stub, so its method can only be called, never `.call`ed. */
const rpcSecret = (value: string) => ({
	get: new Proxy(async () => value, {
		get(_target, property) {
			throw new TypeError(`The RPC receiver does not implement the method "${String(property)}".`);
		},
	}),
});

describe('secrets read from a Worker’s bindings', () => {
	it('the report check calls the binding’s own get', async () => {
		const asked: string[] = [];
		const answer = (body: unknown) => (async (_url: unknown, init?: RequestInit) => {
			asked.push((init?.headers as Record<string, string>)['X-API-Key']);
			return Response.json(body);
		}) as unknown as typeof fetch;
		const env = { ADMIN_API_URL: 'https://admin.rpc.test', INTERNAL_API_KEY: rpcSecret('key-1') };
		assert.equal(await channelReportUnderReview(env, 'ch1', answer({ success: true, result: { underReview: false } })), false);
		assert.deepEqual(asked, ['key-1']);
		assert.equal(await channelReportUnderReview({ ...env, INTERNAL_API_KEY: 'key-2' }, 'ch1', answer({ success: true, result: { underReview: true } })), true);
		assert.equal(asked[1], 'key-2', 'a plain string, as in local development');
	});
});

describe('channel move offers through the mounted app', () => {
	it('the parties read it; a stranger, a visitor and the switch being off get nothing', async () => {
		const { env, get } = setup();
		for (const [userId, paths] of Object.entries(READS)) {
			for (const path of paths) {
				const res = await get(userId, path);
				assert.equal(res.status, 200, `${userId} ${path} ${res.text}`);
				assert.match(res.text, NAMES);
				assert.ok(!/@test\.example/.test(res.text), 'no email');
			}
		}
		for (const path of ['/api/move-offers/o1', '/api/channels/ch1/move-offers']) {
			assert.equal((await get('usr_stranger', path)).status, 404);
			assert.equal((await get(null, path)).status, 401);
		}
		// The web's pages read the switch this way for a visitor: 401 while it is on
		assert.equal((await get(null, '/api/move-offers')).status, 401);
		env.FEATURES_FORCE_OFF = 'channelMove';
		assert.deepEqual([(await get(null, '/api/move-offers')).status, (await get(null, '/api/move-offers')).body.code], [404, 'feature_off']);
		for (const path of READS[FROM]) assert.equal((await get(FROM, path)).body.code, 'feature_off');
	});

	for (const userId of PARTIES) {
		it(`${userId} banned: refused, names nobody, and an unban lifts it`, async () => {
			const { env, get } = setup();
			await writeBan(env.SEARCH_DB as never, { userId, reason: 'spam', bannedBy: 'usr_admin', bannedAt: '2026' } as never);
			for (const path of READS[userId]) {
				const res = await get(userId, path);
				assert.deepEqual([res.status, res.body.code], [403, 'videos_banned'], path);
				assert.ok(!NAMES.test(res.text), path);
			}
			await deleteBan(env.SEARCH_DB as never, userId);
			assert.equal((await get(userId, READS[userId][0])).status, 200);
		});

		it(`${userId}'s data being deleted: refused, and the others don't see their name; a restore lifts both`, async () => {
			const { env, profiles, get } = setup();
			const mark = { at: '2026', by: 'usr_admin' };
			await recordDeletion(env.SEARCH_DB as never, { kind: 'user', id: userId, title: 'x', deletedBy: 'usr_admin', deletedAt: new Date().toISOString() } as never);
			profiles.store.set(userId, JSON.stringify(profile(userId, { adminDeletion: mark })));
			for (const path of READS[userId]) {
				const res = await get(userId, path);
				assert.deepEqual([res.status, res.body.code], [403, 'videos_account_pending_deletion'], path);
				assert.ok(!NAMES.test(res.text), path);
			}
			const other = userId === TO ? FROM : TO;
			const seen = await get(other, '/api/move-offers/o1');
			assert.equal(seen.status, 200);
			assert.ok(!seen.text.includes(`Name of ${userId.slice(4)}`));
			await removeDeletion(env.SEARCH_DB as never, 'user', userId);
			forgetPendingUserDeletion(userId);
			profiles.store.set(userId, JSON.stringify(profile(userId)));
			assert.equal((await get(userId, READS[userId][0])).status, 200);
		});

		it(`${userId} with no live profile reads no offer, whatever the middleware knows`, async () => {
			const { profiles, get } = setup();
			for (const gone of [null, profile(userId, { isDeleted: true }), profile(userId, { adminDeletion: { at: '2026', by: 'x' } })]) {
				if (gone) profiles.store.set(userId, JSON.stringify(gone));
				else profiles.store.delete(userId);
				assert.equal((await get(userId, '/api/move-offers/o1')).status, 404);
				const list = await get(userId, '/api/move-offers');
				assert.deepEqual([list.status, list.body.data.received, list.body.data.sent], [200, [], []]);
			}
		});
	}

	it('the receiver picker opens on every admin: an empty q is no q', async () => {
		const { get } = setup();
		for (const [query, ids] of [['', [TO]], ['?q=', [TO]], ['?q=%20', [TO]], ['?q=of%20to', [TO]], ['?q=nobody', []]] as const) {
			const res = await get(OWNER_NOW, `/api/channels/ch1/move-receivers${query}`);
			assert.equal(res.status, 200, `${query} ${res.text}`);
			assert.deepEqual(res.body.data.items.map((i: { userId: string }) => i.userId), ids, query);
		}
		assert.equal((await get(OWNER_NOW, `/api/channels/ch1/move-receivers?q=${'x'.repeat(201)}`)).status, 400);
		// A page of my offers, and a cursor that is none
		assert.equal((await get(TO, '/api/move-offers?side=received&cursor=9')).status, 200);
		assert.equal((await get(TO, '/api/move-offers?side=received&cursor=x')).status, 400);
	});

	it('offering, accepting, declining and withdrawing are counted against a limiter, per account', async () => {
		const { env, get } = setup();
		const keys: string[] = [];
		env.REACTION_LIMITER = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: false }; } };
		const writes: Array<[string, string, string]> = [
			[OWNER_NOW, 'POST', '/api/channels/ch1/move-offers'],
			[TO, 'POST', '/api/move-offers/o1/accept'],
			[TO, 'POST', '/api/move-offers/o1/decline'],
			[FROM, 'DELETE', '/api/move-offers/o1'],
		];
		for (const [userId, method, path] of writes) {
			const res = await get(userId, path, method);
			assert.deepEqual([res.status, res.body.code], [429, 'rate_limited'], `${method} ${path}`);
		}
		assert.deepEqual(keys, writes.map(([userId]) => `u:${userId}`));
		// Each read is counted too, and none of the writes against the reads' limiter
		const reads: string[] = [];
		env.SEARCH_LIMITER = { limit: async ({ key }: { key: string }) => { reads.push(key); return { success: false }; } };
		for (const path of ['/api/move-offers', '/api/move-offers/o1', '/api/channels/ch1/move-offers', '/api/channels/ch1/move-receivers']) assert.equal((await get(OWNER_NOW, path)).status, 429, path);
		for (const [userId, method, path] of writes) await get(userId, path, method);
		assert.equal(reads.length, 4);
	});

	it('reads and answers are counted against a limiter, per account', async () => {
		const { env, get } = setup();
		const keys: string[] = [];
		env.SEARCH_LIMITER = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: keys.length <= 2 }; } };
		assert.equal((await get(TO, '/api/move-offers')).status, 200);
		assert.equal((await get(TO, '/api/move-offers/o1')).status, 200);
		const over = await get(TO, '/api/channels/ch1/move-offers');
		assert.deepEqual([over.status, over.body.code], [429, 'rate_limited']);
		assert.deepEqual(keys, [`u:${TO}`, `u:${TO}`, `u:${TO}`]);
	});
});
