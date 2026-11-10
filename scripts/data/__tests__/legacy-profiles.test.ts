import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isArabic, isLegacyId, normalizeImageUrl, pairProfiles, planProfile, type StoredProfile } from '../legacy-profiles.ts';

const LEGACY_ID = '4b623aeb45eb610c8c72cca719e0f6c7';
const USR_ID = 'usr_3a7c71348b164b84a3a4acb3962937e6';

// The production pair this was written for (2026-11-09), trimmed
const legacy: StoredProfile = {
	id: LEGACY_ID,
	email: 'owner@example.com',
	firstName: 'محمود',
	lastName: 'درويش',
	avatarUrl: `https://images.alummahnow.net//${LEGACY_ID}_avatar.jpeg`,
	coverUrl: 'https://images.alummahnow.net/d591332e_cover.jpeg',
};
const current: StoredProfile = {
	id: USR_ID,
	email: 'Owner@Example.com',
	firstName: 'Mahmoud',
	firstNameLocalized: { en: 'Mahmoud', ar: '' },
	lastName: 'Darwish',
	lastNameLocalized: { en: 'Darwish', ar: '' },
	displayName: '',
	displayNameLocalized: { en: '', ar: '' },
	avatarUrl: 'https://images.alummahnow.net/bbaaa5e7_avatar.jpeg',
	coverUrl: 'https://images.alummahnow.net/5f09f3bb_cover.jpeg',
	timezone: 'America/New_York',
	channels: [],
};

test('fills only the empty Arabic name slots; photos the user set since are kept', () => {
	const plan = planProfile(current, legacy);
	assert.deepEqual(plan.changes.map((c) => c.field), ['firstNameLocalized.ar', 'lastNameLocalized.ar']);
	assert.equal(plan.next.firstNameLocalized?.ar, 'محمود');
	assert.equal(plan.next.lastNameLocalized?.ar, 'درويش');
	assert.equal(plan.next.firstName, 'Mahmoud');
	assert.equal(plan.next.avatarUrl, current.avatarUrl);
	assert.equal(plan.next.coverUrl, current.coverUrl);
	assert.deepEqual(plan.next.channels, []);
	// the input is not modified
	assert.equal(current.firstNameLocalized?.ar, '');
});

test('is idempotent: planning the result again changes nothing', () => {
	const once = planProfile(current, legacy);
	const twice = planProfile(once.next, legacy);
	assert.deepEqual(twice.changes, []);
	assert.equal(twice.next, once.next);
});

test('fills empty photos from the legacy record, normalising the doubled slash', () => {
	const plan = planProfile({ id: USR_ID, email: 'owner@example.com', avatarUrl: '', coverUrl: undefined }, legacy);
	assert.equal(plan.next.avatarUrl, `https://images.alummahnow.net/${LEGACY_ID}_avatar.jpeg`);
	assert.equal(plan.next.coverUrl, legacy.coverUrl);
});

test('the stored fallback avatar counts as no photo; a real one is never replaced', () => {
	assert.equal(planProfile({ id: USR_ID, avatarUrl: '/avatar.png' }, legacy).next.avatarUrl, `https://images.alummahnow.net/${LEGACY_ID}_avatar.jpeg`);
	assert.equal(planProfile({ id: USR_ID, avatarUrl: 'https://images.alummahnow.net/mine.jpeg' }, legacy).next.avatarUrl, 'https://images.alummahnow.net/mine.jpeg');
});

test('a Latin legacy name fills the default field and the en slot when both are empty', () => {
	const plan = planProfile({ id: USR_ID, firstName: '', firstNameLocalized: { ar: 'سارة' } }, { id: LEGACY_ID, firstName: 'Sara' });
	assert.equal(plan.next.firstName, 'Sara');
	assert.deepEqual(plan.next.firstNameLocalized, { ar: 'سارة', en: 'Sara' });
});

test('legacy localized maps fill missing languages only', () => {
	const plan = planProfile(
		{ id: USR_ID, bio: 'Mine', bioLocalized: { en: 'Mine' } },
		{ id: LEGACY_ID, bio: 'Old', bioLocalized: { en: 'Old', ar: 'قديم' } },
	);
	assert.deepEqual(plan.next.bioLocalized, { en: 'Mine', ar: 'قديم' });
	assert.equal(plan.next.bio, 'Mine');
});

test('without a legacy record only doubled slashes are normalised', () => {
	const plan = planProfile({ id: USR_ID, coverUrl: 'https://images.alummahnow.net//x_cover.jpeg', avatarUrl: 'https://images.alummahnow.net/a.jpeg' });
	assert.deepEqual(plan.changes, [{ field: 'coverUrl', from: 'https://images.alummahnow.net//x_cover.jpeg', to: 'https://images.alummahnow.net/x_cover.jpeg' }]);
	const clean = planProfile({ id: USR_ID, avatarUrl: 'https://images.alummahnow.net/a.jpeg' });
	assert.deepEqual(clean.changes, []);
});

test('pairs on the auth email of the usr_ id (case-insensitive); unmatched or ambiguous records are left alone', () => {
	const other = { id: 'usr_00000000000000000000000000000001', email: 'b@example.com' };
	const orphan = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', email: 'gone@example.com' };
	const dupA = { id: 'usr_00000000000000000000000000000002', email: 'x' };
	const dupB = { id: 'usr_00000000000000000000000000000003', email: 'y' };
	const dupLegacy = { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', email: 'dup@example.com' };
	const auth = new Map([
		[USR_ID, 'OWNER@example.com'],
		[other.id, 'b@example.com'],
		[dupA.id, 'dup@example.com'],
		[dupB.id, 'dup@example.com'],
	]);
	const r = pairProfiles([legacy, current, other, orphan, dupA, dupB, dupLegacy, { id: 'not-a-profile-key' }], auth);
	const byId = Object.fromEntries(r.pairs.map((p) => [p.current.id, p.legacy?.id ?? null]));
	assert.deepEqual(byId, { [USR_ID]: LEGACY_ID, [other.id]: null, [dupA.id]: null, [dupB.id]: null });
	assert.deepEqual(r.unmatched, [orphan.id]);
	assert.deepEqual(r.ambiguous, ['dup@example.com']);
});

test('a usr_ profile claiming the legacy email in its editable profile field is not paired', () => {
	const intruder = { id: 'usr_00000000000000000000000000000009', email: legacy.email };
	const r = pairProfiles([legacy, intruder], new Map([[intruder.id, 'intruder@example.com']]));
	assert.deepEqual(r.pairs.map((x) => [x.current.id, x.legacy]), [[intruder.id, undefined]]);
	assert.deepEqual(r.unmatched, [LEGACY_ID]);
	// and without an auth record at all
	const none = pairProfiles([legacy, intruder], new Map());
	assert.deepEqual(none.pairs.map((p) => p.legacy), [undefined]);
});

test('only the approved fields are planned (the admin job runs what the dry run showed, nothing more)', () => {
	const plan = planProfile({ id: USR_ID, avatarUrl: '', firstNameLocalized: { ar: '' } }, legacy, { only: new Set(['firstNameLocalized.ar']) });
	assert.deepEqual(plan.changes.map((c) => c.field), ['firstNameLocalized.ar']);
	assert.equal(plan.next.avatarUrl, '');
	assert.deepEqual(planProfile(current, legacy, { only: new Set() }).changes, []);
});

test('photos are only restored from the first-party image host', () => {
	const offsite = { ...legacy, avatarUrl: 'https://evil.example/a.jpeg', coverUrl: 'http://images.alummahnow.net/c.jpeg' };
	assert.deepEqual(planProfile({ id: USR_ID, avatarUrl: '', coverUrl: '' }, offsite).changes.filter((c) => /Url$/.test(c.field)), []);
	assert.equal(planProfile({ id: USR_ID, coverUrl: '' }, { ...legacy, coverUrl: 'https://images.qa.alummahnow.net/c.jpeg' }).next.coverUrl, 'https://images.qa.alummahnow.net/c.jpeg');
});

test('helpers', () => {
	assert.equal(isLegacyId(LEGACY_ID), true);
	assert.equal(isLegacyId(USR_ID), false);
	assert.equal(isArabic('محمود'), true);
	assert.equal(isArabic('Mahmoud'), false);
	assert.equal(normalizeImageUrl('https://h//k'), 'https://h/k');
	assert.equal(normalizeImageUrl('/avatar.png'), '/avatar.png');
});
