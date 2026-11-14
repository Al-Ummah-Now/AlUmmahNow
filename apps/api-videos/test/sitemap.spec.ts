/** The videos site's sitemap data (wiki AUN-SEO): public items only, paged, from the search index. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITEMAP_PAGE_SIZE, sitemapPage, sitemapSummary, type SitemapVideo } from '../src/lib/sitemap';
import { SqliteD1 } from './search-sqlite-d1';

function seed() {
	const db = new SqliteD1();
	const insert = (table: string, id: string, channel: string | null, visible: number, payload: object, extra: Partial<{ created: number; indexed: number; duration: number; short: number }> = {}) =>
		db.db.prepare(`INSERT INTO ${table} (id, channel_id, visible, payload, created_at, indexed_at, duration, is_short) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
			.run(id, channel, visible, JSON.stringify(payload), extra.created ?? 1_700_000_000_000, extra.indexed ?? 1_800_000_000_000, extra.duration ?? null, extra.short ?? 0);
	insert('search_channels', 'ch1', 'ch1', 1, { id: 'ch1', name: 'Channel One', handle: 'one' });
	insert('search_channels', 'ch2', 'ch2', 0, { id: 'ch2', name: 'Hidden channel' });
	insert('search_videos', 'v1', 'ch1', 1, { id: 'v1', title: 'Talk', description: 'About it', channelName: 'Channel One' }, { duration: 125, created: 1_750_000_000_000 });
	insert('search_videos', 'v2', 'ch1', 1, { id: 'v2', title: 'Short one', mp4Path: 'pub/v2/e29db4ad6918a943/video.mp4' }, { short: 1, duration: 40 });
	insert('search_videos', 'v3', 'ch2', 1, { id: 'v3', title: 'In a hidden channel' });
	insert('search_videos', 'v4', 'ch1', 0, { id: 'v4', title: 'Not visible' });
	insert('search_playlists', 'p1', 'ch1', 1, { id: 'p1', name: 'Series' });
	return db;
}

describe('sitemap data', () => {
	it('counts only visible items in visible channels', async () => {
		const summary = await sitemapSummary(seed() as never);
		assert.equal(summary.pageSize, SITEMAP_PAGE_SIZE);
		assert.deepEqual(summary.kinds.videos, { count: 2, pages: 1, lastModified: new Date(1_800_000_000_000).toISOString() });
		assert.equal(summary.kinds.channels.count, 1);
		assert.equal(summary.kinds.playlists.count, 1);
	});

	it('lists videos with what a video sitemap needs', async () => {
		const items = (await sitemapPage(seed() as never, 'videos', 0)) as SitemapVideo[];
		assert.deepEqual(items.map((v) => v.id), ['v1', 'v2']);
		assert.equal(items[0].title, 'Talk');
		assert.equal(items[0].description, 'About it');
		assert.equal(items[0].duration, 125);
		assert.equal(items[0].publishedAt, new Date(1_750_000_000_000).toISOString());
		assert.equal(items[1].isShort, true);
	});

	it('gives a video with a public MP4 its contentUrl on the media host, and nothing else one (#1200)', async () => {
		const items = (await sitemapPage(seed() as never, 'videos', 0, 'media.alummahnow.net')) as SitemapVideo[];
		assert.equal(items[0].contentUrl, undefined);
		assert.equal(items[1].contentUrl, 'https://media.alummahnow.net/pub/v2/e29db4ad6918a943/video.mp4');
		// No media host here: no URL
		assert.equal(((await sitemapPage(seed() as never, 'videos', 0)) as SitemapVideo[])[1].contentUrl, undefined);
		// A path that is not this video's public MP4 never becomes a URL
		const db = seed();
		for (const [id, mp4Path] of [['v5', 'priv/v5/abc/video.mp4'], ['v6', 'pub/other/abc/video.mp4'], ['v7', 'pub/v7/abc/../x.mp4'], ['v8', 42]] as const) {
			db.db.prepare(`INSERT INTO search_videos (id, channel_id, visible, payload) VALUES (?, 'ch1', 1, ?)`).run(id, JSON.stringify({ id, title: id, mp4Path }));
		}
		const all = (await sitemapPage(db as never, 'videos', 0, 'media.alummahnow.net')) as SitemapVideo[];
		assert.deepEqual(all.filter((v) => v.contentUrl).map((v) => v.id), ['v2']);
	});

	it('lists channels with their handle and playlists with their title', async () => {
		assert.deepEqual((await sitemapPage(seed() as never, 'channels', 0)).map((c) => ({ ...c, lastModified: undefined })), [{ id: 'ch1', handle: 'one', name: 'Channel One', lastModified: undefined }]);
		assert.equal((await sitemapPage(seed() as never, 'playlists', 0))[0] && (await sitemapPage(seed() as never, 'playlists', 0)).length, 1);
	});

	it('a page past the end is empty', async () => {
		assert.deepEqual(await sitemapPage(seed() as never, 'videos', 1), []);
	});
});
