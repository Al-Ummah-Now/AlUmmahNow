/**
 * Purge completeness (#699, #700, #702, #814): what a purge erases besides the record, and the
 * notifications of soft-deleted content (hidden at once, back on restore).
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captionWorkPrefix, ownershipCompleteKey } from '@al-ummah/shared-types';
import { ADMIN_JOB_HANDLERS, deleteVideo, purgeDeletion, restorePost, restoreVideo, deleteChannel, restoreChannel } from '../src/lib/admin/service';
import { getDeletion } from '../src/lib/admin/deletions';
import { dropVideoReferences, eraseCaptionJobs, ownedPostImagePaths, ownedVideoImagePaths } from '../src/lib/admin/purgeCopies';
import { deleteImageFile, fileUnder, imagePathOfUrl } from '../src/lib/media/imageFiles';
import { countState, listNotifications, setNotificationsHidden } from '../src/lib/notifications';
import { softDeleteVideo, restoreDeletedVideo } from '../src/lib/videoTrash';
import { DeleteCommunityPost } from '../src/endpoints/community/delete-post';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

const IMG = 'https://images.alummahnow.net';

/** Bunny Storage (storage.bunnycdn.com) and Bunny Stream stand-ins; `failDeletes` answers 500. */
const storage = { files: new Set<string>(), deleted: [] as string[], failDeletes: false };
const realFetch = globalThis.fetch;
beforeEach(() => {
	storage.files = new Set();
	storage.deleted = [];
	storage.failDeletes = false;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		if (url.hostname === 'video.bunnycdn.com') return new Response('{}', { status: 200 });
		if (url.hostname !== 'storage.bunnycdn.com') return realFetch(input, init);
		const path = decodeURIComponent(url.pathname.replace(/^\/zone/, ''));
		if (init?.method === 'DELETE') {
			if (storage.failDeletes) return new Response('error', { status: 500 });
			if (!storage.files.delete(path)) return new Response('not found', { status: 404 });
			storage.deleted.push(path);
			return new Response('{}', { status: 200 });
		}
		const items = [...storage.files].filter((f) => f.startsWith(path) && !f.slice(path.length).includes('/')).map((f) => ({ ObjectName: f.slice(path.length), IsDirectory: false }));
		return items.length ? Response.json(items) : new Response('not found', { status: 404 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const UUID = '0b0e6f63-7a52-4a3f-9d9e-2f1c1a1b2c3d';

function baseEnv(seed: { videos?: Record<string, unknown>; channels?: Record<string, unknown>; playlists?: Record<string, unknown>; posts?: Record<string, unknown>; sections?: Record<string, unknown> } = {}) {
	return {
		SEARCH_DB: new SqliteD1(),
		NOTIFICATIONS_DB: createSqliteD1(),
		videos: new MemoryBucket(seed.videos ?? {}),
		channels: new MemoryBucket(seed.channels ?? {}),
		profiles: new MemoryBucket({ owner: { id: 'owner', channels: ['ch1'] } }),
		playlists: new MemoryBucket(seed.playlists ?? {}),
		community_posts: new MemoryBucket(seed.posts ?? {}),
		channel_sections: new MemoryBucket(seed.sections ?? {}),
		channel_tabs: new MemoryBucket(),
		subtitles: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		MEDIA_PRIVATE: new MemoryBucket(),
		queue: new MemoryQueue(),
		ADMIN_JOBS_QUEUE: new MemoryQueue(),
		'bunny-stream-key': 'test-key',
		bunny_stream_library_id: '7',
		image_storage_key: 'storage-key',
		ZONE: 'zone',
	} as any;
}

function notification(env: any, id: string, entityId: string, user = 'viewer', at = Date.now()) {
	env.NOTIFICATIONS_DB.raw
		.prepare("INSERT INTO notifications (id, user_id, category, notification_type, notification_key, params_json, entity_id, created_at) VALUES (?, ?, 'uploads', 'new_video', 'newVideo', '{}', ?, ?)")
		.run(id, user, entityId, at);
}

describe('image files (lib/media/imageFiles.ts)', () => {
	it('maps our image URLs to paths and keeps only plain files under a folder', () => {
		assert.equal(imagePathOfUrl(`${IMG}/thumbnails/v1/a.jpg?width=640`), '/thumbnails/v1/a.jpg');
		assert.equal(imagePathOfUrl('images.alummahnow.net/%D8%A8.jpg'), '/ب.jpg');
		assert.equal(imagePathOfUrl('https://cdn.example.com/thumbnails/v1/a.jpg'), null);
		assert.equal(fileUnder('/thumbnails/v1/a.jpg', '/thumbnails/v1/'), true);
		assert.equal(fileUnder('/thumbnails/v1/sub/a.jpg', '/thumbnails/v1/'), false);
		assert.equal(fileUnder('/thumbnails/v10/a.jpg', '/thumbnails/v1/'), false);
		assert.equal(fileUnder('/thumbnails/v1/..', '/thumbnails/v1/'), false);
	});

	it('a file already gone counts as deleted; a storage error throws', async () => {
		storage.files.add('/x/a.jpg');
		const env = { image_storage_key: 'k', ZONE: 'zone' };
		assert.equal(await deleteImageFile(env, '/x/a.jpg'), 'deleted');
		assert.equal(await deleteImageFile(env, '/x/a.jpg'), 'gone');
		storage.files.add('/x/b.jpg');
		storage.failDeletes = true;
		await assert.rejects(() => deleteImageFile(env, '/x/b.jpg'), /answered 500/);
	});
});

describe('which images belong to an item', () => {
	it('a video owns only the files in its own thumbnail folder, never a shared, foreign or root file', () => {
		const paths = ownedVideoImagePaths('v1', {
			thumbnailUrl: `${IMG}/thumbnails/v1/new.jpg?width=1280`,
			thumbnailSizes: { hd: `${IMG}/thumbnails/v1/new.jpg?width=1280`, sd: `${IMG}/thumbnails/v1/new.jpg?width=640` },
			previousThumbnailUrl: `${IMG}/${UUID}_thumbnail.png`,
			customThumbnailUrl: `${IMG}/thumbnails/v2/theirs.jpg`,
		});
		// A root admin upload from before uploads went to the folder may be named by any record: kept
		assert.deepEqual(paths, ['/thumbnails/v1/new.jpg']);
		// A legacy imported thumbnail (named after a title, may be shared) is not the purge's to delete
		assert.deepEqual(ownedVideoImagePaths('v1', { thumbnailUrl: 'images.alummahnow.net/Old lesson title.jpg' }), []);
	});

	it('a post owns the files in its channel folder, wherever the post names them', () => {
		const post = {
			images: [{ url: `${IMG}/community-posts/ch1/a.webp` }, { url: `${IMG}/community-posts/ch2/not-ours.webp` }],
			linkPreview: { image: { url: `${IMG}/community-posts/ch1/link-1.jpg` } },
			gif: `${IMG}/community-posts/ch1/g.gif`,
			content: 'see https://example.com/a.jpg',
		};
		assert.deepEqual(ownedPostImagePaths(post, 'ch1').sort(), ['/community-posts/ch1/a.webp', '/community-posts/ch1/g.gif', '/community-posts/ch1/link-1.jpg']);
	});
});

describe('video purge erases every copy (#700, #814)', () => {
	async function purgedVideoEnv() {
		const video = videoFixture({
			id: 'v1',
			userId: 'owner',
			channelId: 'ch1',
			isDeleted: true,
			thumbnailUrl: `${IMG}/thumbnails/v1/${UUID}_thumbnail.jpeg`,
			// Another video's file: a record can name any URL, and it is not this purge's to delete
			previousThumbnailUrl: `${IMG}/${UUID}_thumbnail.jpeg`,
		});
		const env = baseEnv({
			videos: { v1: video, v2: videoFixture({ id: 'v2', userId: 'owner', channelId: 'ch1' }) },
			channels: { ch1: { id: 'ch1', userId: 'owner', playlists: [] } },
			playlists: { pl1: { id: 'pl1', channelId: 'ch1', videos: ['v2', 'v1'], videosCount: 2 }, pl2: { id: 'pl2', channelId: 'ch1', videos: ['v2'] } },
			sections: {
				'ch1/s1.json': { id: 's1', type: 'videos', videoIds: ['v1', 'v2'] },
				'ch1/s2.json': { id: 's2', type: 'spotlight', trailerVideoId: 'v1', returningVideoId: 'v2' },
				'ch1/s3.json': { id: 's3', type: 'videos', videoIds: ['v2'] },
			},
		});
		for (const f of ['/thumbnails/v1/one.jpg', '/thumbnails/v1/two.jpg', `/thumbnails/v1/${UUID}_thumbnail.jpeg`, `/${UUID}_thumbnail.jpeg`, '/thumbnails/v2/keep.jpg']) storage.files.add(f);
		await env.subtitles.put('v1/en.vtt', 'WEBVTT');
		await env.subtitles.put('v1/original/a.srt', '1');
		await env.subtitles.put('v2/en.vtt', 'WEBVTT');
		const job = (id: string, status: string) =>
			env.SEARCH_DB.db
				.prepare(
					`INSERT INTO caption_jobs (id, idempotency_key, video_id, subject_id, requested_by, kind, language, provider, model, status, waived, created_at, updated_at)
					 VALUES (?, ?, ?, 'owner', 'owner', 'transcribe', 'ar', 'p', 'm', ?, 1, '2026-11-01', '2026-11-01')`,
				)
				.run(id, id, id === 'j3' ? 'v2' : 'v1', status);
		job('j1', 'ready');
		job('j2', 'transcribing');
		job('j3', 'ready');
		await env.MEDIA_PRIVATE.put(`${captionWorkPrefix('j2')}audio.m4a`, 'x');
		await env.MEDIA_PRIVATE.put(`${captionWorkPrefix('j3')}audio.m4a`, 'x');
		await env.SEARCH_DB.db.prepare("INSERT INTO image_owners (path, kind, owner_id, channel_id, created_at) VALUES ('/thumbnails/v1/one.jpg', 'video_thumbnail', 'owner', 'ch1', '2026-11-01')").run();
		// Found by channel id in the index, whatever the channel record lists
		await runOwnershipPass(env, 'playlist', { maxPages: 10 });
		return env;
	}

	it('erases thumbnails, subtitles, caption jobs and work files, and the id in its channel sections and playlists', async () => {
		const env = await purgedVideoEnv();
		const outcome = await ADMIN_JOB_HANDLERS['video.purge'](env, { targetId: 'v1', params: { userId: 'owner', channelId: 'ch1' } } as never);
		assert.equal((outcome as { done: boolean }).done, true);
		assert.equal(env.videos.store.has('v1'), false);
		// Bunny Storage: every file in its folder (uploads and the admin upload); files it only names stay
		assert.deepEqual([...storage.files].sort(), [`/${UUID}_thumbnail.jpeg`, '/thumbnails/v2/keep.jpg']);
		assert.equal(env.SEARCH_DB.count('image_owners'), 0, 'the index row goes with the file');
		// Subtitles (#814)
		assert.deepEqual([...env.subtitles.store.keys()], ['v2/en.vtt']);
		// Caption jobs: the active one cancelled, all of v1's rows and work gone, v2's kept
		assert.deepEqual(env.SEARCH_DB.db.prepare('SELECT id FROM caption_jobs ORDER BY id').all().map((r: any) => r.id), ['j3']);
		assert.deepEqual([...env.MEDIA_PRIVATE.store.keys()], [`${captionWorkPrefix('j3')}audio.m4a`]);
		// References
		const json = (b: MemoryBucket, k: string) => JSON.parse(b.store.get(k)!);
		assert.deepEqual(json(env.playlists, 'pl1').videos, ['v2']);
		assert.equal(json(env.playlists, 'pl1').videosCount, 1);
		assert.deepEqual(json(env.channel_sections, 'ch1/s1.json').videoIds, ['v2']);
		assert.equal(json(env.channel_sections, 'ch1/s2.json').trailerVideoId, null);
		assert.equal(json(env.channel_sections, 'ch1/s2.json').returningVideoId, 'v2');
	});

	it('is idempotent, and a storage failure fails the job so it retries', async () => {
		const env = await purgedVideoEnv();
		storage.failDeletes = true;
		await assert.rejects(() => ADMIN_JOB_HANDLERS['video.purge'](env, { targetId: 'v1', params: { userId: 'owner', channelId: 'ch1' } } as never), /answered 500/);
		storage.failDeletes = false;
		// The retry finds the record gone and still erases what was left
		await ADMIN_JOB_HANDLERS['video.purge'](env, { targetId: 'v1', params: { userId: 'owner', channelId: 'ch1' } } as never);
		assert.deepEqual([...storage.files].sort(), [`/${UUID}_thumbnail.jpeg`, '/thumbnails/v2/keep.jpg']);
		await ADMIN_JOB_HANDLERS['video.purge'](env, { targetId: 'v1', params: { userId: 'owner', channelId: 'ch1' } } as never);
		assert.deepEqual([...storage.files].sort(), [`/${UUID}_thumbnail.jpeg`, '/thumbnails/v2/keep.jpg']);
	});

	it('reference and caption steps are no-ops with nothing to do', async () => {
		const env = baseEnv();
		await runOwnershipPass(env, 'playlist', { maxPages: 10 });
		assert.equal(await dropVideoReferences(env, 'v9', null), 0);
		assert.equal(await dropVideoReferences(env, 'v9', 'missing'), 0);
		assert.equal(await eraseCaptionJobs(env, 'v9'), 0);
	});

	it('a rebuilding playlist index fails the job after everything else is gone, and the retry finishes', async () => {
		const env = await purgedVideoEnv();
		env.SEARCH_DB.db.prepare('DELETE FROM search_meta WHERE key = ?').run(ownershipCompleteKey('playlist'));
		const run = () => ADMIN_JOB_HANDLERS['video.purge'](env, { targetId: 'v1', params: { userId: 'owner', channelId: 'ch1' } } as never);
		await assert.rejects(run, /index is being rebuilt/);
		assert.equal(env.videos.store.has('v1'), false);
		assert.deepEqual([...storage.files].sort(), [`/${UUID}_thumbnail.jpeg`, '/thumbnails/v2/keep.jpg'], 'the files went first');
		await runOwnershipPass(env, 'playlist', { maxPages: 10 });
		await run();
		assert.deepEqual(env.playlists.read('pl1').videos, ['v2']);
	});
});

describe('post images (#699)', () => {
	const post = (id: string, overrides: Record<string, unknown> = {}) => ({ id, channelId: 'ch1', userId: 'owner', type: 'image', content: id, status: 'deleted', images: [{ url: `${IMG}/community-posts/ch1/${id}.webp` }], createdAt: '2026-11-01T00:00:00.000Z', ...overrides });

	it('the post purge deletes its images first; a failure keeps the post for the next run', async () => {
		const env = baseEnv({ posts: { 'posts/ch1/p1.json': post('p1') } });
		storage.files.add('/community-posts/ch1/p1.webp');
		storage.files.add('/community-posts/ch1/p2.webp');
		const d = { kind: 'post', id: 'p1', parentId: 'ch1' } as any;
		storage.failDeletes = true;
		await assert.rejects(() => purgeDeletion(env, d));
		assert.equal(env.community_posts.store.has('posts/ch1/p1.json'), true);
		storage.failDeletes = false;
		assert.deepEqual(await purgeDeletion(env, d), { state: 'purged' });
		assert.equal(env.community_posts.store.has('posts/ch1/p1.json'), false);
		assert.deepEqual([...storage.files], ['/community-posts/ch1/p2.webp']);
	});

	it('the channel purge empties the channel\'s post image folder', async () => {
		const env = baseEnv({ channels: { ch1: { id: 'ch1', userId: 'owner', handle: 'ch1', isDeleted: true, playlists: [] } }, posts: { 'posts/ch1/p1.json': post('p1') } });
		for (const f of ['/community-posts/ch1/a.webp', '/community-posts/ch1/b.gif', '/community-posts/ch2/c.webp']) storage.files.add(f);
		const first = await ADMIN_JOB_HANDLERS['channel.purge'](env, { targetId: 'ch1', params: { userId: 'owner' } } as never);
		assert.equal((first as any).result.postImages, 2);
		assert.deepEqual([...storage.files], ['/community-posts/ch2/c.webp']);
		assert.equal(env.community_posts.store.has('posts/ch1/p1.json'), false);
	});

	it('a creator\'s own post delete goes to the 30-day cleanup and an admin can restore it', async () => {
		// The owner's channel record: deleting a post checks the caller's role on its channel
		const env = baseEnv({ channels: { ch1: { id: 'ch1', userId: 'owner', handle: 'ch1', playlists: [] } }, posts: { 'posts/ch1/p1.json': post('p1', { status: 'published' }), 'posts/ch1/index.json': { postIds: ['p1'] } } });
		const app = buildApp((r) => r.delete('/api/channels/:channelId/posts/:postId', DeleteCommunityPost), { userId: 'owner' });
		const res = await app.request('/api/channels/ch1/posts/p1', { method: 'DELETE', headers: { channelId: 'ch1' } }, env);
		assert.equal(res.status, 200);
		const deletion = await getDeletion(env.SEARCH_DB, 'post', 'p1');
		assert.equal(deletion?.deletedBy, 'owner');
		assert.equal(deletion?.parentId, 'ch1');
		// Deleting again is still fine and records nothing new
		assert.equal((await app.request('/api/channels/ch1/posts/p1', { method: 'DELETE', headers: { channelId: 'ch1' } }, env)).status, 200);
		await restorePost(env, 'p1');
		const restored = JSON.parse(env.community_posts.store.get('posts/ch1/p1.json')!);
		assert.equal(restored.status, 'published');
		assert.equal(restored.ownerDeletion, undefined);
		assert.equal(await getDeletion(env.SEARCH_DB, 'post', 'p1'), null);
	});
});

it('a notice stored before names were cleaned reads on one line without direction controls', async () => {
	const env = baseEnv();
	notification(env, 'n1', 'v1');
	const params = { channel: '\u202eCorner\u2069\nx', count: 2 };
	await env.NOTIFICATIONS_DB.prepare('UPDATE notifications SET params_json = ? WHERE id = ?').bind(JSON.stringify(params), 'n1').run();
	assert.deepEqual((await listNotifications(env.NOTIFICATIONS_DB, 'viewer')).items[0].params, { channel: 'Corner x', count: 2 });
});

describe('notifications of soft-deleted content (#702)', () => {
	it('hidden rows leave the list and the counts; showing them again brings them back', async () => {
		const env = baseEnv();
		notification(env, 'n1', 'v1');
		notification(env, 'n2', 'v2');
		const db = env.NOTIFICATIONS_DB;
		assert.equal(await setNotificationsHidden(db, ['v1'], true), 1);
		assert.equal(await setNotificationsHidden(db, ['v1'], true), 0, 'idempotent');
		assert.deepEqual((await listNotifications(db, 'viewer')).items.map((n) => n.id), ['n2']);
		assert.equal((await countState(db, 'viewer')).unreadCount, 1);
		assert.equal(await setNotificationsHidden(db, ['v1'], false), 1);
		assert.equal((await listNotifications(db, 'viewer')).items.length, 2);
		// More ids than one statement may bind
		const many = Array.from({ length: 250 }, (_, i) => `x${i}`);
		assert.equal(await setNotificationsHidden(db, [...many, 'v2'], true), 1);
	});

	it('an admin video delete hides its notifications at once; restore shows them again', async () => {
		const env = baseEnv({ videos: { v1: videoFixture({ id: 'v1', userId: 'owner', channelId: 'ch1' }) } });
		notification(env, 'n1', 'v1');
		await deleteVideo(env, 'v1', 'usr_admin');
		assert.equal((await listNotifications(env.NOTIFICATIONS_DB, 'viewer')).items.length, 0);
		await restoreVideo(env, 'v1');
		assert.equal((await listNotifications(env.NOTIFICATIONS_DB, 'viewer')).items.length, 1);
	});

	it('a creator delete hides them too, and the creator restore brings them back', async () => {
		const env = baseEnv({ videos: { v1: videoFixture({ id: 'v1', userId: 'owner', channelId: 'ch1' }) } });
		notification(env, 'n1', 'v1');
		await softDeleteVideo(env, 'v1', 'owner');
		assert.equal((await listNotifications(env.NOTIFICATIONS_DB, 'viewer')).items.length, 0);
		await restoreDeletedVideo(env, { ...JSON.parse(env.videos.store.get('v1')!), id: 'v1' }, 'owner');
		assert.equal((await listNotifications(env.NOTIFICATIONS_DB, 'viewer')).items.length, 1);
	});

	it('a channel delete hides the channel\'s and its videos\' notifications; restore leaves a video deleted on its own hidden', async () => {
		const env = baseEnv({
			channels: { ch1: { id: 'ch1', userId: 'owner', handle: 'ch1', name: 'Channel', isMain: true, playlists: [] } },
			videos: {
				v1: videoFixture({ id: 'v1', userId: 'owner', channelId: 'ch1' }),
				v2: videoFixture({ id: 'v2', userId: 'owner', channelId: 'ch1' }),
			},
		});
		for (const kind of ['video', 'channel', 'playlist'] as const) await runOwnershipPass(env, kind, { maxPages: 10 });
		notification(env, 'n1', 'v1');
		notification(env, 'n2', 'v2');
		notification(env, 'n3', 'ch1');
		notification(env, 'n4', 'other');
		await deleteVideo(env, 'v2', 'usr_admin');
		const { job } = await deleteChannel(env, 'ch1', 'usr_admin');
		await ADMIN_JOB_HANDLERS['channel.sync-holds'](env, job);
		assert.deepEqual((await listNotifications(env.NOTIFICATIONS_DB, 'viewer')).items.map((n) => n.id), ['n4']);
		const restored = await restoreChannel(env, 'ch1', 'usr_admin');
		await ADMIN_JOB_HANDLERS['channel.sync-holds'](env, restored.job);
		assert.deepEqual((await listNotifications(env.NOTIFICATIONS_DB, 'viewer')).items.map((n) => n.id).sort(), ['n1', 'n3', 'n4']);
	});
});
