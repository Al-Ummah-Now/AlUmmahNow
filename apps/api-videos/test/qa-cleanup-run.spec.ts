/**
 * The QA cleanup's I/O (scripts/qa/cleanup-e2e-leftovers.ts) over in-memory buckets: what it lists,
 * that a second run reads nothing it already knows, that it deletes only the version it judged, and
 * that a run stopped or failing half-way leaves nothing behind the next one cannot finish.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apply, listEverything, readPending, type ApplyOptions } from '../../../scripts/qa/cleanup-e2e-leftovers';
import { buildInventory, emptyState, parseState, pendingReads, prune, type State } from '../../../scripts/qa/cleanup-inventory';
import { withSearchSync } from '../src/lib/search/sync';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const OLD = '2026-01-01T00:00:00.000Z';
const TEST = 'test-single-1794059336742@delivered.resend.dev';
const PINNED = 'test-single-1795000000001@e2e.alummahnow.net';
const far = () => Date.now() + 60_000;

const qa = () => ({
	SEARCH_DB: new SqliteD1(),
	profiles: new MemoryBucket({ u1: { id: 'u1', email: TEST, channels: ['c1', 'gone'] } }),
	channels: new MemoryBucket({ c1: { id: 'c1', name: 'E2E main', userId: 'u1', email: TEST, isMain: true, handle: 'h1', dateCreated: OLD } }),
	videos: new MemoryBucket({
		v1: { id: 'v1', title: 'E2E Temp a', userId: 'u1', channelId: 'c1', dateCreated: OLD },
		v2: { id: 'v2', title: 'E2E Temp b', userId: 'u1', channelId: 'c1', dateCreated: OLD },
		'share-cards/v3/v/a.jpg': 'image',
		'livestream:x': { id: 'x' },
	}),
	playlists: new MemoryBucket({ p1: { id: 'p1', title: 'Mine', userId: 'u1', channelId: 'c1' }, 'watch-later-u1': { id: 'watch-later-u1' } }),
	community_posts: new MemoryBucket({
		'posts/c1/x.json': { id: 'x', channelId: 'c1', content: 'A post', createdAt: OLD },
		'posts/c1/index.json': { postIds: ['x'] },
		'comments/x/1.json': { id: '1' },
		'comments/other/1.json': { id: '2' },
	}),
	channel_sections: new MemoryBucket({ 'c1/s1': { title: 'Mine' }, '_order/c1': { ids: ['s1'] } }),
	channel_tabs: new MemoryBucket({ 'channel-handles/h1': { channelId: 'c1', userId: 'u1', handle: 'h1' }, 'channel-tabs/c1': {}, 'channel-handles/dead': { channelId: 'gone', userId: 'u1', handle: 'dead' }, 'channel-tabs/gone': {} }),
	SCHEDULED_VIDEOS: new MemoryBucket({ '2026-01-01/10/v1.json': {}, '2026-01-01/10/gone.json': {} }),
});
type Qa = ReturnType<typeof qa>;

interface Options {
	readUntil?: number;
	apply?: Partial<ApplyOptions>;
	/** After reading, before deleting: what the site does meanwhile */
	meanwhile?: () => Promise<unknown>;
}
async function run(raw: Qa, state: State, options: Options = {}) {
	const pending: Promise<unknown>[] = [];
	const env = withSearchSync(raw as never, { waitUntil: (p: Promise<unknown>) => void pending.push(p) }) as never;
	const { listing, keys } = await listEverything(env, far());
	prune(state, listing);
	const toRead = pendingReads(state, listing);
	const read = await readPending(env, state, toRead, options.readUntil ?? far());
	const inv = buildInventory(state, listing, keys, { now: Date.now(), minAgeMs: 0 });
	await options.meanwhile?.();
	const result = await apply(env, inv, { channelsUntil: far(), until: far(), settle: () => Promise.allSettled(pending.splice(0)), backoffMs: 1, ...options.apply });
	return { pending: toRead, read, result, inv, unsettled: pending.length };
}
const keysOf = async (bucket: MemoryBucket) => (await bucket.list({ limit: 1000 } as never)).objects.map((o: { key: string }) => o.key).sort();
const failOn = (bucket: MemoryBucket, method: 'delete' | 'put' | 'get', bad: string) => {
	const original = (bucket[method] as (...a: unknown[]) => Promise<unknown>).bind(bucket);
	bucket[method] = (async (key: string, ...rest: unknown[]) => {
		if (key === bad || (Array.isArray(key) && key.includes(bad))) throw new Error('R2 500');
		return original(key, ...rest);
	}) as never;
};

describe('QA cleanup run', () => {
	it('deletes the leftovers in one run when it can read everything, and nothing is left running', async () => {
		const env = qa();
		const { pending, read, result, unsettled } = await run(env, emptyState());
		assert.ok(!pending.some((p) => /share-cards|livestream|watch-later|index\.json|comments|_order/.test(p.key)));
		assert.equal(read.done, pending.length);
		assert.deepEqual(result.failures, []);
		assert.equal(result.skipped, 0);
		// 2 videos, post, section, playlist, owner, profile, dead handle, dead tabs, 2 schedule entries: each once
		assert.equal(result.done, 11);
		assert.equal(unsettled, 0);
		assert.deepEqual(await keysOf(env.videos), ['livestream:x', 'share-cards/v3/v/a.jpg']);
		assert.deepEqual(await keysOf(env.channels), []);
		assert.deepEqual(await keysOf(env.playlists), ['watch-later-u1']);
		assert.deepEqual(await keysOf(env.community_posts), ['comments/other/1.json']);
		assert.deepEqual(await keysOf(env.channel_sections), []);
		assert.deepEqual(await keysOf(env.channel_tabs), []);
		assert.deepEqual(await keysOf(env.SCHEDULED_VIDEOS), []);
		assert.deepEqual(env.profiles.read<{ channels: string[] }>('u1')!.channels, []);
	});

	it('a run that ends while deleting goes on in the next one, reading nothing twice', async () => {
		const env = qa();
		const state = emptyState();
		const first = await run(env, state, { apply: { until: 0, channelsUntil: 0 } });
		assert.ok(first.result.planned > 0);
		assert.equal(first.result.done, 0);
		assert.equal((await keysOf(env.videos)).length, 4);
		const second = await run(env, parseState(JSON.stringify(state)));
		assert.equal(second.pending.length, 0);
		assert.deepEqual(await keysOf(env.channels), []);
	});

	it('a run that could read nothing deletes nothing that depends on it', async () => {
		const env = qa();
		const { read, inv } = await run(env, emptyState(), { readUntil: 0 });
		assert.equal(read.done, 0);
		assert.ok(inv.items.every((i) => i.kind === 'schedule-entry' || i.kind === 'tabs' || i.action !== 'delete'));
		assert.deepEqual(await keysOf(env.SCHEDULED_VIDEOS), ['2026-01-01/10/v1.json']);
		assert.equal((await keysOf(env.videos)).length, 4);
		assert.ok((await keysOf(env.channel_tabs)).includes('channel-tabs/c1'));
	});
});

describe('QA cleanup: something on a channel could not be deleted', () => {
	const cases: Array<[what: string, bucket: 'videos' | 'playlists' | 'community_posts' | 'channel_sections', key: string]> = [
		['a video', 'videos', 'v1'],
		['a playlist', 'playlists', 'p1'],
		['a post', 'community_posts', 'posts/c1/x.json'],
		['a post comment', 'community_posts', 'comments/x/1.json'],
		['a section', 'channel_sections', 'c1/s1'],
	];
	for (const [what, bucket, key] of cases) {
		it(`${what}: the channel, its profile entry, handle, tabs and schedule entries stay; the rest goes; the next run finishes`, async () => {
			const env = qa();
			const restore = env[bucket].delete;
			failOn(env[bucket], 'delete', key);
			const state = emptyState();
			const { result } = await run(env, state);
			assert.equal(result.failures.length, 1, result.failures.join());
			assert.deepEqual([result.left, result.skipped], [0, 0], 'every step ran to its end, with nothing in it that has to wait');
			assert.deepEqual(await keysOf(env.channels), ['c1']);
			assert.deepEqual(await keysOf(env.channel_tabs), ['channel-handles/h1', 'channel-tabs/c1'], 'those of the channel that was gone already went');
			assert.deepEqual(env.profiles.read<{ channels: string[] }>('u1')!.channels, ['c1']);
			assert.deepEqual(await keysOf(env.SCHEDULED_VIDEOS), bucket === 'videos' ? ['2026-01-01/10/v1.json'] : [], 'the entry of the video that stays stays');
			if (what === 'a post comment') assert.ok((await keysOf(env.community_posts)).includes('posts/c1/x.json'), 'the post goes after its comments');
			env[bucket].delete = restore.bind(env[bucket]);
			await run(env, state);
			assert.deepEqual(await keysOf(env.channels), []);
			assert.deepEqual(env.profiles.read<{ channels: string[] }>('u1')!.channels, []);
			assert.deepEqual(await keysOf(env.SCHEDULED_VIDEOS), []);
			assert.deepEqual(await keysOf(env.community_posts), ['comments/other/1.json']);
		});
	}
});

describe('QA cleanup: the site changes something while the run reads', () => {
	const put = (bucket: MemoryBucket, key: string, value: unknown) => bucket.put(key, JSON.stringify(value));

	it('a changed record is not deleted, whatever it is, and neither is its channel', async () => {
		const cases: Array<[bucket: 'videos' | 'playlists' | 'community_posts' | 'channel_sections' | 'channels', key: string]> = [
			['videos', 'v1'], ['playlists', 'p1'], ['community_posts', 'posts/c1/x.json'], ['channel_sections', 'c1/s1'], ['channels', 'c1'],
		];
		for (const [bucket, key] of cases) {
			const env = qa();
			const { result } = await run(env, emptyState(), { meanwhile: () => put(env[bucket], key, { ...(env[bucket].read(key) as object), title: 'Renamed by its owner' }) });
			assert.deepEqual(result.failures, []);
			assert.ok(result.skipped > 0, key);
			assert.ok((await keysOf(env[bucket])).includes(key), key);
			assert.deepEqual(await keysOf(env.channels), ['c1'], key);
			assert.ok((await keysOf(env.channel_tabs)).includes('channel-handles/h1'), key);
		}
	});

	it('a post that changed keeps its place in the index and its comments', async () => {
		const env = qa();
		await run(env, emptyState(), { meanwhile: () => put(env.community_posts, 'posts/c1/x.json', { id: 'x', channelId: 'c1', content: 'Edited' }) });
		assert.deepEqual(env.community_posts.read<{ postIds: string[] }>('posts/c1/index.json')!.postIds, ['x']);
		assert.ok((await keysOf(env.community_posts)).includes('comments/x/1.json'));
	});

	it('something new on a channel keeps the channel', async () => {
		for (const add of [
			(env: Qa) => put(env.community_posts, 'posts/c1/new.json', { id: 'new', channelId: 'c1' }),
			(env: Qa) => put(env.channel_sections, 'c1/s2', { title: 'New' }),
			...['video', 'playlist'].map((kind) => async (env: Qa) => void env.SEARCH_DB.db.prepare("INSERT INTO content_ownership (kind, id, channel_id, is_deleted) VALUES (?, 'new', 'c1', 0)").run(kind)),
		]) {
			const env = qa();
			const { result } = await run(env, emptyState(), { meanwhile: () => add(env) as Promise<unknown> });
			assert.deepEqual(result.failures, []);
			assert.deepEqual(await keysOf(env.channels), ['c1']);
		}
	});

	it('a dead handle that someone claims, tabs of a channel that is back, a schedule entry of a video that is back: all stay', async () => {
		const env = qa();
		await run(env, emptyState(), { meanwhile: () => put(env.channel_tabs, 'channel-handles/dead', { channelId: 'c-new', userId: 'u-real', handle: 'dead' }) });
		assert.ok((await keysOf(env.channel_tabs)).includes('channel-handles/dead'));

		const back = qa();
		await run(back, emptyState(), {
			meanwhile: async () => {
				await put(back.channels, 'gone', { id: 'gone', name: 'Restored', userId: 'u1', email: TEST });
				await put(back.videos, 'gone', { id: 'gone', title: 'Restored', userId: 'u1' });
			},
		});
		assert.deepEqual((await keysOf(back.channel_tabs)), ['channel-handles/dead', 'channel-tabs/gone']);
		assert.deepEqual(await keysOf(back.SCHEDULED_VIDEOS), ['2026-01-01/10/gone.json']);
		assert.deepEqual(back.profiles.read<{ channels: string[] }>('u1')!.channels, ['gone']);
	});

	it('a record that changed between the listing and its read is judged and deleted by what was read', async () => {
		const env = qa();
		const get = env.videos.get.bind(env.videos);
		let once = true;
		env.videos.get = (async (key: string) => {
			if (key === 'v1' && once) {
				once = false;
				await put(env.videos, 'v1', { id: 'v1', title: 'A real lecture', userId: 'u1', channelId: 'c1', dateCreated: OLD });
			}
			return get(key);
		}) as never;
		const { inv } = await run(env, emptyState());
		assert.equal(inv.items.find((i) => i.kind === 'video' && i.id === 'v1')!.action, 'unsure');
		assert.ok((await keysOf(env.videos)).includes('v1'));
	});

	it('changes kept records without losing a concurrent write', async () => {
		const env = qa();
		const clip = { id: 'k1', title: 'Kept', userId: 'u2', channelId: 'c2', views: 1, comments: [{ id: 'm', text: 'ws probe 1' }, { id: 'n', text: 'real' }] };
		await put(env.videos, 'k1', clip);
		await put(env.profiles, 'u2', { id: 'u2', email: 'someone@example.com' });
		const bump = async (bucket: MemoryBucket, key: string, change: object) => {
			const original = bucket.put.bind(bucket);
			let once = true;
			bucket.put = (async (k: string, value: string, options?: object) => {
				if (k === key && once && options) {
					once = false;
					await original(key, JSON.stringify({ ...(bucket.read(key) as object), ...change }));
				}
				return original(k, value, options as never);
			}) as never;
		};
		await bump(env.videos, 'k1', { views: 2 });
		await bump(env.profiles, 'u1', { displayName: 'Changed meanwhile' });
		const { result } = await run(env, emptyState());
		assert.deepEqual(result.failures, []);
		const video = env.videos.read<{ views: number; comments: Array<{ id: string }> }>('k1')!;
		assert.deepEqual([video.views, video.comments.map((c) => c.id)], [2, ['n']]);
		const profile = env.profiles.read<{ displayName: string; channels: string[] }>('u1')!;
		assert.deepEqual([profile.displayName, profile.channels], ['Changed meanwhile', []]);
	});
});

describe('QA cleanup: main channels', () => {
	const pinned = (extra: Record<string, unknown>) => ({
		...qa(),
		profiles: new MemoryBucket({ u1: { id: 'u1', email: TEST, channels: ['m', 'a', 'b'] } }),
		videos: new MemoryBucket({}), playlists: new MemoryBucket({}), community_posts: new MemoryBucket({}), channel_sections: new MemoryBucket({}), channel_tabs: new MemoryBucket({}), SCHEDULED_VIDEOS: new MemoryBucket({}),
		channels: new MemoryBucket({
			m: { id: 'm', name: 'E2E main', userId: 'u1', email: TEST, isMain: true, dateCreated: OLD },
			...extra,
		}),
	});

	it('the oldest channel that stays and is not deleted becomes main, by a conditional write', async () => {
		const env = pinned({
			a: { id: 'a', name: 'Noor', userId: 'u1', email: TEST, dateCreated: '2026-02-01T00:00:00Z', isDeleted: true },
			b: { id: 'b', name: 'Huda', userId: 'u1', email: TEST, dateCreated: '2026-04-01T00:00:00Z' },
			c: { id: 'c', name: 'Amal', userId: 'u1', email: TEST, dateCreated: '2026-03-01T00:00:00Z' },
			d: { id: 'd', name: 'E2E second', userId: 'u1', email: TEST, dateCreated: OLD },
		});
		const { result } = await run(env as never, emptyState());
		assert.deepEqual(result.failures, []);
		assert.deepEqual(await keysOf(env.channels), ['a', 'b', 'c']);
		assert.deepEqual(['a', 'b', 'c'].map((id) => !!env.channels.read<{ isMain?: boolean }>(id)!.isMain), [false, false, true]);
	});

	it('a main channel that changed makes no other channel main', async () => {
		const env = pinned({ c: { id: 'c', name: 'Amal', userId: 'u1', email: TEST, dateCreated: OLD } });
		await run(env as never, emptyState(), { meanwhile: () => env.channels.put('m', JSON.stringify({ id: 'm', name: 'Renamed', userId: 'u1', email: TEST, isMain: true })) });
		assert.deepEqual([!!env.channels.read<{ isMain?: boolean }>('m')!.isMain, !!env.channels.read<{ isMain?: boolean }>('c')!.isMain], [true, false]);
	});

	it('prefers a channel that stays over an older one whose delete did not work', async () => {
		const env = pinned({
			c: { id: 'c', name: 'Amal', userId: 'u1', email: TEST, dateCreated: '2026-03-01T00:00:00Z' },
			d: { id: 'd', name: 'E2E second', userId: 'u1', email: TEST, dateCreated: OLD },
		});
		await env.channel_sections.put('d/s', JSON.stringify({ title: 'Mine' }));
		failOn(env.channel_sections, 'delete', 'd/s');
		await run(env as never, emptyState());
		assert.deepEqual(await keysOf(env.channels), ['c', 'd']);
		assert.deepEqual(['c', 'd'].map((id) => !!env.channels.read<{ isMain?: boolean }>(id)!.isMain), [true, false]);
	});

	it('waits while another channel of the owner may not be read yet', async () => {
		const env = pinned({ c: { id: 'c', name: 'Amal', userId: 'u1', email: TEST, dateCreated: OLD } });
		failOn(env.channels, 'get', 'c');
		const { inv } = await run(env as never, emptyState());
		assert.equal(inv.items.find((i) => i.kind === 'channel' && i.id === 'm')!.action, 'wait');
		assert.deepEqual(await keysOf(env.channels), ['c', 'm']);
	});

	it('a pinned CI user’s channels: the spec’s throwaway goes, the main stays', async () => {
		const env = pinned({});
		await env.profiles.put('u1', JSON.stringify({ id: 'u1', email: PINNED, channels: ['m', 't'] }));
		await env.channels.put('m', JSON.stringify({ id: 'm', name: 'E2E Single', userId: 'u1', email: PINNED, isMain: true, dateCreated: OLD }));
		await env.channels.put('t', JSON.stringify({ id: 't', name: 'E2E Temp Channel 1', userId: 'u1', email: PINNED, dateCreated: OLD }));
		await run(env as never, emptyState());
		assert.deepEqual(await keysOf(env.channels), ['m']);
		assert.deepEqual(env.profiles.read<{ channels: string[] }>('u1')!.channels, ['m']);
	});
});

describe('QA cleanup: nothing can be written', () => {
	it('counts nothing as done when every delete fails', async () => {
		const env = qa();
		for (const bucket of Object.values(env)) if (bucket instanceof MemoryBucket) {
			bucket.delete = (async () => { throw new Error('read-only'); }) as never;
			bucket.put = (async () => { throw new Error('read-only'); }) as never;
		}
		// The profile lists only the channel that cannot go: nothing of it is planned
		env.profiles = new MemoryBucket({ u1: { id: 'u1', email: TEST, channels: ['c1'] } });
		const { result } = await run(env, emptyState());
		assert.deepEqual([result.done, result.skipped], [0, 0]);
		assert.ok(result.failures.length > 0);
	});
});
