/**
 * Captions follow the video's own read rule (GET /api/videos/:id, lib/videoReadAccess.ts): the
 * list, the viewing route and the download answer a hidden video with the video GET's 404, and
 * only a video open to anyone is cached publicly or revalidated. Fixture captions only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SubtitlesList } from '../src/endpoints/video/subtitlesList';
import { SubtitlesGet } from '../src/endpoints/video/subtitlesGet';
import { SubtitlesDownload } from '../src/endpoints/video/subtitlesDownload';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { MemoryBucket, buildApp, videoFixture } from './helpers';

const VTT = 'WEBVTT\n\n00:00.000 --> 00:01.000\nfixture caption\n';

const VIDEOS: Record<string, Record<string, unknown>> = {
	pub: { isPublic: true },
	unl: { isPublic: false, isUnlisted: true },
	priv: { isPublic: false },
	processing: { isPublic: true, uploadStatus: 'processing' },
	removed: { isPublic: true, isHidden: true },
	held: { isPublic: true, review: { status: 'in_review' } },
	rejected: { isPublic: true, review: { status: 'rejected' } },
	deleted: { isPublic: true, isDeleted: true },
	marked: { isPublic: true, markedForDeletion: true },
};

function env() {
	const videos = new MemoryBucket(Object.fromEntries(Object.entries(VIDEOS).map(([id, o]) => [id, videoFixture({ id, userId: 'owner', channelId: 'team', ...o })])));
	const subtitles = new MemoryBucket();
	for (const id of Object.keys(VIDEOS)) {
		subtitles.store.set(`${id}/en.vtt`, VTT);
		subtitles.store.set(`${id}/metadata.json`, JSON.stringify({ videoId: id, tracks: [{ language: 'en', label: 'English', isDefault: true, status: 'ready' }] }));
	}
	const channels = new MemoryBucket({
		team: { id: 'team', name: 'Team', userId: 'owner', members: [{ userId: 'ed', role: 'editor' }, { userId: 'mod', role: 'moderator' }] },
	});
	// Viewer downloads on, so the download follows only the video's read rule here; switched off
	// (the default), see caption-drafts.spec.ts
	const global_settings = new MemoryBucket({ 'captions/settings.json': { viewerDownload: { enabled: true } } });
	return { videos, subtitles, channels, global_settings };
}

function app(userId?: string) {
	return buildApp((r) => {
		r.get('/api/videos/:id', VideoFetch);
		r.get('/api/videos/:videoId/subtitles', SubtitlesList);
		r.get('/api/videos/:videoId/subtitles/:language', SubtitlesGet);
		r.get('/api/videos/:videoId/subtitles/:language/download', SubtitlesDownload);
	}, userId ? { userId } : null);
}

const paths = (id: string) => [`/api/videos/${id}/subtitles`, `/api/videos/${id}/subtitles/en`, `/api/videos/${id}/subtitles/en/download`];

describe('caption reads follow the video GET', () => {
	it('a public or unlisted video serves its captions to anyone, cacheable with an ETag and 304', async () => {
		const e = env();
		for (const id of ['pub', 'unl']) {
			for (const path of paths(id)) assert.equal((await app().request(path, {}, e as never)).status, 200, path);
			const list = (await (await app().request(`/api/videos/${id}/subtitles`, {}, e as never)).json()) as any;
			assert.equal(list.data.restricted, false);
			assert.equal(list.data.tracks.length, 1);
			const view = await app().request(`/api/videos/${id}/subtitles/en`, {}, e as never);
			assert.equal(await view.text(), VTT);
			assert.match(view.headers.get('cache-control')!, /^public/);
			const etag = view.headers.get('etag')!;
			assert.ok(etag);
			const again = await app().request(`/api/videos/${id}/subtitles/en`, { headers: { 'If-None-Match': etag } }, e as never);
			assert.equal(again.status, 304);
		}
	});

	it('a private or still-processing video: anonymous, strangers and a moderator get the video GET 404; the owner and an editor read it, never cached', async () => {
		const e = env();
		for (const id of ['priv', 'processing']) {
			const videoGet = await app().request(`/api/videos/${id}`, {}, e as never);
			assert.equal(videoGet.status, 404);
			const notFound = await videoGet.json();
			for (const viewer of [undefined, 'stranger', 'mod']) {
				for (const path of paths(id)) {
					const res = await app(viewer).request(path, {}, e as never);
					assert.equal(res.status, 404, `${viewer ?? 'anonymous'} ${path}`);
					assert.deepEqual(await res.json(), notFound, 'same body as the video GET: no existence leak');
					assert.equal(res.headers.get('etag'), null);
				}
			}
			for (const viewer of ['owner', 'ed']) {
				assert.equal((await app(viewer).request(`/api/videos/${id}`, {}, e as never)).status, 200, 'the video GET admits them too');
				for (const path of paths(id)) {
					const res = await app(viewer).request(path, {}, e as never);
					assert.equal(res.status, 200, `${viewer} ${path}`);
					assert.match(res.headers.get('cache-control') ?? '', /no-store/, `${viewer} ${path} is never cached`);
				}
				const list = (await (await app(viewer).request(`/api/videos/${id}/subtitles`, {}, e as never)).json()) as any;
				assert.equal(list.data.restricted, true);
				const view = await app(viewer).request(`/api/videos/${id}/subtitles/en`, {}, e as never);
				assert.equal(await view.text(), VTT);
				assert.equal(view.headers.get('etag'), null, 'no validator for an owner-only read');
			}
		}
	});

	it('never answers a hidden video with 304, even with the public ETag', async () => {
		const e = env();
		const etag = (await app().request('/api/videos/pub/subtitles/en', {}, e as never)).headers.get('etag')!;
		// The same track bytes under a private video: the ETag would match
		const res = await app().request('/api/videos/priv/subtitles/en', { headers: { 'If-None-Match': etag } }, e as never);
		assert.equal(res.status, 404);
		const owner = await app('owner').request('/api/videos/priv/subtitles/en', { headers: { 'If-None-Match': etag } }, e as never);
		assert.equal(owner.status, 200, "the owner's conditional read gets the content, never a 304");
	});

	it('removed, held, rejected, soft-deleted and pending-deletion videos: 404 for everyone, the owner included, like the video GET', async () => {
		const e = env();
		for (const id of ['removed', 'deleted', 'marked']) {
			for (const viewer of [undefined, 'owner']) {
				assert.equal((await app(viewer).request(`/api/videos/${id}`, {}, e as never)).status, 404);
				for (const path of paths(id)) assert.equal((await app(viewer).request(path, {}, e as never)).status, 404, `${viewer ?? 'anonymous'} ${path}`);
			}
		}
		// Held or rejected by review: hidden from the public; the owner sees it in Studio, as the video GET allows
		for (const id of ['held', 'rejected']) {
			for (const path of paths(id)) {
				assert.equal((await app().request(path, {}, e as never)).status, 404, `anonymous ${path}`);
				assert.equal((await app('stranger').request(path, {}, e as never)).status, 404, `stranger ${path}`);
			}
			const ownerGet = (await app('owner').request(`/api/videos/${id}`, {}, e as never)).status;
			for (const path of paths(id)) assert.equal((await app('owner').request(path, {}, e as never)).status, ownerGet, `owner ${path} answers as the video GET`);
		}
	});

	it('a missing video answers 404 on every caption route', async () => {
		const e = env();
		e.subtitles.store.set('ghost/en.vtt', VTT);
		for (const path of paths('ghost')) assert.equal((await app('owner').request(path, {}, e as never)).status, 404, path);
	});
});
