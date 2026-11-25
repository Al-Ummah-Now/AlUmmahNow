/**
 * The QA cleanup's I/O (scripts/qa/cleanup-e2e-leftovers.ts) over in-memory buckets: what it lists,
 * that a second run reads nothing it already knows, and that a run stopped half-way leaves nothing
 * behind that the next one cannot finish.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apply, listEverything, readPending } from '../../../scripts/qa/cleanup-e2e-leftovers';
import { buildInventory, emptyState, pendingReads, prune, type State } from '../../../scripts/qa/cleanup-inventory';
import { MemoryBucket } from './helpers';

const OLD = '2026-01-01T00:00:00.000Z';
const TEST = 'test-single-1794059336742@delivered.resend.dev';
const FAR = Date.now() + 60_000;

function qa() {
	const env = {
		profiles: new MemoryBucket({ u1: { id: 'u1', email: TEST, channels: ['c1', 'c2'] } }),
		channels: new MemoryBucket({ c1: { id: 'c1', name: 'E2E main', userId: 'u1', email: TEST, isMain: true, handle: 'h1', dateCreated: OLD } }),
		videos: new MemoryBucket({
			v1: { id: 'v1', title: 'E2E Temp a', userId: 'u1', channelId: 'c1', dateCreated: OLD },
			v2: { id: 'v2', title: 'E2E Temp b', userId: 'u1', channelId: 'c1', dateCreated: OLD },
			'share-cards/v3/v/a.jpg': 'image',
			'livestream:x': { id: 'x' },
		}),
		playlists: new MemoryBucket({ p1: { id: 'p1', title: 'E2E Temp list', userId: 'u1' }, 'watch-later-u1': { id: 'watch-later-u1' } }),
		community_posts: new MemoryBucket({
			'posts/c1/x.json': { id: 'x', channelId: 'c1', content: 'E2E Temp post', createdAt: OLD },
			'posts/c1/index.json': { postIds: ['x', 'y'] },
			'comments/x/1.json': { id: '1' },
			'comments/other/1.json': { id: '2' },
		}),
		channel_sections: new MemoryBucket({}),
		channel_tabs: new MemoryBucket({ 'channel-handles/h1': { channelId: 'c1', userId: 'u1', handle: 'h1' }, 'channel-tabs/c1': {} }),
		SCHEDULED_VIDEOS: new MemoryBucket({ '2026-01-01/10/v1.json': {}, '2026-01-01/10/gone.json': {} }),
	};
	return env;
}

async function run(env: ReturnType<typeof qa>, state: State, options: { readUntil?: number; writeUntil?: number } = {}) {
	const { listing, keys } = await listEverything(env as never, FAR);
	prune(state, listing);
	const pending = pendingReads(state, listing);
	const read = await readPending(env as never, state, pending, options.readUntil ?? FAR);
	const inv = buildInventory(state, listing, keys, { now: Date.now(), minAgeMs: 0 });
	const result = await apply(env as never, inv, options.writeUntil ?? FAR);
	return { pending, read, result, inv };
}
const keysOf = async (bucket: MemoryBucket) => (await bucket.list({ limit: 1000 } as never)).objects.map((o: { key: string }) => o.key).sort();

describe('QA cleanup run', () => {
	it('deletes the leftovers in one run when it can read everything', async () => {
		const env = qa();
		const { pending, read, result } = await run(env, emptyState());
		assert.ok(!pending.some((p) => /share-cards|livestream|watch-later|index\.json|comments/.test(p.key)));
		assert.equal(read.done, pending.length);
		assert.deepEqual(result.failures, []);
		assert.deepEqual(await keysOf(env.videos), ['livestream:x', 'share-cards/v3/v/a.jpg']);
		assert.deepEqual(await keysOf(env.channels), []);
		assert.deepEqual(await keysOf(env.playlists), ['watch-later-u1']);
		assert.ok(!(await keysOf(env.community_posts)).some((k) => k.includes('/x')));
		assert.ok((await keysOf(env.community_posts)).includes('comments/other/1.json'));
		assert.deepEqual(await keysOf(env.channel_tabs), []);
		assert.deepEqual(await keysOf(env.SCHEDULED_VIDEOS), []);
		assert.deepEqual(((await (await env.profiles.get('u1'))!.json()) as { channels: string[] }).channels, []);
	});

	it('a run that ends while deleting goes on in the next one, reading nothing twice', async () => {
		const env = qa();
		const state = emptyState();
		const first = await run(env, state, { writeUntil: 0 });
		assert.ok(first.result.planned > 0);
		assert.equal(first.result.done, 0);
		assert.equal((await keysOf(env.videos)).length, 4);
		const second = await run(env, JSON.parse(JSON.stringify(state)));
		assert.equal(second.pending.length, 0);
		assert.deepEqual(await keysOf(env.channels), []);
	});

	it('a channel stays while a video of it could not be deleted', async () => {
		const env = qa();
		const remove = env.videos.delete.bind(env.videos);
		env.videos.delete = (async (key: string) => {
			if (key === 'v2') throw new Error('R2 500');
			return remove(key);
		}) as never;
		const { result } = await run(env, emptyState(), { writeUntil: Date.now() + 100 });
		assert.ok(result.failures.some((f) => f.startsWith('video v2')));
		assert.deepEqual(await keysOf(env.channels), ['c1']);
		assert.ok((await keysOf(env.channel_tabs)).includes('channel-tabs/c1'));
		assert.deepEqual(((await (await env.profiles.get('u1'))!.json()) as { channels: string[] }).channels.includes('c1'), true);
	});

	it('a run that could read nothing deletes nothing that depends on it', async () => {
		const env = qa();
		const { read, inv } = await run(env, emptyState(), { readUntil: 0 });
		assert.equal(read.done, 0);
		assert.ok(inv.items.every((i) => i.kind === 'schedule-entry' || i.action !== 'delete'));
		assert.deepEqual(await keysOf(env.SCHEDULED_VIDEOS), ['2026-01-01/10/v1.json']);
		assert.equal((await keysOf(env.videos)).length, 4);
	});
});
