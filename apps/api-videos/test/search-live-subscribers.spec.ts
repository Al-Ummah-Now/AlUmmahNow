/**
 * #1633: the search index's channel subscriber count (Explore, search results, suggestions and the
 * channel's popularity) follows the live D1 count (NOTIFICATIONS_DB channel_subscriber_counts),
 * never the count frozen on the R2 channel object since subscriptions moved to D1 (AV-4).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	channelPopularity,
	channelSubscriberCount,
	refreshChannelSubscribers,
	syncSearchDocument,
} from '@al-ummah/shared-types';
import { ExploreGet } from '../src/endpoints/search/exploreGet';
import { SearchGet } from '../src/endpoints/search/searchGet';
import { withSearchSync } from '../src/lib/search/sync';
import { backfillSearchPage } from '../src/lib/search/backfill';
import { MemoryBucket, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

const NOW = Date.now();

/** A channel as stored in R2: its legacy `subscribers` list froze at 3 when subscriptions moved to D1 */
const channel = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	name: `Seerah Notes ${id}`,
	userId: `owner-${id}`,
	subscribers: ['a', 'b', 'c'],
	videosCount: 4,
	dateCreated: new Date(NOW - 60_000).toISOString(),
	...extra,
});

function liveCounts(counts: Record<string, number>) {
	const db = createSqliteD1();
	for (const [id, n] of Object.entries(counts)) {
		db.rows('INSERT INTO channel_subscriber_counts (channel_id, subscribers) VALUES (?, ?)', id, n);
	}
	return db;
}

function indexed(db: SqliteD1, id: string): { subscribersCount: number; popularity: number } | null {
	const row = db.db.prepare('SELECT payload, popularity FROM search_channels WHERE id = ?').get(id) as { payload: string; popularity: number } | undefined;
	return row ? { subscribersCount: JSON.parse(row.payload).subscribersCount, popularity: Number(row.popularity) } : null;
}

describe('live subscriber counts in the search index (#1633)', () => {
	it('reads the live count by channel, and nothing for a channel with no row', async () => {
		const counts = liveCounts({ c1: 7, c0: 0 });
		assert.equal(await channelSubscriberCount(counts, 'c1'), 7);
		assert.equal(await channelSubscriberCount(counts, 'c0'), 0);
		assert.equal(await channelSubscriberCount(counts, 'unknown'), undefined);
		assert.equal(await channelSubscriberCount(undefined, 'c1'), undefined);
	});

	it('a channel document takes the live count over the frozen R2 one, popularity included', async () => {
		const db = new SqliteD1();
		await syncSearchDocument(db, 'channel', 'c1', channel('c1'), { now: NOW });
		assert.equal(indexed(db, 'c1')!.subscribersCount, 3, 'without a live count the R2 one stays');
		await syncSearchDocument(db, 'channel', 'c1', channel('c1'), { now: NOW, version: NOW + 1, subscribers: 12 });
		assert.deepEqual(indexed(db, 'c1'), { subscribersCount: 12, popularity: channelPopularity(12, 4) });
		await syncSearchDocument(db, 'channel', 'c1', channel('c1'), { now: NOW, version: NOW + 2, subscribers: 0 });
		assert.equal(indexed(db, 'c1')!.subscribersCount, 0, 'zero is a live count too');
	});

	it('a subscription change refreshes the indexed count and popularity', async () => {
		const db = new SqliteD1();
		await syncSearchDocument(db, 'channel', 'c1', channel('c1', { subscribers: [] }), { now: NOW });
		assert.equal(await refreshChannelSubscribers(db, 'c1', 2), 'updated');
		assert.deepEqual(indexed(db, 'c1'), { subscribersCount: 2, popularity: channelPopularity(2, 4) });
		assert.equal(await refreshChannelSubscribers(db, 'c1', 2), 'unchanged');
		assert.equal(await refreshChannelSubscribers(db, 'c1', 1), 'updated');
		assert.equal(indexed(db, 'c1')!.subscribersCount, 1);
		assert.equal(await refreshChannelSubscribers(db, 'never-indexed', 5), 'missing');
		// A deleted channel keeps an empty row: nothing to update
		await syncSearchDocument(db, 'channel', 'gone', channel('gone'), { now: NOW });
		await syncSearchDocument(db, 'channel', 'gone', null, { now: NOW + 1, version: NOW + 1 });
		assert.equal(await refreshChannelSubscribers(db, 'gone', 5), 'missing');
	});

	it('a channel edit (R2 write) keeps the live count instead of putting the frozen one back', async () => {
		const db = new SqliteD1();
		const pending: Promise<unknown>[] = [];
		const raw = { SEARCH_DB: db, NOTIFICATIONS_DB: liveCounts({ c1: 9 }), videos: new MemoryBucket(), channels: new MemoryBucket(), playlists: new MemoryBucket(), community_posts: new MemoryBucket() };
		const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
		await env.channels.put('c1', JSON.stringify(channel('c1', { description: 'Edited' })));
		await Promise.all(pending);
		assert.equal(indexed(db, 'c1')!.subscribersCount, 9);
	});

	it('the daily backfill writes the live count', async () => {
		const db = new SqliteD1();
		const channels = new MemoryBucket({ c1: channel('c1'), c2: channel('c2') });
		await backfillSearchPage({ SEARCH_DB: db, channels, NOTIFICATIONS_DB: liveCounts({ c1: 2 }) }, 'channel', { limit: 10, now: NOW });
		assert.equal(indexed(db, 'c1')!.subscribersCount, 2, 'live count');
		assert.equal(indexed(db, 'c2')!.subscribersCount, 3, 'no live row yet: the stored count');
	});

	it('Explore and search show the count after a subscription change', async () => {
		const db = new SqliteD1();
		for (const id of ['c0', 'c1', 'c2']) await syncSearchDocument(db, 'channel', id, channel(id, { subscribers: [] }), { now: NOW });
		await refreshChannelSubscribers(db, 'c1', 1);
		await refreshChannelSubscribers(db, 'c2', 2);
		const routes = buildApp(r => {
			r.get('/api/explore', ExploreGet);
			r.get('/api/search', SearchGet);
		});
		const env = { SEARCH_DB: db, global_settings: new MemoryBucket(), videos: new MemoryBucket(), channels: new MemoryBucket() };
		const explore = await (await routes.request('/api/explore', {}, env)).json() as any;
		const fromExplore = Object.fromEntries((explore.newChannels ?? explore.result?.newChannels ?? []).map((c: any) => [c.id, c.subscribersCount]));
		assert.deepEqual(fromExplore, { c0: 0, c1: 1, c2: 2 });
		const search = await (await routes.request('/api/search?q=seerah&type=channel&limit=10', {}, env)).json() as any;
		const fromSearch = Object.fromEntries(search.results.map((r: any) => [r.channel.id, r.channel.subscribersCount]));
		assert.deepEqual(fromSearch, { c0: 0, c1: 1, c2: 2 });
	});
});
