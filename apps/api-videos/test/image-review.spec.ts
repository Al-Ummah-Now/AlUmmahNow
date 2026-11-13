/**
 * Image review (VR16; docs/specs/VIDEO-REVIEW.md §8): a post with images is held whole until it
 * clears; an avatar or banner waits in pendingImages and never shows to others before it is clean.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, VIDEO_REVIEW_SETTINGS_KEY, clearVideoReviewSettingsCache, isPostHeldByReview, projectPost } from '@al-ummah/shared-types';
import { applyImageResult, imageGate, newImagePatch } from '../src/lib/review/images';
import { transformChannelToView } from '../src/lib/transformations';
import { MemoryBucket, MemoryQueue } from './helpers';

beforeEach(() => clearVideoReviewSettingsCache());

function env(mode = 'enforce', allowed = 'true') {
	const global_settings = new MemoryBucket();
	global_settings.store.set(VIDEO_REVIEW_SETTINGS_KEY, JSON.stringify({ mode }));
	return {
		global_settings,
		VIDEO_REVIEW_ALLOWED: allowed,
		MODERATION_QUEUE: new MemoryQueue(),
		queue: new MemoryQueue(),
		channels: new MemoryBucket({ ch1: { id: 'ch1', name: 'C', userId: 'u1', avatarUrl: 'https://images.alummahnow.net/old.jpg' } }),
		profiles: new MemoryBucket({ u1: { id: 'u1', avatarUrl: 'https://images.alummahnow.net/me.jpg' } }),
		community_posts: new MemoryBucket({ 'posts/ch1/p1.json': { id: 'p1', channelId: 'ch1', userId: 'u1', content: 'Hello', status: 'published', visibility: 'public', createdAt: 'x', review: { status: 'checking', reviewId: 'r1', timing: 'pre', since: 'x' } } }),
	};
}

describe('the gate', () => {
	it('mode off or outside production: images apply at once, no scan', async () => {
		const off = await imageGate(env('off') as never);
		assert.deepEqual(newImagePatch(off, 'avatar', 'https://x/new.jpg', undefined), { patch: { avatarUrl: 'https://x/new.jpg' }, reviewId: null });
		clearVideoReviewSettingsCache();
		const qa = await imageGate(env('enforce', 'false') as never);
		assert.equal(qa.holds, false);
		assert.equal(qa.scans, false);
	});
	it('enforce: the new avatar waits in pendingImages; another pending field is kept', async () => {
		const gate = await imageGate(env() as never);
		const r = newImagePatch(gate, 'avatar', 'https://x/new.jpg', { coverUrl: { url: 'b', reviewId: 'rb', since: 's', status: 'checking' } }, 'r9');
		assert.equal(r.reviewId, 'r9');
		assert.equal((r.patch as any).avatarUrl, undefined, 'the live avatar is not replaced yet');
		assert.equal((r.patch as any).pendingImages.avatarUrl.url, 'https://x/new.jpg');
		assert.ok((r.patch as any).pendingImages.coverUrl);
	});
	it('shadow: applied at once, but scanned (recorded only)', async () => {
		const gate = await imageGate(env('shadow') as never);
		const r = newImagePatch(gate, 'banner', 'https://x/b.jpg', undefined);
		assert.deepEqual(r.patch, { coverUrl: 'https://x/b.jpg' });
		assert.ok(r.reviewId);
	});
});

describe('results', () => {
	it('a clean avatar is swapped in; views never carry a pending URL', async () => {
		const e = env();
		e.channels.store.set('ch1', JSON.stringify({ id: 'ch1', name: 'C', userId: 'u1', avatarUrl: 'https://images.alummahnow.net/old.jpg', pendingImages: { avatarUrl: { url: 'https://images.alummahnow.net/new.jpg', reviewId: 'r2', since: 's', status: 'checking' } } }));
		const view = transformChannelToView(e.channels.read('ch1') as never) as Record<string, any>;
		assert.equal(view.avatarUrl, 'https://images.alummahnow.net/old.jpg');
		assert.deepEqual(view.pendingImages, { avatarUrl: 'checking' });
		assert.equal(JSON.stringify(view).includes('new.jpg'), false);
		assert.deepEqual(await applyImageResult(e as never, { subject: 'avatar', subjectId: 'ch1', reviewId: 'r2', result: 'approve' }), { applied: true });
		const ch = e.channels.read('ch1');
		assert.equal(ch.avatarUrl, 'https://images.alummahnow.net/new.jpg');
		assert.equal(ch.pendingImages, undefined);
	});
	it('an NSFW avatar stays pending for a person, then a rejection drops it', async () => {
		const e = env();
		e.profiles.store.set('u1', JSON.stringify({ id: 'u1', avatarUrl: 'https://images.alummahnow.net/me.jpg', pendingImages: { avatarUrl: { url: 'https://images.alummahnow.net/bad.jpg', reviewId: 'r3', since: 's', status: 'checking' } } }));
		await applyImageResult(e as never, { subject: 'profile_picture', subjectId: 'u1', reviewId: 'r3', result: 'hold' });
		assert.equal(e.profiles.read('u1').pendingImages.avatarUrl.status, 'in_review');
		await applyImageResult(e as never, { subject: 'profile_picture', subjectId: 'u1', reviewId: 'r3', result: 'reject', reviewerId: 'rev1' });
		assert.equal(e.profiles.read('u1').avatarUrl, 'https://images.alummahnow.net/me.jpg');
		assert.equal(e.profiles.read('u1').pendingImages, undefined);
		const stale = await applyImageResult(e as never, { subject: 'profile_picture', subjectId: 'u1', reviewId: 'r3', result: 'approve' });
		assert.equal('why' in stale && stale.status, 409);
	});
	it('a held post is withheld (and not searchable) until it clears, then its subscribers are told', async () => {
		const e = env();
		const held = e.community_posts.read('posts/ch1/p1.json');
		assert.equal(isPostHeldByReview(held), true);
		assert.equal(projectPost(held), null, 'not in search while held');
		await applyImageResult(e as never, { subject: 'post', subjectId: 'ch1/p1', reviewId: 'r1', result: 'approve' });
		const post = e.community_posts.read('posts/ch1/p1.json');
		assert.equal(post.review.status, 'approved');
		assert.equal(isPostHeldByReview(post), false);
		assert.equal(e.queue.messages.filter((m: any) => m.type === MessageType.CommunityPostCreated).length, 1);
	});
	it('a rejected post stays withheld and its author is told why', async () => {
		const e = env();
		await applyImageResult(e as never, { subject: 'post', subjectId: 'ch1/p1', reviewId: 'r1', result: 'hold' });
		await applyImageResult(e as never, { subject: 'post', subjectId: 'ch1/p1', reviewId: 'r1', result: 'reject', reviewerId: 'rev1', reasonCode: 'sexual' });
		const post = e.community_posts.read('posts/ch1/p1.json');
		assert.equal(post.review.status, 'rejected');
		assert.equal(isPostHeldByReview(post), true);
		const notice = e.queue.messages.find((m: any) => m.type === MessageType.NotificationCreate);
		assert.equal(notice.payload.notificationKey, 'reviewRejected');
		assert.equal(e.queue.messages.filter((m: any) => m.type === MessageType.CommunityPostCreated).length, 0);
	});
});
