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
	uploadCollection,
	type CollectionClient,
} from '../src/lib/channelCollection';
import { handleCollectionBackfillMessage, readCollectionBackfillRun, runCollectionBackfillPage } from '../src/lib/bunny/collectionBackfill';
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

	it('a user-level upload (no channel) gets no collection', async () => {
		const bunny = fakeBunny();
		assert.equal(await uploadCollection({ channels: new MemoryBucket() as any }, bunny.client, 1, 'user-1', 'user-1'), undefined);
		assert.equal(await uploadCollection({ channels: new MemoryBucket() as any }, bunny.client, 1, 'missing', 'user-1'), undefined);
		assert.equal(bunny.log.length, 0);
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
let lib: Record<string, Record<string, { collectionId: string }>>;
let cols: Record<string, Set<string>>;
let writes: string[];

beforeEach(() => {
	writes = [];
	lib = {
		'498994': { [vid(1)]: { collectionId: '' } },
		'400189': { [vid(2)]: { collectionId: '' }, [vid(3)]: { collectionId: 'legacy-col' }, [vid(5)]: { collectionId: '' } },
	};
	cols = { '498994': new Set(), '400189': new Set(['legacy-col']) };
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
				cols[l].add(guid);
				writes.push(`create-collection ${l}`);
				return Response.json({ guid });
			}
			if (method === 'GET' && !id) return Response.json({ totalItems: cols[l].size, items: [] });
			return cols[l].has(id!) ? Response.json({ guid: id }) : new Response('{}', { status: 404 });
		}
		if (!id) return Response.json({ totalItems: Object.keys(lib[l]).length, items: Object.keys(lib[l]).map((guid) => ({ guid, status: 4 })) });
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
	const videos = new MemoryBucket({
		// New upload in the primary library
		[vid(1)]: { id: vid(1), userId: 'owner', channelId: 'ch', bunnyLibraryId: 498994, playUrl: `https://${NEW_HOST}/${vid(1)}/playlist.m3u8` },
		// Legacy videos (playUrl host only)
		[vid(2)]: { id: vid(2), userId: 'owner', channelId: 'ch', playUrl: `https://${OLD_HOST}/${vid(2)}/playlist.m3u8` },
		[vid(3)]: { id: vid(3), userId: 'owner', channelId: 'ch', playUrl: `https://${OLD_HOST}/${vid(3)}/playlist.m3u8` },
		// User-level upload, and a record whose Bunny video is gone
		[vid(4)]: { id: vid(4), userId: 'owner', channelId: 'owner', playUrl: `https://${OLD_HOST}/${vid(4)}/playlist.m3u8` },
		[vid(6)]: { id: vid(6), userId: 'owner', channelId: 'ch', playUrl: `https://${OLD_HOST}/${vid(6)}/playlist.m3u8` },
		// Not a video record
		'livestream:abc': { id: 'abc' },
	});
	const channels = new MemoryBucket({ ch: channel({ bunnyCollectionId: 'legacy-col' }) });
	return {
		videos,
		channels,
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

describe('collection backfill', () => {
	it('dry run counts per library and writes nothing', async () => {
		const env = backfillEnv();
		const before = env.channels.store.get('ch');
		const { counts, nextCursor } = await runCollectionBackfillPage(env, { cursor: null, dryRun: true, limit: 50 });
		assert.equal(nextCursor, null);
		assert.equal(counts.scanned, 5);
		assert.equal(counts.noChannel, 1);
		assert.deepEqual(counts.byLibrary['498994'], { videos: 1, alreadyPlaced: 0, moved: 1, missingInBunny: 0, errors: 0 });
		assert.deepEqual(counts.byLibrary['400189'], { videos: 3, alreadyPlaced: 1, moved: 1, missingInBunny: 1, errors: 0 });
		assert.deepEqual(counts.collectionsCreated, ['ch:498994']);
		assert.deepEqual(counts.collectionsAdopted, ['ch:400189']);
		assert.deepEqual(writes, []);
		assert.equal(env.channels.store.get('ch'), before);
	});

	it('apply files every video in its channel\'s collection in its own library, and is idempotent', async () => {
		const env = backfillEnv();
		await runCollectionBackfillPage(env, { cursor: null, dryRun: false, limit: 50 });
		const saved = JSON.parse(env.channels.store.get('ch')!);
		assert.equal(saved.bunnyCollections['400189'], 'legacy-col');
		const fresh = saved.bunnyCollections['498994'];
		assert.ok(fresh?.startsWith('new-col-498994'));
		assert.equal(lib['498994'][vid(1)].collectionId, fresh);
		assert.equal(lib['400189'][vid(2)].collectionId, 'legacy-col');
		assert.equal(lib['400189'][vid(3)].collectionId, 'legacy-col');
		assert.equal(lib['400189'][vid(5)].collectionId, '', 'a Bunny video without a record is not ours to file');

		writes = [];
		const second = await runCollectionBackfillPage(env, { cursor: null, dryRun: false, limit: 50 });
		assert.deepEqual(writes, []);
		assert.equal(second.counts.byLibrary['400189'].alreadyPlaced, 2);
	});

	it('runs page by page from the queue and records the run with library checks', async () => {
		const env = backfillEnv();
		const ack = { acked: 0, retried: 0 };
		const message = (body: unknown) => ({ body, attempts: 1, ack: () => void ack.acked++, retry: () => void ack.retried++ });
		await handleCollectionBackfillMessage(env, message({ kind: 'bunny-collection-backfill', runId: 'r1', page: 0, cursor: null, dryRun: true, limit: 2 }));
		while (env.PROCESSING_CHECK_QUEUE.messages.length) {
			const next = env.PROCESSING_CHECK_QUEUE.messages.shift();
			await handleCollectionBackfillMessage(env, message(next));
		}
		assert.equal(ack.retried, 0);
		const run = await readCollectionBackfillRun(env, 'r1');
		assert.equal(run?.status, 'done');
		assert.equal(run?.totals?.scanned, 5);
		assert.equal(run?.totals?.byLibrary['400189'].moved, 1);
		assert.deepEqual(Object.keys(run?.libraries ?? {}).sort(), ['400189', '498994']);
		assert.equal(run?.libraries?.['400189'].host, OLD_HOST);
		assert.equal(run?.libraries?.['400189'].videosInLibrary, 3);
	});
});
