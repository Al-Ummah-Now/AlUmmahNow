/**
 * Multi-pass export and erase through the Worker (GET /api/privacy/export, DELETE /api/privacy/data):
 * the progress between passes is sealed (lib/privacy/resume-state.ts), a run goes on only for the
 * account and the kind of run it was made for, and what belongs to the account is decided from the
 * live records of each pass.
 */
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import worker from '../src/index';
import { __resetClientForTests } from '../src/lib/openauth-client';
import { RESUME_TOKEN_MAX, RESUME_TTL_MS, ResumeUnavailableError, openResume, sealResume } from '../src/lib/privacy/resume-state';
import { FOOTPRINT_BUCKETS, handleFootprintBackfillMessage, startFootprintPass } from '../src/lib/privacy/footprints';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { recordDeletion } from '../src/lib/admin/deletions';
import { MemoryBucket, MemoryQueue, commentFixture, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const ISSUER = 'https://auth.test.example';
const ME = 'user-me';
const OTHER = 'user-other';
const KEY = 'k'.repeat(40);

type Json = Record<string, any>;

let sign: (userId: string) => Promise<string>;
let realFetch: typeof fetch;
/** Needs-action items reported to admin-api. */
const flagged: string[] = [];

before(async () => {
	const { publicKey, privateKey } = await generateKeyPair('ES256');
	const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
	sign = (userId) =>
		new SignJWT({ mode: 'access', type: 'user', properties: { id: userId, email: `${userId}@test.example` } })
			.setProtectedHeader({ alg: 'ES256', kid: 'k1' })
			.setIssuer(ISSUER)
			.setAudience('client-1')
			.setSubject(`user:${userId}`)
			.setIssuedAt(new Date())
			.setExpirationTime(new Date(Date.now() + 15 * 60_000))
			.sign(privateKey);
	realFetch = globalThis.fetch;
	// The issuer's documents; nothing else leaves the test
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
		if (url.pathname === '/.well-known/oauth-authorization-server') return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks.json` });
		if (url.pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
		if (url.host === 'errors.test') {
			const { events = [] } = JSON.parse(String(init?.body ?? '{}')) as { events?: Json[] };
			flagged.push(...events.map((e) => e.action?.key as string).filter(Boolean));
			return Response.json({ success: true });
		}
		return new Response('not found', { status: 404 });
	}) as typeof fetch;
});
after(() => {
	globalThis.fetch = realFetch;
});
beforeEach(() => {
	__resetClientForTests();
	flagged.length = 0;
});

/** Two accounts with the same kinds of records; `me`'s also appear on `other`'s content. */
function seed() {
	return {
		profiles: new MemoryBucket({ [ME]: { id: ME, email: 'me@test.example' }, [OTHER]: { id: OTHER, email: 'other@test.example' } }),
		channels: new MemoryBucket({
			'ch-me': { id: 'ch-me', userId: ME, name: 'Mine', handle: 'mine', subscriptions: [] },
			'ch-me2': { id: 'ch-me2', userId: ME, name: 'Mine too', subscriptions: [] },
			'ch-other': { id: 'ch-other', userId: OTHER, name: 'Other', handle: 'other', contactEmail: 'private@other.example', subscriptions: [{ id: 's1', userId: ME, channelId: 'ch-me' }] },
		}),
		channel_sections: new MemoryBucket({ 'ch-me/sec1': { id: 'sec-me' }, 'ch-me2/sec1': { id: 'sec-me2' }, 'ch-other/sec1': { id: 'sec-other' } }),
		channel_tabs: new MemoryBucket({
			'channel-tabs/ch-me': { channelId: 'ch-me' },
			'channel-tabs/ch-other': { channelId: 'ch-other' },
			'channel-handles/mine': { channelId: 'ch-me' },
			'channel-handles/other': { channelId: 'ch-other' },
		}),
		videos: new MemoryBucket({
			'v-mine': videoFixture({ id: 'v-mine', userId: ME, channelId: 'ch-me' }),
			'v-mine2': videoFixture({ id: 'v-mine2', userId: ME, channelId: 'ch-me2' }),
			'v-other': videoFixture({ id: 'v-other', userId: OTHER, channelId: 'ch-other', isPublic: false, comments: [commentFixture('c-mine', { userId: ME, channelId: 'ch-me', text: 'mine' })] }),
			'livestream:ls-mine': { id: 'ls-mine', userId: ME, channelId: 'ch-me' },
			'livestream:ls-other': { id: 'ls-other', userId: OTHER, channelId: 'ch-other' },
		}),
		watch_history: new MemoryBucket({ [`${ME}:v-other`]: { userId: ME, videoId: 'v-other' }, [`${OTHER}:v-mine`]: { userId: OTHER, videoId: 'v-mine' } }),
		community_posts: new MemoryBucket({
			'posts/ch-me/p-mine.json': { id: 'p-mine', channelId: 'ch-me', userId: ME, content: 'mine' },
			'posts/ch-other/p-other.json': { id: 'p-other', channelId: 'ch-other', userId: OTHER, content: 'theirs' },
		}),
		playlists: new MemoryBucket({
			'pl-mine': { id: 'pl-mine', userId: ME, channelId: 'ch-me' },
			'pl-personal': { id: 'pl-personal', userId: ME, channelId: '' },
			'pl-other': { id: 'pl-other', userId: OTHER, channelId: 'ch-other' },
		}),
		'upload-defaults': new MemoryBucket(),
		reports: new MemoryBucket(),
		subtitles: new MemoryBucket({ 'v-mine/original/en.vtt': { x: 1 }, 'v-other/original/en.vtt': { x: 1 } }),
		global_settings: new MemoryBucket(),
		ADMIN_BACKUPS: new MemoryBucket(),
		queue: new MemoryQueue(),
	};
}
type Buckets = ReturnType<typeof seed>;

/** Everything stored for `other` (and only theirs). */
const THEIRS: Array<[keyof Buckets, string]> = [
	['profiles', OTHER],
	['channels', 'ch-other'],
	['channel_sections', 'ch-other/sec1'],
	['channel_tabs', 'channel-tabs/ch-other'],
	['channel_tabs', 'channel-handles/other'],
	['videos', 'v-other'],
	['videos', 'livestream:ls-other'],
	['watch_history', `${OTHER}:v-mine`],
	['community_posts', 'posts/ch-other/p-other.json'],
	['playlists', 'pl-other'],
	['subtitles', 'v-other/original/en.vtt'],
];
const missing = (b: Buckets, keys: Array<[keyof Buckets, string]>) => keys.filter(([bucket, key]) => !(b[bucket] as MemoryBucket).store.has(key)).map((k) => k.join(' '));

const workerEnv = (b: Buckets, vars: Json = {}) => ({ ...b, Issuer: ISSUER, ClientId: 'client-1', ENVIRONMENT: 'qa', INTERNAL_API_KEY: KEY, ERRORS_INGEST_URL: 'https://errors.test/internal/errors', ...vars });
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} };

async function call(userId: string, path: string, init: RequestInit, env: Json, status = 200): Promise<Json> {
	const res = await worker.fetch(
		new Request(`https://videos.test${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await sign(userId)}` } }),
		env as never,
		ctx as never,
	);
	const text = await res.text();
	await Promise.allSettled(pending.splice(0));
	assert.equal(res.status, status, text);
	return JSON.parse(text) as Json;
}
const exportPass = (userId: string, env: Json, resume?: string, status?: number) => call(userId, `/api/privacy/export${resume ? `?resume=${encodeURIComponent(resume)}` : ''}`, {}, env, status);
const erasePass = (userId: string, env: Json, resumeToken?: string, status?: number) =>
	call(userId, '/api/privacy/data', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE', ...(resumeToken ? { resumeToken } : {}) }) }, env, status);

/** Passes until `until`, or until complete. */
async function eraseAll(userId: string, env: Json, options: { token?: string; until?: () => boolean } = {}): Promise<{ token?: string; passes: number; complete: boolean; longest: number }> {
	let token = options.token;
	let longest = 0;
	for (let passes = 1; passes <= 200; passes++) {
		const part = await erasePass(userId, env, token);
		token = part.resumeToken;
		longest = Math.max(longest, token?.length ?? 0);
		if (part.complete) return { passes, complete: true, longest };
		if (options.until?.()) return { token, passes, complete: false, longest };
	}
	throw new Error('the erase did not finish');
}

async function exportAll(userId: string, env: Json): Promise<{ lists: Record<string, Json[]>; passes: number; longest: number }> {
	let longest = 0;
	const lists: Record<string, Json[]> = {};
	let token: string | undefined;
	for (let passes = 1; passes <= 200; passes++) {
		const part = await exportPass(userId, env, token);
		for (const [key, value] of Object.entries(part)) if (Array.isArray(value) && key !== 'notes') (lists[key] ??= []).push(...value);
		token = part.resumeToken;
		longest = Math.max(longest, token?.length ?? 0);
		if (part.complete) return { lists, passes, longest };
	}
	throw new Error('the export did not finish');
}

/** A state in the plain format used before progress was kept by the server. */
const plainState = (state: Json) => Buffer.from(JSON.stringify(state)).toString('base64url');
const plainErase = { v: 3, o: ['ch-other'], k: ['ch-other'] };

/** The token with its state changed: its fields where they can be read, otherwise one character. */
function edited(token: string, change: (state: Json) => void): string {
	try {
		const state = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
		change(state);
		return plainState(state);
	} catch {
		const at = Math.floor(token.length / 2);
		return token.slice(0, at) + (token[at] === 'A' ? 'B' : 'A') + token.slice(at + 1);
	}
}

/** Until the run has passed the channels phase: the first phases are done. */
const started = (b: Buckets) => () => !b.watch_history.store.has(`${ME}:v-other`) && b.channels.read('ch-other').subscriptions.length === 0;
const SMALL = { PRIVACY_OP_BUDGET: '16' };
const LARGE = { PRIVACY_OP_BUDGET: '10000' };

describe('a multi-pass erase', () => {
	it('completes over several passes and leaves nothing of the account', async () => {
		const b = seed();
		const run = await eraseAll(ME, workerEnv(b, SMALL));
		assert.ok(run.passes > 2, `${run.passes} passes`);
		const everything = Object.values(b).filter((x): x is MemoryBucket => x instanceof MemoryBucket).flatMap((x) => [...x.store.keys(), ...x.store.values()]).join('\n');
		assert.ok(!everything.includes(ME));
		for (const gone of ['ch-me', 'ch-me2']) assert.ok(!everything.includes(`"${gone}"`), gone);
		assert.deepEqual(missing(b, THEIRS), []);
	});

	it('completes with the indexes, and a channel\'s rows go with it even when the token is lost afterwards', async () => {
		const b = seed();
		const db = new SqliteD1();
		const queue = new MemoryQueue();
		const env = workerEnv(b, { ...SMALL, SEARCH_DB: db, PROCESSING_CHECK_QUEUE: queue });
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(env as never, kind, { maxPages: 50 });
		for (const bucket of FOOTPRINT_BUCKETS) await startFootprintPass(env as never, bucket, { dryRun: false });
		for (let i = 0; queue.messages.length && i < 1000; i++) await handleFootprintBackfillMessage(env as never, queue.messages.shift());
		const add = (id: string, channelId: string) =>
			db.db.prepare(`INSERT INTO channel_comments (comment_id, channel_id, target_kind, target_id, author_user_id, status, created_at, updated_at) VALUES (?, ?, 'video', 'v', 'user-third', 'published', 't', 't')`).run(id, channelId);
		add('cc-me', 'ch-me');
		add('cc-me2', 'ch-me2');
		add('cc-other', 'ch-other');
		const first = await eraseAll(ME, env, { until: () => !b.channels.store.has('ch-me') && !b.channels.store.has('ch-me2') });
		assert.equal(first.complete, false, 'channels gone, the run is not finished');
		const rest = await eraseAll(ME, env);
		assert.equal(rest.complete, true);
		assert.deepEqual(db.db.prepare('SELECT comment_id FROM channel_comments').all().map((r) => (r as Json).comment_id), ['cc-other']);
		assert.equal(b.profiles.store.has(ME), false);
		assert.deepEqual(missing(b, THEIRS), []);
	});

	it('goes on with its token after its channel records are gone', async () => {
		const b = seed();
		const env = workerEnv(b, SMALL);
		const first = await eraseAll(ME, env, { until: () => !b.channels.store.has('ch-me') && !b.channels.store.has('ch-me2') });
		assert.equal(first.complete, false);
		const scans = b.channels.calls;
		const rest = await eraseAll(ME, env, { token: first.token });
		assert.equal(rest.complete, true);
		assert.ok(b.channels.calls - scans <= rest.passes + 4, 'the channels are not walked again');
		assert.equal(b.profiles.store.has(ME), false);
		assert.deepEqual(missing(b, THEIRS), []);
	});

	it('starts over on a state in the old format', async () => {
		for (let p = 0; p <= 18; p++) {
			const b = seed();
			// `other` has nothing to do with this run: only the caller's data may go
			const part = await erasePass(ME, workerEnv(b, LARGE), plainState({ ...plainErase, p }));
			assert.equal(part.complete, true);
			assert.deepEqual(missing(b, THEIRS), [], `p ${p}`);
			assert.equal(b.channels.store.has('ch-me'), false, `p ${p}: the run began at the start`);
			assert.equal(b.watch_history.store.has(`${ME}:v-other`), false, `p ${p}`);
		}
	});

	it('starts over on a state of another account', async () => {
		const b = seed();
		const first = await eraseAll(ME, workerEnv(b, SMALL), { until: started(b) });
		assert.ok(first.token);
		const mine: Array<[keyof Buckets, string]> = (['v-mine', 'v-mine2'] as const).map((key) => ['videos', key] as [keyof Buckets, string]).filter(([x, key]) => (b[x] as MemoryBucket).store.has(key));
		const channels: Array<[keyof Buckets, string]> = [['channels', 'ch-me'], ['channels', 'ch-me2']];
		const part = await erasePass(OTHER, workerEnv(b, LARGE), first.token);
		assert.equal(part.complete, true);
		assert.deepEqual(missing(b, [...mine, ...channels]), [], 'the first account keeps its data');
		assert.deepEqual(missing(b, THEIRS).length, THEIRS.length, 'the caller\'s own erase ran from the start');
	});

	it('starts over on an edited state', async () => {
		const b = seed();
		const first = await eraseAll(ME, workerEnv(b, SMALL), { until: started(b) });
		const token = edited(first.token!, (state) => {
			state.o = ['ch-other'];
			state.k = ['ch-other'];
		});
		const part = await erasePass(ME, workerEnv(b, LARGE), token);
		assert.equal(part.complete, true);
		assert.deepEqual(missing(b, THEIRS), []);
		assert.equal(b.channels.store.has('ch-me'), false);
	});

	it('starts over on every single-character change of a state', async () => {
		const state = { p: 3, t: 1, o: ['ch-me'], k: ['ch-me'] };
		const env = { INTERNAL_API_KEY: KEY, ENVIRONMENT: 'qa' };
		const scope = { purpose: 'erase', userId: ME, version: 4 } as const;
		const token = (await sealResume(env, scope, state))!;
		assert.deepEqual(await openResume(env, scope, token), { state });
		for (let i = 0; i < token.length - 1; i++) {
			const changed = token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1);
			assert.deepEqual(await openResume(env, scope, changed), { restart: 'unusable' }, `at ${i}`);
		}
	});

	it('starts over on a state of an export', async () => {
		const b = seed();
		const first = await exportPass(ME, workerEnv(b, { PRIVACY_OP_BUDGET: '20' }));
		assert.ok(first.resumeToken);
		const token = edited(first.resumeToken, (state) => Object.assign(state, { v: 3, p: 14, k: [] }));
		for (const given of [first.resumeToken, token]) {
			const again = seed();
			const part = await erasePass(ME, workerEnv(again, LARGE), given);
			assert.equal(part.complete, true);
			assert.equal(again.channels.store.has('ch-me'), false);
			assert.equal(again.watch_history.store.has(`${ME}:v-other`), false);
		}
	});
});

describe('a channel that changes hands during an erase', () => {
	/** The move as the admin job makes it: the channel first, its records afterwards. */
	const moveChannel = (b: Buckets) => {
		b.channels.store.set('ch-me', JSON.stringify({ ...b.channels.read('ch-me'), userId: OTHER, transferredAt: new Date().toISOString() }));
	};
	const moveRecords = (b: Buckets) => {
		for (const [bucket, key] of [['videos', 'v-mine'], ['videos', 'livestream:ls-mine'], ['playlists', 'pl-mine'], ['community_posts', 'posts/ch-me/p-mine.json']] as const) {
			const record = b[bucket].read(key);
			if (record) b[bucket].store.set(key, JSON.stringify({ ...record, userId: OTHER }));
		}
	};
	const MOVED: Array<[keyof Buckets, string]> = [
		['channels', 'ch-me'],
		['channel_tabs', 'channel-handles/mine'],
		['videos', 'v-mine'],
		['videos', 'livestream:ls-mine'],
		['subtitles', 'v-mine/original/en.vtt'],
		['community_posts', 'posts/ch-me/p-mine.json'],
		['playlists', 'pl-mine'],
	];

	for (const records of [true, false]) {
		it(`stays with its new owner (its records ${records ? 'moved too' : 'are still moving'})`, async () => {
			const b = seed();
			const list = b.videos.list.bind(b.videos);
			let moved = false;
			// The videos phase begins: the run already knows the channel
			b.videos.list = (async (opts: never) => {
				if (!moved) {
					moved = true;
					moveChannel(b);
					if (records) moveRecords(b);
				}
				return list(opts);
			}) as never;
			const run = await eraseAll(ME, workerEnv(b, SMALL));
			assert.equal(run.complete, true);
			assert.ok(moved && run.passes > 1);
			assert.deepEqual(missing(b, [...MOVED, ...THEIRS]), []);
			assert.equal(b.channels.store.has('ch-me2'), false, 'the account\'s other channel went');
			assert.equal(b.videos.store.has('v-mine2'), false);
			assert.equal(b.playlists.store.has('pl-personal'), false);
			assert.equal(b.profiles.store.has(ME), false);
		});
	}

	it('is left alone when the move landed just before the run and its records are still moving', async () => {
		const b = seed();
		const db = new SqliteD1();
		moveChannel(b);
		b.channels.store.set('ch-me', JSON.stringify({ ...b.channels.read('ch-me'), transferredAt: '2026-01-01T00:00:00.000Z' }));
		db.db.prepare('INSERT INTO channel_transfer_locks (channel_id, job_id, created_at) VALUES (?, ?, ?)').run('ch-me', 'job-1', 't');
		const run = await eraseAll(ME, workerEnv(b, { ...LARGE, SEARCH_DB: db }));
		assert.equal(run.complete, true);
		assert.deepEqual(missing(b, [...MOVED, ...THEIRS]), []);
		assert.equal(b.profiles.store.has(ME), false);
	});

	it('keeps what the move left behind: it goes to the new owner, and an export leaves it out', async () => {
		for (const SEARCH_DB of [undefined, new SqliteD1()]) {
			const b = seed();
			const env = workerEnv(b, { ...LARGE, ...(SEARCH_DB ? { SEARCH_DB } : {}) });
			// Moved long ago and finished; some records still name the previous owner
			b.channels.store.set('ch-me', JSON.stringify({ ...b.channels.read('ch-me'), userId: OTHER, transferredAt: '2026-01-01T00:00:00.000Z' }));
			const { lists } = await exportAll(ME, env);
			for (const list of [lists.videos, lists.playlists, lists.communityPosts]) assert.ok(!JSON.stringify(list ?? []).includes('"ch-me"'));
			assert.deepEqual(lists.channels.map((x) => x.id), ['ch-me2']);
			const run = await eraseAll(ME, env);
			assert.equal(run.complete, true);
			assert.deepEqual(missing(b, [...MOVED, ...THEIRS]), []);
			for (const [bucket, key] of [['videos', 'v-mine'], ['videos', 'livestream:ls-mine'], ['playlists', 'pl-mine'], ['community_posts', 'posts/ch-me/p-mine.json']] as const) {
				assert.equal((b[bucket] as MemoryBucket).read(key).userId, OTHER, key);
			}
			assert.equal(b.playlists.store.has('pl-personal'), false);
			const everything = Object.values(b).filter((x): x is MemoryBucket => x instanceof MemoryBucket).flatMap((x) => [...x.store.keys(), ...x.store.values()]).join('\n');
			assert.ok(!everything.includes(ME), 'nothing names the account any more');
		}
	});

	it('is not part of a run that began before the account received it', async () => {
		const b = seed();
		b.channels.store.set('ch-other', JSON.stringify({ ...b.channels.read('ch-other'), userId: ME, transferredAt: new Date(Date.now() + 1000).toISOString() }));
		b.videos.store.set('v-other', JSON.stringify({ ...b.videos.read('v-other'), userId: ME }));
		await eraseAll(ME, workerEnv(b, LARGE));
		assert.deepEqual(missing(b, THEIRS), []);
		assert.equal(b.channels.store.has('ch-me'), false);
	});
});

describe('a multi-pass export', () => {
	const ids = (list: Json[] = []) => list.map((x) => x.id).sort();

	it('merges to the single-pass export', async () => {
		const b = seed();
		const { lists: full } = await exportAll(ME, workerEnv(b, LARGE));
		const { lists, passes } = await exportAll(ME, workerEnv(b, { PRIVACY_OP_BUDGET: '20' }));
		assert.ok(passes > 1, `${passes} passes`);
		assert.deepEqual(lists, full);
		assert.deepEqual(ids(full.videos), ['ls-mine', 'v-mine', 'v-mine2']);
		assert.deepEqual(ids(full.channelSections), ['sec-me', 'sec-me2']);
	});

	it('starts over on a state in the old format', async () => {
		for (let p = 0; p <= 19; p++) {
			const part = await exportPass(ME, workerEnv(seed(), LARGE), plainState({ p, o: ['ch-other'], k: [] }));
			assert.equal(part.complete, true);
			assert.ok(part.profile, `p ${p}: from the start`);
			assert.deepEqual(ids(part.channelSections), ['sec-me', 'sec-me2']);
			assert.deepEqual(ids(part.videos), ['ls-mine', 'v-mine', 'v-mine2']);
			assert.deepEqual(ids(part.communityPosts), ['p-mine']);
			assert.equal(part.restarted, true);
		}
	});

	it('starts over on a state of another account, of an erase, or edited', async () => {
		const b = seed();
		const mine = (await exportPass(ME, workerEnv(b, { PRIVACY_OP_BUDGET: '20' }))).resumeToken as string;
		const theirs = (await exportPass(OTHER, workerEnv(b, { PRIVACY_OP_BUDGET: '20' }))).resumeToken as string;
		const erase = (await eraseAll(ME, workerEnv(seed(), SMALL), { until: () => true })).token as string;
		for (const [name, token] of Object.entries({
			theirs,
			erase,
			relabeled: edited(erase, (state) => {
				delete state.v;
				state.p = 5;
				state.o = ['ch-other'];
			}),
			edited: edited(mine, (state) => {
				state.o = ['ch-other'];
			}),
		})) {
			const part = await exportPass(ME, workerEnv(b, LARGE), token);
			assert.equal(part.restarted, true, name);
			assert.ok(part.profile, name);
			assert.deepEqual(ids(part.channelSections), ['sec-me', 'sec-me2'], name);
			assert.deepEqual(ids(part.videos), ['ls-mine', 'v-mine', 'v-mine2'], name);
		}
		const goesOn = await exportPass(ME, workerEnv(b, LARGE), mine);
		assert.equal(goesOn.restarted, undefined);
		assert.equal(goesOn.profile, null, 'the profile came with the first pass');
	});

	it('leaves out a channel that changed hands since the last pass', async () => {
		const b = seed();
		const first = await exportPass(ME, workerEnv(b, { PRIVACY_OP_BUDGET: '20' }));
		assert.deepEqual(ids(first.channels), ['ch-me', 'ch-me2']);
		assert.ok(first.resumeToken);
		b.channels.store.set('ch-me', JSON.stringify({ ...b.channels.read('ch-me'), userId: OTHER, transferredAt: new Date().toISOString() }));
		b.channel_sections.store.set('ch-me/sec2', JSON.stringify({ id: 'sec-new-owner' }));
		b.videos.store.set('v-new', JSON.stringify(videoFixture({ id: 'v-new', userId: OTHER, channelId: 'ch-me' })));
		b.community_posts.store.set('posts/ch-me/p-new.json', JSON.stringify({ id: 'p-new', channelId: 'ch-me', userId: OTHER }));
		const rest = await exportPass(ME, workerEnv(b, LARGE), first.resumeToken);
		assert.equal(rest.restarted, undefined);
		const all = JSON.stringify(rest);
		for (const id of ['sec-new-owner', 'v-new', 'p-new']) assert.ok(!all.includes(id), id);
		assert.deepEqual(ids(rest.videos), ['v-mine2']);
	});
});

describe('a channel record that cannot be read', () => {
	const CORRUPT = ['{"id":"ch-me","userId":', 'null', '{"id":"ch-me"}'];
	const HELD: Array<[keyof Buckets, string]> = [['channels', 'ch-me'], ['videos', 'v-mine'], ['videos', 'livestream:ls-mine'], ['playlists', 'pl-mine'], ['community_posts', 'posts/ch-me/p-mine.json']];

	it('is left in place with what is on it and reported; the rest of the erase finishes', async () => {
		for (const body of CORRUPT) {
			const b = seed();
			b.channels.store.set('ch-me', body);
			const part = await erasePass(ME, workerEnv(b, LARGE));
			assert.equal(part.complete, true);
			assert.ok(part.errors.includes('channel_unreadable:ch-me'), body);
			assert.deepEqual(missing(b, [...HELD, ...THEIRS]), []);
			assert.ok(flagged.includes('privacy-channel-unreadable:ch-me'));
			for (const key of ['ch-me2']) assert.equal(b.channels.store.has(key), false);
			assert.equal(b.profiles.store.has(ME), false);
			flagged.length = 0;
		}
	});

	it('is left out of an export, which says so', async () => {
		const b = seed();
		b.channels.store.set('ch-me', CORRUPT[0]);
		const part = await exportPass(ME, workerEnv(b, LARGE));
		assert.equal(part.complete, true);
		assert.deepEqual(part.unreadableChannels, ['ch-me']);
		assert.deepEqual(part.videos.map((v: Json) => v.id), ['v-mine2']);
		assert.deepEqual(part.playlists.map((p: Json) => p.id), ['pl-personal']);
		assert.ok(flagged.includes('privacy-channel-unreadable:ch-me'));
	});

	it('is reported through the ownership index even when nothing is on it', async () => {
		const b = seed();
		const db = new SqliteD1();
		const env = workerEnv(b, { ...LARGE, SEARCH_DB: db });
		await runOwnershipPass(env as never, 'channel', { maxPages: 50 });
		for (const key of ['ch-me2', 'ch-other']) b.channels.store.set(key, '{');
		for (const key of ['v-mine2', 'v-other', 'livestream:ls-other']) b.videos.store.delete(key);
		const part = await exportPass(ME, env);
		assert.deepEqual(part.unreadableChannels, ['ch-me2'], 'the account\'s own, not another account\'s');
		assert.deepEqual(part.channels.map((x: Json) => x.id), ['ch-me']);
		const erased = await erasePass(ME, env);
		assert.equal(erased.complete, true);
		assert.deepEqual(erased.errors.filter((e: string) => e.startsWith('channel_unreadable')), ['channel_unreadable:ch-me2']);
	});

	it('is not the same as no record: the record\'s own owner decides then', async () => {
		const b = seed();
		b.channels.store.delete('ch-me');
		const part = await exportPass(ME, workerEnv(b, LARGE));
		assert.deepEqual(part.videos.map((v: Json) => v.id).sort(), ['ls-mine', 'v-mine', 'v-mine2']);
		assert.equal(part.unreadableChannels, undefined);
		// Someone else's record on the missing channel is not the account's
		b.videos.store.set('v-third', JSON.stringify(videoFixture({ id: 'v-third', userId: 'user-third', channelId: 'ch-me' })));
		const erased = await erasePass(ME, workerEnv(b, LARGE));
		assert.equal(erased.complete, true);
		assert.deepEqual(missing(b, HELD).length, HELD.length);
		assert.ok(b.videos.store.has('v-third'));
		assert.deepEqual(flagged, []);
	});
});

describe('an account with many channels', () => {
	const N = 90;
	const id = (i: number) => `channel-00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
	const many = () => {
		const b = seed();
		for (let i = 0; i < N; i++) {
			b.channels.store.set(id(i), JSON.stringify({ id: id(i), userId: ME, name: `c${i}` }));
			b.channel_sections.store.set(`${id(i)}/s`, JSON.stringify({ id: `s${i}` }));
			// Put there by someone else: only the channel makes it the account's
			b.videos.store.set(`v${i}`, JSON.stringify(videoFixture({ id: `v${i}`, userId: 'user-third', channelId: id(i) })));
			b.community_posts.store.set(`posts/${id(i)}/p${i}.json`, JSON.stringify({ id: `p${i}`, channelId: id(i), userId: 'user-third' }));
		}
		return b;
	};
	const BUDGET = { PRIVACY_OP_BUDGET: '250' };

	it('is exported in rounds, once each, with short tokens', async () => {
		const b = many();
		const { lists, passes, longest } = await exportAll(ME, workerEnv(b, BUDGET));
		assert.ok(passes > 3 && longest <= RESUME_TOKEN_MAX / 2, `${passes} passes, ${longest}`);
		const count = (name: string, n: number) => {
			const ids = lists[name].map((x) => x.id);
			assert.equal(ids.length, n, name);
			assert.equal(new Set(ids).size, n, name);
		};
		count('channels', N + 2);
		count('channelSections', N + 2);
		count('videos', N + 3);
		count('communityPosts', N + 1);
		count('playlists', 2);
		assert.equal(lists.videoComments.length, 1);
		assert.equal(lists.subscriptions.length, 1);
		assert.equal(lists.watchHistory.length, 1);
	});

	it('is erased in rounds, by scan and by index', async () => {
		for (const indexed of [false, true]) {
			const b = many();
			const db = new SqliteD1();
			const queue = new MemoryQueue();
			const env = workerEnv(b, { ...BUDGET, ...(indexed ? { SEARCH_DB: db, PROCESSING_CHECK_QUEUE: queue } : {}) });
			if (indexed) {
				for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(env as never, kind, { maxPages: 50 });
				for (const bucket of FOOTPRINT_BUCKETS) await startFootprintPass(env as never, bucket, { dryRun: false });
				for (let i = 0; queue.messages.length && i < 1000; i++) await handleFootprintBackfillMessage(env as never, queue.messages.shift());
			}
			const run = await eraseAll(ME, env);
			assert.ok(run.passes > 3 && run.longest <= RESUME_TOKEN_MAX / 2, `${run.passes} passes, ${run.longest}`);
			assert.deepEqual([...b.channels.store.keys()], ['ch-other']);
			assert.deepEqual([...b.channel_sections.store.keys()], ['ch-other/sec1']);
			assert.deepEqual([...b.videos.store.keys()].sort(), ['livestream:ls-other', 'v-other']);
			assert.deepEqual([...b.community_posts.store.keys()], ['posts/ch-other/p-other.json']);
			assert.deepEqual(missing(b, THEIRS), []);
		}
	});
});

describe('when a run cannot be continued', () => {
	const NO_KEY = [{ INTERNAL_API_KEY: undefined }, { INTERNAL_API_KEY: { get: async () => Promise.reject(new Error('store unavailable')) } }];

	it('an export that needs another pass is an error, never a part; a single pass still works', async () => {
		for (const vars of NO_KEY) {
			const body = await exportPass(ME, workerEnv(seed(), { PRIVACY_OP_BUDGET: '20', ...vars }), undefined, 503);
			assert.equal(body.code, 'resume_unavailable');
			assert.equal(body.profile, undefined);
			assert.equal((await exportPass(ME, workerEnv(seed(), { ...LARGE, ...vars }))).complete, true);
		}
	});

	it('an erase that needs another pass is an error after its follow-ups', async () => {
		const b = seed();
		const env = workerEnv(b, { PRIVACY_OP_BUDGET: '40', INTERNAL_API_KEY: undefined });
		const body = await erasePass(ME, env, undefined, 503);
		assert.equal(body.code, 'resume_unavailable');
		const gone = ['v-mine', 'v-mine2'].filter((key) => !b.videos.store.has(key));
		assert.ok(gone.length > 0);
		for (const videoId of gone) assert.ok(JSON.stringify(b.queue.messages).includes(videoId), 'the processor hears of every deleted video');
		assert.deepEqual(missing(b, THEIRS), []);
	});

	it('a token is kept, not dropped, while the key cannot be read', async () => {
		const b = seed();
		const first = await eraseAll(ME, workerEnv(b, SMALL), { until: started(b) });
		const before = b.channels.calls;
		await erasePass(ME, workerEnv(b, { ...LARGE, ...NO_KEY[1] }), first.token, 503);
		assert.equal(b.channels.calls, before, 'nothing ran');
		assert.equal((await erasePass(ME, workerEnv(b, LARGE), first.token)).complete, true);
	});

	it('the admin job fails its attempt instead of queueing itself again', async () => {
		const big = async (vars: Json) => {
			const b = seed();
			for (let i = 0; i < 400; i++) b.videos.store.set(`v${i}`, JSON.stringify(videoFixture({ id: `v${i}`, userId: ME, channelId: 'ch-me' })));
			const db = new SqliteD1();
			await recordDeletion(db as never, { kind: 'user', id: ME, deletedBy: 'admin' } as never);
			return workerEnv(b, { SEARCH_DB: db, ...vars });
		};
		const run = (env: Json, params: Json) => ADMIN_JOB_HANDLERS['user.delete-data']!(env as never, { id: 'j', kind: 'user.delete-data', targetId: ME, params, result: null } as never);
		await assert.rejects(run(await big({ INTERNAL_API_KEY: undefined }), {}), ResumeUnavailableError);
		const next = (await run(await big({}), {})) as Json;
		assert.equal(next.done, false);
		assert.deepEqual(Object.keys(next.params), ['resumeToken']);
		const again = (await run(await big({}), { resumeToken: 'old' })) as Json;
		assert.equal(again.params.restarts, 1);
		await assert.rejects(run(await big({}), { resumeToken: 'old', restarts: 5 }), /started over 6 times/);
		// A run that goes on keeps its count and is not stopped by it
		assert.equal(((await run(await big({}), { resumeToken: next.params.resumeToken, restarts: 5 })) as Json).done !== undefined, true);
	});
});

describe('when a state expires', () => {
	afterEach(() => mock.timers.reset());
	const at = (ms: number) => {
		mock.timers.reset();
		mock.timers.enable({ apis: ['Date'], now: ms });
	};

	it('export and erase start over', async () => {
		const t0 = Date.now();
		at(t0);
		const b = seed();
		const exported = await exportPass(ME, workerEnv(b, { PRIVACY_OP_BUDGET: '20' }));
		const erased = await eraseAll(ME, workerEnv(b, SMALL), { until: started(b) });
		at(t0 + RESUME_TTL_MS - 60_000);
		assert.equal((await exportPass(ME, workerEnv(b, LARGE), exported.resumeToken)).profile, null, 'still goes on');
		at(t0 + RESUME_TTL_MS + 1000);
		const late = await exportPass(ME, workerEnv(b, LARGE), exported.resumeToken);
		assert.ok(late.profile, 'from the start');
		// Watched again meanwhile: only a run from the start removes it
		b.watch_history.store.set(`${ME}:v-other`, JSON.stringify({ userId: ME, videoId: 'v-other' }));
		const part = await erasePass(ME, workerEnv(b, LARGE), erased.token);
		assert.equal(part.complete, true);
		assert.equal(b.watch_history.store.has(`${ME}:v-other`), false);
		assert.deepEqual(missing(b, THEIRS), []);
	});
});

describe('the sealed state', () => {
	const env = { INTERNAL_API_KEY: { get: async () => KEY }, ENVIRONMENT: 'qa' };
	const scope = { purpose: 'erase', userId: ME, version: 4 } as const;
	const state = { p: 1 };

	it('opens only in its own scope, environment and key', async () => {
		const token = (await sealResume(env, scope, state))!;
		assert.deepEqual(await openResume(env, scope, token), { state });
		const refused = { restart: 'unusable' };
		assert.deepEqual(await openResume(env, { ...scope, userId: OTHER }, token), refused);
		assert.deepEqual(await openResume(env, { ...scope, purpose: 'export' }, token), refused);
		assert.deepEqual(await openResume(env, { ...scope, version: 5 }, token), refused);
		assert.deepEqual(await openResume({ ...env, ENVIRONMENT: 'production' }, scope, token), refused);
		assert.deepEqual(await openResume({ ...env, INTERNAL_API_KEY: 'z'.repeat(40) }, scope, token), refused);
		for (const bad of ['', 'r1.', 'r1.AAAA', 'r1.***', token.slice(0, -4), `${token}${'A'.repeat(20_000)}`]) assert.deepEqual(await openResume(env, scope, bad), refused, bad.slice(0, 20));
	});

	it('shows nothing of the run and is never the same twice', async () => {
		const [a, b] = [await sealResume(env, scope, { o: ['ch-me'] }), await sealResume(env, scope, { o: ['ch-me'] })];
		assert.notEqual(a, b);
		assert.ok(!Buffer.from(a!.slice(3), 'base64url').toString('latin1').includes('ch-me'));
	});

	it('is neither made nor opened without a readable key', async () => {
		const token = (await sealResume(env, scope, state))!;
		const broken = { get: async () => Promise.reject(new Error('store unavailable')) };
		for (const INTERNAL_API_KEY of [undefined, '', 'short', { get: async () => '' }, broken]) {
			await assert.rejects(sealResume({ INTERNAL_API_KEY }, scope, state), ResumeUnavailableError);
			await assert.rejects(openResume({ INTERNAL_API_KEY }, scope, token), ResumeUnavailableError);
		}
	});

	it('has one length limit: what is made can be opened, what would be longer is refused', async () => {
		const room = Math.floor(((RESUME_TOKEN_MAX - 3) * 3) / 4) - 12 - 16 - JSON.stringify({ e: Date.now(), s: { x: '' } }).length;
		const longest = { x: 'a'.repeat(room) };
		const token = await sealResume(env, scope, longest);
		assert.ok(token.length <= RESUME_TOKEN_MAX && token.length > RESUME_TOKEN_MAX - 4, `${token.length}`);
		assert.deepEqual(await openResume(env, scope, token), { state: longest });
		await assert.rejects(sealResume(env, scope, { x: 'a'.repeat(room + 1) }), ResumeUnavailableError);
	});
});
