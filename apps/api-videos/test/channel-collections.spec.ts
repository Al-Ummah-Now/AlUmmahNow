/**
 * One Bunny collection per channel and library (lib/channelCollection.ts) and
 * the backfill that files existing videos (lib/bunny/collectionBackfill.ts).
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import R2Repository from '../src/lib/r2Repo';
import {
	channelCollections,
	deleteChannelCollections,
	ensureChannelCollection,
	renameChannelCollections,
	placeVideoInCollection,
	removeCollectionsFor,
	renameCollectionsForUser,
	uploadCollection,
	userCollectionName,
	type CollectionClient,
} from '../src/lib/channelCollection';
import { handleCollectionBackfillMessage, readCollectionBackfillRun, runCollectionBackfillPage } from '../src/lib/bunny/collectionBackfill';
import { runProcessingCheck, startProcessingLoop } from '../src/lib/processing/loop';
import { MemoryBucket, MemoryQueue } from './helpers';

/** In-memory Bunny collections per library */
function fakeBunny(existing: Record<number, string[]> = {}) {
	const collections = new Map<number, Map<string, string>>();
	for (const [lib, ids] of Object.entries(existing)) collections.set(Number(lib), new Map(ids.map((id) => [id, 'old'])));
	let n = 0;
	const log: string[] = [];
	const client: Required<CollectionClient> = {
		async createCollection(lib, data) {
			const guid = `col-${lib}-${++n}`;
			if (!collections.has(lib)) collections.set(lib, new Map());
			collections.get(lib)!.set(guid, data.name ?? '');
			log.push(`create ${lib} ${data.name}`);
			return { guid };
		},
		async deleteCollection(lib, id) {
			if (!collections.get(lib)?.delete(id)) throw new Error('HTTP error! status: 404');
			log.push(`delete ${lib} ${id}`);
		},
		async getCollection(lib, id) {
			if (!collections.get(lib)?.has(id)) throw new Error('HTTP error! status: 404');
			return { guid: id };
		},
		async updateCollection(lib, id, data) {
			if (!collections.get(lib)?.has(id)) throw new Error('HTTP error! status: 404');
			collections.get(lib)!.set(id, data.name ?? '');
			log.push(`rename ${lib} ${id} ${data.name}`);
			return {};
		},
	};
	return { client, collections, log };
}

const channel = (over: Record<string, unknown> = {}) => ({ id: 'ch', userId: 'owner', name: 'Lessons', dateModified: '2026-01-01T00:00:00.000Z', ...over });

describe('channel collections per library', () => {
	it('creates one collection per library on first upload and reuses it', async () => {
		const channels = new MemoryBucket({ ch: channel() });
		const repo = new R2Repository<any>(channels as any);
		const bunny = fakeBunny();
		const a = await ensureChannelCollection(repo, bunny.client, 498994, 'ch', 'Lessons');
		const again = await ensureChannelCollection(repo, bunny.client, 498994, 'ch', 'Lessons');
		const legacyLib = await ensureChannelCollection(repo, bunny.client, 400189, 'ch', 'Lessons');
		assert.equal(a, again);
		assert.notEqual(a, legacyLib);
		assert.deepEqual(JSON.parse(channels.store.get('ch')!).bunnyCollections, { '498994': a, '400189': legacyLib });
		assert.equal(bunny.log.filter((l) => l.startsWith('create')).length, 2);
	});

	it('adopts the old single bunnyCollectionId only in the library that holds it', async () => {
		const channels = new MemoryBucket({ ch: channel({ bunnyCollectionId: 'legacy-col' }) });
		const repo = new R2Repository<any>(channels as any);
		const bunny = fakeBunny({ 400189: ['legacy-col'] });
		// The new library does not have it: a new collection, the legacy id untouched
		const fresh = await ensureChannelCollection(repo, bunny.client, 498994, 'ch', 'Lessons');
		assert.notEqual(fresh, 'legacy-col');
		const adopted = await ensureChannelCollection(repo, bunny.client, 400189, 'ch', 'Lessons');
		assert.equal(adopted, 'legacy-col');
		const saved = JSON.parse(channels.store.get('ch')!);
		assert.deepEqual(saved.bunnyCollections, { '498994': fresh, '400189': 'legacy-col' });
		assert.equal(saved.bunnyCollectionId, 'legacy-col', 'kept for older readers');
		assert.deepEqual(channelCollections(saved).map((c) => c.libraryId).sort(), [400189, 498994]);
	});

	it('a user-level upload, or one to a channel that is gone, goes into the owner collection (per library)', async () => {
		const bunny = fakeBunny();
		const profiles = new MemoryBucket({ u1: { id: 'u1', displayName: '', userName: 'abu_bakr' } });
		const channels = new MemoryBucket({ dead: channel({ id: 'dead', isDeleted: true }) });
		const env = { channels: channels as any, profiles: profiles as any };
		const own = await uploadCollection(env, bunny.client, 498994, 'u1', 'u1');
		assert.ok(own);
		assert.equal(bunny.collections.get(498994)!.get(own!), '@abu_bakr', 'named after the handle without a display name');
		assert.equal(await uploadCollection(env, bunny.client, 498994, 'dead', 'u1'), own, "a deleted channel's upload: the owner's collection");
		assert.equal(await uploadCollection(env, bunny.client, 498994, 'missing', 'u1'), own);
		assert.deepEqual(JSON.parse(profiles.store.get('u1')!).bunnyCollections, { '498994': own });
		// No profile: no collection, never a throw
		assert.equal(await uploadCollection(env, bunny.client, 498994, 'u2', 'u2'), undefined);
		assert.equal(bunny.log.filter((l) => l.startsWith('create')).length, 1);
	});

	it('user collection names: display name, else @handle, else the id', () => {
		assert.equal(userCollectionName({ displayName: ' Umm Salama ', userName: 'x' }, 'u'), 'Umm Salama');
		assert.equal(userCollectionName({ userName: '@x' }, 'u'), '@x');
		assert.equal(userCollectionName(null, 'u9'), 'User u9');
	});

	it('renames every library\'s collection with the channel; a failure is not fatal', async () => {
		const bunny = fakeBunny({ 498994: ['a'], 400189: ['b'] });
		const ch = { name: 'New name', bunnyCollections: { '498994': 'a', '400189': 'b', '777': 'gone' } };
		const renamed = await renameChannelCollections(async () => bunny.client, 'ch', ch, 'New name');
		assert.equal(renamed, 2);
		assert.equal(bunny.collections.get(498994)!.get('a'), 'New name');
		assert.equal(bunny.collections.get(400189)!.get('b'), 'New name');
	});

	it('purge deletes the collections, trying an unadopted legacy id in each library', async () => {
		const bunny = fakeBunny({ 498994: ['a'], 400189: ['legacy'] });
		const ch = { bunnyCollectionId: 'legacy', bunnyCollections: { '498994': 'a' } };
		const deleted = await deleteChannelCollections(async () => bunny.client, [498994, 400189], 'ch', ch);
		assert.equal(deleted, 2);
		assert.equal(bunny.collections.get(498994)!.size, 0);
		assert.equal(bunny.collections.get(400189)!.size, 0);
	});
});

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

const NEW_HOST = 'vz-25839d05-80d.b-cdn.net';
const OLD_HOST = 'vz-215a1ffd-a5a.b-cdn.net';
const vid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const realFetch = globalThis.fetch;
/** Bunny state: videos per library with their collection; collections per library */
let lib: Record<string, Record<string, { collectionId: string; title?: string; storageSize?: number }>>;
let cols: Record<string, Map<string, string>>;
let writes: string[];

beforeEach(() => {
	writes = [];
	lib = {
		'498994': { [vid(1)]: { collectionId: '' }, [vid(9)]: { collectionId: '', title: 'nobody references me', storageSize: 1000 } },
		'400189': {
			[vid(2)]: { collectionId: '' },
			[vid(3)]: { collectionId: 'legacy-col' },
			[vid(4)]: { collectionId: '' },
			[vid(7)]: { collectionId: '' },
			[vid(8)]: { collectionId: '' },
			[vid(10)]: { collectionId: '' },
			[vid(5)]: { collectionId: '', title: 'orphan', storageSize: 5 },
		},
	};
	cols = { '498994': new Map(), '400189': new Map([['legacy-col', 'Lessons']]) };
	let n = 0;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const method = init?.method ?? 'GET';
		const m = /^\/library\/(\d+)\/(videos|collections)(?:\/([^/]+))?$/.exec(url.pathname);
		if (url.hostname !== 'video.bunnycdn.com' || !m) return new Response(null, { status: 200 });
		const [, l, kind, id] = m;
		if (kind === 'collections') {
			if (method === 'POST' && !id) {
				const guid = `new-col-${l}-${++n}`;
				cols[l].set(guid, JSON.parse(String(init!.body)).name);
				writes.push(`create-collection ${l}`);
				return Response.json({ guid });
			}
			if (method === 'GET' && !id) return Response.json({ totalItems: cols[l].size, items: [] });
			if (!cols[l].has(id!)) return new Response('{}', { status: 404 });
			if (method === 'POST') cols[l].set(id!, JSON.parse(String(init!.body)).name);
			if (method === 'DELETE') cols[l].delete(id!);
			return Response.json({ guid: id });
		}
		if (!id) {
			const page = Number(url.searchParams.get('page') || 1);
			const per = Number(url.searchParams.get('itemsPerPage') || 100);
			const all = Object.entries(lib[l]).map(([guid, v]) => ({ guid, status: 4, ...v }));
			return Response.json({ totalItems: all.length, items: all.slice((page - 1) * per, page * per) });
		}
		const v = lib[l][id];
		if (!v) return new Response('{}', { status: 404 });
		if (method === 'POST') {
			const body = JSON.parse(String(init!.body));
			v.collectionId = body.collectionId;
			writes.push(`move ${l} ${id} ${body.collectionId}`);
		}
		return Response.json({ guid: id, ...v });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

function backfillEnv() {
	const rec = (n: number, host: string, extra: Record<string, unknown>) => ({ id: vid(n), userId: 'owner', playUrl: `https://${host}/${vid(n)}/playlist.m3u8`, ...extra });
	const videos = new MemoryBucket({
		// Channel video, new upload in the primary library
		[vid(1)]: rec(1, NEW_HOST, { channelId: 'ch', bunnyLibraryId: 498994 }),
		// Channel videos in the legacy library (one already in the adopted legacy collection)
		[vid(2)]: rec(2, OLD_HOST, { channelId: 'ch' }),
		[vid(3)]: rec(3, OLD_HOST, { channelId: 'ch' }),
		// User-level upload (channelId is the owner) and one with no channel at all
		[vid(4)]: rec(4, OLD_HOST, { channelId: 'owner' }),
		[vid(10)]: rec(10, OLD_HOST, {}),
		// Its channel was deleted (soft) / never existed: the owner's collection
		[vid(7)]: rec(7, OLD_HOST, { channelId: 'gone-soft' }),
		[vid(8)]: rec(8, OLD_HOST, { channelId: 'gone-hard' }),
		// Owner without a profile: listed only
		[vid(11)]: rec(11, OLD_HOST, { channelId: 'gone-hard', userId: 'ghost' }),
		// Record whose Bunny video is gone
		[vid(6)]: rec(6, OLD_HOST, { channelId: 'ch' }),
		// A live stream that references a Bunny video, and not a video record
		'livestream:abc': { id: 'abc', streamUrl: `https://iframe.mediadelivery.net/embed/498994/${vid(12)}` },
	});
	lib['498994'][vid(12)] = { collectionId: '' };
	const channels = new MemoryBucket({ ch: channel({ bunnyCollectionId: 'legacy-col' }), 'gone-soft': channel({ id: 'gone-soft', isDeleted: true }) });
	const profiles = new MemoryBucket({ owner: { id: 'owner', displayName: 'Shaykh A', userName: 'shaykha' } });
	return {
		videos,
		channels,
		profiles,
		global_settings: new MemoryBucket(),
		PROCESSING_CHECK_QUEUE: new MemoryQueue(),
		'bunny-stream-key': 'new-key',
		bunny_stream_library_id: '498994',
		bunny_hostname: NEW_HOST,
		BUNNY_LEGACY_LIBRARY_ID: '400189',
		BUNNY_LEGACY_HOSTNAME: OLD_HOST,
		BUNNY_LEGACY_STREAM_KEY: 'old-key',
	} as any;
}

const P = (videos: number, alreadyPlaced: number, moved: number, missingInBunny = 0) => ({ videos, alreadyPlaced, moved, missingInBunny, errors: 0 });

describe('collection backfill', () => {
	it('dry run counts each placement per library and writes nothing', async () => {
		const env = backfillEnv();
		const before = [env.channels.store.get('ch'), env.profiles.store.get('owner')];
		const { counts, nextCursor } = await runCollectionBackfillPage(env, { cursor: null, dryRun: true, limit: 50 });
		assert.equal(nextCursor, null);
		assert.equal(counts.scanned, 9);
		assert.deepEqual(counts.byLibrary['498994'], { channel: P(1, 0, 1), user: P(0, 0, 0), deletedChannel: P(0, 0, 0), ownerMissing: 0 });
		assert.deepEqual(counts.byLibrary['400189'], { channel: P(3, 1, 1, 1), user: P(2, 0, 2), deletedChannel: P(2, 0, 2), ownerMissing: 1 });
		assert.deepEqual(counts.ownerMissing.map((o) => o.videoId), [vid(11)]);
		assert.deepEqual(counts.collectionsCreated.sort(), ['channel:ch:498994', 'user:owner:400189']);
		assert.deepEqual(counts.collectionsAdopted, ['channel:ch:400189']);
		assert.deepEqual(writes, []);
		assert.deepEqual([env.channels.store.get('ch'), env.profiles.store.get('owner')], before);
	});

	it('apply files channel videos in the channel collection and the rest in the owner collection; idempotent', async () => {
		const env = backfillEnv();
		await runCollectionBackfillPage(env, { cursor: null, dryRun: false, limit: 50 });
		const ch = JSON.parse(env.channels.store.get('ch')!);
		const owner = JSON.parse(env.profiles.store.get('owner')!);
		assert.equal(ch.bunnyCollections['400189'], 'legacy-col');
		const userCol = owner.bunnyCollections['400189'];
		assert.ok(userCol);
		assert.equal(cols['400189'].get(userCol), 'Shaykh A', 'named after the display name');
		assert.equal(lib['498994'][vid(1)].collectionId, ch.bunnyCollections['498994']);
		assert.equal(lib['400189'][vid(2)].collectionId, 'legacy-col');
		for (const n of [4, 10, 7, 8]) assert.equal(lib['400189'][vid(n)].collectionId, userCol, `video ${n} in the owner collection`);
		assert.equal(lib['400189'][vid(5)].collectionId, '', 'a Bunny video without a record is never touched');

		writes = [];
		const second = await runCollectionBackfillPage(env, { cursor: null, dryRun: false, limit: 50 });
		assert.deepEqual(writes, []);
		assert.equal(second.counts.byLibrary['400189'].user.alreadyPlaced, 2);
		assert.equal(second.counts.byLibrary['400189'].deletedChannel.alreadyPlaced, 2);
	});

	it('runs from the queue: video pages, then lists unreferenced Bunny videos per library', async () => {
		const env = backfillEnv();
		const ack = { acked: 0, retried: 0 };
		const message = (body: unknown) => ({ body, attempts: 1, ack: () => void ack.acked++, retry: () => void ack.retried++ });
		await handleCollectionBackfillMessage(env, message({ kind: 'bunny-collection-backfill', runId: 'r1', page: 0, cursor: null, dryRun: true, limit: 3 }));
		while (env.PROCESSING_CHECK_QUEUE.messages.length) await handleCollectionBackfillMessage(env, message(env.PROCESSING_CHECK_QUEUE.messages.shift()));
		assert.equal(ack.retried, 0);
		const run = await readCollectionBackfillRun(env, 'r1');
		assert.equal(run?.status, 'done');
		assert.equal(run?.totals?.scanned, 9);
		assert.equal(run?.totals?.byLibrary['400189'].deletedChannel.moved, 2);
		assert.deepEqual(Object.keys(run?.libraries ?? {}).sort(), ['400189', '498994']);
		assert.deepEqual(run?.unreferenced?.['498994'].items.map((v) => v.guid), [vid(9)], 'the live stream video is referenced');
		assert.deepEqual(run?.unreferenced?.['400189'].items.map((v) => v.guid), [vid(5)]);
		assert.equal(run?.unreferenced?.['400189'].storageBytes, 5);
		assert.equal(lib['400189'][vid(5)] !== undefined, true, 'listed, not deleted');
	});

	it('a user collection is renamed with the profile and removed on purge, in each library', async () => {
		const env = backfillEnv();
		cols['400189'].set('user-col', 'Old name');
		cols['498994'].set('user-col-2', 'Old name');
		const profile = { id: 'owner', displayName: 'New name', bunnyCollections: { '400189': 'user-col', '498994': 'user-col-2' } };
		assert.equal(await renameCollectionsForUser(env, 'owner', profile), 2);
		assert.equal(cols['400189'].get('user-col'), 'New name');
		assert.equal(cols['498994'].get('user-col-2'), 'New name');
		assert.equal(await removeCollectionsFor(env, 'owner', profile), 2);
		assert.equal(cols['400189'].has('user-col'), false);
		assert.equal(cols['498994'].has('user-col-2'), false);
	});

	it('the processing check files a video Bunny still has at the root (failed or skipped collection step)', async () => {
		const env = backfillEnv();
		// A bulk upload of 2026-11-10: at the library root although its channel has a collection
		assert.equal(lib['400189'][vid(2)].collectionId, '');
		await startProcessingLoop(env, vid(2), { reason: 'test' });
		const message = env.PROCESSING_CHECK_QUEUE.messages.find((m: any) => m.videoId === vid(2));
		await runProcessingCheck(env, message);
		assert.equal(lib['400189'][vid(2)].collectionId, 'legacy-col');
		assert.ok(writes.includes(`move 400189 ${vid(2)} legacy-col`));
		// Already in a collection: left alone
		writes = [];
		await runProcessingCheck(env, { ...message, attempt: message.attempt + 1 });
		assert.deepEqual(writes.filter((w) => w.startsWith('move')), []);
	});

	it('placeVideoInCollection: a user-level video goes to the owner collection; failures never throw', async () => {
		const env = backfillEnv();
		assert.equal(await placeVideoInCollection(env, { id: vid(4), userId: 'owner', channelId: 'owner', playUrl: `https://${OLD_HOST}/${vid(4)}/playlist.m3u8` }, ''), 'placed');
		const userCol = JSON.parse(env.profiles.store.get('owner')!).bunnyCollections['400189'];
		assert.equal(lib['400189'][vid(4)].collectionId, userCol);
		assert.equal(await placeVideoInCollection(env, { id: vid(4), userId: 'owner' }, 'x'), 'already');
		globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
		assert.equal(await placeVideoInCollection(env, { id: vid(2), userId: 'owner', channelId: 'ch2', playUrl: `https://${OLD_HOST}/${vid(2)}/playlist.m3u8` }, ''), 'failed');
	});

	it('an upload whose collection step fails is retried once, then goes on without one (warned)', async () => {
		let calls = 0;
		const failing = { ...fakeBunny().client, createCollection: async () => { calls++; throw new Error('HTTP error! status: 500'); } };
		const channels = new MemoryBucket({ ch: channel() });
		assert.equal(await uploadCollection({ channels: channels as any }, failing, 400189, 'ch', 'owner'), undefined);
		assert.equal(calls, 2);
	});
});
