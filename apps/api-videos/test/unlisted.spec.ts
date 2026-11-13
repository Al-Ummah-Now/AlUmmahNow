/**
 * Unlisted videos (owner decision D-SEO-5): open to anyone with the link, never listed.
 * Stored as isPublic false + isUnlisted true, so every list that requires isPublic keeps them
 * out; single-video reads by id admit them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { errorHandler } from '../src/middleware/error-handler';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { applyVisibilityInput, isRestrictedVideo, isVideoPubliclyVisible, isVideoListedFor, uploadVisibility } from '../src/lib/visibility';
import { applyBulkChanges } from '../src/lib/bulkEdit';
import { videoVisibility } from '@al-ummah/shared-types';
import { MemoryBucket, videoFixture } from './helpers';

const OWNER = 'usr_owner';

describe('visibility helpers', () => {
	it('names the three visibilities from the stored flags', () => {
		assert.equal(videoVisibility({ isPublic: true }), 'public');
		assert.equal(videoVisibility({}), 'public');
		assert.equal(videoVisibility({ isPublic: false }), 'private');
		assert.equal(videoVisibility({ isPublic: false, isUnlisted: true }), 'unlisted');
		assert.equal(videoVisibility({ isPublic: true, isUnlisted: true }), 'public');
	});

	it('keeps unlisted videos out of every list but open by link', () => {
		const unlisted = videoFixture({ isPublic: false, isUnlisted: true });
		assert.equal(isVideoPubliclyVisible(unlisted), false);
		assert.equal(isVideoListedFor(unlisted, 'someone-else'), false);
		assert.equal(isRestrictedVideo(unlisted), false);
		assert.equal(isRestrictedVideo(videoFixture({ isPublic: false })), true);
		assert.equal(isRestrictedVideo(videoFixture({ isPublic: true })), false);
	});

	it('applies create and update input consistently', () => {
		assert.deepEqual(applyVisibilityInput({ isPublic: true }, { visibility: 'unlisted' }), { isPublic: false, isUnlisted: true });
		assert.deepEqual(applyVisibilityInput({ isPublic: false, isUnlisted: true }, { visibility: 'public' }), { isPublic: true });
		assert.deepEqual(applyVisibilityInput({ isPublic: false, isUnlisted: true }, { visibility: 'private' }), { isPublic: false });
		assert.deepEqual(applyVisibilityInput({ isPublic: true }, { isUnlisted: true }), { isPublic: false, isUnlisted: true });
		assert.deepEqual(applyVisibilityInput({ isPublic: false, isUnlisted: true }, { isPublic: true }), { isPublic: true });
		assert.deepEqual(applyVisibilityInput({ isPublic: false, isUnlisted: true }, {}), { isPublic: false, isUnlisted: true }, 'untouched');
		assert.deepEqual(uploadVisibility(true, 'unlisted', true), { isPublic: false }, 'a draft is always private');
		assert.deepEqual(uploadVisibility(false, 'unlisted', true), { isPublic: false, isUnlisted: true });
		assert.deepEqual(uploadVisibility(false, undefined, undefined), { isPublic: true });
	});

	it('bulk edit can set any visibility and publishing as unlisted ends a draft', () => {
		const r = applyBulkChanges(videoFixture({ isPublic: false, isDraft: true }) as never, { visibility: 'unlisted' }, '2026-11-13T00:00:00.000Z');
		assert.ok(r.ok);
		if (!r.ok) return;
		assert.equal((r.video as { isPublic?: boolean }).isPublic, false);
		assert.equal((r.video as { isUnlisted?: boolean }).isUnlisted, true);
		assert.equal((r.video as { isDraft?: boolean }).isDraft, false);
		assert.ok(r.fields.includes('isUnlisted'));
	});
});

describe('GET /api/videos/:id', () => {
	const env = {
		videos: new MemoryBucket({
			pub: videoFixture({ id: 'pub', userId: OWNER, channelId: 'ch1' }),
			unl: videoFixture({ id: 'unl', userId: OWNER, channelId: 'ch1', isPublic: false, isUnlisted: true }),
			priv: videoFixture({ id: 'priv', userId: OWNER, channelId: 'ch1', isPublic: false }),
		}),
		channels: new MemoryBucket({ ch1: { id: 'ch1', userId: OWNER, name: 'Channel' } }),
	};
	const get = async (path: string, userId?: string) => {
		const app = new Hono();
		app.onError(errorHandler);
		app.use('*', async (c, next) => {
			if (userId) {
				c.set('auth' as never, { userId, email: `${userId}@test.local`, payload: {} } as never);
				c.set('userId' as never, userId as never);
			}
			await next();
		});
		fromHono(app).get('/api/videos/:id', VideoFetch);
		return app.request(path, {}, env as never);
	};

	it('opens an unlisted video to anyone with the link', async () => {
		const res = await get('/api/videos/unl');
		assert.equal(res.status, 200);
		const body = (await res.json()) as { isUnlisted?: boolean; isPublic?: boolean };
		assert.equal(body.isUnlisted, true);
		assert.equal(body.isPublic, false);
	});

	it('keeps a private video hidden from others (404) and open to its owner', async () => {
		assert.equal((await get('/api/videos/priv')).status, 404);
		assert.equal((await get('/api/videos/priv', 'usr_other')).status, 404);
		assert.equal((await get('/api/videos/priv', OWNER)).status, 200);
		assert.equal((await get('/api/videos/pub')).status, 200);
	});
});
