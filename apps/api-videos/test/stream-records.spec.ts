/**
 * The videos bucket also holds live streams and section indexes, told apart by their key
 * (isInternalVideoKey): no route that reads or changes a video takes one for a video.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { isInternalVideoKey, isInternalVideoRecord } from '@al-ummah/shared-types';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';
import { runOwnershipPass } from '../src/lib/search/ownership';
import R2Repository, { NonVideoRepository } from '../src/lib/r2Repo';
import { scanFill } from '../src/lib/listFill';
import { refuseInternalVideoKeys } from '../src/middleware/internal-video-keys';
import { computeChannelTotals } from '../src/lib/channelAbout';
import { loadPublicPlay } from '../src/lib/media/public-play';
import { LiveStreamsList } from '../src/endpoints/live/liveStreamsList';
import { deleteVideo, moveVideo, reprocessVideo, restoreVideo, setVideoPublished, updateVideo, videoDetail } from '../src/lib/admin/service';
import videoRouter from '../src/routers/video.router';
import playlistRouter from '../src/routers/playlist.router';
import analyticsRouter from '../src/routers/analytics.router';
import moderationRouter from '../src/routers/moderation.router';
import libraryRouter from '../src/routers/library.router';
import discoveryRouter from '../src/routers/discovery.router';
import sectionsRouter from '../src/routers/sections.router';
import watchHistoryRouter from '../src/routers/watch-history.router';
import translateRouter from '../src/routers/translate.router';
import studioRouter from '../src/routers/studio.router';
import settingsRouter from '../src/routers/settings.router';
import communityRouter from '../src/routers/community.router';
import channelRouter from '../src/routers/channel.router';
import { continueWatchingRouter, watchStateRouter } from '../src/routers/watch-state.router';

const OWNER = 'usr_owner';
const stream = (id: string, over: Record<string, unknown> = {}) => ({
	id, title: 'Evening lesson', description: 'evening', userId: OWNER, channelId: 'ch1', category: 'islamic_history', status: 'scheduled', currentViewers: 0, peakViewers: 0, views: 0, isPrivate: false,
	likes: [], dislikes: [], comments: [commentFixture('c1', { userId: 'usr_x', channelId: null, text: 'evening' })], tags: [], playbackUrl: 'https://live.test/x.m3u8', dateCreated: '2026-11-01T00:00:00.000Z', ...over,
});
/** Every kind of stream that is not simply public and on air. */
const STREAMS = {
	private: { isPrivate: true },
	scheduled: { isPrivate: true, scheduledStartTime: '2999-01-01T00:00:00.000Z' },
	hidden: { isPrivate: true, isHidden: true },
	members: { isPrivate: true, visibility: 'members', subscribersOnly: true },
	ended: { status: 'ended', vodUrl: 'https://live.test/vod.m3u8' },
	premiere: { kind: 'premiere', premiereVideoId: 'v1', currentViewers: undefined },
};

let realFetch: typeof fetch;
before(() => {
	realFetch = globalThis.fetch;
	globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch;
});
after(() => {
	globalThis.fetch = realFetch;
});

async function setup(indexed: boolean) {
	const videos = new MemoryBucket({
		v1: videoFixture({ id: 'v1', title: 'A video', userId: OWNER, channelId: 'ch1', category: 'islamic_history', dateCreated: '2026-11-01T00:00:00.000Z', uploadStatus: 'ready', duration: 600 } as never),
		...Object.fromEntries(Object.entries(STREAMS).map(([id, over]) => [`livestream:${id}`, stream(id, over)])),
		'index:recent-videos': { title: 'Evening lesson', category: 'islamic_history', videos: [] },
		'metadata:last-index-update': { title: 'Evening lesson' },
	});
	const buckets = ['profiles', 'playlists', 'community_posts', 'channel_tabs', 'channel_sections', 'watch_history', 'upload-defaults', 'reports', 'subtitles', 'global_settings', 'ADMIN_BACKUPS', 'MEDIA', 'MEDIA_PRIVATE', 'MEDIA_ORIGINALS', 'SCHEDULED_VIDEOS', 'analytics_rollups'];
	const env: Record<string, any> = {
		...Object.fromEntries(buckets.map((name) => [name, new MemoryBucket()])),
		videos,
		channels: new MemoryBucket({ ch1: { id: 'ch1', userId: OWNER, name: 'Channel', members: [] } }),
		queue: new MemoryQueue(), ADMIN_JOBS_QUEUE: new MemoryQueue(), MODERATION_QUEUE: new MemoryQueue(), PROCESSING_CHECK_QUEUE: new MemoryQueue(),
		NOTIFICATIONS_DB: createSqliteD1(), TUS_SESSIONS: { get: async () => null, put: async () => undefined, delete: async () => undefined }, FEED: { get: async () => null },
		'bunny-stream-key': 'k', bunny_stream_library_id: '7', image_storage_key: 'k', ZONE: 'z', INTERNAL_API_KEY: 'k'.repeat(40),
	};
	env.playlists.store.set('pl1', JSON.stringify({ id: 'pl1', title: 'p', userId: OWNER, channelId: 'ch1', videos: ['v1'], isPublic: true, dateCreated: '2026-11-01T00:00:00.000Z' }));
	if (indexed) {
		env.SEARCH_DB = new SqliteD1();
		for (const kind of ['channel', 'video', 'playlist', 'stream'] as const) await runOwnershipPass(env as never, kind, { maxPages: 10 });
	}
	return env;
}

const internal = (env: Record<string, any>) => JSON.stringify([...env.videos.store.entries()].filter(([key]: [string]) => isInternalVideoKey(key)).sort());
const MARKS = ['Evening lesson', 'live.test'];

/** Every route of the API that can name a video, with its real handlers. */
function mount(app: any) {
	const routers: Array<[string, any]> = [
		['/api/videos', videoRouter], ['/api/videos/sections', sectionsRouter], ['/api/playlists', playlistRouter], ['/api/analytics', analyticsRouter], ['/api/moderation', moderationRouter],
		['/api/library', libraryRouter], ['/api', discoveryRouter], ['/api/watch-history', watchHistoryRouter], ['/api/watch-state', watchStateRouter], ['/api/continue-watching', continueWatchingRouter],
		['/api/translate', translateRouter], ['/api/studio', studioRouter], ['/api/upload-defaults', settingsRouter], ['/api/community', communityRouter], ['/api/channels', channelRouter],
	];
	for (const [base, router] of routers) app.route(base, router);
}

const PARAMS: Record<string, string> = { channelId: 'ch1', cid: 'c1', commentId: 'c1', postId: 'p1', lang: 'en', language: 'en', trackId: 't1', userId: 'usr_x', sectionId: 'sec1', handle: 'ch', tabId: 't', category: 'islamic_history', playlistId: 'pl1' };
const KEY = 'livestream:private';

/** What a client could send, with a stream's key wherever an id goes. */
const BODY = {
	videoId: KEY, videoIds: [KEY], ids: [KEY], id: KEY, entityId: KEY, targetId: KEY, entityType: 'video', targetType: 'video', contentType: 'video', contentId: KEY, items: [{ videoId: KEY, id: KEY, title: 'changed' }], videos: [KEY], perVideo: { [KEY]: { title: 'changed' } }, order: [KEY],
	text: 'changed', title: 'changed', description: 'changed', reason: 'spam', category: 'islamic_history', changes: { title: 'changed', isPublic: true }, isPublic: true, visibility: 'public', sessionId: 'session-12345678', seconds: 5, buckets: [0], position: 10, duration: 100, progress: 10,
	scheduledPublishDate: '2999-01-01T00:00:00.000Z', scheduledStartTime: new Date(Date.now() + 3600_000).toISOString(), chapters: [{ title: 'changed', startTime: 0 }], confirm: 'DELETE', playlistIds: ['pl1'], playlistId: 'pl1', timeSeconds: 1, note: 'changed', event: 'play', type: 'video', targetLanguage: 'ar', fileName: 'x.mp4', fileSize: 10,
};

describe('records of the videos bucket that are not videos', () => {
	for (const indexed of [true, false]) {
		it(`no route of the API shows or changes one (${indexed ? 'index' : 'scan'})`, async () => {
			const wrong: string[] = [];
			let calls = 0;
			for (const who of [null, 'usr_x', OWNER]) {
				const env = await setup(indexed);
				const before = internal(env);
				const app = buildApp(mount as never, who ? { userId: who } : null);
				const routes = [...new Map((app as unknown as Hono).routes.filter((r) => r.method !== 'ALL').map((r) => [`${r.method} ${r.path}`, r])).values()];
				assert.ok(routes.length > 150, `${routes.length} routes`);
				// The reads once more at the end: what a write let in would show then
				for (const { method, path } of [...routes, ...routes.filter((r) => r.method === 'GET')]) {
					const ids = [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);
					// The stream in each id the route takes, in turn, and in none (lists, bodies)
					const spots = [null, ...ids.filter((name) => /^(id|videoId)$/.test(name))];
					for (const spot of spots) {
						const url = path.replace(/:([A-Za-z]+)(\{[^}]*\})?\??/g, (_m, name) => encodeURIComponent(name === spot ? KEY : (PARAMS[name] ?? (path.startsWith('/api/playlists') ? 'pl1' : path.startsWith('/api/channels') ? 'ch1' : 'v1'))));
						// A delete of the video itself would end the run's other checks
						if (method === 'DELETE' && spot === null && ids.length) continue;
						for (const query of method === 'GET' ? ['', '?q=evening&limit=50', '?query=evening&limit=50', '?category=islamic_history&limit=50', `?videoId=${KEY}&entityId=${KEY}&entityType=video&limit=50`, '?channelId=ch1&limit=50', '?channelIds=ch1&limit=50'] : ['']) {
							calls++;
							const res = await Promise.race([
								Promise.resolve(app.request(url + query, { method, ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(BODY), headers: { 'content-type': 'application/json' } }) }, env as never, { waitUntil: () => undefined, passThroughOnException: () => undefined } as never)).catch(() => null),
								new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000).unref()),
							]);
							const name = `${who ?? 'signed out'}: ${method} ${path}${spot ? ` (${spot})` : ''}${query.split('=')[0]}`;
							const text = res ? await res.text().catch(() => '') : '';
							if (MARKS.some((mark) => text.includes(mark))) wrong.push(`${name} shows it`);
							if (internal(env) !== before) {
								wrong.push(`${name} changes it`);
								for (const [key, value] of JSON.parse(before)) env.videos.store.set(key, value);
							}
						}
					}
				}
				for (const [bucket, store] of Object.entries(env).filter(([name, b]) => b instanceof MemoryBucket && name !== 'videos')) {
					const text = JSON.stringify([...(store as MemoryBucket).store.entries()]);
					if (MARKS.some((mark) => text.includes(mark))) wrong.push(`${who ?? 'signed out'}: copied to ${bucket}`);
					if (bucket === 'playlists' && text.includes(KEY)) wrong.push(`${who ?? 'signed out'}: added to a playlist`);
				}
			}
			assert.ok(calls > 1000, `${calls} calls`);
			assert.deepEqual(wrong, []);
		});
	}

	it('an id in the path or in an id parameter that is such a key is not found, whatever reads it', async () => {
		const app = new Hono();
		app.use('/api/*', refuseInternalVideoKeys);
		app.all('*', (c) => c.text('read'));
		for (const path of [`/api/videos/${KEY}`, `/api/videos/${encodeURIComponent(KEY)}/comments`, '/api/videos/LIVESTREAM%3Ax'.replace('LIVESTREAM', 'livestream'), '/api/videos/index:recent-videos', `/api/recommendations?videoId=${KEY}`, `/api/analytics?entityId=${KEY}`, `/api/x?ids=v1,${KEY}`]) assert.equal((await app.request(path)).status, 404, path);
		const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
		assert.ok(index.indexOf("app.use('/api/*', refuseInternalVideoKeys)") > 0 && index.indexOf("app.use('/api/*', refuseInternalVideoKeys)") < index.indexOf('registerAllRouters(openapi'), 'the API uses it before its routes');
		for (const path of ['/api/videos/v1', '/api/videos?q=livestream:x', '/api/search?query=index:%20of%20lessons', '/api/live-streams/private', '/api/videos/%E0%A4%A']) assert.equal((await app.request(path)).status, 200, path);
	});

	it('the repository, the filled scan and the totals skip them; the stream code still reads its own', async () => {
		const env = await setup(false);
		const repo = new R2Repository<Record<string, unknown>>(env.videos);
		for (const key of [KEY, 'index:recent-videos', 'metadata:last-index-update']) {
			assert.equal(await repo.getObject(key), null);
			assert.equal(await repo.updateObject(key, (r) => { r.title = 'changed'; }), null);
			assert.deepEqual(await repo.updateObjectOrReject(key, () => true), { data: null });
			await assert.rejects(repo.putObject(key, {}));
			await assert.rejects(repo.createObject(key, {}));
			await assert.rejects(repo.deleteObject(key));
		}
		assert.deepEqual((await repo.listObjects(100)).items.map((v) => v.id), ['v1']);
		const page = await scanFill<Record<string, unknown>>({ bucket: env.videos, limit: 50, load: async (key) => env.videos.read(key), isListed: (v): v is Record<string, unknown> => !!v, label: 't' });
		assert.deepEqual(page.items.map((v) => v.id), ['v1']);
		assert.equal((await computeChannelTotals(env.videos, 'ch1')).videosCount, 1);
		const streams = new NonVideoRepository<Record<string, unknown>>(env.videos);
		assert.equal((await streams.getObject(KEY))!.id, 'private');
		assert.equal((await streams.listObjects(100, undefined, 'livestream:')).items.length, Object.keys(STREAMS).length);
		const list = await buildApp((r: any) => r.get('/api/live-streams', LiveStreamsList), { userId: OWNER }).request('/api/live-streams', {}, env as never);
		assert.ok(((await list.json()) as any).result.data.length >= 3, 'live streams are listed as live streams');
	});

	it('nor does the admin or the public player', async () => {
		const env = await setup(true);
		const before = internal(env);
		const e = env as never;
		for (const act of [() => videoDetail(e, KEY), () => updateVideo(e, KEY, { title: 'changed' } as never), () => moveVideo(e, KEY, 'ch1', 'admin'), () => setVideoPublished(e, KEY, true), () => reprocessVideo(e, KEY), () => deleteVideo(e, KEY, 'admin'), () => restoreVideo(e, KEY)]) await assert.rejects(Promise.resolve().then(act), (error: any) => /not_found/.test(`${error.code} ${error.message}`), String(act));
		assert.equal((await loadPublicPlay(env as never, KEY).catch(() => null)) ?? null, null);
		assert.equal(internal(env), before);
	});

	it('a video is never taken for one', () => {
		for (const key of ['v1', 'livestream', 'indexes:1', 'x:livestream:', '', null, undefined]) assert.equal(isInternalVideoKey(key), false, String(key));
		for (const key of ['index:recent-videos', 'livestream:s', 'metadata:x']) {
			assert.equal(isInternalVideoKey(key), true);
			assert.equal(isInternalVideoRecord({ id: key }), true);
		}
	});
});
