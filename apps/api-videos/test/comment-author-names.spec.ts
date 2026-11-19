import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommentAuthor } from '../src/lib/comments';
import { channelParams } from '../src/lib/channelName';
import { localizedDisplayNames, type PostComment } from '@al-ummah/shared-types';
import { withAuthorNames } from '../src/endpoints/community/post-comment-helpers';
import { MemoryBucket } from './helpers';

/**
 * #1610 / #1618: comments showed the author's English (or saved) name on Arabic pages. Every payload
 * that names a channel or a person as an author now carries the current name per language.
 */
const channel = { id: 'ch-1', name: 'Community Corner', nameLocalized: { en: 'Community Corner', ar: 'ركن المجتمع' }, avatarUrl: 'https://cdn/logo.jpg' };

describe('comment authors', () => {
	it('a channel author carries the channel name per language', () => {
		const author = resolveCommentAuthor({ userId: 'u1', channelId: 'ch-1' }, channel, null);
		assert.equal(author.displayName, 'Community Corner');
		assert.deepEqual(author.displayNameLocalized, { en: 'Community Corner', ar: 'ركن المجتمع' });
	});

	it('a channel without localized names sends the default only', () => {
		const author = resolveCommentAuthor({ userId: 'u1', channelId: 'ch-2' }, { name: 'Noor' }, null);
		assert.equal(author.displayName, 'Noor');
		assert.equal(author.displayNameLocalized, undefined);
	});

	it('a person author carries their name per language when the profile has localized names', () => {
		const profile = { displayName: 'Amina Yusuf', displayNameLocalized: { en: 'Amina Yusuf', ar: 'أمينة يوسف' } };
		const author = resolveCommentAuthor({ userId: 'u1', channelId: null }, null, profile);
		assert.equal(author.displayName, 'Amina Yusuf');
		assert.deepEqual(author.displayNameLocalized, { en: 'Amina Yusuf', ar: 'أمينة يوسف' });
	});

	it('localizedDisplayNames fills the other language by the display-name rule', () => {
		assert.deepEqual(localizedDisplayNames({ displayName: 'Amina', firstNameLocalized: { ar: 'أمينة' } }), { en: 'Amina', ar: 'Amina' });
		assert.deepEqual(localizedDisplayNames({ displayName: 'Amina' }), {});
	});
});

describe('post comments', () => {
	const base = { postId: 'p1', content: 'hi', channelVerified: false, likes: 0, repliesCount: 0, isPinned: false, isEdited: false, isHeartedByCreator: false, createdAt: '2026-11-19T00:00:00Z' };
	const asChannel = { ...base, id: 'c1', userId: 'u1', channelId: 'ch-1', userDisplayName: 'Old name' } as PostComment;
	const asPerson = { ...base, id: 'c2', userId: 'u2', channelId: 'u2', userDisplayName: 'Sara (old)' } as PostComment;
	const unknownPerson = { ...base, id: 'c4', userId: 'u9', channelId: 'u9', userDisplayName: 'Kept' } as PostComment;
	const sara = { displayName: 'Sara Ahmed', displayNameLocalized: { en: 'Sara Ahmed', ar: 'سارة أحمد' } };
	const deleted = { ...base, id: 'c3', userId: 'u1', channelId: 'ch-1', userDisplayName: '[deleted]', deletedAt: '2026-11-19T01:00:00Z' } as PostComment;

	it("current names per language: the channel's, or the person's by the display-name rule; deleted and unreadable keep theirs", async () => {
		const env = {
			channels: new MemoryBucket({ 'ch-1': channel }) as unknown as R2Bucket,
			profiles: new MemoryBucket({ u2: sara }) as unknown as R2Bucket,
		};
		const [a, b, c, d] = await withAuthorNames(env, [asChannel, asPerson, deleted, unknownPerson]);
		assert.equal(a.userDisplayName, 'Community Corner');
		assert.deepEqual(a.userDisplayNameLocalized, { en: 'Community Corner', ar: 'ركن المجتمع' });
		assert.equal(b.userDisplayName, 'Sara Ahmed');
		assert.deepEqual(b.userDisplayNameLocalized, { en: 'Sara Ahmed', ar: 'سارة أحمد' });
		assert.deepEqual(c, deleted);
		assert.deepEqual(d, unknownPerson);
	});
});

describe('notification params', () => {
	it('name a channel in every language it has', () => {
		assert.deepEqual(channelParams('actorName', channel), { actorName: 'Community Corner', actorName_en: 'Community Corner', actorName_ar: 'ركن المجتمع' });
		assert.deepEqual(channelParams('channel', { name: 'Noor' }), { channel: 'Noor' });
	});
});
