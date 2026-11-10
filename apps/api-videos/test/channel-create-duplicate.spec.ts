import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withSearchSync } from '../src/lib/search/sync';
import { isOwnershipComplete, runOwnershipPass } from '../src/lib/search/ownership';
import { ChannelCreate } from '../src/endpoints/channel/channelCreate';
import { MemoryBucket, MemoryQueue, buildApp, JobsQueue, drainJobs } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

function channel(id: string, overrides: Record<string, unknown> = {}) {
	return { id, name: `Channel ${id}`, userId: 'someone', dateCreated: '2026-01-01T00:00:00.000Z', subscribers: [], ...overrides };
}

/** Many other owners' channels (the scan needs several pages) plus the owner's own. */
function channels(): Record<string, unknown> {
	const all: Record<string, unknown> = {};
	for (let i = 0; i < 450; i++) {
		const id = `ch${String(i).padStart(3, '0')}`;
		all[id] = channel(id, { userId: `user${i % 40}`, name: 'Taken Elsewhere' });
	}
	all.mine = channel('mine', { userId: 'owner', name: 'My Lectures' });
	all.gone = channel('gone', { userId: 'owner', name: 'Old Name', isDeleted: true });
	all.hidden = channel('hidden', { userId: 'owner', name: 'Hidden One', isHidden: true });
	return all;
}

function env() {
	const db = new SqliteD1();
	const background: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => { background.push(p); }, passThroughOnException: () => undefined };
	const raw = {
		SEARCH_DB: db,
		channels: new MemoryBucket(channels()),
		videos: new MemoryBucket(),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		profiles: new MemoryBucket({ owner: { id: 'owner', email: 'owner@test.local' } }),
		queue: new MemoryQueue(),
		ADMIN_JOBS_QUEUE: new JobsQueue(),
	};
	const wrapped = withSearchSync(raw, ctx);
	return { db, raw, wrapped, ctx, background };
}

const app = buildApp(r => r.post('/api/channels', ChannelCreate), { userId: 'owner' });

function create(e: ReturnType<typeof env>, name: string) {
	return app.request('/api/channels', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name }),
	}, e.wrapped, e.ctx as never);
}

describe('POST /api/channels duplicate-name guard', () => {
	it('uses the ownership index once complete: no bucket listing, one GET per owned channel', async () => {
		const e = env();
		await runOwnershipPass(e.raw as never, 'channel', { maxPages: 50 });
		assert.equal(await isOwnershipComplete(e.db, 'channel'), true);

		e.raw.channels.calls = 0;
		const listed: unknown[] = [];
		const list = e.raw.channels.list.bind(e.raw.channels);
		e.raw.channels.list = (async (...args: unknown[]) => { listed.push(args); return (list as any)(...args); }) as never;

		const clash = await create(e, '  my lectures ');
		assert.equal(clash.status, 409);
		assert.equal(listed.length, 0, 'the bucket is not listed');
		// mine + hidden (deleted channels are not in the owner's ids)
		assert.equal(e.raw.channels.calls, 2);

		assert.equal((await create(e, 'Hidden One')).status, 409, 'moderation-hidden channels still count');
		assert.equal((await create(e, 'Old Name')).status, 200, 'a deleted channel frees its name');
		assert.equal((await create(e, 'Taken Elsewhere')).status, 200, "other owners' names are not checked");
	});

	it('catches a channel created moments earlier (rows are written inline with the put)', async () => {
		const e = env();
		await runOwnershipPass(e.raw as never, 'channel', { maxPages: 50 });
		const first = await create(e, 'Fresh Channel');
		assert.equal(first.status, 200);
		assert.equal((await create(e, 'fresh channel')).status, 409);
	});

	it('falls back to the bucket scan while the index is incomplete, and schedules a heal', async () => {
		const e = env();
		assert.equal(await isOwnershipComplete(e.db, 'channel'), false);

		assert.equal((await create(e, 'My Lectures')).status, 409);
		assert.equal((await create(e, 'Old Name')).status, 200);
		assert.ok(e.background.length >= 1, 'a heal was scheduled');
		await Promise.all(e.background);
		assert.equal(e.raw.ADMIN_JOBS_QUEUE.sent.length, 1, 'as a queued rebuild job');
		await drainJobs(e.raw as never);
		assert.equal(await isOwnershipComplete(e.db, 'channel'), true);
	});
});
