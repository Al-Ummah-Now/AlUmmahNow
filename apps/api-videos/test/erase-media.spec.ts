/**
 * The media of an erased account (lib/privacy/erase-media.ts): written down before its record goes,
 * deleted by the admin job user.erase-media, retried until gone, and never anyone else's.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { JobsQueue, MemoryBucket, MemoryQueue, drainJobs, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';
import { errorHandler } from '../src/middleware/error-handler';
import { privacyRouter } from '../src/routers/privacy.router';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { recordDeletion } from '../src/lib/admin/deletions';
import { createJob, getJob } from '../src/lib/admin/jobs';
import { ERASE_DELAY, ERASE_MEDIA_JOB, RETRY_DELAYS, RUN_ACCOUNT_DELAY, SWEEP_DELAY, eraseMediaHooks, onEraseMediaFailed, runEraseMedia } from '../src/lib/privacy/erase-media';
import { ownershipCompleteKey } from '@al-ummah/shared-types';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { endParts, erasedRecord, erasedTargets, holdTargets, takePart, uploadersUnderTakedown, writeTarget } from '../src/lib/privacy/erase-targets';
import { eraseRunUserData } from '../src/lib/privacy/run-user-erase';
import { eraseUserData } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { backfillImageOwnersStep, isUploadRow, recordImageOwner } from '../src/lib/csam/imageOwners';

type Json = Record<string, any>;
const ME = 'usr_me';
const OTHER = 'usr_other';
const IMG = 'https://images.alummahnow.net';

/** Bunny Storage, Bunny Stream and Cloudflare's cache API. */
const out = { images: new Set<string>(), bunny: new Set<string>(), purged: [] as string[], failBunny: false, failCdn: false, failImages: false, flagged: [] as Json[] };
let realFetch: typeof fetch;
before(() => {
	realFetch = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		const method = init?.method ?? 'GET';
		if (url.hostname === 'errors.test') {
			for (const e of (JSON.parse(String(init?.body)) as { events?: Json[] }).events ?? []) if (e.action?.key) out.flagged.push({ key: e.action.key, message: e.message });
			return Response.json({ success: true });
		}
		if (url.hostname === 'video.bunnycdn.com') {
			if (out.failBunny) return new Response('down', { status: 500 });
			const id = url.pathname.split('/').pop()!;
			if (method === 'DELETE') return out.bunny.delete(id) ? Response.json({ success: true }) : new Response('{}', { status: 404 });
			return Response.json({});
		}
		if (url.hostname === 'api.cloudflare.com') {
			if (out.failCdn) return new Response('no', { status: 500 });
			const body = JSON.parse(String(init?.body ?? '{}')) as { files?: string[]; prefixes?: string[] };
			out.purged.push(...(body.files ?? []), ...(body.prefixes ?? []));
			return Response.json({ success: true });
		}
		if (url.hostname === 'storage.bunnycdn.com') {
			if (out.failImages) return new Response('down', { status: 500 });
			const path = decodeURIComponent(url.pathname.replace(/^\/zone/, ''));
			if (method === 'DELETE') return out.images.delete(path) ? Response.json({}) : new Response('gone', { status: 404 });
			const items = [...out.images].filter((f) => f.startsWith(path) && !f.slice(path.length).includes('/')).map((f) => ({ ObjectName: f.slice(path.length), IsDirectory: false }));
			return items.length ? Response.json(items) : new Response('gone', { status: 404 });
		}
		return new Response('not found', { status: 404 });
	}) as typeof fetch;
});
after(() => {
	globalThis.fetch = realFetch;
});
beforeEach(() => {
	Object.assign(out, { images: new Set(), bunny: new Set(), purged: [], failBunny: false, failCdn: false, failImages: false, flagged: [] });
});

const media = (id: string) => ({
	pub: [`pub/${id}/r1/master.m3u8`, `pub/${id}/r1/720p/0.m4s`, `pub/thumbs/${id}/a.jpg`],
	priv: [`priv/${id}/r1/master.m3u8`, `staging/${id}/s1/_manifest.json`, `review/${id}/r1/manifest.json`, `review/${id}/r1/frames/0.jpg`, `review/${id}/r1/transcript.json`, `review/${id}/audio-t1-abcdef01/manifest.json`],
	original: [`src/${id}/u1/0`, `audio/${id}/t1/u/0`],
});

async function setup() {
	const db = new SqliteD1();
	const files = (keys: string[]) => new MemoryBucket(Object.fromEntries(keys.map((k) => [k, { x: 1 }])));
	const ids = ['v-mine', 'v-member', 'v-other', 'v-guest'];
	const MEDIA = files(ids.flatMap((id) => media(id).pub));
	const MEDIA_PRIVATE = files([...ids.flatMap((id) => media(id).priv), `studio/${ME}/kit.json`, 'review/ls-mine/r1/frames/0.jpg', 'review/ls-other/r1/frames/0.jpg']);
	const MEDIA_ORIGINALS = files(ids.flatMap((id) => media(id).original));
	const LIVE_MEDIA = files(['live/sess-mine/720/0.m4s', 'live/sess-mine/vod.m3u8', 'live/sess-other/720/0.m4s']);
	for (const id of ids) out.bunny.add(id);
	out.bunny.add('bunny-live-mine').add('bunny-live-other');
	const stored: Array<[string, string, string | null, string | null]> = [
		['/a-me_avatar.jpg', 'profile_avatar', ME, null],
		['/a-me-old_avatar.jpg', 'profile_avatar', ME, null],
		['/c-me_avatar.jpg', 'channel_avatar', ME, 'ch-me'],
		// A channel admin's upload for the user's channel
		['/c-me-member_cover.jpg', 'channel_cover', OTHER, 'ch-me'],
		['/a-other_avatar.jpg', 'profile_avatar', OTHER, null],
		['/c-other_avatar.jpg', 'channel_avatar', OTHER, 'ch-other'],
		['/community-posts/ch-me/p1.webp', 'post_image', ME, 'ch-me'],
		['/community-posts/ch-me/by-member.webp', 'post_image', OTHER, 'ch-me'],
		// The user's uploads for someone else's channel
		['/community-posts/ch-other/by-me.webp', 'post_image', ME, 'ch-other'],
		['/community-posts/ch-other/p2.webp', 'post_image', OTHER, 'ch-other'],
		['/c-other-by-me_cover.jpg', 'channel_cover', ME, 'ch-other'],
	];
	for (const [path, kind, owner, channel] of stored) {
		out.images.add(path);
		db.db.prepare('INSERT INTO image_owners (path, kind, owner_id, channel_id, created_at) VALUES (?, ?, ?, ?, ?)').run(path, kind, owner, channel, '2026-11-01T00:00:00.000+00:00');
	}
	for (const id of ids) out.images.add(`/thumbnails/${id}/t.jpg`);
	out.images.add('/legacy_avatar.jpg');
	const session = (id: string, stream: string, provider: string, ref: string | null) =>
		db.db.prepare(`INSERT INTO live_sessions (id, stream_id, channel_id, provider, provider_ref, status, reason, created_at) VALUES (?, ?, 'x', ?, ?, 'ended', 'test', 1)`).run(id, stream, provider, ref);
	session('sess-mine', 'ls-mine', 'selfhosted', null);
	session('sess-mine-b', 'ls-mine', 'bunny', 'bunny-live-mine');
	session('sess-other', 'ls-other', 'selfhosted', null);
	session('sess-other-b', 'ls-other', 'bunny', 'bunny-live-other');
	const env = {
		SEARCH_DB: db,
		NOTIFICATIONS_DB: createSqliteD1(),
		ADMIN_JOBS_QUEUE: new JobsQueue(),
		profiles: new MemoryBucket({
			[ME]: { id: ME, avatarUrl: `${IMG}/a-me_avatar.jpg`, coverUrl: `${IMG}/a-other_avatar.jpg` },
			[OTHER]: { id: OTHER, avatarUrl: `${IMG}/a-other_avatar.jpg` },
		}),
		channels: new MemoryBucket({
			// Its avatar is its own; its cover names another channel's file
			'ch-me': { id: 'ch-me', userId: ME, avatarUrl: `${IMG}/c-me_avatar.jpg`, coverUrl: `${IMG}/c-other_avatar.jpg`, pendingImages: { coverUrl: { url: `${IMG}/c-me-member_cover.jpg` } } },
			'ch-other': { id: 'ch-other', userId: OTHER, avatarUrl: `${IMG}/c-other_avatar.jpg`, members: [{ userId: ME, role: 'editor' }] },
		}),
		videos: new MemoryBucket({
			'v-mine': videoFixture({ id: 'v-mine', userId: ME, channelId: 'ch-me' }),
			'v-member': videoFixture({ id: 'v-member', userId: ME, uploadedBy: OTHER, channelId: 'ch-me' }),
			'v-other': videoFixture({ id: 'v-other', userId: OTHER, channelId: 'ch-other' }),
			// Uploaded by the user as a member of someone else's channel
			'v-guest': videoFixture({ id: 'v-guest', userId: OTHER, uploadedBy: ME, channelId: 'ch-other' }),
			'livestream:ls-mine': { id: 'ls-mine', userId: ME, channelId: 'ch-me', status: 'ended' },
			'livestream:ls-other': { id: 'ls-other', userId: OTHER, channelId: 'ch-other', status: 'ended' },
		}),
		channel_sections: new MemoryBucket(), channel_tabs: new MemoryBucket(), watch_history: new MemoryBucket(),
		community_posts: new MemoryBucket({
			'posts/ch-me/p1.json': { id: 'p1', channelId: 'ch-me', userId: ME, images: [{ url: `${IMG}/community-posts/ch-me/p1.webp` }, { url: `${IMG}/community-posts/ch-other/p2.webp` }] },
			'posts/ch-other/p2.json': { id: 'p2', channelId: 'ch-other', userId: OTHER, authorId: ME, images: [{ url: `${IMG}/community-posts/ch-other/by-me.webp` }] },
		}),
		playlists: new MemoryBucket(), 'upload-defaults': new MemoryBucket(), reports: new MemoryBucket(), subtitles: new MemoryBucket(),
		global_settings: new MemoryBucket(), ADMIN_BACKUPS: new MemoryBucket(),
		MEDIA, MEDIA_PRIVATE, MEDIA_ORIGINALS, LIVE_MEDIA,
		MEDIA_PUBLIC_HOST: 'media.test', MEDIA_CDN_API_TOKEN: 'cdn-token',
		image_storage_key: 'storage-key', ZONE: 'zone',
		'bunny-stream-key': 'test-key', bunny_stream_library_id: '7',
		INTERNAL_API_KEY: 'k'.repeat(40),
		queue: new MemoryQueue(),
	} as Json;
	await runIndex(env);
	return env;
}

async function erase(env: Json, status = 200, email = 'me@test.example'): Promise<Json> {
	const app = new Hono();
	app.onError(errorHandler);
	app.use('*', async (c, next) => {
		c.set('auth' as never, { userId: ME, email, payload: {} } as never);
		c.set('userId' as never, ME as never);
		await next();
	});
	app.route('/api/privacy', privacyRouter as never);
	const res = await app.request('/api/privacy/data', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) }, env);
	const text = await res.text();
	assert.equal(res.status, status, text);
	return (text.startsWith('{') ? JSON.parse(text) : {}) as Json;
}

const jobs = (env: Json): Json[] => env.SEARCH_DB.db.prepare('SELECT * FROM admin_jobs WHERE kind = ? ORDER BY created_at').all(ERASE_MEDIA_JOB) as Json[];
const stores = (env: Json) => [env.MEDIA, env.MEDIA_PRIVATE, env.MEDIA_ORIGINALS].flatMap((b: MemoryBucket) => [...b.store.keys()]);
const of = (id: string) => [...media(id).pub, ...media(id).priv, ...media(id).original];
const left = (env: Json, id: string) => of(id).filter((k) => stores(env).includes(k));

const runIndex = async (env: Json) => {
	for (const kind of ['channel', 'video', 'playlist', 'stream'] as const) await runOwnershipPass(env as never, kind, { maxPages: 10 });
};

/** The day is over: what was written down may go now. */
const due = (env: Json) => env.SEARCH_DB.db.prepare(`UPDATE admin_jobs SET params = json_remove(params, '$.runAfter', '$.delay') WHERE kind = ?`).run(ERASE_MEDIA_JOB);
const drain = async (env: Json) => {
	due(env);
	await drainJobs(env as never);
};

/** One step of a job as the consumer runs it (the row's params and state follow). */
async function step(env: Json, id: string): Promise<Json> {
	due(env);
	const job = (await getJob(env as never, id))!;
	env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'running' WHERE id = ?").run(id);
	const outcome = (await runEraseMedia(env, job)) as Json;
	env.SEARCH_DB.db.prepare('UPDATE admin_jobs SET status = ?, params = ? WHERE id = ?').run(outcome.done ? 'succeeded' : 'queued', JSON.stringify(outcome.params ?? job.params), id);
	return outcome;
}

describe('the media of an erased account', () => {
	it('is written down before the records go, and all of it is deleted; nothing else is', async () => {
		const env = await setup();
		const summary = await erase(env);
		assert.equal(summary.complete, true);
		const [job, ...more] = jobs(env);
		assert.equal(more.length, 0, 'one job');
		assert.equal(job.status, 'queued');
		assert.equal(env.ADMIN_JOBS_QUEUE.sent[0].delaySeconds, 43_200, 'the queue\'s longest');
		assert.ok(!JSON.stringify(job).includes(ME), 'the job names no account');
		assert.deepEqual(left(env, 'v-mine'), of('v-mine'), 'nothing is deleted in the request');
		await drain(env);
		const done = jobs(env)[0];
		assert.equal(done.status, 'succeeded', done.last_error);
		// The account's: videos on its channel (a member's upload too), recordings, images
		for (const id of ['v-mine', 'v-member']) {
			assert.deepEqual(left(env, id), [], id);
			assert.equal(out.bunny.has(id), false, id);
			assert.equal(out.images.has(`/thumbnails/${id}/t.jpg`), false, id);
			for (const prefix of [`media.test/pub/${id}/`, `media.test/pub/thumbs/${id}/`]) assert.ok(out.purged.includes(prefix), prefix);
		}
		assert.deepEqual([...env.LIVE_MEDIA.store.keys()], ['live/sess-other/720/0.m4s']);
		assert.deepEqual([...env.MEDIA_PRIVATE.store.keys()].filter((k) => k.startsWith('review/ls-')), ['review/ls-other/r1/frames/0.jpg'], 'review media of recordings too');
		assert.equal(out.bunny.has('bunny-live-mine'), false);
		for (const path of ['/a-me_avatar.jpg', '/a-me-old_avatar.jpg', '/c-me_avatar.jpg', '/c-me-member_cover.jpg', '/community-posts/ch-me/p1.webp', '/community-posts/ch-me/by-member.webp']) {
			assert.equal(out.images.has(path), false, path);
			assert.ok(out.purged.includes(`${IMG}${path}`), `${path} leaves the CDN`);
		}
		// Everyone else's, whatever the account's records named, and what it uploaded to another channel
		for (const id of ['v-other', 'v-guest']) {
			assert.deepEqual(left(env, id), of(id), id);
			assert.equal(out.bunny.has(id), true, id);
			assert.equal(out.images.has(`/thumbnails/${id}/t.jpg`), true, id);
		}
		assert.equal(out.bunny.has('bunny-live-other'), true);
		for (const path of ['/a-other_avatar.jpg', '/c-other_avatar.jpg', '/community-posts/ch-other/by-me.webp', '/community-posts/ch-other/p2.webp', '/c-other-by-me_cover.jpg', '/legacy_avatar.jpg']) assert.equal(out.images.has(path), true, path);
		assert.equal(env.videos.read('v-guest').uploadedBy, 'deleted-user', 'it stays with the channel, without the name');
		const result = JSON.parse(done.result);
		assert.deepEqual({ videos: result.videos, streams: result.streams, channels: result.channels }, { videos: 2, streams: 1, channels: 1 });
		assert.deepEqual(result.cachesNotPurged, ['bunny-edge']);
		assert.deepEqual(result.kept.sort(), ['2 image(s) uploaded to channels that still exist', 'image /a-other_avatar.jpg: whose it is cannot be proven', 'image /c-other_avatar.jpg: whose it is cannot be proven']);
		assert.deepEqual(JSON.parse(done.params).items, undefined, 'the finished job keeps no list');
		assert.equal(env.SEARCH_DB.db.prepare('SELECT COUNT(*) AS n FROM image_owners WHERE owner_id = ?').get(ME).n, 0, 'nor any row the account');
		// The processor hears of every video even if the request never said so
		for (const id of ['v-mine', 'v-member']) assert.ok(env.queue.messages.some((m: Json) => JSON.stringify(m).includes('erasure-media') && JSON.stringify(m).includes(id)));
	});

	it('is written down by the admin erasure as well', async () => {
		const env = await setup();
		await recordDeletion(env.SEARCH_DB, { kind: 'user', id: ME, deletedBy: 'admin' } as never);
		const outcome = (await ADMIN_JOB_HANDLERS['user.delete-data']!(env as never, { id: 'j', kind: 'user.delete-data', targetId: ME, params: {}, result: null } as never)) as Json;
		assert.equal(outcome.done, true);
		assert.equal(jobs(env).length, 1);
		await drain(env);
		assert.deepEqual(left(env, 'v-mine'), []);
		assert.deepEqual(left(env, 'v-other'), of('v-other'));
	});

	it('keeps the records when the job cannot be stored or queued', async () => {
		for (const broken of ['queue', 'row'] as const) {
			const env = await setup();
			if (broken === 'queue') env.ADMIN_JOBS_QUEUE.send = async () => Promise.reject(new Error('queue down'));
			else env.SEARCH_DB.db.exec("CREATE TRIGGER no_jobs BEFORE INSERT ON admin_jobs BEGIN SELECT RAISE(ABORT, 'D1 down'); END");
			assert.equal((await erase(env, 503)).code, 'service_unavailable');
			assert.ok(env.videos.store.has('v-member'), `${broken}: the first record is still there`);
			assert.ok(env.profiles.store.has(ME));
			assert.deepEqual(left(env, 'v-member'), of('v-member'));
			// The job that could not be queued shows as failed; retried, it touches nothing that still exists
			for (const job of jobs(env)) {
				assert.equal(job.status, 'failed');
				const outcome = await step(env, job.id);
				assert.equal(outcome.delaySeconds, RETRY_DELAYS[0]);
				assert.match(outcome.note, /its record still exists/);
			}
			assert.deepEqual(left(env, 'v-member'), of('v-member'));
		}
	});
});

describe('the job', () => {
	const start = async (env: Json, items: unknown[]) => (await createJob(env as never, { kind: ERASE_MEDIA_JOB, targetKind: 'user', targetId: 'deleted-user', actorId: 'system', params: { items } })).id;
	const video = (id: string) => ({ t: 'video', id, bunny: { ref: id, library: {} } });

	it('tries again for a day, says why it waits, then fails; a later Retry finishes', async () => {
		const env = await setup();
		env.videos.store.clear();
		out.failBunny = true;
		const id = await start(env, [video('v-mine')]);
		for (const delay of RETRY_DELAYS) {
			const outcome = await step(env, id);
			assert.equal(outcome.done, false);
			assert.equal(outcome.delaySeconds, delay);
			assert.match(outcome.note, /^video v-mine: .*500/);
			assert.ok(out.purged.includes('media.test/pub/v-mine/'), 'nor the CDN for Bunny');
		}
		await assert.rejects(step(env, id), /Not erased: video v-mine/);
		assert.deepEqual(left(env, 'v-mine'), [], 'everything else went');
		out.failBunny = false;
		env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'queued' WHERE id = ?").run(id);
		await step(env, id);
		assert.equal(out.bunny.has('v-mine'), false);
	});

	it('one item that fails does not hold up the rest; a failed CDN purge is not "done"', async () => {
		const env = await setup();
		env.videos.store.clear();
		out.failCdn = true;
		const id = await start(env, [video('v-mine'), video('v-member')]);
		const outcome = await step(env, id);
		assert.equal(outcome.delaySeconds, RETRY_DELAYS[0]);
		for (const v of ['v-mine', 'v-member']) assert.equal(out.bunny.has(v), false, 'what is stored does not wait for the CDN');
		assert.deepEqual(outcome.params.items.map((i: Json) => i.t).sort(), ['files', 'files', 'video', 'video'], 'and what each was deleting');
		out.failCdn = false;
		await step(env, id);
		for (const v of ['v-mine', 'v-member']) assert.deepEqual(left(env, v), []);
	});

	it('takes a very large channel a part at a time, and every file leaves the CDN', async () => {
		const env = await setup();
		const files = Array.from({ length: 600 }, (_, i) => `/community-posts/ch-big/${i}.webp`);
		for (const f of files) out.images.add(f);
		const id = await start(env, [{ t: 'channel', id: 'ch-big' }, { t: 'kept', why: 'x' }]);
		const left: number[] = [];
		for (let last: Json = { params: { items: [1] } }; last.params?.items?.length; ) {
			last = await step(env, id);
			left.push(files.filter((f) => out.images.has(f)).length);
		}
		assert.ok(left.length >= 3 && left.length <= 5, `${left}`);
		assert.ok(left[0] > 300 && left[0] < 450, `a part per step ${left}`);
		assert.equal(left.at(-1), 0);
		for (const f of files) assert.ok(out.purged.includes(`${IMG}${f}`), f);
		assert.equal(JSON.parse(jobs(env)[0].params).counts.channels, 1);
	});

	it('looks once more later, for what was written meanwhile', async () => {
		const env = await setup();
		env.videos.store.clear();
		const id = await start(env, [video('v-mine')]);
		const first = await step(env, id);
		assert.deepEqual([first.done, first.delaySeconds], [false, SWEEP_DELAY]);
		await env.MEDIA.put('pub/v-mine/r2/late.m4s', '{}');
		await step(env, id);
		assert.equal(env.MEDIA.store.has('pub/v-mine/r2/late.m4s'), false);
		const last = await step(env, id);
		assert.equal(last.done, true);
		assert.equal(last.result.videos, 1, 'counted once');
	});

	it('never acts on what still has its record, nor on an id that is not one', async () => {
		const env = await setup();
		const id = await start(env, [video('v-other'), { t: 'channel', id: 'ch-other' }, { t: 'images', paths: ['/c-other_avatar.jpg', '/a-other_avatar.jpg'] }, { t: 'stream', id: 'ls-other' }]);
		let last: Json = {};
		for (let i = 0; i < 30 && !last.done; i++) last = await step(env, id);
		assert.deepEqual([...last.result.kept].sort(), ['channel ch-other: its record still exists', 'images (2): its record still exists', 'stream ls-other: its record still exists', 'video v-other: its record still exists']);
		assert.deepEqual(left(env, 'v-other'), of('v-other'));
		for (const path of ['/c-other_avatar.jpg', '/a-other_avatar.jpg']) assert.equal(out.images.has(path), true, path);
		const all = stores(env).length;
		for (const bad of ['', '..', 'a/b', 'thumbs/v-other', '%2e']) {
			const job = await start(env, [video(bad)]);
			const outcome = await step(env, job);
			assert.match(outcome.note, /Not an id/);
		}
		assert.equal(stores(env).length, all);
	});

	it('waits for an open takedown case, and fails visibly if it never closes', async () => {
		const env = await setup();
		const takedown = await createJob(env as never, { kind: 'csam.contain', targetKind: 'video', targetId: 'v-mine', actorId: 'system', params: {} });
		const hooks = eraseMediaHooks(env);
		await hooks.onVideoDeleted('v-mine', env.videos.read('v-mine'), 'v-mine');
		env.videos.store.delete('v-mine');
		const id = jobs(env)[0].id;
		for (let i = 0; i < RETRY_DELAYS.length; i++) assert.match((await step(env, id)).note, /a takedown case is open/);
		await assert.rejects(step(env, id), /a takedown case is open/);
		assert.deepEqual(left(env, 'v-mine'), of('v-mine'));
		env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'succeeded' WHERE id = ?").run(takedown.id);
		env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'queued' WHERE id = ?").run(id);
		await step(env, id);
		assert.deepEqual(left(env, 'v-mine'), []);
	});

	it('an erase leaves a record under a takedown to the case\'s own job', async () => {
		const env = await setup();
		await env.videos.put('v-mine', JSON.stringify({ ...env.videos.read('v-mine'), csamTakedown: { caseId: 'c1' } }));
		const summary = await erase(env);
		assert.equal(summary.complete, true);
		assert.ok(env.videos.store.has('v-mine'));
		assert.ok(!JSON.stringify(summary).includes('v-mine'), 'the answer says nothing about it');
		await drain(env);
		assert.deepEqual(left(env, 'v-mine'), of('v-mine'));
		assert.deepEqual(left(env, 'v-member'), []);
	});

	it('a job that already runs takes no more; the next record starts another', async () => {
		const env = await setup();
		const hooks = eraseMediaHooks(env);
		await hooks.onVideoDeleted('a', { id: 'a' }, 'a');
		await hooks.onVideoDeleted('b', { id: 'b' }, 'b');
		assert.equal(jobs(env).length, 1);
		env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'running'").run();
		await hooks.onVideoDeleted('c', { id: 'c' }, 'c');
		assert.deepEqual(jobs(env).map((j) => JSON.parse(j.params).items.map((i: Json) => i.id)), [['a', 'b'], ['c']]);
	});

	it('only the upload\'s own row is proof: a record, the backfill or an older row is not, and those files are listed', async () => {
		const env = await setup();
		env.ERRORS_INGEST_URL = 'https://errors.test/internal/errors';
		env.profiles = new MemoryBucket({ [ME]: { id: ME, avatarUrl: `${IMG}/legacy_avatar.jpg`, coverUrl: `${IMG}/named_cover.jpg` } });
		for (const path of ['/named_cover.jpg', '/old-row_avatar.jpg', '/new-upload_avatar.jpg']) out.images.add(path);
		// A row from before the marker, and one the upload writes today
		env.SEARCH_DB.db.prepare("INSERT INTO image_owners (path, kind, owner_id, channel_id, created_at) VALUES ('/old-row_avatar.jpg', 'profile_avatar', ?, NULL, '2026-11-20T10:00:00.000Z')").run(ME);
		await recordImageOwner(env.SEARCH_DB, `${IMG}/new-upload_avatar.jpg`, { kind: 'profile_avatar', ownerId: ME });
		await backfillImageOwnersStep(env as never, {});
		const rows = Object.fromEntries((env.SEARCH_DB.db.prepare('SELECT path, owner_id, created_at FROM image_owners').all() as Json[]).map((r) => [r.path, r]));
		assert.equal(rows['/legacy_avatar.jpg'].owner_id, ME, 'the backfill names the likely uploader');
		assert.deepEqual(['/legacy_avatar.jpg', '/old-row_avatar.jpg', '/new-upload_avatar.jpg'].map((p) => isUploadRow(rows[p].created_at)), [false, false, true]);
		assert.ok(Number.isFinite(Date.parse(rows['/new-upload_avatar.jpg'].created_at)), 'still a date');

		await eraseMediaHooks(env).onProfileDeleted(ME, env.profiles.read(ME));
		env.profiles.store.delete(ME);
		env.channels.store.delete('ch-me');
		const id = jobs(env)[0].id;
		let last: Json = {};
		for (let i = 0; i < 10 && !last.done; i++) last = await step(env, id);
		for (const path of ['/new-upload_avatar.jpg', '/a-me_avatar.jpg']) assert.equal(out.images.has(path), false, path);
		const kept = ['/legacy_avatar.jpg', '/named_cover.jpg', '/old-row_avatar.jpg'];
		for (const path of kept) {
			assert.equal(out.images.has(path), true, path);
			assert.ok(last.result.kept.includes(`image ${path}: whose it is cannot be proven`), path);
		}
		const item = out.flagged.find((f) => f.key === `erase-media-kept:${id}`)!;
		for (const path of kept) assert.ok(item.message.includes(path), path);
	});

	it('a channel\'s image on an unproven row is kept too, while its own folder goes', async () => {
		const env = await setup();
		env.SEARCH_DB.db.prepare("UPDATE image_owners SET created_at = '2026-11-01T00:00:00.000Z' WHERE path = '/c-me_avatar.jpg'").run();
		await erase(env);
		await drain(env);
		assert.equal(out.images.has('/c-me_avatar.jpg'), true);
		assert.equal(out.images.has('/community-posts/ch-me/p1.webp'), false);
		assert.equal(JSON.parse(jobs(env)[0].result).kept.filter((k: string) => k.startsWith('image /c-me_avatar.jpg')).length, 1, 'listed once');
	});

	it('what the account uploaded for a channel that outlives it goes with that channel, without its name', async () => {
		const env = await setup();
		await erase(env);
		await drain(env);
		const row = (path: string) => env.SEARCH_DB.db.prepare('SELECT owner_id, channel_id FROM image_owners WHERE path = ?').get(path) as Json | undefined;
		assert.equal(out.images.has('/c-other-by-me_cover.jpg'), true, 'stays with the channel');
		assert.deepEqual({ ...row('/c-other-by-me_cover.jpg') }, { owner_id: null, channel_id: 'ch-other' });
		assert.equal(env.SEARCH_DB.db.prepare('SELECT COUNT(*) AS n FROM image_owners WHERE owner_id = ?').get(ME).n, 0);
		assert.equal(row('/a-me_avatar.jpg'), undefined);

		// The channel's own erasure later: the row still proves the cover is the channel's
		await eraseMediaHooks(env).onChannelDeleted('ch-other', { id: 'ch-other', coverUrl: `${IMG}/c-other-by-me_cover.jpg` });
		await env.channels.delete('ch-other');
		await drain(env);
		assert.equal(out.images.has('/c-other-by-me_cover.jpg'), false);
		assert.equal(row('/c-other-by-me_cover.jpg'), undefined, 'and its row with it');
	});

	it('a channel that comes while the profile goes takes its media with it, what the account uploaded for it too', async () => {
		const env = await setup();
		const other = env.channels.read('ch-other');
		await env.channels.put('ch-other', JSON.stringify({ ...other, coverUrl: `${IMG}/c-other-by-me_cover.jpg` }));
		const remove = env.profiles.delete.bind(env.profiles);
		let came = false;
		env.profiles.delete = async (key: string | string[]) => {
			await remove(key);
			if (came) return;
			came = true;
			const at = new Date().toISOString();
			await env.channels.put('ch-other', JSON.stringify({ ...env.channels.read('ch-other'), userId: ME, members: [], transferredAt: at }));
			env.SEARCH_DB.db.prepare(`INSERT INTO channel_move_offers (id, channel_id, from_user_id, to_user_id, status, job_id, created_at, expires_at, updated_at) VALUES ('o1', 'ch-other', ?, ?, 'moved', 'j1', ?, ?, ?)`).run(OTHER, ME, at, at, at);
		};
		const summary = await erase(env);
		assert.equal(summary.complete, true);
		assert.equal(came, true);
		assert.equal(await env.channels.head('ch-other'), null, 'erased by the same run');
		assert.equal(env.SEARCH_DB.db.prepare('SELECT to_user_id FROM channel_move_offers').get().to_user_id, 'deleted-user', 'and its offer names nobody');
		await drain(env);
		for (const id of ['v-mine', 'v-other']) assert.deepEqual(left(env, id), [], id);
		for (const path of ['/c-me_avatar.jpg', '/c-other-by-me_cover.jpg', '/c-other_avatar.jpg', '/community-posts/ch-other/p2.webp']) assert.equal(out.images.has(path), false, path);
		for (const path of ['/a-other_avatar.jpg', '/legacy_avatar.jpg']) assert.equal(out.images.has(path), true, path);
		assert.ok(jobs(env).every((j) => j.status === 'succeeded'), 'nothing waits');
	});

	it('a profile that is still there keeps its images: the erase stopped between the write and the delete', async () => {
		for (const how of ['stopped', 'failed'] as const) {
			const env = await setup();
			if (how === 'failed') {
				env.profiles.delete = async () => Promise.reject(new Error('R2 down'));
				await erase(env, 500);
			} else await eraseMediaHooks(env).onProfileDeleted(ME, env.profiles.read(ME));
			const written = jobs(env).flatMap((j) => JSON.parse(j.params).items).filter((i: Json) => i.t === 'images').flatMap((i: Json) => i.paths);
			assert.ok(written.includes('/a-me_avatar.jpg'), how);
			for (const job of jobs(env)) {
				let last: Json = {};
				for (let i = 0; i < 12 && !last.done; i++) last = await step(env, job.id);
			}
			assert.ok(env.profiles.store.has(ME));
			for (const path of ['/a-me_avatar.jpg', '/a-me-old_avatar.jpg']) assert.equal(out.images.has(path), true, `${how}: ${path}`);
			assert.ok(env.SEARCH_DB.db.prepare(`SELECT 1 FROM image_owners WHERE path = '/a-me_avatar.jpg'`).get(), 'and the row that proves it');
		}
	});

	it('nothing of a video goes before its media is written down: its subtitles and side records stay with it', async () => {
		const side = (env: Json) => {
			env.subtitles.store.set('v-mine/en.vtt', '"x"');
			env.global_settings.store.set('ops/upload-reaper/created/v-mine', '{}');
		};
		const held = (env: Json) => [env.subtitles.store.has('v-mine/en.vtt'), env.global_settings.store.has('ops/upload-reaper/created/v-mine'), env.videos.store.has('v-mine')];
		const env = await setup();
		side(env);
		for (const key of ['v-member', 'livestream:ls-mine']) env.videos.store.delete(key);
		env.ADMIN_JOBS_QUEUE.send = async () => Promise.reject(new Error('queue down'));
		await erase(env, 503);
		assert.deepEqual(held(env), [true, true, true]);
		// Written down, the record gone, then the worker stops: the job deletes the rest
		const stopped = await setup();
		side(stopped);
		await eraseMediaHooks(stopped).onVideoDeleted('v-mine', stopped.videos.read('v-mine'), 'v-mine');
		stopped.videos.store.delete('v-mine');
		await drain(stopped);
		assert.deepEqual(held(stopped), [false, false, false]);
		// The run-account erase in the same order
		const run = await setup();
		side(run);
		for (const key of ['v-member', 'livestream:ls-mine']) run.videos.store.delete(key);
		await runIndex(run);
		await assert.rejects(eraseRunUserData(run as never, ME, new OperationBudget(900), { onVideoDeleted: async () => Promise.reject(new Error('not stored')) }), /not stored/);
		assert.deepEqual(held(run), [true, true, true]);
	});

	it('review frames, audio and transcripts go, and stay under a takedown', async () => {
		const env = await setup();
		const review = () => [...env.MEDIA_PRIVATE.store.keys()].filter((k: string) => k.startsWith('review/v-mine/'));
		env.videos.store.delete('v-mine');
		const takedown = await createJob(env as never, { kind: 'csam.contain', targetKind: 'video', targetId: 'v-mine', actorId: 'system', params: {} });
		const id = await start(env, [video('v-mine')]);
		await step(env, id);
		assert.equal(review().length, 4);
		env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'succeeded' WHERE id = ?").run(takedown.id);
		await step(env, id);
		assert.deepEqual(review(), []);
		assert.ok([...env.MEDIA_PRIVATE.store.keys()].some((k: string) => k.startsWith('review/v-other/')));
	});

	it('a caption job\'s row stays until its work is gone', async () => {
		const env = await setup();
		env.videos.store.delete('v-mine');
		const row = (n: string) => env.SEARCH_DB.db.prepare('SELECT id FROM caption_jobs WHERE id = ?').get(n);
		const columns = (env.SEARCH_DB.db.prepare('PRAGMA table_info(caption_jobs)').all() as Json[]).filter((c) => c.notnull && c.dflt_value === null && !c.pk).map((c) => c.name);
		const add = (id: string) => {
			const values: Json = Object.fromEntries(columns.map((c: string) => [c, 'x']));
			Object.assign(values, { id, video_id: 'v-mine', status: 'ready', kind: 'transcribe' });
			const names = Object.keys(values);
			env.SEARCH_DB.db.prepare(`INSERT INTO caption_jobs (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...Object.values(values));
			env.MEDIA_PRIVATE.store.set(`captions-work/${id}/manifest.json`, '{}');
		};
		add('cap-1');
		const list = env.MEDIA_PRIVATE.list.bind(env.MEDIA_PRIVATE);
		env.MEDIA_PRIVATE.list = async (o: Json) => (String(o?.prefix).startsWith('captions-work/') ? Promise.reject(new Error('R2 down')) : list(o));
		const id = await start(env, [video('v-mine')]);
		assert.match((await step(env, id)).note, /R2 down/);
		assert.ok(row('cap-1'), 'the work is still findable');
		env.MEDIA_PRIVATE.list = list;
		for (let i = 2; i < 25; i++) add(`cap-${i}`);
		for (let i = 0; i < 4; i++) await step(env, id);
		assert.equal(env.SEARCH_DB.db.prepare('SELECT COUNT(*) AS n FROM caption_jobs').get().n, 0);
		assert.deepEqual([...env.MEDIA_PRIVATE.store.keys()].filter((k: string) => k.startsWith('captions-work/')), []);
	});

	it('every avatar and cover ever uploaded for an erased channel goes, whoever uploaded it; what its uploader shows stays', async () => {
		const env = await setup();
		const add = (path: string, owner: string | null, at = '2026-11-01T00:00:00.000+00:00') => {
			out.images.add(path);
			env.SEARCH_DB.db.prepare(`INSERT INTO image_owners (path, kind, owner_id, channel_id, created_at) VALUES (?, 'channel_avatar', ?, 'ch-me', ?)`).run(path, owner, at);
		};
		for (let i = 0; i < 25; i++) add(`/old-${String(i).padStart(2, '0')}_avatar.jpg`, i % 2 ? OTHER : null);
		add('/shown_avatar.jpg', OTHER);
		add('/shown-channel_avatar.jpg', OTHER);
		add('/guess_avatar.jpg', OTHER, '2026-11-01T00:00:00.000Z');
		// Linked from a stranger's record: the account's own upload goes all the same
		await env.channels.put('ch-third', JSON.stringify({ id: 'ch-third', userId: 'usr_third', avatarUrl: `${IMG}/a-me_avatar.jpg` }));
		await env.profiles.put(OTHER, JSON.stringify({ id: OTHER, avatarUrl: `${IMG}/shown_avatar.jpg` }));
		await env.channels.put('ch-other', JSON.stringify({ ...env.channels.read('ch-other'), coverUrl: `${IMG}/shown-channel_avatar.jpg` }));
		await runIndex(env);
		await erase(env);
		await drain(env);
		for (let i = 0; i < 25; i++) assert.equal(out.images.has(`/old-${String(i).padStart(2, '0')}_avatar.jpg`), false, `${i}`);
		for (const path of ['/shown_avatar.jpg', '/shown-channel_avatar.jpg', '/guess_avatar.jpg', '/c-other_avatar.jpg']) assert.equal(out.images.has(path), true, path);
		assert.equal(out.images.has('/a-me_avatar.jpg'), false);
		const kept = JSON.parse(jobs(env)[0].result).kept as string[];
		for (const path of ['/shown_avatar.jpg', '/shown-channel_avatar.jpg']) assert.ok(kept.includes(`image ${path}: its uploader still shows it`), path);
		const plan = (env.SEARCH_DB.db.prepare(`EXPLAIN QUERY PLAN SELECT path, kind, owner_id, channel_id, created_at FROM image_owners WHERE channel_id = ? AND path > ? AND kind IN ('channel_avatar', 'channel_cover') ORDER BY path LIMIT 10`).all('x', '') as Json[]).map((r) => r.detail).join(' | ');
		assert.match(plan, /SEARCH image_owners USING (COVERING )?INDEX idx_image_owners_channel/);
		assert.doesNotMatch(plan, /SCAN|TEMP B-TREE/);
	});

	it('waits while the channel index is rebuilt: it could miss who shows an image', async () => {
		const env = await setup();
		env.channels.store.delete('ch-me');
		env.SEARCH_DB.db.prepare('DELETE FROM search_meta WHERE key = ?').run(ownershipCompleteKey('channel'));
		const id = await start(env, [{ t: 'channel', id: 'ch-me' }]);
		assert.match((await step(env, id)).note, /index is being rebuilt/);
		assert.equal(out.images.has('/c-me-member_cover.jpg'), true);
		await runIndex(env);
		await step(env, id);
		assert.equal(out.images.has('/c-me-member_cover.jpg'), false);
	});

	it('asks for a takedown when it is about to delete: one that began after the list was written holds it', async () => {
		const targets: Array<[string, string, Json, () => boolean]> = [];
		for (const [kind, target, item, there] of [
			['video', 'v-mine', video('v-mine'), (env: Json) => left(env, 'v-mine').length === of('v-mine').length && out.bunny.has('v-mine')],
			['video', 'ls-mine', { t: 'stream', id: 'ls-mine' }, (env: Json) => env.LIVE_MEDIA.store.has('live/sess-mine/vod.m3u8') && env.MEDIA_PRIVATE.store.has('review/ls-mine/r1/frames/0.jpg')],
			['channel', 'ch-me', { t: 'channel', id: 'ch-me' }, () => ['/c-me_avatar.jpg', '/community-posts/ch-me/p1.webp'].every((p) => out.images.has(p))],
			['user', ME, { t: 'images', paths: ['/a-me_avatar.jpg', '/a-me-old_avatar.jpg'] }, () => out.images.has('/a-me_avatar.jpg') && out.images.has('/a-me-old_avatar.jpg')],
			['channel', 'ch-me', { t: 'images', paths: ['/c-me_avatar.jpg'] }, () => out.images.has('/c-me_avatar.jpg')],
		] as Array<[string, string, Json, (env: Json) => boolean]>) {
			const env = await setup();
			for (const key of ['v-mine', 'livestream:ls-mine']) env.videos.store.delete(key);
			env.channels.store.delete('ch-me');
			env.profiles.store.delete(ME);
			const id = await start(env, [item]);
			const takedown = await createJob(env as never, { kind: 'csam.contain', targetKind: kind as never, targetId: target, actorId: 'system', params: {} });
			for (let i = 0; i < 2; i++) assert.match((await step(env, id)).note, /a takedown case is open/, `${kind} ${item.t}`);
			assert.equal(there(env), true, `${kind} ${item.t}: untouched`);
			env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'succeeded' WHERE id = ?").run(takedown.id);
			await step(env, id);
			assert.equal(there(env), false, `${kind} ${item.t}: gone after the case`);
		}
		assert.equal(targets.length, 0);
	});

	it('and between its parts: one that begins while a video is being deleted keeps what is left', async () => {
		const env = await setup();
		env.videos.store.delete('v-mine');
		const id = await start(env, [video('v-mine')]);
		const remove = env.MEDIA.delete.bind(env.MEDIA);
		env.MEDIA.delete = async (keys: string | string[]) => {
			await remove(keys);
			if (!env.SEARCH_DB.db.prepare("SELECT 1 FROM admin_jobs WHERE kind = 'csam.contain'").get()) await createJob(env as never, { kind: 'csam.contain', targetKind: 'video', targetId: 'v-mine', actorId: 'system', params: {} });
		};
		assert.match((await step(env, id)).note, /a takedown case is open/);
		for (const key of [...media('v-mine').priv, ...media('v-mine').original]) assert.ok(stores(env).includes(key), key);
		assert.ok(out.bunny.has('v-mine'));
	});

	it('the run-account erase leaves videos and posts under a takedown to the case, marked before or meanwhile', async () => {
		const env = await setup();
		await env.videos.put('v-mine', JSON.stringify({ ...env.videos.read('v-mine'), csamTakedown: { caseId: 'c1' } }));
		await env.community_posts.put('posts/ch-me/p1.json', JSON.stringify({ ...env.community_posts.read('posts/ch-me/p1.json'), csamTakedown: { caseId: 'c1' } }));
		await env.community_posts.put('comments/p1/top-level/x.json', JSON.stringify({ id: 'x' }));
		await runIndex(env);
		const hooks = eraseMediaHooks(env);
		await eraseRunUserData(env as never, ME, new OperationBudget(900), {
			...hooks,
			onVideoDeleted: async (id, record, key) => {
				await hooks.onVideoDeleted(id, record, key);
				if (id === 'v-member') await env.videos.put(id, JSON.stringify({ ...env.videos.read(id), csamTakedown: { caseId: 'c2' } }));
			},
		});
		for (const id of ['v-mine', 'v-member']) assert.ok(env.videos.store.has(id), id);
		assert.deepEqual(jobs(env).flatMap((j) => JSON.parse(j.params).items).filter((i: Json) => i.id === 'v-mine'), [], 'nor is it written down');
		assert.ok(env.community_posts.store.has('posts/ch-me/p1.json'));
		assert.ok(env.community_posts.store.has('comments/p1/top-level/x.json'));
	});

	it('the full erase too, when the mark lands after the media is written down', async () => {
		const env = await setup();
		const hooks = eraseMediaHooks(env);
		await eraseUserData(env as never, ME, new OperationBudget(5000), {
			...hooks,
			onVideoDeleted: async (id, record, key) => {
				await hooks.onVideoDeleted(id, record, key);
				if (id === 'v-mine') await env.videos.put(id, JSON.stringify({ ...env.videos.read(id), csamTakedown: { caseId: 'c2' } }));
			},
		});
		assert.ok(env.videos.store.has('v-mine'));
		assert.equal(env.videos.store.has('v-member'), false);
		// The job leaves what still has its record
		for (let i = 0; i < 2; i++) await step(env, jobs(env)[0].id);
		assert.deepEqual(left(env, 'v-mine'), of('v-mine'));
	});

	it('a list written twice, and two deliveries at once, delete the same and nothing else', async () => {
		const env = await setup();
		const hooks = eraseMediaHooks(env);
		// The pass stopped after the write; the next one wrote it again
		await hooks.onVideoDeleted('v-mine', env.videos.read('v-mine'), 'v-mine');
		await eraseMediaHooks(env).onVideoDeleted('v-mine', env.videos.read('v-mine'), 'v-mine');
		env.videos.store.delete('v-mine');
		assert.equal(jobs(env).length, 2);
		const others = [...of('v-member'), ...of('v-other'), ...of('v-guest')];
		const [a] = jobs(env);
		const job = (await getJob(env as never, a.id))!;
		env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'running' WHERE id = ?").run(a.id);
		due(env);
		const both = await Promise.all([runEraseMedia(env, job), runEraseMedia(env, job)]);
		// One may have met the other's part: it puts that off
		for (const outcome of both as Json[]) assert.ok(outcome.later || [SWEEP_DELAY, RETRY_DELAYS[0], 10].includes(outcome.delaySeconds), JSON.stringify(outcome));
		assert.deepEqual(left(env, 'v-mine'), []);
		assert.equal(marks(env), 0);
		env.SEARCH_DB.db.prepare('UPDATE admin_jobs SET params = ? WHERE id = ?').run(JSON.stringify((both as Json[]).find((o) => o.params)!.params), a.id);
		await drain(env);
		assert.ok(jobs(env).every((j) => j.status === 'succeeded'), jobs(env).map((j) => j.last_error).join());
		for (const key of others) assert.ok(stores(env).includes(key), key);
	});

	it('a job that has run takes no more, also while it waits for its next step', async () => {
		const env = await setup();
		const hooks = eraseMediaHooks(env);
		await hooks.onVideoDeleted('a', { id: 'a' }, 'a');
		await step(env, jobs(env)[0].id);
		assert.equal(jobs(env)[0].status, 'queued');
		await hooks.onVideoDeleted('b', { id: 'b' }, 'b');
		const listed = jobs(env).flatMap((j) => [...(JSON.parse(j.params).items ?? [])]).map((i: Json) => i.id);
		assert.ok(listed.includes('b'));
		assert.equal(jobs(env).length, 2, 'in a job of its own');
	});

	it('a very large video is deleted a page at a time, never listed whole, and every step stays within its calls', async () => {
		const env = await setup();
		env.videos.store.delete('v-mine');
		for (let i = 0; i < 2500; i++) env.MEDIA.store.set(`pub/v-mine/r9/${i}.m4s`, '"x"');
		let calls = 0;
		let most = 0;
		for (const name of ['MEDIA', 'MEDIA_PRIVATE', 'MEDIA_ORIGINALS', 'subtitles', 'videos', 'channels', 'profiles', 'LIVE_MEDIA', 'global_settings'] as const) {
			for (const method of ['list', 'delete', 'head', 'get'] as const) {
				const real = env[name][method].bind(env[name]);
				env[name][method] = async (...args: unknown[]) => {
					calls++;
					const page = await real(...args);
					if (method === 'list') most = Math.max(most, page.objects.length);
					if (method === 'delete' && Array.isArray(args[0])) assert.ok((args[0] as string[]).length <= 1000);
					return page;
				};
			}
		}
		const id = await start(env, [video('v-mine')]);
		for (let i = 0; i < 4; i++) {
			calls = 0;
			await step(env, id);
			assert.ok(calls < 600, `${calls} calls`);
		}
		assert.ok(most <= 1000);
		assert.deepEqual(left(env, 'v-mine'), []);
		assert.equal([...env.MEDIA.store.keys()].some((k: string) => k.startsWith('pub/v-mine/')), false);
	});

	it('a stream of many sessions goes on where it stopped, also after a failure', async () => {
		const env = await setup();
		env.videos.store.delete('livestream:ls-mine');
		for (let i = 0; i < 260; i++) {
			const sid = `m-${String(i).padStart(3, '0')}`;
			env.SEARCH_DB.db.prepare(`INSERT INTO live_sessions (id, stream_id, channel_id, provider, provider_ref, status, reason, created_at) VALUES (?, 'ls-mine', 'x', 'selfhosted', NULL, 'ended', 'test', 1)`).run(sid);
			env.LIVE_MEDIA.store.set(`live/${sid}/0.m4s`, '"x"');
		}
		const list = env.LIVE_MEDIA.list.bind(env.LIVE_MEDIA);
		const asked = new Map<string, number>();
		let fail = true;
		env.LIVE_MEDIA.list = async (o: Json) => {
			asked.set(o.prefix, (asked.get(o.prefix) ?? 0) + 1);
			if (fail && o.prefix === 'live/m-050/') {
				fail = false;
				throw new Error('R2 down');
			}
			return list(o);
		};
		const id = await start(env, [{ t: 'stream', id: 'ls-mine' }]);
		assert.match((await step(env, id)).note, /R2 down/);
		for (let i = 0; i < 8 && [...env.LIVE_MEDIA.store.keys()].some((k: string) => k.startsWith('live/m-')); i++) await step(env, id);
		assert.deepEqual([...env.LIVE_MEDIA.store.keys()], ['live/sess-mine/720/0.m4s', 'live/sess-mine/vod.m3u8', 'live/sess-other/720/0.m4s'].filter((k) => env.LIVE_MEDIA.store.has(k)));
		assert.equal(asked.get('live/m-010/'), 1, 'what was done is not asked for again');
	});

	it('a missing job table or queue answers 503 and keeps the records', async () => {
		for (const missing of ['ADMIN_JOBS_QUEUE', 'SEARCH_DB'] as const) {
			const env = await setup();
			delete env[missing];
			assert.equal((await erase(env, 503)).code, 'service_unavailable', missing);
			for (const key of ['v-mine', 'v-member', 'livestream:ls-mine']) assert.ok(env.videos.store.has(key), `${missing}: ${key}`);
			assert.ok(env.profiles.store.has(ME) && env.channels.store.has('ch-me'));
			assert.deepEqual(left(env, 'v-mine'), of('v-mine'), 'nothing is deleted in the request');
			assert.ok(out.images.has('/a-me_avatar.jpg'));
		}
	});
});

const start = async (env: Json, items: unknown[]) => (await createJob(env as never, { kind: ERASE_MEDIA_JOB, targetKind: 'user', targetId: 'deleted-user', actorId: 'system', params: { items } })).id;
const video = (id: string) => ({ t: 'video', id, bunny: { ref: id, library: {} } });

/** Channels of an account, in the index. */
async function manyChannels(env: Json, owner: string, count: number, last: Json = {}): Promise<void> {
	for (let i = 0; i < count; i++) {
		const id = `${owner}-ch-${String(i).padStart(3, '0')}`;
		env.channels.store.set(id, JSON.stringify({ id, userId: owner, ...(i === count - 1 ? last : {}) }));
	}
	await runIndex(env);
}
const own = (env: Json, path: string, owner: string | null, channel: string | null = 'ch-me', kind = 'post_image') => {
	out.images.add(path);
	env.SEARCH_DB.db.prepare(`INSERT OR REPLACE INTO image_owners (path, kind, owner_id, channel_id, created_at) VALUES (?, ?, ?, ?, '2026-11-01T00:00:00.000+00:00')`).run(path, kind, owner, channel);
};
const marks = (env: Json) => env.SEARCH_DB.db.prepare('SELECT COUNT(*) AS n FROM media_erase_targets WHERE claim_token IS NOT NULL').get().n;
/** Two hours pass for the marks. */
const age = (env: Json) => env.SEARCH_DB.db.prepare('UPDATE media_erase_targets SET claimed_at = ? WHERE claim_token IS NOT NULL').run(new Date(Date.now() - 2 * 3_600_000).toISOString());
const rowOf = (env: Json, path: string) => env.SEARCH_DB.db.prepare('SELECT path FROM image_owners WHERE path = ?').get(path);
const openCase = (env: Json, kind: string, id: string, params: Json = {}) => createJob(env as never, { kind: 'csam.contain', targetKind: kind as never, targetId: id, actorId: 'system', params });
const closeCase = (env: Json, id: string) => env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'succeeded' WHERE id = ?").run(id);
/** Outside calls of one step: R2, D1, HTTP. */
function counting(env: Json): { used: () => number; reset: () => void } {
	let n = 0;
	for (const b of ['channels', 'profiles', 'videos', 'MEDIA', 'MEDIA_PRIVATE']) {
		for (const m of ['get', 'head', 'list', 'delete']) {
			const real = env[b][m].bind(env[b]);
			env[b][m] = (...a: unknown[]) => (n++, real(...a));
		}
	}
	const prepare = env.SEARCH_DB.prepare.bind(env.SEARCH_DB);
	env.SEARCH_DB.prepare = (sql: string) => (n++, prepare(sql));
	return { used: () => n, reset: () => void (n = 0) };
}

describe('what its uploader shows, or may show', () => {
	it('is looked up in every channel they have; more than can be looked at, or an unreadable one, keeps the image', async () => {
		for (const [count, last, expected] of [
			[150, { avatarUrl: `${IMG}/c-me-member_cover.jpg` }, /uploader still shows it$/],
			[150, {}, null],
			[201, {}, /cannot be told$/],
		] as Array<[number, Json, RegExp | null]>) {
			const env = await setup();
			await manyChannels(env, OTHER, count, last);
			env.channels.store.delete('ch-me');
			const id = await start(env, [{ t: 'channel', id: 'ch-me' }]);
			let result: Json = {};
			for (let i = 0; i < 6 && !result.done; i++) result = await step(env, id);
			assert.equal(out.images.has('/c-me-member_cover.jpg'), !!expected, `${count} ${JSON.stringify(last)}`);
			if (expected) assert.match(result.result.kept.find((k: string) => k.includes('/c-me-member_cover.jpg')), expected);
		}
		const env = await setup();
		env.channels.store.delete('ch-me');
		env.channels.store.set('ch-other', '{not json');
		const id = await start(env, [{ t: 'channel', id: 'ch-me' }]);
		await step(env, id);
		assert.equal(out.images.has('/c-me-member_cover.jpg'), true);
	});

	it('lookups count: many uploaders with many channels take more steps, and each step decides something', async () => {
		const env = await setup();
		const people = Array.from({ length: 5 }, (_, i) => `usr_p${i}`);
		for (const who of people) {
			await manyChannels(env, who, 150);
			own(env, `/community-posts/ch-me/by-${who}.webp`, who);
		}
		env.channels.store.delete('ch-me');
		const id = await start(env, [{ t: 'channel', id: 'ch-me' }]);
		const count = counting(env);
		let steps = 0;
		for (let last: Json = {}; !last.done && steps < 20; steps++) {
			count.reset();
			last = await step(env, id);
			assert.ok(count.used() < 500, `${count.used()} calls`);
			if (!last.done && last.params.items?.length) assert.ok(last.delaySeconds > 0, 'not again at once');
		}
		assert.ok(steps > 2 && steps < 12, `${steps}`);
		for (const who of people) assert.equal(out.images.has(`/community-posts/ch-me/by-${who}.webp`), false, who);
	});

	it('kept files are passed once: what comes after thousands of them is reached', async () => {
		const env = await setup();
		await manyChannels(env, OTHER, 201);
		for (let i = 0; i < 2500; i++) own(env, `/community-posts/ch-big/a${String(i).padStart(4, '0')}.webp`, OTHER, 'ch-big');
		for (let i = 0; i < 15; i++) own(env, `/community-posts/ch-big/z${i}.webp`, null, 'ch-big');
		const id = await start(env, [{ t: 'channel', id: 'ch-big' }]);
		let steps = 0;
		for (let last: Json = {}; !last.done && steps < 8; steps++) last = await step(env, id);
		assert.ok(steps < 8, `${steps}`);
		assert.deepEqual([...out.images].filter((p) => p.startsWith('/community-posts/ch-big/z')), []);
		assert.equal([...out.images].filter((p) => p.startsWith('/community-posts/ch-big/a')).length, 2500);
	});
});

describe('a takedown and an erasure of the same media', () => {
	it('a stream with nothing but review media waits too', async () => {
		const env = await setup();
		await env.MEDIA_PRIVATE.put('review/ls-only/r1/frames/0.jpg', '{}');
		const opened = await openCase(env, 'video', 'ls-only');
		const id = await start(env, [{ t: 'stream', id: 'ls-only' }]);
		assert.match((await step(env, id)).note, /a takedown case is open/);
		assert.ok(env.MEDIA_PRIVATE.store.has('review/ls-only/r1/frames/0.jpg'));
		closeCase(env, opened.id);
		await step(env, id);
		assert.equal(env.MEDIA_PRIVATE.store.has('review/ls-only/r1/frames/0.jpg'), false);
	});

	it('an image waits for its uploader\'s case, whichever entity is erased; the rest goes', async () => {
		const env = await setup();
		for (const key of ['v-mine', 'livestream:ls-mine']) env.videos.store.delete(key);
		env.channels.store.delete('ch-me');
		own(env, '/thumbnails/v-mine/by-member.jpg', OTHER, null, 'video_thumbnail');
		const theirs = ['/c-me-member_cover.jpg', '/community-posts/ch-me/by-member.webp', '/thumbnails/v-mine/by-member.jpg'];
		const opened = await openCase(env, 'user', OTHER);
		const id = await start(env, [{ t: 'channel', id: 'ch-me' }, video('v-mine')]);
		for (let i = 0; i < 2; i++) assert.match((await step(env, id)).note, /a takedown case is open/);
		for (const path of theirs) {
			assert.ok(out.images.has(path), path);
			assert.ok(rowOf(env, path), path);
		}
		for (const path of ['/c-me_avatar.jpg', '/community-posts/ch-me/p1.webp', '/thumbnails/v-mine/t.jpg']) assert.equal(out.images.has(path), false, path);
		closeCase(env, opened.id);
		// Held by a case of something else of theirs
		const other = await openCase(env, 'channel', 'elsewhere');
		await holdTargets(env.SEARCH_DB, [{ kind: 'user', id: OTHER }], other);
		for (const path of ['/community-posts/ch-me/late.webp']) own(env, path, null);
		const next = await start(env, [{ t: 'channel', id: 'ch-me' }]);
		assert.match((await step(env, next)).note, /a takedown case is open/);
		assert.deepEqual([out.images.has('/community-posts/ch-me/late.webp'), theirs.slice(0, 2).every((path) => out.images.has(path))], [false, true], 'file by file');
		closeCase(env, other.id);
		for (let i = 0; i < 2; i++) await step(env, id);
		for (const path of theirs) {
			assert.equal(out.images.has(path), false, path);
			assert.equal(rowOf(env, path), undefined, path);
		}
	});

	it('a case of the uploader that begins between the look and the delete stops it', async () => {
		const env = await setup();
		env.channels.store.delete('ch-me');
		const id = await start(env, [{ t: 'channel', id: 'ch-me' }]);
		const get = env.profiles.get.bind(env.profiles);
		env.profiles.get = async (key: string) => {
			if (key === OTHER && !(await uploadersUnderTakedown(env.SEARCH_DB, [OTHER])).size) await openCase(env, 'user', OTHER);
			return get(key);
		};
		assert.match((await step(env, id)).note, /a takedown case is open/);
		assert.ok(out.images.has('/c-me-member_cover.jpg'));
	});

	it('a case of the channel that begins between the look and the delete stops its folder too', async () => {
		const env = await setup();
		for (const path of ['/community-posts/ch-big/a.webp', '/community-posts/ch-big/b.webp']) own(env, path, OTHER, 'ch-big');
		const id = await start(env, [{ t: 'channel', id: 'ch-big' }]);
		const get = env.profiles.get.bind(env.profiles);
		let opened: Json | null = null;
		env.profiles.get = async (key: string) => {
			opened ??= await openCase(env, 'channel', 'ch-big');
			return get(key);
		};
		assert.match((await step(env, id)).note, /a takedown case is open/);
		for (const f of ['a', 'b']) assert.ok(out.images.has(`/community-posts/ch-big/${f}.webp`));
		closeCase(env, opened!.id);
		await step(env, id);
		for (const f of ['a', 'b']) assert.equal(out.images.has(`/community-posts/ch-big/${f}.webp`), false);
	});

	it('a part is taken in one statement: all of its targets or none, never while a case is open or holds one', async () => {
		const env = await setup();
		const db = env.SEARCH_DB;
		const V = { kind: 'video' as const, id: 'v-mine' };
		const rows = () => db.db.prepare('SELECT target_kind AS kind, target_id AS id, job_id AS job, claimed_at AS at FROM media_erase_targets ORDER BY 1, 2, 3').all() as Json[];
		// Several jobs of one target, each with its own mark
		assert.equal(await takePart(db, 'j1', 'd1', [V]), true);
		assert.equal(await takePart(db, 'j2', 'd2', [V]), true);
		await endParts(db, 'j1', 'd1', 'none');
		assert.deepEqual(rows().map((r) => [r.job, !!r.at]), [['j1', false], ['j2', true]]);
		await endParts(db, 'j2', 'd2', 'none');
		const opened = await openCase(env, 'video', 'v-mine');
		assert.equal(await takePart(db, 'j1', 'd1', [V]), false);
		assert.equal(await takePart(db, 'j1', 'd1', [{ kind: 'channel', id: 'ch-me' }, V]), false);
		assert.ok(rows().every((r) => !r.at), 'none of them');
		const person = await openCase(env, 'user', OTHER);
		assert.equal(await takePart(db, 'j1', 'd1', [{ kind: 'channel', id: 'ch-me' }, { kind: 'user', id: OTHER }]), false);
		for (const job of [opened, person]) closeCase(env, job.id);
		assert.equal(await takePart(db, 'j1', 'd1', [{ kind: 'channel', id: 'ch-me' }, { kind: 'user', id: OTHER }]), true);
		assert.equal(rows().filter((r) => r.at).length, 2);
		await endParts(db, 'j1', 'd1', 'none');
		// Held by a case of another target, for as long as that case is open
		const other = await openCase(env, 'channel', 'elsewhere');
		await holdTargets(db, [V], other);
		assert.equal(await takePart(db, 'j2', 'd2', [V]), false);
		closeCase(env, other.id);
		assert.equal(await takePart(db, 'j2', 'd2', [V]), true);
		db.trace = [];
		await takePart(db, 'j2', 'd2', [{ kind: 'channel', id: 'ch-me' }, { kind: 'user', id: OTHER }]);
		await endParts(db, 'j2', 'd2', 'deleted');
		await uploadersUnderTakedown(db, [ME, OTHER]);
		await erasedTargets(db, V);
		await holdTargets(db, [V], other);
		const traced = [...db.trace] as Array<{ sql: string; params: unknown[] }>;
		db.trace = null;
		assert.equal(traced.length, 5);
		for (const { sql, params } of traced) {
			// By the primary key
			if (/ VALUES \(/.test(sql)) continue;
			const plan = (db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Json[]).map((r) => r.detail).join(' | ');
			assert.doesNotMatch(plan, /SCAN (admin_jobs|media_erase_targets|c|h|m|t|j)( |$)(?!VIRTUAL)/, `${sql}: ${plan}`);
			assert.match(plan, /SEARCH (media_erase_targets|c|h|m|t|j) USING/, plan);
		}
	});

	it('what a part deleted is written down on its targets; a part that deleted nothing says nothing', async () => {
		const env = await setup();
		const db = env.SEARCH_DB;
		const V = { kind: 'video' as const, id: 'v-mine' };
		const at = (n: number) => new Date(Date.UTC(2026, 10, 24, n));
		const one = async () => (await erasedTargets(db, V))[0];
		await writeTarget(db, V, 'j1', { id: 'v-mine' });
		await takePart(db, 'j1', 'd1', [V], at(1));
		await endParts(db, 'j1', 'd1', 'none', at(1));
		assert.deepEqual([(await one()).firstDeletedAt, (await one()).stoppedAt], [null, null]);
		for (const n of [2, 4]) {
			await takePart(db, 'j1', 'd1', [V], at(n));
			await endParts(db, 'j1', 'd1', 'deleted', at(n + 1));
		}
		assert.deepEqual([(await one()).firstDeletedAt, (await one()).lastDeletedAt], [at(2).toISOString(), at(5).toISOString()]);
		await takePart(db, 'j1', 'd1', [V], at(8));
		assert.equal((await one()).stoppedAt, at(8).toISOString(), 'a mark whose job is not at work');
		await endParts(db, 'j1', 'd1', 'stopped', at(9));
		assert.equal((await one()).stoppedAt, at(8).toISOString());
		// The job itself
		for (const fails of [false, true]) {
			const u = await setup();
			const hooks = eraseMediaHooks(u);
			await hooks.onVideoDeleted('v-mine', u.videos.read('v-mine'), 'v-mine');
			u.videos.store.delete('v-mine');
			if (fails) u.MEDIA.delete = async () => Promise.reject(new Error('R2 down'));
			await step(u, jobs(u)[0].id);
			const [row] = await erasedTargets(u.SEARCH_DB, V);
			assert.deepEqual([!!row.firstDeletedAt, !!row.stoppedAt, row.live], fails ? [false, true, false] : [true, false, false]);
		}
	});

	it('a mark counts only while its job is at work, for an hour at most', async () => {
		const env = await setup();
		const db = env.SEARCH_DB;
		const V = { kind: 'video' as const, id: 'v-mine' };
		const hooks = eraseMediaHooks(env);
		await hooks.onVideoDeleted('v-mine', env.videos.read('v-mine'), 'v-mine');
		const id = jobs(env)[0].id;
		const live = async () => (await erasedTargets(db, V))[0].live;
		await takePart(db, id, 'd1', [V]);
		for (const [status, expected] of [['running', true], ['queued', true], ['retrying', true], ['failed', false], ['succeeded', false]] as const) {
			db.db.prepare('UPDATE admin_jobs SET status = ? WHERE id = ?').run(status, id);
			assert.equal(await live(), expected, status);
		}
		db.db.prepare("UPDATE admin_jobs SET status = 'running' WHERE id = ?").run(id);
		age(env);
		assert.equal(await live(), false);
		await onEraseMediaFailed(env, (await getJob(env as never, id))!, 'gave up');
		assert.equal((await erasedTargets(db, V))[0].stoppedAt !== null, true);
		assert.equal(marks(env), 0);
	});

	it('a delivery ends only its own part; beside another one it does not start, and says nothing of the job', async () => {
		const env = await setup();
		const db = env.SEARCH_DB;
		const V = { kind: 'video' as const, id: 'v-mine' };
		await takePart(db, 'j1', 'd1', [V]);
		await assert.rejects(takePart(db, 'j1', 'd2', [V]), /another delivery/);
		assert.equal(await takePart(db, 'j1', 'd2', [{ kind: 'video', id: 'v-member' }]), true, 'other media');
		await endParts(db, 'j1', 'd2', 'deleted');
		const token = () => db.db.prepare("SELECT claim_token AS t, first_deleted_at AS d FROM media_erase_targets WHERE target_id = 'v-mine'").get() as Json;
		assert.deepEqual({ ...token() }, { t: 'd1', d: null });
		age(env);
		assert.equal(await takePart(db, 'j1', 'd2', [V]), true, 'nobody\'s after an hour');
		await endParts(db, 'j1', 'd2', 'none');
		assert.ok(db.db.prepare("SELECT stopped_at AS at FROM media_erase_targets WHERE target_id = 'v-mine'").get().at, 'and that it stopped is kept');
		// The job
		const u = await setup();
		u.videos.store.delete('v-mine');
		const id = await start(u, [video('v-mine')]);
		await takePart(u.SEARCH_DB, id, 'other', [V]);
		const before = jobs(u)[0].params;
		assert.deepEqual(await runEraseMedia(u, (await getJob(u as never, id))!), { later: 600 });
		assert.deepEqual([left(u, 'v-mine'), jobs(u)[0].params, marks(u)], [of('v-mine'), before, 1]);
		await onEraseMediaFailed(u, (await getJob(u as never, id))!, 'x');
		assert.equal(marks(u), 1, 'nor does the failure handler take a live one');
		// A mark of nobody is taken back, also of what this delivery does not touch
		await takePart(u.SEARCH_DB, id, 'other', [{ kind: 'channel', id: 'ch-other' }]);
		age(u);
		await step(u, id);
		assert.deepEqual([left(u, 'v-mine'), marks(u)], [[], 0]);
	});

	it('what was put off runs again unless the job has moved on by then', async () => {
		for (const moved of [false, true]) {
			const env = await setup();
			env.videos.store.delete('v-mine');
			const id = await start(env, [video('v-mine')]);
			await takePart(env.SEARCH_DB, id, 'other', [{ kind: 'video', id: 'v-mine' }]);
			await drainJobs(env as never, 1);
			assert.deepEqual(env.ADMIN_JOBS_QUEUE.sent.map((m: Json) => [m.delaySeconds, typeof m.body.payload.ifUnmovedSince]), [[600, 'string']]);
			age(env);
			if (moved) env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'queued', updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(id);
			await drainJobs(env as never, 1);
			assert.equal(left(env, 'v-mine').length === 0, !moved);
			assert.equal(env.ADMIN_JOBS_QUEUE.sent.length, moved ? 0 : 1, 'one chain of deliveries');
		}
	});

	it('a record whose case began meanwhile may go: its media stays, held, and is found by what was written down', async () => {
		for (const full of [true, false]) {
			const env = await setup();
			env.videos.store.set('v-mine', JSON.stringify({ ...env.videos.read('v-mine'), playUrl: 'https://vz-x.b-cdn.net/v-mine/playlist.m3u8', title: 'a title', r2: { status: 'ready', access: 'pub', rev: 'r1' } }));
			const hooks = eraseMediaHooks(env, undefined, full ? {} : { runAccount: true });
			let post: Json | null = null;
			const withCase = {
				...hooks,
				onVideoDeleted: async (id: string, record: unknown, key?: string) => {
					await hooks.onVideoDeleted(id, record, key);
					if (id === 'v-mine') await openCase(env, 'video', 'v-mine');
				},
				onPostDeleted: async (channelId: string, postId: string, record: unknown) => {
					await hooks.onPostDeleted(channelId, postId, record);
					post = await openCase(env, 'channel', 'ch-me', { resolution: { kind: 'post_image', channelId: 'ch-me', postId: 'p1' } });
				},
			};
			if (full) await eraseUserData(env as never, ME, new OperationBudget(5000), withCase);
			else await eraseRunUserData(env as never, ME, new OperationBudget(900), withCase);
			assert.ok(post, `full ${full}`);
			assert.equal(env.videos.store.has('v-mine'), false);
			const media = (await erasedRecord(env.SEARCH_DB, { kind: 'video', id: 'v-mine' }))!;
			assert.deepEqual([media.channelId, media.r2.rev, media.media.providers.bunny.ref, media.title], ['ch-me', 'r1', 'v-mine', undefined], 'ids and paths, no text');
			assert.deepEqual((await erasedRecord(env.SEARCH_DB, { kind: 'post', id: 'ch-me/p1' }))!.images, [{ url: `${IMG}/community-posts/ch-me/p1.webp` }], 'its own folder only');
			for (const job of jobs(env)) for (let i = 0; i < 2; i++) await step(env, job.id);
			assert.deepEqual(left(env, 'v-mine'), of('v-mine'), `full ${full}`);
			assert.ok(out.images.has('/community-posts/ch-me/p1.webp'));
			assert.deepEqual(left(env, 'v-member'), [], 'the rest goes');
		}
	});

	it('rows that name an account go with its images; the others keep what was deleted when, not the list', async () => {
		const env = await setup();
		await erase(env);
		const id = jobs(env)[0].id;
		const rows = () => env.SEARCH_DB.db.prepare('SELECT target_kind AS kind, target_id AS id, media, claimed_at AS at, first_deleted_at AS first FROM media_erase_targets').all() as Json[];
		assert.ok(rows().some((r) => r.kind === 'user' && r.id === ME && r.media.includes('/a-me_avatar.jpg')));
		assert.ok(rows().some((r) => r.kind === 'post' && r.id === 'ch-me/p1'));
		let swept = false;
		for (let last: Json = {}; !last.done; ) {
			last = await step(env, id);
			if (last.delaySeconds !== SWEEP_DELAY) continue;
			swept = true;
			assert.deepEqual(rows().filter((r) => r.kind === 'user'), []);
			assert.ok(rows().some((r) => r.id === 'v-mine' && r.media));
		}
		assert.ok(swept);
		assert.deepEqual(rows().map((r) => [r.kind, r.id, r.media, r.at]).sort(), [['channel', 'ch-me', null, null], ['video', 'ls-mine', null, null], ['video', 'v-member', null, null], ['video', 'v-mine', null, null]]);
		assert.ok(rows().every((r) => r.first), 'since when');
	});
});

describe('the day before anything is deleted', () => {
	it('counts from the last record written down; until then the job only waits', async () => {
		const env = await setup();
		const before = Date.now();
		await erase(env);
		const id = jobs(env)[0].id;
		const params = () => JSON.parse(jobs(env)[0].params);
		const runAfter = Date.parse(params().runAfter);
		assert.ok(runAfter >= before + ERASE_DELAY * 1000 && runAfter <= Date.now() + ERASE_DELAY * 1000);
		assert.equal(ERASE_DELAY, 24 * 3600);
		const job = (await getJob(env as never, id))!;
		const waits = (await runEraseMedia(env, job)) as Json;
		assert.deepEqual([waits.done, waits.delaySeconds], [false, 43_200]);
		assert.deepEqual(waits.params, params(), 'as it was');
		assert.deepEqual(left(env, 'v-mine'), of('v-mine'));
		// Still before its first run: the list takes more, and the day starts again
		const hooks = eraseMediaHooks(env);
		await hooks.onVideoDeleted('a', { id: 'a' }, 'a');
		const [, second] = jobs(env);
		env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET params = json_set(params, '$.runAfter', '2026-01-01T00:00:00.000Z') WHERE id = ?").run(second.id);
		await hooks.onVideoDeleted('b', { id: 'b' }, 'b');
		const again = JSON.parse(jobs(env)[1].params);
		assert.deepEqual([again.items.length, Date.parse(again.runAfter) > Date.now() + 86_000_000], [2, true]);
		// Shortly before: only the rest of it
		env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET params = json_set(params, '$.runAfter', ?) WHERE id = ?").run(new Date(Date.now() + 60_000).toISOString(), id);
		const rest = (await runEraseMedia(env, (await getJob(env as never, id))!)) as Json;
		assert.ok(rest.delaySeconds > 50 && rest.delaySeconds <= 61, `${rest.delaySeconds}`);
	});

	it('subtitles and side records wait with the rest; a stream\'s too', async () => {
		const env = await setup();
		const side = ['v-mine', 'ls-mine'].flatMap((id) => [['subtitles', `${id}/en.vtt`], ['global_settings', `ops/playlist-adds/${id}/x.json`]]) as Array<[string, string]>;
		for (const [bucket, key] of side) env[bucket].store.set(key, '"x"');
		await erase(env);
		assert.equal(env.videos.store.has('v-mine'), false);
		for (const [bucket, key] of side) assert.ok(env[bucket].store.has(key), key);
		await drain(env);
		for (const [bucket, key] of side) assert.equal(env[bucket].store.has(key), false, key);
	});

	it('a record still there starts its day when it is seen gone; one written down again later, from then', async () => {
		const DAY = 24 * 3600;
		const seconds = (o: Json) => Math.round(o.delaySeconds);
		const at = (env: Json, id: string, over: Json) => env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET params = json_patch(params, ?) WHERE id = ?").run(JSON.stringify(over), id);
		const raw = async (env: Json, id: string): Promise<Json> => {
			const outcome = (await runEraseMedia(env, (await getJob(env as never, id))!)) as Json;
			env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'queued', params = ? WHERE id = ?").run(JSON.stringify(outcome.params), id);
			return outcome;
		};
		for (const kind of ['video', 'channel', 'images'] as const) {
			const env = await setup();
			const item = kind === 'video' ? video('v-mine') : kind === 'channel' ? { t: 'channel', id: 'ch-me' } : { t: 'images', paths: ['/a-me_avatar.jpg'] };
			const there = () => (kind === 'video' ? left(env, 'v-mine').length > 0 : out.images.has(kind === 'channel' ? '/c-me_avatar.jpg' : '/a-me_avatar.jpg'));
			const id = await start(env, [item]);
			at(env, id, { delay: DAY });
			assert.equal((await raw(env, id)).delaySeconds, RETRY_DELAYS[0], 'the record is still there');
			const [bucket, key] = kind === 'video' ? ['videos', 'v-mine'] : kind === 'channel' ? ['channels', 'ch-me'] : ['profiles', ME];
			env[bucket].store.delete(key);
			const waits = await raw(env, id);
			assert.ok(waits.done === false && seconds(waits) === 43_200, `${kind} ${JSON.stringify(waits)}`);
			assert.match(waits.note, /less than a day ago/);
			assert.equal(there(), true, kind);
			assert.equal((await raw(env, id)).done, false);
			assert.equal(there(), true, `${kind}: and again`);
			// The day is over
			const params = JSON.parse(jobs(env)[0].params);
			for (const i of params.items) i.arm = Object.fromEntries(Object.keys(i.arm).map((k) => [k, '2026-01-01T00:00:00.000Z']));
			at(env, id, { items: params.items });
			await raw(env, id);
			assert.equal(there(), false, kind);
		}
		// Written down by an earlier pass that stopped, the record deleted by a later one
		const env = await setup();
		await eraseMediaHooks(env).onVideoDeleted('v-mine', env.videos.read('v-mine'), 'v-mine');
		await eraseMediaHooks(env).onVideoDeleted('v-mine', env.videos.read('v-mine'), 'v-mine');
		env.videos.store.delete('v-mine');
		const [first] = jobs(env);
		at(env, first.id, { runAfter: '2026-01-01T00:00:00.000Z' });
		const early = await raw(env, first.id);
		assert.deepEqual([early.done, left(env, 'v-mine').length], [false, of('v-mine').length]);
		env.SEARCH_DB.db.prepare("UPDATE media_erase_targets SET erased_at = '2026-01-01T00:00:00.000Z'").run();
		const params = JSON.parse(jobs(env)[0].params);
		at(env, first.id, { items: params.items.map((i: Json) => ({ ...i, arm: { self: '2026-01-01T00:00:00.000Z' } })) });
		await raw(env, first.id);
		assert.deepEqual(left(env, 'v-mine'), []);
	});

	it('the last part of a video lists nothing without a bound', async () => {
		const env = await setup();
		env.videos.store.delete('v-mine');
		for (const id of ['v-mine', 'ls-mine']) for (let i = 0; i < 1200; i++) env.global_settings.store.set(`ops/playlist-adds/${id}/${i}.json`, '"x"');
		for (let i = 0; i < 1200; i++) env.subtitles.store.set(`ls-mine/${i}.vtt`, '"x"');
		env.videos.store.delete('livestream:ls-mine');
		const id = await start(env, [video('v-mine'), { t: 'stream', id: 'ls-mine' }]);
		// An encode that ends while the rest is being deleted
		const remove = env.MEDIA.delete.bind(env.MEDIA);
		let late = false;
		env.MEDIA_ORIGINALS.delete = ((real) => async (keys: string[]) => {
			await real(keys);
			if (!late) for (let i = 0; i < 1800; i++) env.MEDIA.store.set(`pub/v-mine/late/${i}.m4s`, '"x"');
			late = true;
		})(env.MEDIA_ORIGINALS.delete.bind(env.MEDIA_ORIGINALS));
		let most = 0;
		env.MEDIA.delete = async (keys: string | string[]) => {
			most = Math.max(most, Array.isArray(keys) ? keys.length : 1);
			return remove(keys);
		};
		// And side records that come during the last part itself, which starts with the video's and the stream's marker
		const lateSide = new Set<string>();
		for (const name of ['global_settings', 'subtitles']) {
			const list = env[name].list.bind(env[name]);
			env[name].list = async (o: Json) => {
				assert.ok(o.limit <= 500, `${name} ${o.prefix}`);
				return list(o);
			};
			const real = env[name].delete.bind(env[name]);
			env[name].delete = async (keys: string | string[]) => {
				most = Math.max(most, Array.isArray(keys) ? keys.length : 1);
				const marker = (Array.isArray(keys) ? keys : [keys]).find((k) => k.startsWith('ops/upload-reaper/created/'));
				const of = marker?.split('/').pop();
				if (of && !lateSide.has(of)) {
					lateSide.add(of);
					for (let i = 0; i < 1200; i++) env.global_settings.store.set(`ops/playlist-adds/${of}/late-${i}.json`, '"x"');
				}
				return real(keys);
			};
		}
		const first = await step(env, id);
		assert.equal(first.delaySeconds, SWEEP_DELAY);
		const adds = () => [...env.global_settings.store.keys()].filter((k: string) => k.includes('playlist-adds'));
		assert.deepEqual([...lateSide].sort(), ['ls-mine', 'v-mine']);
		assert.deepEqual([adds().length, adds().every((k) => k.includes('/late-'))], [2400, true]);
		assert.deepEqual([...env.subtitles.store.keys()].filter((k: string) => k.startsWith('ls-mine/')), []);
		assert.ok(late && most <= 500, `${most}`);
		assert.equal([...env.MEDIA.store.keys()].filter((k: string) => k.startsWith('pub/v-mine/late/')).length, 1800, 'the second look\'s');
		await step(env, id);
		assert.deepEqual([[...env.MEDIA.store.keys()].some((k: string) => k.startsWith('pub/v-mine/')), adds(), most <= 500], [false, [], true]);
	});

	it('a run account\'s media goes right after its pass', async () => {
		const env = Object.assign(await setup(), { BUNNY_TEST_LIBRARY: 'true', ENVIRONMENT: 'qa' });
		await recordDeletion(env.SEARCH_DB, { kind: 'user', id: ME, deletedBy: 'admin' } as never);
		await ADMIN_JOB_HANDLERS['user.erase-run']!(env as never, { id: 'j', kind: 'user.erase-run', targetId: ME, params: {}, result: null } as never);
		const [job] = jobs(env);
		assert.ok(Date.parse(JSON.parse(job.params).runAfter) <= Date.now() + RUN_ACCOUNT_DELAY * 1000);
		assert.equal(env.ADMIN_JOBS_QUEUE.sent.find((m: Json) => m.delaySeconds)?.delaySeconds, RUN_ACCOUNT_DELAY);
		assert.equal(RUN_ACCOUNT_DELAY, 5);
	});

	const RUN_EMAIL = 'e2e+45566375022-1-web-chromium-single@e2e.alummahnow.net';
	const TEST_ENV = { BUNNY_TEST_LIBRARY: 'true', ENVIRONMENT: 'qa' };
	for (const by of ['their own "Delete my data"', 'an admin', 'the run sweep'] as const) {
		it(`a run account erased by ${by}: at once, in one round, and nothing of it is left, the upload marker by Bunny's id too`, async () => {
			const env = await setup();
			Object.assign(env, TEST_ENV);
			await env.profiles.put(ME, JSON.stringify({ ...env.profiles.read(ME), email: RUN_EMAIL }));
			await env.videos.put('v-mine', JSON.stringify({ ...env.videos.read('v-mine'), media: { providers: { bunny: { ref: 'guid-1' } } } }));
			out.bunny.add('guid-1');
			env.global_settings.store.set('ops/upload-reaper/created/guid-1', JSON.stringify({ userId: ME }));
			await runIndex(env);
			await runOwnershipPass(env as never, 'profile', { maxPages: 10 });
			if (by === 'their own "Delete my data"') await erase(env, 200, RUN_EMAIL);
			else {
				await recordDeletion(env.SEARCH_DB, { kind: 'user', id: ME, deletedBy: 'admin' } as never);
				const kind = by === 'an admin' ? 'user.delete-data' : 'user.erase-run';
				const outcome = (await ADMIN_JOB_HANDLERS[kind]!(env as never, { id: 'j', kind, targetId: ME, params: {}, result: null } as never)) as Json;
				assert.equal(outcome.done, true);
			}
			const own = jobs(env);
			assert.ok(own.length > 0);
			for (const job of own) {
				const p = JSON.parse(job.params);
				assert.deepEqual([p.run, p.delay, Date.parse(p.runAfter) <= Date.now() + 5000], [true, 5, true]);
			}
			// As it is: nothing is moved forward but those seconds
			env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET params = json_set(params, '$.runAfter', ?) WHERE kind = ?").run(new Date(0).toISOString(), ERASE_MEDIA_JOB);
			env.SEARCH_DB.db.prepare("UPDATE media_erase_targets SET erased_at = '2026-01-01T00:00:00.000Z'").run();
			const delays = env.ADMIN_JOBS_QUEUE.sent.length;
			assert.ok(delays > 0);
			const send = env.ADMIN_JOBS_QUEUE.send.bind(env.ADMIN_JOBS_QUEUE);
			const waits: number[] = [];
			env.ADMIN_JOBS_QUEUE.send = async (body: unknown, options?: { delaySeconds?: number }) => {
				waits.push(options?.delaySeconds ?? 0);
				return send(body, options);
			};
			await drainJobs(env as never);
			assert.ok(jobs(env).every((j) => j.status === 'succeeded'), jobs(env).map((j) => j.last_error).join());
			assert.ok(waits.every((s) => s <= 30), `${waits}`);
			assert.equal(env.SEARCH_DB.db.prepare('SELECT COUNT(*) AS n FROM media_erase_targets').get().n, 0);
			assert.equal(env.SEARCH_DB.db.prepare('SELECT COUNT(*) AS n FROM image_owners WHERE owner_id = ?').get(ME).n, 0);
			assert.deepEqual([left(env, 'v-mine'), out.bunny.has('guid-1'), env.global_settings.store.has('ops/upload-reaper/created/guid-1')], [[], false, false]);
		});
	}

	it('only a run account of a test environment: any other address, or production, keeps the day', async () => {
		for (const [email, over] of [['me@test.example', TEST_ENV], [RUN_EMAIL, { BUNNY_TEST_LIBRARY: 'false', ENVIRONMENT: 'qa' }], [RUN_EMAIL, { BUNNY_TEST_LIBRARY: 'true', ENVIRONMENT: 'production' }], [RUN_EMAIL, {}], [`x${RUN_EMAIL}`, TEST_ENV]] as Array<[string, Json]>) {
			const env = await setup();
			Object.assign(env, over);
			await erase(env, 200, email);
			const p = JSON.parse(jobs(env)[0].params);
			assert.deepEqual([p.run, p.delay], [undefined, ERASE_DELAY], `${email} ${JSON.stringify(over)}`);
		}
	});

	it('what fails of a run account is tried again within seconds', async () => {
		const env = await setup();
		env.videos.store.clear();
		out.failBunny = true;
		const id = await start(env, [video('v-mine')]);
		env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET params = json_set(params, '$.run', json('true')) WHERE id = ?").run(id);
		for (const delay of [5, 5, 10, 15, 20, 30]) assert.equal((await step(env, id)).delaySeconds, delay);
		await assert.rejects(step(env, id), /Not erased/);
	});

	it('a thumbnail folder that cannot be listed keeps the item, not the rest of the video', async () => {
		const env = await setup();
		env.videos.store.clear();
		out.failImages = true;
		const id = await start(env, [video('v-mine')]);
		const first = await step(env, id);
		assert.match(first.note, /^video v-mine: Image storage list answered 500/);
		assert.deepEqual([out.bunny.has('v-mine'), left(env, 'v-mine'), first.result.videos], [false, [], 0]);
		out.failImages = false;
		assert.equal((await step(env, id)).result.videos, 1);
		assert.equal(out.images.has('/thumbnails/v-mine/t.jpg'), false);
	});

	it('files left to finish of an account are finished by their rows alone', async () => {
		const env = await setup();
		env.profiles.store.delete(ME);
		const id = await start(env, [{ t: 'files', kind: 'user', id: '', paths: ['/a-me_avatar.jpg'], own: true }, { t: 'files', kind: 'user', id: '', paths: ['/gone.jpg'], own: true }]);
		const opened = await openCase(env, 'user', ME);
		assert.match((await step(env, id)).note, /a takedown case is open/);
		assert.ok(out.images.has('/a-me_avatar.jpg'));
		closeCase(env, opened.id);
		for (let i = 0; i < 2; i++) await step(env, id);
		assert.deepEqual([out.images.has('/a-me_avatar.jpg'), rowOf(env, '/a-me_avatar.jpg')], [false, undefined]);
	});

	it('nor does the job of a run account run, or go at once, anywhere but there', async () => {
		for (const over of [{}, { BUNNY_TEST_LIBRARY: 'true', ENVIRONMENT: 'production' }, { BUNNY_TEST_LIBRARY: 'false', ENVIRONMENT: 'qa' }]) {
			const env = Object.assign(await setup(), over);
			await recordDeletion(env.SEARCH_DB, { kind: 'user', id: ME, deletedBy: 'admin' } as never);
			await assert.rejects(ADMIN_JOB_HANDLERS['user.erase-run']!(env as never, { id: 'j', kind: 'user.erase-run', targetId: ME, params: {}, result: null } as never), /only where there are any/);
			assert.ok(env.videos.store.has('v-mine') && env.profiles.store.has(ME));
			await eraseMediaHooks(env, undefined, { runAccount: true }).onVideoDeleted('v-mine', env.videos.read('v-mine'), 'v-mine');
			const p = JSON.parse(jobs(env)[0].params);
			assert.deepEqual([p.run, p.delay], [undefined, ERASE_DELAY], JSON.stringify(over));
		}
	});

	it('an account\'s images that wait for their record, then for their day, name no account on the job', async () => {
		const env = await setup();
		own(env, '/for-gone_cover.jpg', ME, 'ch-gone', 'channel_cover');
		const id = await start(env, [{ t: 'images', paths: ['/a-me_avatar.jpg', '/a-me-old_avatar.jpg', '/for-gone_cover.jpg'] }]);
		const set = (over: Json) => env.SEARCH_DB.db.prepare('UPDATE admin_jobs SET params = json_patch(params, ?) WHERE id = ?').run(JSON.stringify(over), id);
		set({ delay: 24 * 3600 });
		const run = async (): Promise<Json> => {
			const outcome = (await runEraseMedia(env, (await getJob(env as never, id))!)) as Json;
			env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'queued', params = ?, result = ?, last_error = ? WHERE id = ?").run(JSON.stringify(outcome.params), JSON.stringify(outcome.result ?? null), outcome.note ?? null, id);
			assert.ok(!JSON.stringify(jobs(env)[0]).includes(ME), JSON.stringify(jobs(env)[0]));
			return outcome;
		};
		assert.equal((await run()).delaySeconds, RETRY_DELAYS[0], 'the profile is still there');
		assert.deepEqual(JSON.parse(jobs(env)[0].params).items[0].arm, { account: 'seen' });
		env.profiles.store.delete(ME);
		for (let i = 0; i < 2; i++) assert.match((await run()).note, /less than a day ago/);
		assert.ok(out.images.has('/a-me_avatar.jpg') && !out.images.has('/for-gone_cover.jpg'), 'each by its own record');
		const { items } = JSON.parse(jobs(env)[0].params);
		assert.ok(Date.parse(items[0].arm.account) > Date.now());
		set({ items: [{ ...items[0], arm: { account: '2026-01-01T00:00:00.000Z' } }] });
		await run();
		assert.equal(out.images.has('/a-me_avatar.jpg'), false);
	});

	it('what the job writes of the files it is deleting names no account', async () => {
		const env = await setup();
		env.profiles.store.delete(ME);
		const id = await start(env, [{ t: 'images', paths: ['/a-me_avatar.jpg', '/a-me-old_avatar.jpg'] }]);
		const prepare = env.SEARCH_DB.prepare.bind(env.SEARCH_DB);
		const seen: string[] = [];
		env.SEARCH_DB.prepare = (text: string) => {
			const statement = prepare(text);
			if (!text.includes("'$.unfinished'")) return statement;
			return { bind: (...args: unknown[]) => (seen.push(String(args[0])), statement.bind(...args)) };
		};
		out.failCdn = true;
		await step(env, id);
		assert.ok(seen.length && seen.every((text) => text.includes('/a-me_avatar.jpg') && !text.includes(ME)), seen.join());
		assert.ok(!JSON.stringify(jobs(env)[0]).includes(ME));
		// Finished from its rows
		out.failCdn = false;
		for (const files of JSON.parse(jobs(env)[0].params).items.filter((i: Json) => i.t === 'files')) assert.equal(files.id, '');
		await step(env, id);
		for (const path of ['/a-me_avatar.jpg', '/a-me-old_avatar.jpg']) assert.deepEqual([out.images.has(path), rowOf(env, path), out.purged.includes(`${IMG}${path}`)], [false, undefined, true]);
	});
});

describe('a try that stops half-way', () => {
	const rowsLeft = (env: Json) => (env.SEARCH_DB.db.prepare(`SELECT path FROM image_owners WHERE path LIKE '/community-posts/ch-me/%' ORDER BY path`).all() as Json[]).map((r) => r.path);

	for (const when of ['the rows', 'the CDN', 'a file'] as const) {
		it(`leaves no row of a deleted file (stopped at ${when})`, async () => {
			const env = await setup();
			env.channels.store.delete('ch-me');
			const files = Array.from({ length: 6 }, (_, i) => `/community-posts/ch-me/f${i}.webp`);
			for (const f of files) own(env, f, null);
			const id = await start(env, [{ t: 'channel', id: 'ch-me' }]);
			const prepare = env.SEARCH_DB.prepare.bind(env.SEARCH_DB);
			const fetchNow = globalThis.fetch;
			const fail = (text: string) => when === 'the rows' && text.startsWith('DELETE FROM image_owners') && text.includes('json_each');
			let folder = false;
			env.SEARCH_DB.prepare = (text: string) => {
				if (folder && fail(text)) throw new Error('D1 down');
				return prepare(text);
			};
			globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.includes('/community-posts/ch-me/')) folder = true;
				if (folder && when === 'the CDN' && url.startsWith('https://api.cloudflare.com/')) return new Response('no', { status: 500 });
				if (when === 'a file' && init?.method === 'DELETE' && url.includes('f3.webp')) return new Response('down', { status: 500 });
				return fetchNow(input as never, init);
			}) as typeof fetch;
			try {
				assert.ok((await step(env, id)).note);
			} finally {
				globalThis.fetch = fetchNow;
				env.SEARCH_DB.prepare = prepare;
			}
			assert.ok(files.some((f) => !out.images.has(f)) && rowsLeft(env).length >= 6, 'some files went, their rows did not');
			await step(env, id);
			assert.deepEqual(rowsLeft(env), []);
			assert.deepEqual(files.filter((f) => out.images.has(f)), []);
			for (const f of files) assert.ok(out.purged.includes(`${IMG}${f}`), f);
		});
	}

	it('the list is on the job\'s row before the first file goes: a delivery that never ends is finished by the next', async () => {
		const env = await setup();
		env.channels.store.delete('ch-me');
		for (let i = 0; i < 3; i++) own(env, `/community-posts/ch-me/f${i}.webp`, null);
		const id = await start(env, [{ t: 'channel', id: 'ch-me' }]);
		const fetchNow = globalThis.fetch;
		// The worker stops for good after the first file of the folder: nothing after it runs, no handler either
		let reached!: () => void;
		const stopped = new Promise<void>((done) => (reached = done));
		let gone = false;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'DELETE' && String(input).includes('f1.webp') && !gone) {
				gone = true;
				reached();
				return new Promise(() => undefined);
			}
			return fetchNow(input as never, init);
		}) as typeof fetch;
		try {
			const job = (await getJob(env as never, id))!;
			env.SEARCH_DB.db.prepare("UPDATE admin_jobs SET status = 'running', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
			void runEraseMedia(env, job);
			await stopped;
			const saved = JSON.parse(jobs(env)[0].params).unfinished as Json[];
			assert.deepEqual(saved.flatMap((f) => f.paths).filter((path) => path.includes('/f')), [0, 1, 2].map((i) => `/community-posts/ch-me/f${i}.webp`));
			assert.equal(out.images.has('/community-posts/ch-me/f0.webp'), false);
			assert.ok(rowOf(env, '/community-posts/ch-me/f0.webp'), 'rows last');
			assert.equal((await erasedTargets(env.SEARCH_DB, { kind: 'channel', id: 'ch-me' }))[0].live, true);
			assert.deepEqual(await runEraseMedia(env, job), { later: 600 });
			age(env);
			await step(env, id);
		} finally {
			globalThis.fetch = fetchNow;
		}
		assert.deepEqual(rowsLeft(env), []);
		for (let i = 0; i < 3; i++) assert.ok(out.purged.includes(`${IMG}/community-posts/ch-me/f${i}.webp`), `${i}`);
		assert.ok((await erasedTargets(env.SEARCH_DB, { kind: 'channel', id: 'ch-me' }))[0].stoppedAt, 'that a delivery stopped is kept');
	});

	it('and finishing it asks again: a case of the uploader that began meanwhile holds what is left', async () => {
		const env = await setup();
		env.channels.store.delete('ch-me');
		for (let i = 0; i < 4; i++) own(env, `/community-posts/ch-me/f${i}.webp`, 'usr_third');
		const id = await start(env, [{ t: 'channel', id: 'ch-me' }]);
		const fetchNow = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => (init?.method === 'DELETE' && String(input).includes('f2.webp') ? new Response('down', { status: 500 }) : fetchNow(input as never, init))) as typeof fetch;
		try {
			for (let i = 0; i < 2; i++) {
				await step(env, id);
				assert.ok(rowOf(env, '/community-posts/ch-me/f2.webp'), 'its row stays while its file does');
			}
		} finally {
			globalThis.fetch = fetchNow;
		}
		const opened = await openCase(env, 'user', 'usr_third');
		assert.match((await step(env, id)).note, /a takedown case is open/);
		assert.ok(out.images.has('/community-posts/ch-me/f2.webp') && rowOf(env, '/community-posts/ch-me/f2.webp'));
		closeCase(env, opened.id);
		await step(env, id);
		assert.equal(out.images.has('/community-posts/ch-me/f2.webp'), false);
		assert.deepEqual(rowsLeft(env), []);
	});

	it('keeps what waits of an account\'s images when a later part fails', async () => {
		const env = await setup();
		env.profiles.store.delete(ME);
		// The first ten wait for their channel's record, the next ten fail
		const waits = Array.from({ length: 10 }, (_, i) => `/w${i}.jpg`);
		const fails = Array.from({ length: 10 }, (_, i) => `/x${i}.jpg`);
		for (const f of waits) own(env, f, ME, 'ch-other', 'channel_cover');
		for (const f of fails) own(env, f, ME, null, 'profile_avatar');
		const id = await start(env, [{ t: 'images', paths: [...waits, ...fails] }]);
		out.failImages = true;
		await step(env, id);
		out.failImages = false;
		assert.deepEqual([...JSON.parse(jobs(env)[0].params).items[0].paths].sort(), [...waits, ...fails].sort());
		env.channels.store.delete('ch-other');
		await step(env, id);
		assert.deepEqual([...waits, ...fails].filter((f) => out.images.has(f)), []);
	});
});

describe('writing down an account\'s images', () => {
	it('reads its rows in pages, spends the pass\'s budget, and stops the pass when that runs out', async () => {
		const env = await setup();
		for (let i = 0; i < 450; i++) own(env, `/mine-${String(i).padStart(3, '0')}.jpg`, ME, null, 'profile_avatar');
		const budget = new OperationBudget(900);
		env.SEARCH_DB.trace = [];
		await eraseMediaHooks(env, budget).onProfileDeleted(ME, env.profiles.read(ME));
		const reads = (env.SEARCH_DB.trace as Array<{ sql: string; params: unknown[] }>).filter(({ sql }) => /FROM image_owners/.test(sql));
		for (const { sql, params } of reads) {
			assert.match(sql, /LIMIT \d+/);
			const plan = (env.SEARCH_DB.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Json[]).map((r) => r.detail).join(' | ');
			assert.match(plan, /SEARCH image_owners USING (COVERING )?INDEX/, plan);
		}
		env.SEARCH_DB.trace = null;
		assert.ok(budget.spent >= reads.length && budget.spent < 40, `${budget.spent}`);
		const listed = jobs(env).flatMap((j) => JSON.parse(j.params).items).flatMap((i: Json) => i.paths ?? []) as string[];
		assert.equal(listed.filter((p) => p.startsWith('/mine-')).length, 450);
		assert.equal(new Set(listed).size, listed.length);
		await assert.rejects(eraseMediaHooks(env, new OperationBudget(3)).onProfileDeleted(ME, env.profiles.read(ME)), (e: Error) => e.constructor.name === 'BudgetExhausted');
	});
});
