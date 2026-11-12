/**
 * resolveDisplayName: the one rule for the name a user is shown by
 * (owner rule 2026-11-12: "display name should be the first and last as a fallback").
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDisplayName } from '@al-ummah/shared-types';

describe('resolveDisplayName', () => {
	it('prefers the display name in the page language', () => {
		const p = { displayName: 'Plain', displayNameLocalized: { en: 'English', ar: 'عربي' }, firstName: 'A', lastName: 'B' };
		assert.equal(resolveDisplayName(p, 'en'), 'English');
		assert.equal(resolveDisplayName(p, 'ar'), 'عربي');
		assert.equal(resolveDisplayName(p, 'ar-EG'), 'عربي');
	});

	it('falls back to the plain display name', () => {
		assert.equal(resolveDisplayName({ displayName: 'Plain', displayNameLocalized: { ar: 'عربي' } }, 'en'), 'Plain');
		assert.equal(resolveDisplayName({ displayName: 'Plain', displayNameLocalized: { en: '  ' } }, 'en'), 'Plain');
		assert.equal(resolveDisplayName({ displayName: 'Plain' }), 'Plain');
	});

	it('uses first + last when the display name is empty (the owner\'s own profile)', () => {
		const owner = { displayName: '', firstName: 'Mahmoud', lastName: 'Darwish', email: 'someone@example.org' };
		assert.equal(resolveDisplayName(owner, 'en'), 'Mahmoud Darwish');
		assert.equal(resolveDisplayName(owner, 'ar'), 'Mahmoud Darwish');
		assert.equal(resolveDisplayName({ displayName: '   ', displayNameLocalized: { en: '', ar: ' ' }, firstName: 'Mahmoud', lastName: 'Darwish' }, 'en'), 'Mahmoud Darwish');
		assert.equal(resolveDisplayName({ displayName: undefined, firstName: 'Mahmoud', lastName: 'Darwish' }, 'en'), 'Mahmoud Darwish');
		assert.equal(resolveDisplayName({ displayName: null, firstName: 'Mahmoud', lastName: 'Darwish' }, 'en'), 'Mahmoud Darwish');
	});

	it('uses whichever of first and last exists, trimmed', () => {
		assert.equal(resolveDisplayName({ displayName: '', firstName: '  Mahmoud ', lastName: '' }), 'Mahmoud');
		assert.equal(resolveDisplayName({ displayName: '', firstName: ' ', lastName: ' Darwish' }), 'Darwish');
		assert.equal(resolveDisplayName({ firstName: 'Mahmoud   S.', lastName: 'Darwish' }), 'Mahmoud S. Darwish');
	});

	it('uses localized first and last names in the page language', () => {
		const p = { firstName: 'Mahmoud', lastName: 'Darwish', firstNameLocalized: { ar: 'محمود' }, lastNameLocalized: { ar: 'درويش' } };
		assert.equal(resolveDisplayName(p, 'ar'), 'محمود درويش');
		assert.equal(resolveDisplayName(p, 'en'), 'Mahmoud Darwish');
	});

	it('a plain display name beats a localized first + last', () => {
		assert.equal(resolveDisplayName({ displayName: 'Plain', firstNameLocalized: { ar: 'محمود' } }, 'ar'), 'Plain');
	});

	it('an Arabic-only profile still has a name on an English page', () => {
		assert.equal(resolveDisplayName({ displayName: '', displayNameLocalized: { ar: 'محمود' } }, 'en'), 'محمود');
		assert.equal(resolveDisplayName({ firstNameLocalized: { ar: 'محمود' }, lastNameLocalized: { ar: 'درويش' } }, 'en'), 'محمود درويش');
		assert.equal(resolveDisplayName({ displayNameLocalized: { ar: 'محمود' } }, 'ar'), 'محمود');
		// with no locale at all
		assert.equal(resolveDisplayName({ displayNameLocalized: { ar: 'محمود' } }), 'محمود');
	});

	it('first + last in the page language beat a display name in another language', () => {
		assert.equal(resolveDisplayName({ displayNameLocalized: { ar: 'محمود' }, firstName: 'Mahmoud', lastName: 'Darwish' }, 'en'), 'Mahmoud Darwish');
	});

	it('another language: English before Arabic before the rest', () => {
		assert.equal(resolveDisplayName({ displayNameLocalized: { fr: 'Fr', ar: 'عربي', en: 'English' } }, 'ur'), 'English');
		assert.equal(resolveDisplayName({ displayNameLocalized: { fr: 'Fr', ar: 'عربي' } }, 'en'), 'عربي');
	});

	it('has no @handle step: handles belong to channels, so a legacy profile userName is not a name', () => {
		assert.equal(resolveDisplayName({ displayName: '', firstName: '', lastName: ' ', userName: 'mahmoud' } as never, 'en'), '');
		assert.equal(resolveDisplayName({ handle: 'mahmoud' } as never), '');
		assert.equal(resolveDisplayName({ firstName: 'Mahmoud', lastName: 'Darwish', userName: 'm' } as never), 'Mahmoud Darwish');
	});

	it('never returns the email', () => {
		assert.equal(resolveDisplayName({ displayName: '', email: 'a@b.c' } as never, 'en'), '');
		assert.equal(resolveDisplayName(null), '');
		assert.equal(resolveDisplayName(undefined, 'ar'), '');
		assert.equal(resolveDisplayName({}), '');
	});

	it('ignores non-string values', () => {
		assert.equal(resolveDisplayName({ displayName: 42 as never, displayNameLocalized: 'x' as never, firstName: 'A' }), 'A');
	});

});

describe('API responses use the resolved name', () => {
	const owner = { displayName: '', firstName: 'Mahmoud', lastName: 'Darwish', email: 'owner@example.org' };

	it('admin user rows (lists, detail, pickers, creators)', async () => {
		const { toUserRow } = await import('../src/lib/admin/directory');
		const row = toUserRow('u1', owner as never, false);
		assert.equal(row.displayName, 'Mahmoud Darwish');
		assert.equal(row.email, 'owner@example.org');
		// No name: empty (the page shows the email); a legacy userName stays in its own field
		const bare = toUserRow('u2', { displayName: ' ', userName: 'legacy', email: 'b@c.d' } as never, false);
		assert.equal(bare.displayName, '');
		assert.equal(bare.userName, 'legacy');
	});

	it('comment authors: channel name, else the profile\'s resolved name, never the email', async () => {
		const { resolveCommentAuthor } = await import('../src/lib/comments');
		const comment = { userId: 'u1', channelId: 'c1' };
		assert.equal(resolveCommentAuthor(comment, { name: 'Channel' }, owner).displayName, 'Channel');
		assert.equal(resolveCommentAuthor(comment, { name: '  ' }, owner).displayName, 'Mahmoud Darwish');
		assert.equal(resolveCommentAuthor(comment, null, { displayName: '', email: 'x@y.z' } as never).displayName, '');
	});

	it('user Bunny collections are named after the resolved name', async () => {
		const { userCollectionName } = await import('../src/lib/channelCollection');
		assert.equal(userCollectionName(owner as never, 'u1'), 'Mahmoud Darwish');
		assert.equal(userCollectionName({} as never, 'u1'), 'User u1');
	});
});
