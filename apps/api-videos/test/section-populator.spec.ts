import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { populateSectionContent } from '../src/lib/channelSectionPopulator';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { MemoryBucket, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

/**
 * Recent/popular upload sections used to list up to 1000 bucket objects and
 * read every video one after another to find the channel's (~12 s on QA with
 * ~250 videos). They are now answered from the ownership index.
 */
const CHANNEL = 'target-ch';

function bucketData() {
	const videos: Record<string, unknown> = {};
	for (let i = 0; i < 100; i++) {
		const id = `a${String(i).padStart(3, '0')}`;
		videos[id] = videoFixture({ id, channelId: 'other-ch', userId: 'someone' });
	}
	const own = [
		videoFixture({ id: 'z-old', channelId: CHANNEL, views: 50, dateCreated: '2026-01-01T00:00:00.000Z' }),
		videoFixture({ id: 'z-mid', channelId: CHANNEL, views: 5, dateCreated: '2026-02-01T00:00:00.000Z' }),
		videoFixture({ id: 'z-new', channelId: CHANNEL, views: 20, dateCreated: '2026-03-01T00:00:00.000Z' }),
		videoFixture({ id: 'z-priv', channelId: CHANNEL, isPublic: false, dateCreated: '2026-04-01T00:00:00.000Z' }),
		videoFixture({ id: 'z-del', channelId: CHANNEL, isDeleted: true, dateCreated: '2026-05-01T00:00:00.000Z' }),
	];
	for (const v of own) videos[v.id] = v;
	return videos;
}

function section(type: 'recent_uploads' | 'popular_uploads') {
	return { id: 's1', channelId: CHANNEL, type, title: '', position: 0, itemCount: 12 } as never;
}

describe('channel section populator (recent/popular uploads)', () => {
	it('reads only the channel videos from the index, newest first / most viewed first', async () => {
		const videos = new MemoryBucket(bucketData());
		const env = { SEARCH_DB: new SqliteD1(), videos, channels: new MemoryBucket() };
		await runOwnershipPass(env as never, 'video', { maxPages: 50 });

		videos.calls = 0;
		const recent = await populateSectionContent(section('recent_uploads'), env);
		assert.deepEqual(recent.videos?.map((v) => v.id), ['z-new', 'z-mid', 'z-old']);
		assert.ok(videos.calls < 10, `recent read ${videos.calls} objects`);

		const popular = await populateSectionContent(section('popular_uploads'), env);
		assert.deepEqual(popular.videos?.map((v) => v.id), ['z-old', 'z-new', 'z-mid']);
	});

	it('falls back to a bucket scan without an index (public, not removed, sorted)', async () => {
		const env = { videos: new MemoryBucket(bucketData()), channels: new MemoryBucket() };
		const recent = await populateSectionContent(section('recent_uploads'), env);
		assert.deepEqual(recent.videos?.map((v) => v.id), ['z-new', 'z-mid', 'z-old']);
		const popular = await populateSectionContent(section('popular_uploads'), env);
		assert.deepEqual(popular.videos?.map((v) => v.id), ['z-old', 'z-new', 'z-mid']);
	});
});
