import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { channelTabCounts } from '../src/lib/channelTabCounts';
import { ChannelTabsFetch } from '../src/endpoints/channel/channelTabsFetch';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

/**
 * Channel tab counts (#1669): what each tab holds for a visitor, so the page hides empty
 * Shorts, Live, Playlists, Community and Channels tabs. Indexed reads only.
 */
function env() {
	const db = new SqliteD1();
	const channel = { id: 'c1', name: 'Community Corner', userId: 'owner', dateCreated: '2026-01-01T00:00:00.000Z', subscribers: [] };
	const videos: Record<string, unknown> = {
		long1: videoFixture({ id: 'long1', channelId: 'c1', duration: 900 }),
		long2: videoFixture({ id: 'long2', channelId: 'c1', duration: 900 }),
		priv: videoFixture({ id: 'priv', channelId: 'c1', duration: 900, isPublic: false }),
		hidden: videoFixture({ id: 'hidden', channelId: 'c1', duration: 900, isHidden: true }),
		processing: videoFixture({ id: 'processing', channelId: 'c1', duration: 900, uploadStatus: 'processing' }),
		short1: videoFixture({ id: 'short1', channelId: 'c1', duration: 30, width: 1080, height: 1920 }),
		live1: videoFixture({ id: 'live1', channelId: 'c1', duration: 0, isLive: true }),
		other: videoFixture({ id: 'other', channelId: 'c2', duration: 900 }),
	};
	const sections = new MemoryBucket({
		'c1/s1': { id: 's1', channelId: 'c1', type: 'featured_channels', channelIds: ['c2', 'c3', 'c1', 'c2'] },
		'c1/s2': { id: 's2', channelId: 'c1', type: 'recent_uploads' },
		'c1/s3': { id: 's3', channelId: 'c1', type: 'subscribed_channels' },
	});
	const raw = {
		SEARCH_DB: db,
		videos: new MemoryBucket(videos),
		channels: new MemoryBucket({ c1: channel, c2: { ...channel, id: 'c2' } }),
		channel_tabs: new MemoryBucket(),
		channel_sections: sections,
	};
	const row = (table: string, id: string, channelId: string, visible: number) =>
		db.db.prepare(`INSERT INTO ${table} (id, channel_id, visible, payload) VALUES (?, ?, ?, '{}')`).run(id, channelId, visible);
	row('search_playlists', 'p1', 'c1', 1);
	row('search_playlists', 'p2', 'c1', 0);
	row('search_posts', 'post1', 'c1', 1);
	row('search_posts', 'post2', 'c1', 1);
	row('search_posts', 'post3', 'c2', 1);
	return { raw, db };
}

describe('channel tab counts', () => {
	it('counts what a visitor sees on each tab', async () => {
		const { raw } = env();
		await runOwnershipPass(raw as never, 'channel');
		await runOwnershipPass(raw as never, 'video');
		const counts = await channelTabCounts(raw as never, 'c1');
		// Private, hidden and processing videos never count; featured ids are unique and not the channel itself;
		// a subscriptions section without the owner's consent shows nothing
		assert.deepEqual(counts, { videos: 2, shorts: 1, live: 1, playlists: 1, community: 2, channels: 2 });
	});

	it('is null (every tab shown) while the ownership index is incomplete', async () => {
		const { raw } = env();
		assert.equal(await channelTabCounts(raw as never, 'c1'), null);
	});

	it('GET /api/channels/:id/tabs returns the counts with the config', async () => {
		const { raw } = env();
		await runOwnershipPass(raw as never, 'channel');
		await runOwnershipPass(raw as never, 'video');
		const app = buildApp(r => r.get('/api/channels/:id/tabs', ChannelTabsFetch), null);
		const res = await app.request('/api/channels/c1/tabs', {}, raw);
		assert.equal(res.status, 200);
		const body = (await res.json()) as { tabs: unknown[]; counts?: Record<string, number> };
		assert.ok(body.tabs.length >= 7);
		assert.equal(body.counts?.shorts, 1);
		assert.equal(body.counts?.channels, 2);
	});
});
