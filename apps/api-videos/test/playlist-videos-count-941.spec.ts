/**
 * Regression tests for #941: playlist videosCount (and videos on viewer reads)
 * must exclude deleted, hidden, missing, processing, and other users' private videos
 * instead of returning raw playlist.videos.length.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { PlaylistAddVideo } from '../src/endpoints/playlist/playlistAddVideo';
import { PlaylistCreate } from '../src/endpoints/playlist/playlistCreate';
import { PlaylistFetch } from '../src/endpoints/playlist/playlistFetch';
import { PlaylistRemoveVideo } from '../src/endpoints/playlist/playlistRemoveVideo';
import { PlaylistUpdate } from '../src/endpoints/playlist/playlistUpdate';
import { ChannelPlaylistsList } from '../src/endpoints/channel/channelPlaylistsList';
import { MAX_COUNT_R2_READS, resolveViewableVideoIds, withPlaylistCovers } from '../src/lib/playlistCovers';
import { transformPlaylistToView } from '../src/lib/transformations';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const CHANNEL_ID = 'b4beecaf-0000-0000-0000-000000000001';
const PLAYLIST_ID = 'c63da002-2c21-4ea7-bfbb-a660ffe4aa3b';

function routes(r: any) {
	r.get('/api/playlists', PlaylistsList);
	r.get('/api/playlists/:id', PlaylistFetch);
	r.get('/api/channels/:id/playlists', ChannelPlaylistsList);
	r.post('/api/playlists', PlaylistCreate);
	r.patch('/api/playlists/:id', PlaylistUpdate);
	r.post('/api/playlists/:id/videos', PlaylistAddVideo);
	r.delete('/api/playlists/:id/videos/:videoId', PlaylistRemoveVideo);
}

function fixtureEnv(withIndex: boolean) {
	// Mirrors the exact QA #941 playlist: 7 stored IDs, only 3 public & ready
	const playlist = {
		id: PLAYLIST_ID,
		title: 'QA Lectures — Starter Playlist',
		userId: 'qa-creator',
		channelId: CHANNEL_ID,
		isPublic: true,
		videos: ['pub-1', 'pub-2', 'pub-3', 'gone-1', 'deleted-1', 'hidden-1', 'other-private'],
		dateCreated: '2026-11-01T00:00:00.000Z',
		dateModified: '2026-11-10T00:00:00.000Z',
	};
	const videos = new MemoryBucket({
		'pub-1': videoFixture({ id: 'pub-1', userId: 'qa-creator', channelId: CHANNEL_ID, isPublic: true, uploadStatus: 'ready' }),
		'pub-2': videoFixture({ id: 'pub-2', userId: 'qa-creator', channelId: CHANNEL_ID, isPublic: true, uploadStatus: 'ready' }),
		'pub-3': videoFixture({ id: 'pub-3', userId: 'qa-creator', channelId: CHANNEL_ID, isPublic: true, uploadStatus: 'ready' }),
		// gone-1: completely absent from R2
		'deleted-1': videoFixture({ id: 'deleted-1', userId: 'qa-creator', channelId: CHANNEL_ID, isPublic: true, isDeleted: true, uploadStatus: 'ready' }),
		'hidden-1': videoFixture({ id: 'hidden-1', userId: 'qa-creator', channelId: CHANNEL_ID, isPublic: true, isHidden: true, uploadStatus: 'ready' }),
		'other-private': videoFixture({ id: 'other-private', userId: 'android-tester', channelId: 'other-ch', isPublic: false, uploadStatus: 'ready' }),
	});
	const channels = new MemoryBucket({
		'other-ch': {
			id: 'other-ch',
			userId: 'android-tester',
			members: [{ userId: 'editor', role: 'editor', addedBy: 'android-tester', addedAt: '2026-11-01T00:00:00.000Z' }],
		},
		[CHANNEL_ID]: {
			id: CHANNEL_ID,
			userId: 'qa-creator',
			name: 'QA Creator',
			isMain: true,
			dateCreated: '2026-11-01T00:00:00.000Z',
			dateModified: '2026-11-01T00:00:00.000Z',
		},
	});
	const playlists = new MemoryBucket({ [PLAYLIST_ID]: playlist });
	const db = withIndex ? new SqliteD1() : undefined;
	return { playlists, videos, channels, ...(db ? { SEARCH_DB: db } : {}) };
}

describe('playlist videosCount excludes deleted and private videos (#941)', () => {
	for (const withIndex of [false, true]) {
		it(`counts only viewable videos (${withIndex ? 'indexed D1 content_ownership' : 'R2 fallback'})`, async () => {
			const env = fixtureEnv(withIndex);
			if (withIndex) {
				await runOwnershipPass(env as never, 'video');
				await runOwnershipPass(env as never, 'playlist');
			}

			const anon = buildApp(routes, null);

			// 1. GET /api/playlists?channelId=...
			const listRes = await anon.request(`/api/playlists?channelId=${CHANNEL_ID}&limit=10`, {}, env);
			assert.equal(listRes.status, 200);
			const listBody = (await listRes.json()) as { data: Array<{ id: string; videosCount: number; videos: string[] }> };
			assert.equal(listBody.data.length, 1);
			assert.equal(listBody.data[0].videosCount, 3);
			assert.deepEqual(listBody.data[0].videos, ['pub-1', 'pub-2', 'pub-3']);

			// 2. GET /api/channels/:id/playlists
			const chListRes = await anon.request(`/api/channels/${CHANNEL_ID}/playlists?limit=10`, {}, env);
			assert.equal(chListRes.status, 200);
			const chListBody = (await chListRes.json()) as { data: Array<{ id: string; videosCount: number; videos: string[] }> };
			assert.equal(chListBody.data[0].videosCount, 3);
			assert.deepEqual(chListBody.data[0].videos, ['pub-1', 'pub-2', 'pub-3']);

			// 3. GET /api/playlists/:id (unexpanded)
			const fetchRes = await anon.request(`/api/playlists/${PLAYLIST_ID}`, {}, env);
			assert.equal(fetchRes.status, 200);
			const fetchBody = (await fetchRes.json()) as { videosCount: number; videos: string[] };
			assert.equal(fetchBody.videosCount, 3);
			assert.deepEqual(fetchBody.videos, ['pub-1', 'pub-2', 'pub-3']);

			// 4. GET /api/playlists/:id?includeVideos=true (expanded: videosCount matches videoItems)
			const expandedRes = await anon.request(`/api/playlists/${PLAYLIST_ID}?includeVideos=true`, {}, env);
			assert.equal(expandedRes.status, 200);
			const expandedBody = (await expandedRes.json()) as { videosCount: number; videos: string[]; videoItems: Array<{ id: string }> };
			assert.equal(expandedBody.videoItems.length, 3);
			assert.equal(expandedBody.videosCount, 3);
			assert.deepEqual(expandedBody.videos, ['pub-1', 'pub-2', 'pub-3']);

			// 5. Private video's owner sees their own private video counted, but still not deleted/hidden/missing
			const privateOwner = buildApp(routes, { userId: 'android-tester' });
			const ownerList = (await (await privateOwner.request(`/api/playlists?channelId=${CHANNEL_ID}&limit=10`, {}, env)).json()) as {
				data: Array<{ videosCount: number; videos: string[] }>;
			};
			assert.equal(ownerList.data[0].videosCount, 4);
			assert.deepEqual(ownerList.data[0].videos, ['pub-1', 'pub-2', 'pub-3', 'other-private']);

			// The live channel's editor can see the private video, even with a different record owner.
			const editor = buildApp(routes, { userId: 'editor' });
			const editorList = await (await editor.request(`/api/playlists?channelId=${CHANNEL_ID}&limit=10`, {}, env)).json() as typeof ownerList;
			assert.deepEqual(editorList.data[0].videos, ownerList.data[0].videos);
			assert.equal(editorList.data[0].videosCount, 4);
		});
	}

	describe('mutation responses', () => {
		const playlistPath = `/api/playlists/${PLAYLIST_ID}`;
		const cases = [
			{
				name: 'creates a playlist with public and caller-visible private videos',
				method: 'POST', path: '/api/playlists',
				body: { title: 'New playlist', videos: ['pub-1', 'moved-private', 'deleted-1', 'hidden-1', 'other-private'] },
				expected: ['pub-1', 'moved-private'],
			},
			{
				name: 'adds a video and filters the existing playlist',
				method: 'POST', path: `${playlistPath}/videos`,
				body: { videoId: 'pub-3' },
				expected: ['pub-1', 'pub-2', 'moved-private', 'pub-3'],
			},
			{
				name: 'removes a video and filters the remaining playlist',
				method: 'DELETE', path: `${playlistPath}/videos/pub-2`,
				expected: ['pub-1', 'moved-private'],
			},
			{
				name: 'updates details and filters the existing playlist',
				method: 'PATCH', path: playlistPath,
				body: { title: 'Renamed playlist' },
				expected: ['pub-1', 'pub-2', 'moved-private'],
			},
		];

		for (const { name, method, path, body, expected } of cases) {
			it(name, async () => {
				const env = { ...fixtureEnv(true), queue: new MemoryQueue() };
				const playlist = env.playlists.read(PLAYLIST_ID);
				const storedIds = ['pub-1', 'pub-2', 'moved-private', 'deleted-1', 'hidden-1', 'other-private'];
				await env.playlists.put(PLAYLIST_ID, JSON.stringify({ ...playlist, videos: storedIds }));
				await env.videos.put('moved-private', JSON.stringify(videoFixture({
					id: 'moved-private', userId: 'former-owner', channelId: CHANNEL_ID, isPublic: false, uploadStatus: 'ready',
				})));
				await runOwnershipPass(env as never, 'video');

				const app = buildApp(routes, { userId: 'qa-creator' });
				const response = await app.request(path, {
					method,
					headers: { 'content-type': 'application/json', channelId: CHANNEL_ID },
					body: JSON.stringify(body),
				}, env);
				const result = await response.json() as { result: { playlist: { id: string; videos: string[]; videosCount: number } } };
				assert.equal(response.status, 200, JSON.stringify(result));
				assert.deepEqual(result.result.playlist.videos, expected);
				assert.equal(result.result.playlist.videosCount, expected.length);
				const stored = env.playlists.read(result.result.playlist.id);
				if (result.result.playlist.id === PLAYLIST_ID) {
					assert.deepEqual(
						stored.videos.filter((id: string) => ['deleted-1', 'hidden-1', 'other-private'].includes(id)),
						['deleted-1', 'hidden-1', 'other-private'],
					);
				} else {
					assert.deepEqual(stored.videos, expected);
				}
			});
		}
	});

	it('uses the live channel owner after a move, including on indexed reads', async () => {
		const env = fixtureEnv(true);
		const channel = env.channels.read('other-ch');
		await env.channels.put(channel.id, JSON.stringify({ ...channel, userId: 'new-owner' }));
		await runOwnershipPass(env as never, 'video');

		for (const [userId, expected] of [['new-owner', true], ['editor', true], ['android-tester', false]] as const) {
			const response = await buildApp(routes, { userId }).request(`/api/playlists/${PLAYLIST_ID}`, {}, env);
			assert.equal(response.status, 200);
			const { videos, videosCount } = await response.json() as { videos: string[]; videosCount: number };
			assert.deepEqual(videos, ['pub-1', 'pub-2', 'pub-3', ...(expected ? ['other-private'] : [])], userId);
			assert.equal(videosCount, videos.length);
		}
	});

	it('answers at the R2 read cap and falls back above it or without a videos binding', async () => {
		const env = fixtureEnv(true);
		const expandedPageSize = 200;
		const ids = Array.from({ length: expandedPageSize + MAX_COUNT_R2_READS + 1 }, (_, i) => `private-${i}`);
		for (const id of ids) {
			await env.videos.put(id, JSON.stringify(videoFixture({
				id, userId: 'qa-creator', channelId: CHANNEL_ID, isPublic: false, uploadStatus: 'ready',
			})));
		}
		await runOwnershipPass(env as never, 'video');

		const atCap = ids.slice(0, MAX_COUNT_R2_READS);
		env.videos.calls = 0;
		assert.deepEqual(await resolveViewableVideoIds(env as never, atCap, 'qa-creator'), new Set(atCap));
		assert.equal(env.videos.calls, MAX_COUNT_R2_READS);

		const allIds = ['pub-1', ...ids.slice(0, MAX_COUNT_R2_READS + 1)];
		env.videos.calls = 0;
		assert.equal(await resolveViewableVideoIds(env as never, allIds, 'qa-creator'), null);
		assert.equal(env.videos.calls, 0);
		const indexedOnly = { SEARCH_DB: env.SEARCH_DB };
		assert.equal(await resolveViewableVideoIds(indexedOnly, ['pub-1', ids[0]], 'qa-creator'), null);
		assert.deepEqual(await resolveViewableVideoIds(indexedOnly, allIds), new Set(['pub-1']));
		assert.deepEqual(await resolveViewableVideoIds(indexedOnly, ['pub-1'], 'qa-creator'), new Set(['pub-1']));

		// Each playlist fits the cap on its own, but the whole page exceeds it.
		const playlists = [atCap, ['pub-1', ids[MAX_COUNT_R2_READS]]].map((videos, i) => ({
			id: `playlist-${i}`, thumbnailUrl: 'https://example.test/cover.webp', videos, videosCount: videos.length,
		}));
		assert.deepEqual(await withPlaylistCovers(env as never, playlists, 'qa-creator'), playlists);
		assert.equal(env.videos.calls, 0);

		const playlist = env.playlists.read(PLAYLIST_ID);
		await env.playlists.put(PLAYLIST_ID, JSON.stringify({ ...playlist, videos: ids }));
		const app = buildApp(routes, { userId: 'qa-creator' });
		const response = await app.request(`/api/playlists/${PLAYLIST_ID}?includeVideos=true`, {}, env);
		assert.equal(response.status, 200);
		const expanded = await response.json() as { videos: string[]; videosCount: number; videoItems: Array<{ id: string }> };
		assert.deepEqual(expanded.videoItems.map(({ id }) => id), ids.slice(0, expandedPageSize));
		assert.deepEqual(expanded.videos, ids);
		assert.equal(expanded.videosCount, ids.length);
	});

	it('transformPlaylistToView honours filtered visibleVideos over raw playlist.videos.length', () => {
		const view = transformPlaylistToView(
			{
				id: PLAYLIST_ID,
				title: 'Lectures',
				userId: 'qa-creator',
				channelId: CHANNEL_ID,
				isPublic: true,
				videos: ['pub-1', 'pub-2', 'gone-1', 'other-private'],
				dateCreated: '2026-11-01T00:00:00.000Z',
				dateModified: '2026-11-10T00:00:00.000Z',
			} as never,
			null,
			['pub-1', 'pub-2'],
		);
		assert.equal(view.videosCount, 2);
		assert.deepEqual(view.videos, ['pub-1', 'pub-2']);
	});
});
