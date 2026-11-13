/**
 * One visibility rule for every surface (#1241). Each surface that decides whether a video may be
 * listed, opened, announced, indexed or served from the public R2 prefix must agree with the
 * shared rule in shared-types video-visibility.ts. A new surface that keeps its own copy of the
 * rule belongs in this table; if it disagrees, this test fails.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { isVideoSearchable } from '@al-ummah/shared-types';
import { errorHandler } from '../src/middleware/error-handler';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { VideoPlayback } from '../src/endpoints/video/videoPlayback';
import { isVideoListedFor, isVideoMediaPublic, isVideoOpenToAnyone, isVideoPubliclyVisible } from '../src/lib/visibility';
import { isDiscoverable } from '../src/lib/discovery';
import { isPubliclyPlayable } from '../src/lib/media/public-play';
import { desiredAccess } from '../src/lib/media/r2-delivery';
import { isAnnounceable } from '../src/lib/notification-events';
import { isPublishedState } from '../src/lib/published';
import { isListableVideo } from '../src/lib/channelSectionRules';
import { MemoryBucket, videoFixture } from './helpers';

const OWNER = 'usr_owner';

/** Every state a stored video can be in, with what everyone else may do with it. */
const STATES: Array<{ name: string; video: Record<string, unknown>; listed: boolean; open: boolean; mediaPublic: boolean }> = [
	{ name: 'public and ready', video: { uploadStatus: 'ready' }, listed: true, open: true, mediaPublic: true },
	{ name: 'public, older record without a status', video: {}, listed: true, open: true, mediaPublic: true },
	{ name: 'public and still processing', video: { uploadStatus: 'processing' }, listed: false, open: false, mediaPublic: true },
	{ name: 'public and uploading', video: { uploadStatus: 'uploading' }, listed: false, open: false, mediaPublic: true },
	{ name: 'public and failed', video: { uploadStatus: 'failed' }, listed: false, open: false, mediaPublic: true },
	{ name: 'unlisted and ready', video: { uploadStatus: 'ready', isPublic: false, isUnlisted: true }, listed: false, open: true, mediaPublic: false },
	{ name: 'unlisted and processing', video: { uploadStatus: 'processing', isPublic: false, isUnlisted: true }, listed: false, open: false, mediaPublic: false },
	{ name: 'private', video: { uploadStatus: 'ready', isPublic: false }, listed: false, open: false, mediaPublic: false },
	{ name: 'draft', video: { uploadStatus: 'ready', isPublic: false, isDraft: true }, listed: false, open: false, mediaPublic: false },
	{ name: 'draft flagged public by an old write', video: { uploadStatus: 'ready', isDraft: true }, listed: false, open: false, mediaPublic: false },
	{ name: 'scheduled', video: { uploadStatus: 'ready', scheduledPublishStatus: 'scheduled' }, listed: false, open: false, mediaPublic: false },
	{ name: 'being published by the scheduler', video: { uploadStatus: 'ready', scheduledPublishStatus: 'publishing' }, listed: false, open: false, mediaPublic: false },
	{ name: 'released by the scheduler', video: { uploadStatus: 'ready', scheduledPublishStatus: 'published' }, listed: true, open: true, mediaPublic: true },
	{ name: 'hidden by moderation', video: { uploadStatus: 'ready', isHidden: true }, listed: false, open: false, mediaPublic: false },
	{ name: 'deleted', video: { uploadStatus: 'ready', isDeleted: true }, listed: false, open: false, mediaPublic: false },
	{ name: 'in a deleted channel', video: { uploadStatus: 'ready', markedForDeletion: true }, listed: false, open: false, mediaPublic: false },
	// Pre-publication review (wiki AUN-VIDEO-REVIEW): the gate is isVideoReady
	{ name: 'review: automated check running', video: { uploadStatus: 'ready', review: { status: 'checking', reviewId: 'r', timing: 'pre', since: 'x' } }, listed: false, open: false, mediaPublic: true },
	{ name: 'review: held for a person', video: { uploadStatus: 'ready', review: { status: 'in_review', reviewId: 'r', timing: 'pre', since: 'x' } }, listed: false, open: false, mediaPublic: false },
	{ name: 'review: rejected', video: { uploadStatus: 'ready', review: { status: 'rejected', reviewId: 'r', timing: 'pre', since: 'x' } }, listed: false, open: false, mediaPublic: false },
	{ name: 'review: appealed', video: { uploadStatus: 'ready', review: { status: 'appealed', reviewId: 'r', timing: 'pre', since: 'x' } }, listed: false, open: false, mediaPublic: false },
	{ name: 'review: approved', video: { uploadStatus: 'ready', review: { status: 'approved', reviewId: 'r', timing: 'pre', since: 'x' } }, listed: true, open: true, mediaPublic: true },
	{ name: 'review: trusted channel, post-hoc', video: { uploadStatus: 'ready', review: { status: 'post_review', reviewId: 'r', timing: 'post', since: 'x' } }, listed: true, open: true, mediaPublic: true },
	{ name: 'review: approved but still processing', video: { uploadStatus: 'processing', review: { status: 'approved', reviewId: 'r', timing: 'pre', since: 'x' } }, listed: false, open: false, mediaPublic: true },
	{ name: 'review: unlisted and held', video: { uploadStatus: 'ready', isPublic: false, isUnlisted: true, review: { status: 'in_review', reviewId: 'r', timing: 'pre', since: 'x' } }, listed: false, open: false, mediaPublic: false },
];

const fixture = (video: Record<string, unknown>) => videoFixture({ id: 'v1', userId: OWNER, channelId: 'ch1', ...video }) as never;

describe('every surface follows the shared rule (#1241)', () => {
	for (const state of STATES) {
		it(state.name, () => {
			const v = fixture(state.video);
			// The rule itself
			assert.equal(isVideoPubliclyVisible(v), state.listed, 'isVideoPubliclyVisible');
			assert.equal(isVideoOpenToAnyone(v), state.open, 'isVideoOpenToAnyone');
			assert.equal(isVideoMediaPublic(v), state.mediaPublic, 'isVideoMediaPublic');
			// Listing surfaces
			assert.equal(isVideoListedFor(v, 'usr_someone_else'), state.listed, 'lists (isVideoListedFor)');
			assert.equal(isDiscoverable(v), state.listed, 'discovery / trending');
			assert.equal(isListableVideo(v), state.listed, 'channel sections');
			assert.equal(isVideoSearchable(v), state.listed, 'search projection (search, sitemap, IndexNow, feed)');
			assert.equal(isPubliclyPlayable(v), state.listed, 'www timeline / Shorts (public-play)');
			assert.equal(isAnnounceable(v), state.listed, 'subscriber notifications');
			assert.equal(isPublishedState(v), state.listed, 'publishedAt');
			// Public R2 prefix
			assert.equal(desiredAccess(v), state.mediaPublic ? 'pub' : 'priv', 'R2 access');
		});
	}

	it('the owner still lists every state except removed ones', () => {
		for (const state of STATES) {
			const removed = Boolean(state.video.isHidden || state.video.isDeleted || state.video.markedForDeletion);
			assert.equal(isVideoListedFor(fixture(state.video), OWNER), !removed, state.name);
		}
	});
});

describe('single-video reads: watch and playback (#1241)', () => {
	const videos = Object.fromEntries(STATES.map((s, i) => [`s${i}`, videoFixture({ id: `s${i}`, userId: OWNER, channelId: 'ch1', playUrl: 'https://vz.example/x/playlist.m3u8', ...s.video })]));
	const env = {
		videos: new MemoryBucket(videos),
		channels: new MemoryBucket({ ch1: { id: 'ch1', userId: OWNER, name: 'Channel' } }),
		global_settings: new MemoryBucket(),
	};
	const request = async (path: string, userId?: string) => {
		const app = new Hono();
		app.onError(errorHandler);
		app.use('*', async (c, next) => {
			if (userId) {
				c.set('auth' as never, { userId, email: `${userId}@test.local`, payload: {} } as never);
				c.set('userId' as never, userId as never);
			}
			await next();
		});
		const router = fromHono(app);
		router.get('/api/videos/:id', VideoFetch);
		router.get('/api/videos/:id/playback', VideoPlayback);
		return (await app.request(path, {}, env as never)).status;
	};

	STATES.forEach((state, i) => {
		const removed = Boolean(state.video.isHidden || state.video.isDeleted || state.video.markedForDeletion);
		it(`${state.name}: anonymous ${state.open ? 200 : 404}, another user ${state.open ? 200 : 404}, owner ${removed ? 404 : 200}`, async () => {
			for (const path of [`/api/videos/s${i}`, `/api/videos/s${i}/playback?exclude=r2&reason=manifest_4xx`]) {
				assert.equal(await request(path), state.open ? 200 : 404, `anonymous ${path}`);
				assert.equal(await request(path, 'usr_other'), state.open ? 200 : 404, `other user ${path}`);
				assert.equal(await request(path, OWNER), removed ? 404 : 200, `owner ${path}`);
			}
		});
	});
});
