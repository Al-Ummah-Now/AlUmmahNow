import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	applyCommentReaction,
	normalizeCommentText,
	paginateComments,
	resolveCommentAuthor,
	toCommentListItem,
} from '../src/lib/comments';
import { buildSubscriptionFeed, countSubscribers, isSubscribed } from '../src/lib/subscriptions';
import { isVideoPubliclyVisible, isVideoRemoved } from '../src/lib/visibility';
import { commentFixture } from './helpers';

describe('visibility', () => {
	it('excludes hidden, deleted and private videos', () => {
		assert.equal(isVideoPubliclyVisible({ isPublic: true }), true);
		assert.equal(isVideoPubliclyVisible({}), true);
		assert.equal(isVideoPubliclyVisible({ isHidden: true }), false);
		assert.equal(isVideoPubliclyVisible({ isDeleted: true }), false);
		assert.equal(isVideoPubliclyVisible({ isPublic: false }), false);
		assert.equal(isVideoPubliclyVisible(null), false);
		assert.equal(isVideoRemoved({ isPublic: false }), false);
		assert.equal(isVideoRemoved({ isHidden: true }), true);
	});
});

describe('paginateComments', () => {
	const comments = [
		commentFixture('a', { dateCreated: '2026-01-01T00:00:00.000Z' }),
		commentFixture('b', { dateCreated: '2026-01-03T00:00:00.000Z' }),
		commentFixture('c', { dateCreated: '2026-01-02T00:00:00.000Z' }),
		commentFixture('d', { dateCreated: '2026-01-04T00:00:00.000Z', isDeleted: true }),
		commentFixture('e', { dateCreated: '2026-01-05T00:00:00.000Z', isHidden: true }),
	];

	it('returns newest first and skips deleted/hidden comments', () => {
		const page = paginateComments(comments, 10);
		assert.deepEqual(page.items.map((c) => c.id), ['b', 'c', 'a']);
		assert.equal(page.total, 3);
		assert.equal(page.nextCursor, null);
	});

	it('paginates with an offset cursor', () => {
		const first = paginateComments(comments, 2);
		assert.deepEqual(first.items.map((c) => c.id), ['b', 'c']);
		assert.equal(first.nextCursor, '2');
		const second = paginateComments(comments, 2, first.nextCursor);
		assert.deepEqual(second.items.map((c) => c.id), ['a']);
		assert.equal(second.nextCursor, null);
	});

	it('puts pinned comments first', () => {
		const page = paginateComments([...comments, commentFixture('p', { isPinned: true, dateCreated: '2025-01-01T00:00:00.000Z' })], 10);
		assert.equal(page.items[0].id, 'p');
	});

	it('clamps invalid limits and cursors', () => {
		assert.equal(paginateComments(comments, 0, 'garbage').items.length, 3);
		assert.equal(paginateComments(comments, 1000).items.length, 3);
	});
});

describe('resolveCommentAuthor', () => {
	it('prefers the channel name and avatar', () => {
		const author = resolveCommentAuthor({ userId: 'u', channelId: 'c' }, { name: 'Chan', avatarUrl: 'a.png' }, { displayName: 'Prof', avatarUrl: 'p.png' });
		assert.deepEqual(author, { userId: 'u', channelId: 'c', displayName: 'Chan', avatarUrl: 'a.png' });
	});

	it('falls back to the profile name', () => {
		assert.equal(resolveCommentAuthor({ userId: 'u', channelId: 'c' }, null, { firstName: 'A', lastName: 'B' }).displayName, 'A B');
		assert.equal(resolveCommentAuthor({ userId: 'u', channelId: 'c' }, null, null).displayName, '');
	});
});

describe('toCommentListItem', () => {
	it('computes the like count and flag; stored dislikes are never shown or counted (2026-11-12)', () => {
		const comment = commentFixture('x', {
			likes: [{ id: '1', userId: 'u2', channelId: 'viewer' }],
			dislikes: [{ id: '2', userId: 'u3', channelId: 'other' }, { id: '3', userId: 'u2', channelId: 'viewer' }],
		});
		const item = toCommentListItem(comment, { userId: 'u1', channelId: 'ch1', displayName: 'N' }, 'viewer');
		assert.equal(item.likesCount, 1);
		assert.equal(item.dislikesCount, 0);
		assert.equal(item.isLiked, true);
		assert.equal(item.isDisliked, false);
		assert.equal(item.author.displayName, 'N');
	});

	it('handles legacy comments without reaction arrays', () => {
		const legacy = { ...commentFixture('y') } as Record<string, unknown>;
		delete legacy.likes;
		delete legacy.dislikes;
		const item = toCommentListItem(legacy as never, { userId: 'u1', channelId: 'ch1', displayName: '' }, null);
		assert.equal(item.likesCount, 0);
		assert.equal(item.isLiked, false);
	});
});

describe('applyCommentReaction', () => {
	const entry = (channelId: string) => ({ id: crypto.randomUUID(), userId: 'u', channelId, entityId: 'v:c', dateCreated: new Date().toISOString() });

	it('adds a like once and removes an opposing dislike', () => {
		const comment = commentFixture('c', { dislikes: [{ id: 'd', userId: 'u', channelId: 'me' }] });
		assert.equal(applyCommentReaction(comment, 'like', 'add', entry('me')), true);
		assert.equal(comment.likes.length, 1);
		assert.equal(comment.dislikes.length, 0);
		assert.equal(applyCommentReaction(comment, 'like', 'add', entry('me')), false);
		assert.equal(comment.likes.length, 1);
	});

	it('removes only the reacting channel', () => {
		const comment = commentFixture('c', { likes: [{ id: '1', userId: 'u', channelId: 'me' }, { id: '2', userId: 'u', channelId: 'other' }] });
		assert.equal(applyCommentReaction(comment, 'like', 'remove', entry('me')), true);
		assert.deepEqual(comment.likes.map((l: { channelId: string }) => l.channelId), ['other']);
		assert.equal(applyCommentReaction(comment, 'like', 'remove', entry('me')), false);
	});

	it('initializes missing arrays', () => {
		const comment = { ...commentFixture('c'), likes: undefined, dislikes: undefined } as never;
		assert.equal(applyCommentReaction(comment, 'dislike', 'add', entry('me')), true);
	});
});

describe('normalizeCommentText', () => {
	it('accepts text or content and trims', () => {
		assert.equal(normalizeCommentText({ text: '  hi ' }), 'hi');
		assert.equal(normalizeCommentText({ content: ' yo ' }), 'yo');
		assert.equal(normalizeCommentText({ text: '   ', content: 'fallback' }), 'fallback');
		assert.equal(normalizeCommentText({}), '');
		assert.equal(normalizeCommentText(null), '');
	});
});

describe('subscriptions', () => {
	const subs = [
		{ id: '1', userId: 'u1', channelId: 'c1' },
		{ id: '2', userId: 'u1', channelId: 'c2' },
		{ id: '3', userId: 'u2', channelId: 'c3' },
	];

	it('checks status by channel when provided, else by user', () => {
		assert.equal(isSubscribed(subs, { userId: 'u1', channelId: 'c2' }), true);
		assert.equal(isSubscribed(subs, { userId: 'u1', channelId: 'c9' }), false);
		assert.equal(isSubscribed(subs, { userId: 'u2' }), true);
		assert.equal(isSubscribed(undefined, { userId: 'u2' }), false);
	});

	it('counts distinct subscriber channels', () => {
		assert.equal(countSubscribers([...subs, { id: '4', userId: 'u1', channelId: 'c1' }]), 3);
		assert.equal(countSubscribers(null), 0);
	});

	it('builds a newest-first feed of visible videos from subscribed channels', () => {
		const videos = [
			{ id: 'a', channelId: 's1', dateCreated: '2026-01-01T00:00:00Z' },
			{ id: 'b', channelId: 's2', dateCreated: '2026-01-03T00:00:00Z' },
			{ id: 'c', channelId: 'x', dateCreated: '2026-01-04T00:00:00Z' },
			{ id: 'd', channelId: 's1', dateCreated: '2026-01-05T00:00:00Z', isHidden: true },
			{ id: 'e', channelId: 's1', dateCreated: '2026-01-06T00:00:00Z', isPublic: false },
			{ id: 'f', channelId: 's1', dateCreated: '2026-01-07T00:00:00Z', scheduledPublishStatus: 'scheduled' },
			{ id: 'g', channelId: 's2', dateCreated: '2026-01-02T00:00:00Z' },
		];
		const page = buildSubscriptionFeed(videos, ['s1', 's2'], 2);
		assert.deepEqual(page.items.map((v) => v.id), ['b', 'g']);
		assert.equal(page.total, 3);
		assert.equal(page.nextCursor, '2');
		assert.deepEqual(buildSubscriptionFeed(videos, ['s1', 's2'], 2, '2').items.map((v) => v.id), ['a']);
	});
});

describe('video view carries the channel verification badge (Epic 6.1)', () => {
	it('channelIsVerified follows the channel, false without one', async () => {
		const { transformVideoToView } = await import('../src/lib/transformations');
		const { videoFixture } = await import('./helpers');
		const video = videoFixture() as never;
		assert.equal(transformVideoToView(video, { id: 'c', name: 'Noor', isVerified: true } as never).channelIsVerified, true);
		assert.equal(transformVideoToView(video, { id: 'c', name: 'Noor' } as never).channelIsVerified, false);
		assert.equal(transformVideoToView(video, null).channelIsVerified, false);
	});
});
