import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_COVER_R2_READS, resolvePlaylistCovers, withPlaylistCovers } from '../src/lib/playlistCovers';
import { attachSearchPlaylistCovers } from '../src/lib/search/playlistCovers';
import { signBunnyUrlsInText } from '../src/lib/bunny-signing';
import { MemoryBucket } from './helpers';

const thumb = (id: string) => `https://images.test/${id}.jpg`;
const video = (id: string, extra: Record<string, unknown> = {}) => ({ id, userId: 'creator', thumbnailUrl: thumb(id), ...extra });

/** D1 stand-in: answers the visible-videos query and counts queries. */
function fakeIndex(rows: Record<string, unknown>) {
	const db = {
		queries: 0,
		prepare() {
			return {
				bind(...ids: string[]) {
					return {
						all: async () => {
							db.queries++;
							return { results: ids.filter((id) => rows[id]).map((id) => ({ id, payload: JSON.stringify(rows[id]) })) };
						},
					};
				},
			};
		},
	};
	return db;
}

function env(videos: Record<string, unknown>, index?: ReturnType<typeof fakeIndex>) {
	return { videos: new MemoryBucket(videos) as unknown as R2Bucket, SEARCH_DB: index };
}

describe('resolvePlaylistCovers', () => {
	it('leaves a playlist with a custom thumbnail alone', async () => {
		const e = env({ a: video('a') });
		const [result] = await withPlaylistCovers(e, [{ id: 'p', thumbnailUrl: 'https://images.test/custom.jpg', videos: ['a'] }]);
		assert.equal(result.cover, undefined);
		assert.equal(result.thumbnailUrl, 'https://images.test/custom.jpg');
	});

	it('uses the first video in playlist order', async () => {
		const index = fakeIndex({ a: { thumbnailUrl: thumb('a') }, b: { thumbnailUrl: thumb('b') } });
		const covers = await resolvePlaylistCovers(env({}, index), [{ id: 'p', videos: ['b', 'a'] }]);
		assert.deepEqual(covers.get('p'), { videoId: 'b', thumbnailUrl: thumb('b') });
	});

	for (const [name, extra] of [
		['deleted', { isDeleted: true }],
		['hidden', { isHidden: true }],
		['private', { isPublic: false }],
	] as const) {
		it(`skips a ${name} first video`, async () => {
			const e = env({ a: video('a', extra), b: video('b') });
			const covers = await resolvePlaylistCovers(e, [{ id: 'p', videos: ['a', 'b'] }], 'someone-else');
			assert.equal(covers.get('p')?.videoId, 'b');
		});
	}

	it('skips a first video that has no thumbnail', async () => {
		const e = env({ a: video('a', { thumbnailUrl: undefined }), b: video('b') });
		const covers = await resolvePlaylistCovers(e, [{ id: 'p', videos: ['a', 'b'] }]);
		assert.equal(covers.get('p')?.videoId, 'b');
	});

	it('shows the playlist owner their own private first video, ahead of the indexed one', async () => {
		const index = fakeIndex({ b: { thumbnailUrl: thumb('b') } });
		const e = env({ a: video('a', { isPublic: false, userId: 'me' }), b: video('b') }, index);
		const mine = await resolvePlaylistCovers(e, [{ id: 'p', userId: 'me', videos: ['a', 'b'] }], 'me');
		assert.equal(mine.get('p')?.videoId, 'a');
		const theirs = await resolvePlaylistCovers(e, [{ id: 'p', userId: 'me', videos: ['a', 'b'] }], 'visitor');
		assert.equal(theirs.get('p')?.videoId, 'b');
	});

	it('returns no cover for an empty playlist', async () => {
		const covers = await resolvePlaylistCovers(env({}), [{ id: 'p', videos: [] }]);
		assert.equal(covers.size, 0);
	});

	it('answers a page of playlists with one index query and no R2 reads', async () => {
		const rows: Record<string, unknown> = {};
		const playlists = Array.from({ length: 20 }, (_, i) => {
			rows[`v${i}`] = { thumbnailUrl: thumb(`v${i}`) };
			return { id: `p${i}`, videos: [`v${i}`] };
		});
		const index = fakeIndex(rows);
		const e = env({}, index);
		const covers = await resolvePlaylistCovers(e, playlists);
		assert.equal(covers.size, 20);
		assert.equal(index.queries, 1);
		assert.equal((e.videos as unknown as MemoryBucket).calls, 0);
	});

	it('caps R2 reads when the index cannot help', async () => {
		const playlists = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, videos: [`v${i}`] }));
		const e = env(Object.fromEntries(playlists.map((p) => [p.videos[0], video(p.videos[0])])));
		await resolvePlaylistCovers(e, playlists);
		assert.equal((e.videos as unknown as MemoryBucket).calls, MAX_COVER_R2_READS);
	});

	it('falls back to R2 when the index query fails', async () => {
		const broken = { prepare: () => { throw new Error('D1 down'); } };
		const e = { videos: new MemoryBucket({ a: video('a') }) as unknown as R2Bucket, SEARCH_DB: broken };
		const covers = await resolvePlaylistCovers(e, [{ id: 'p', videos: ['a'] }]);
		assert.equal(covers.get('p')?.videoId, 'a');
	});
});

describe('search playlist covers', () => {
	it('adds the cover and strips the internal id list', async () => {
		const index = fakeIndex({ a: { thumbnailUrl: thumb('a') } });
		const playlist = { id: 'p', name: 'P', videosCount: 1, coverVideoIds: ['a'] };
		await attachSearchPlaylistCovers(env({}, index), [{ type: 'playlist', id: 'p', score: 1, playlist }]);
		assert.deepEqual(playlist, { id: 'p', name: 'P', videosCount: 1, cover: { videoId: 'a', thumbnailUrl: thumb('a') } });
	});
});

describe('cover signing', () => {
	const HOST = 'vz-test.b-cdn.net';
	const VID = '11111111-1111-4111-8111-111111111111';
	const body = JSON.stringify({ id: 'playlist-1', cover: { videoId: VID, thumbnailUrl: `https://${HOST}/${VID}/thumbnail.jpg` } });

	it('gets a token that follows the response time, while the stored URL stays plain', async () => {
		const early = JSON.parse(await signBunnyUrlsInText(body, HOST, 'key', 1_800_000_000));
		const later = JSON.parse(await signBunnyUrlsInText(body, HOST, 'key', 1_800_100_000));
		assert.match(early.cover.thumbnailUrl, /\/thumbnail\.jpg\?token=[^&]+&expires=\d+$/);
		assert.notEqual(early.cover.thumbnailUrl, later.cover.thumbnailUrl);
		const expires = Number(new URL(later.cover.thumbnailUrl).searchParams.get('expires'));
		assert.ok(expires > 1_800_100_000);
	});

	it('does not sign a URL placed directly on the playlist, whose id is not the video', async () => {
		const flat = JSON.stringify({ id: 'playlist-1', thumbnailUrl: `https://${HOST}/${VID}/thumbnail.jpg` });
		assert.equal(await signBunnyUrlsInText(flat, HOST, 'key', 1_800_000_000), flat);
	});
});
