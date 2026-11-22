/**
 * Creators admin: the effect sentence every tier confirmation states, the
 * tier form's validation (CREATOR_TIER_BOUNDS), the list query, friendly
 * error messages, en/ar strings, and the rendered row control, table and
 * notice (super admins locked, selection, limit-hit links).
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { CREATOR_TIER_BOUNDS, DEFAULT_CREATOR_TIER, DEFAULT_MEMBER_TIER, DEFAULT_UNLIMITED_TIER, formatNumber, type AdminUserRow, type CreatorTier, type CreatorTiersList } from '@al-ummah/shared-types';
import {
  creatorsToUsersHref,
  defaultTierName,
  isUnexpectedFailure,
  parseUserTierFilter,
  tierActionMessage,
  tierChangeMessage,
  tierEffect,
  tierFormPayload,
  tierToForm,
  validateTierForm,
  type TierFormValues, tierLabel, arabicMissing } from '../src/lib/creator-tiers';
import { memberCounts } from '../src/components/creators/CreatorTiersView';
import { createTranslator } from '../src/i18n/translate';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { CaptionGrantControls } from '../src/components/creators/CaptionGrantControls';
import { captionUsageFrom } from '@al-ummah/shared-types';
import { CreatorTierControl } from '../src/components/creators/CreatorTierControl';
import { UsersTable } from '../src/components/users/UsersTable';
import { LimitHitsNotice } from '../src/components/creators/LimitHitsNotice';
import { TierEditor } from '../src/components/creators/TierEditor';
import { TierRankList } from '../src/components/creators/TierRankList';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

// tsx compiles the components' JSX in classic mode (tsconfig jsx: preserve): they read the global React
(globalThis as unknown as { React: unknown }).React = React;

const ARABIC = /[؀-ۿ]/;
const tEn = createTranslator('en');
const tAr = createTranslator('ar');

const CREATOR: CreatorTier = { ...DEFAULT_CREATOR_TIER, perHour: 300, perDay: 2000, maxConcurrent: 20, maxChannels: 3, captionMinutesMonth: 0, updatedAt: null, updatedBy: null };
const UNLIMITED: CreatorTier = { ...DEFAULT_UNLIMITED_TIER, updatedAt: null, updatedBy: null };
const MEMBER: CreatorTier = { ...DEFAULT_MEMBER_TIER, updatedAt: null, updatedBy: null };
const TIERS = [MEMBER, CREATOR, UNLIMITED];

const setTier = async () => ({ ok: true as const, data: null });
const bulkSetTier = async () => ({ ok: true as const, data: { changed: [], unchanged: [], skippedSuperAdmin: [] } });
const tierActions = { save: setTier, remove: setTier };

/** react-dom/server and this app resolve different @types/react copies; build elements through one typed helper. */
function el<P extends object>(component: (props: P) => unknown, props: P): React.ReactElement {
  return React.createElement(component as unknown as React.FC<P>, props);
}

function render(element: React.ReactElement, locale: 'en' | 'ar' = 'en'): string {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, element) as never);
}

describe('tier effect (stated in every confirmation)', () => {
  it('states the limits, with numbers formatted for the locale', () => {
    assert.equal(
      tierEffect(CREATOR, tEn, 'en'),
      'They can upload up to 300 videos per hour and 2,000 per day (20 starting at once), and own up to 3 channels. Live: 20 hours a month, one stream at a time, up to 240 minutes per stream.',
    );
    // Live: off says so; several at once; a tier from before live says nothing about it
    assert.equal(tierEffect({ ...CREATOR, live: false }, tEn, 'en').endsWith('No live streaming.'), true);
    assert.equal(tierEffect({ ...CREATOR, liveMaxConcurrent: 3 }, tEn, 'en').includes('Live: 20 hours a month, 3 at once, up to 240 minutes per stream.'), true);
    assert.equal(tierEffect({ ...CREATOR, live: undefined }, tEn, 'en').includes('Live'), false);
    assert.match(tierEffect({ ...CREATOR, live: false }, tAr, 'ar'), /بلا بث مباشر/);
    assert.equal(tierEffect({ ...CREATOR, maxChannels: null, live: undefined }, tEn, 'en').endsWith('own any number of channels.'), true);
    // Caption minutes join the sentence only when the tier gives some
    assert.equal(tierEffect({ ...CREATOR, captionMinutesMonth: 600 }, tEn, 'en').endsWith('Caption minutes: 600 a month.'), true);
    assert.equal(tierEffect({ ...CREATOR, audioTracksPerVideo: 3 }, tEn, 'en').endsWith('Audio tracks per video: 3.'), true);
    assert.equal(tierEffect(UNLIMITED, tEn, 'en'), 'They can upload and create channels with no limits.');
    assert.equal(tierEffect(null, tEn, 'en'), 'They will not be able to upload or create channels.');
    const arabic = tierEffect(CREATOR, tAr, 'ar');
    assert.match(arabic, ARABIC);
    assert.equal(arabic.includes(formatNumber('ar', 2000)), true, 'numbers formatted for Arabic');
  });

  it('follows the tier\'s flags: Member only watches; uploads or channels alone', () => {
    assert.equal(tierEffect(MEMBER, tEn, 'en'), 'They can watch, save, comment and subscribe, but not upload or create channels.');
    assert.equal(tierEffect({ ...CREATOR, channels: false }, tEn, 'en'), 'They can upload up to 300 videos per hour and 2,000 per day (20 starting at once), but not create channels. Live: 20 hours a month, one stream at a time, up to 240 minutes per stream.');
    assert.equal(tierEffect({ ...CREATOR, uploads: false, live: false }, tEn, 'en'), 'They can own up to 3 channels, but not upload. No live streaming.');
    assert.match(tierEffect(MEMBER, tAr, 'ar'), ARABIC);
  });

  it('names who and which tier, for one user or a selection', () => {
    assert.equal(tierChangeMessage(CREATOR, tEn, 'en', { userName: 'Amina' }).startsWith('Give Amina the Creator tier? They can upload up to 300'), true);
    assert.equal(tierChangeMessage(null, tEn, 'en', { count: 4 }), 'Remove the tier from 4 selected users? They will not be able to upload or create channels.');
  });
});

describe('tier form validation (same bounds and rules as api-videos)', () => {
  const base: TierFormValues = { ...tierToForm(), id: 'gold', name: 'Gold', nameAr: 'ذهبي', description: 'For weekly teachers', descriptionAr: 'لمن يعلّم كل أسبوع', perHour: 10, perDay: 100, maxConcurrent: 5, maxChannels: 2, captionMinutesMonth: 0, audioTracksPerVideo: 0, live: true, liveHoursMonth: 20, liveMaxConcurrent: 1, liveMaxStreamMinutes: 240 };

  it('accepts a valid tier and an unlimited one without limits', () => {
    assert.deepEqual(validateTierForm(base, { create: true }), {});
    assert.deepEqual(validateTierForm({ ...base, unlimited: true, perHour: NaN }), {});
    assert.deepEqual(validateTierForm({ ...base, maxChannels: null }), {}, 'empty channels = no limit');
    assert.deepEqual(validateTierForm({ ...base, captionMinutesMonth: -1 }).captionMinutesMonth?.key, 'creators.errorRange');
    // Audio tracks per video (wiki AUN-MULTI-AUDIO MA9): 0 to 16
    assert.deepEqual(validateTierForm({ ...base, audioTracksPerVideo: 17 }).audioTracksPerVideo?.key, 'creators.errorRange');
    assert.equal(validateTierForm({ ...base, audioTracksPerVideo: 16 }).audioTracksPerVideo, undefined);
  });

  it('checks the live limits only while live is allowed', () => {
    const bad = { ...base, liveHoursMonth: 0, liveMaxConcurrent: 101, liveMaxStreamMinutes: 5 };
    assert.deepEqual(Object.keys(validateTierForm(bad)).sort(), ['liveHoursMonth', 'liveMaxConcurrent', 'liveMaxStreamMinutes']);
    assert.deepEqual(validateTierForm({ ...bad, live: false }), {});
    assert.deepEqual(validateTierForm(bad).liveMaxStreamMinutes, { key: 'creators.errorRange', params: { min: 10, max: 1440 } });
  });

  it('flags each field outside CREATOR_TIER_BOUNDS, a daily limit under the hourly one, and bad names; no id to type', () => {
    const errors = validateTierForm({ ...base, perHour: 0, perDay: CREATOR_TIER_BOUNDS.perDay.max + 1, maxConcurrent: 1.5, maxChannels: 0 });
    assert.deepEqual(Object.keys(errors).sort(), ['maxChannels', 'maxConcurrent', 'perDay', 'perHour']);
    assert.deepEqual(errors.perHour, { key: 'creators.errorRange', params: { min: 1, max: 100_000 } });
    assert.equal(validateTierForm({ ...base, perHour: 50, perDay: 20 }).perDay?.key, 'creators.errorPerDay');
    assert.equal(validateTierForm({ ...base, perHour: NaN }).perHour?.key, 'creators.errorRange', 'an emptied field is an error');
    assert.equal(validateTierForm({ ...base, name: '   ' }).name?.key, 'creators.errorName');
    // Admins never type ids (api-videos makes one from the name): a new tier with no id is valid
    assert.deepEqual(validateTierForm({ ...base, id: '' }, { create: true }), {});
  });

  it('checks the Upgrade page text and order, even on an unlimited tier', () => {
    assert.deepEqual(validateTierForm({ ...base, nameAr: 'ذ'.repeat(61), description: 'x'.repeat(201) }), {
      nameAr: { key: 'creators.errorText', params: { max: 60 } },
      description: { key: 'creators.errorText', params: { max: 200 } },
    });
    assert.equal(validateTierForm({ ...base, unlimited: true, sortOrder: -1 }).sortOrder?.key, 'creators.errorRange');
    assert.equal(validateTierForm({ ...base, descriptionAr: '  ' }).descriptionAr?.key, 'creators.errorDescriptionAr', 'no fallback to the English one');
  });

  it('starts a new tier with uploads and channels on (as api-videos does) and sends empty text as null', () => {
    const fresh = tierToForm();
    assert.deepEqual([fresh.uploads, fresh.channels, fresh.requestable, fresh.sortOrder], [true, true, false, 50]);
    const member = tierToForm(MEMBER);
    assert.deepEqual([member.uploads, member.channels, member.requestable, member.nameAr], [false, false, false, 'مجاني']);
    const payload = tierFormPayload({ ...base, name: ' Gold ', nameAr: ' ', description: ' For pros ', descriptionAr: '' });
    assert.deepEqual([payload.name, payload.nameAr, payload.description, payload.descriptionAr], ['Gold', null, 'For pros', null]);
  });

  it('counts stored rows per tier; accounts not backfilled yet count on Free (they work as Free), whatever the default', () => {
    const list: CreatorTiersList = { items: TIERS, defaultTierId: 'creator', counts: { byTier: { creator: 4 }, none: 9 }, limitHits7d: 0 };
    assert.deepEqual(memberCounts(list), { creator: 4, member: 9 });
  });

  it('names the default tier by its name only (a legacy "none" reads as Free)', () => {
    const t = ((key: string) => (key === 'creators.none' ? 'None' : key)) as never;
    assert.equal(defaultTierName('member', TIERS, t), 'Free');
    assert.equal(defaultTierName('none', TIERS, t), 'Free');
    assert.equal(defaultTierName('creator', TIERS, t), 'Creator');
  });
});

describe('Users list tier filter (the old Creators page)', () => {
  it('keeps needs_tier, has_tier, hit_limit, none and tier ids and drops the rest', () => {
    for (const value of ['needs_tier', 'has_tier', 'hit_limit', 'none', 'creator', 'gold-2']) assert.equal(parseUserTierFilter(value), value);
    for (const value of ['Drop Table', '', undefined, 'assigned_', '-x']) assert.equal(parseUserTierFilter(value), '');
  });

  it('old /creators links land on the matching Users list', () => {
    assert.equal(creatorsToUsersHref({}), '/users');
    assert.equal(creatorsToUsersHref({ q: ' amina ', page: '3' }), '/users?q=amina&page=3');
    assert.equal(creatorsToUsersHref({ filter: 'needs_tier' }), '/users?tier=needs_tier');
    assert.equal(creatorsToUsersHref({ filter: 'assigned' }), '/users?tier=has_tier');
    assert.equal(creatorsToUsersHref({ filter: 'limited' }), '/users?tier=hit_limit');
    assert.equal(creatorsToUsersHref({ filter: 'all', tier: 'none' }), '/users?tier=none');
    assert.equal(creatorsToUsersHref({ filter: 'limited', tier: 'creator' }), '/users?tier=creator', 'a tier wins over the Show filter');
    assert.equal(creatorsToUsersHref({ filter: 'everyone', tier: 'Drop Table', page: '-1' }), '/users');
  });
});

describe('friendly errors', () => {
  it('maps refusals to messages and reports only network or server failures', () => {
    assert.equal(tierActionMessage({ status: 409, code: 'super_admin_tier' }), 'creators.errorSuperAdmin');
    assert.equal(tierActionMessage({ status: 404, code: 'tier_not_found' }), 'creators.errorTierGone');
    assert.equal(tierActionMessage({ status: 409, code: 'tier_in_use' }), 'creators.tierInUse');
    assert.equal(tierActionMessage({ status: 409, code: 'tier_is_default' }), 'creators.tierIsDefault');
    assert.equal(tierActionMessage({ status: 409, code: 'default_tier_deleted' }), 'creators.errorDefaultDeleted');
    assert.equal(tierActionMessage({ status: 403 }), 'creators.errorForbidden');
    assert.equal(tierActionMessage({ status: 401 }), 'errors.notAuthenticated');
    assert.equal(tierActionMessage({ status: 500, code: 'internal_error' }), 'creators.saveFailed');
    assert.equal(isUnexpectedFailure({ status: 0 }), true);
    assert.equal(isUnexpectedFailure({ status: 503 }), true);
    assert.equal(isUnexpectedFailure({ status: 409 }), false);
  });

  it('every creators string exists in English and Arabic', () => {
    assert.deepEqual(Object.keys(ar.creators).sort(), Object.keys(en.creators).sort());
    for (const [key, value] of Object.entries(ar.creators)) {
      // Placeholder-only strings ("{from} ← {to}") have no words to translate
      if (/[A-Za-z؀-ۿ]/.test(value.replace(/\{\w+\}/g, ''))) assert.match(value, ARABIC, `ar.creators.${key}`);
    }
  });
});

const row = (over: Omit<Partial<AdminUserRow>, 'creator'> & { creator?: Partial<NonNullable<AdminUserRow['creator']>> } = {}): AdminUserRow => ({
  id: 'usr_1',
  displayName: 'Amina',
  userName: 'amina',
  email: 'amina@example.com',
  avatarUrl: null,
  createdAt: '2026-11-01T00:00:00Z',
  isBanned: false,
  ...over,
  creator: { assignment: null, origin: null, assignedByName: null, needsTier: false, limitHits7d: 0, ...over.creator },
});

describe('rendered components', () => {
  it('a super admin row is locked, says why, and offers only "Change anyway"', () => {
    const html = render(
      el(CreatorTierControl, {
        userId: 'usr_owner',
        userName: 'Owner',
        current: { tierId: 'unlimited', origin: 'super_admin', assignedBy: 'system:super-admin', assignedAt: '2026-11-10T00:00:00Z' },
        tiers: TIERS,
        canManage: true,
        setTier,
      }),
    );
    assert.match(html, /Automatic: super admin/);
    assert.match(html, /locked here to avoid a downgrade by mistake/);
    assert.doesNotMatch(html, /creator-tier-select/);
    assert.match(html, /data-testid="creator-tier-unlock"/);
  });

  it('a user with content but no tier gets "Make Creator"; an admin-assigned tier shows who and when', () => {
    const needs = render(el(CreatorTierControl, { userId: 'usr_2', userName: 'Bilal', current: null, tiers: TIERS, canManage: true, needsTier: true, setTier }));
    assert.match(needs, /Make Creator/);
    assert.match(needs, /creator-tier-select/);
    const assigned = render(
      el(CreatorTierControl, {
        userId: 'usr_3',
        userName: 'Sara',
        current: { tierId: 'creator', origin: 'admin', assignedBy: 'usr_admin', assignedByName: 'Admin Name', assignedAt: '2026-11-08T00:00:00Z' },
        tiers: TIERS,
        canManage: false,
        setTier,
      }),
    );
    // Who and when once (no "an admin · Admin" doubling)
    assert.match(assigned, /Assigned by <bdi>Admin Name<\/bdi>, <bdi>Nov 8, 2026<\/bdi>/);
    assert.doesNotMatch(assigned, /<select/, 'read-only for moderators');
    // Only the admin's id stored and no name known (yet): "an admin", never the raw id
    const byId = render(
      el(CreatorTierControl, {
        userId: 'usr_3',
        userName: 'Sara',
        current: { tierId: 'creator', origin: 'admin', assignedBy: 'usr_a5ce024dc7f546b5', assignedAt: '2026-11-08T00:00:00Z' },
        tiers: TIERS,
        canManage: false,
        setTier,
      }),
    );
    assert.match(byId, /Assigned by an admin/);
    assert.doesNotMatch(byId, /usr_a5ce|Unknown user/);
  });

  it('the Users table shows each tier, disables selecting super admins, and links a limit hit to the tier on the Tiers page', () => {
    const html = render(
      el(UsersTable, {
        items: [
          row({ id: 'usr_owner', displayName: 'Owner', creator: { origin: 'super_admin', assignment: { userId: 'usr_owner', tierId: 'unlimited', source: 'admin', assignedBy: 'system:super-admin', assignedAt: '2026-11-10T00:00:00Z' } } }),
          row({ id: 'usr_c', creator: { origin: 'admin', assignment: { userId: 'usr_c', tierId: 'creator', source: 'admin', assignedBy: 'a', assignedAt: '2026-11-10T00:00:00Z' }, limitHits7d: 2 } }),
          row({ id: 'usr_new', displayName: 'New', creator: { needsTier: true } }),
        ],
        tiers: TIERS,
        canManage: true,
        setTier,
        bulkSetTier,
      }),
    );
    const owner = html.slice(html.indexOf('data-user-id="usr_owner"'), html.indexOf('data-user-id="usr_c"'));
    assert.match(owner, /data-testid="user-select"[^>]*disabled|disabled[^>]*data-testid="user-select"/);
    assert.match(html, /data-testid="users-bulk"/, 'the bulk tier change for managers');
    assert.match(html, /2 limit hits this week/);
    assert.match(html, /href="\/tiers#tier-creator"/);
    assert.match(html, /data-user-id="usr_new" data-needs-tier="true"/);
    assert.match(html, /Make Creator/);
    assert.match(html, /href="\/users\/usr_c"/, 'rows open the videos user page');
    assert.doesNotMatch(html, /auth-requests/, 'never the Auth admin');
  });

  it('the Users table is read-only without creators:manage: no selection, no bulk change, no tier select', () => {
    const html = render(el(UsersTable, { items: [row({ id: 'usr_c' })], tiers: TIERS, canManage: false, setTier, bulkSetTier }));
    assert.doesNotMatch(html, /users-bulk|user-select|creator-tier-select/);
    assert.match(html, /data-testid="user-tier-cell"/);
  });

  it('the limit-hit notice counts this week and links to who and to the limits; nothing when nobody hit one', () => {
    const notice = renderToStaticMarkup(el(LimitHitsNotice, { count: 3, t: tEn, locale: 'en' }) as never);
    assert.match(notice, /3 creators hit their upload limit this week\./);
    assert.match(notice, /href="\/users\?tier=hit_limit"/);
    assert.match(notice, /href="\/tiers"/);
    assert.equal(renderToStaticMarkup(el(LimitHitsNotice, { count: 0, t: tEn, locale: 'en' }) as never), '');
  });

  it('the tiers page shows users per tier, field help with the bounds, and keeps the shipped Unlimited unlimited; in Arabic too', () => {
    const html = render(el(TierEditor, { tiers: TIERS, counts: { member: 30, creator: 12, unlimited: 1 }, canManage: true, actions: tierActions }));
    assert.match(html, /12 users/);
    assert.match(html, /New videos a creator may start uploading in one hour\. 1 to 100,000\./);
    assert.match(html, /id="tier-creator"/);
    const unlimited = html.slice(html.indexOf('data-testid="tier-card-unlimited"'));
    assert.match(unlimited, /data-testid="tier-unlimited-unlimited"[^>]*disabled|disabled[^>]*data-testid="tier-unlimited-unlimited"/);
    assert.match(unlimited, /always stays unlimited/);
    // Free (id member), the minimum: every limit editable (unlimited too), uploads and channels off, not requestable
    const member = html.slice(html.indexOf('data-testid="tier-card-member"'), html.indexOf('data-testid="tier-card-creator"'));
    assert.doesNotMatch(member, /data-testid="tier-member-unlimited"[^>]*disabled|disabled[^>]*data-testid="tier-member-unlimited"/);
    assert.doesNotMatch(member, /checked=""[^>]*data-testid="tier-member-uploads"/);
    assert.doesNotMatch(member, /checked=""[^>]*data-testid="tier-member-requestable"|data-testid="tier-member-requestable"[^>]*checked=""/);
    assert.match(member, /value="مجاني"[^>]*data-testid="tier-member-nameAr"|data-testid="tier-member-nameAr"[^>]*value="مجاني"/);
    assert.match(member, /What the tier allows/);
    assert.doesNotMatch(member, /data-testid="tier-member-delete"/, 'shipped tiers cannot be deleted');
    const arabic = render(el(TierEditor, { tiers: TIERS, counts: { creator: 12 }, canManage: true, actions: tierActions }), 'ar');
    assert.match(arabic, new RegExp(`${formatNumber('ar', 12)} مستخدم`));
  });

  it('the Rank list shows the tiers lowest first with Move up/down (first and last disabled), and is read-only without creators:manage', () => {
    const reorder = async () => ({ ok: true as const, data: { previous: [], order: [] } });
    const html = render(el(TierRankList, { tiers: TIERS, defaultTierId: 'member', canManage: true, reorder }));
    assert.match(html, /data-order="member,creator,unlimited"/);
    assert.match(html, /aria-label="Move Free up"[^>]*disabled|disabled[^>]*aria-label="Move Free up"/);
    assert.match(html, /aria-label="Move Unlimited down"[^>]*disabled|disabled[^>]*aria-label="Move Unlimited down"/);
    assert.match(html, /draggable="true"/);
    const readOnly = render(el(TierRankList, { tiers: TIERS, canManage: false, reorder }));
    assert.doesNotMatch(readOnly, /Move Free up|draggable="true"/);
  });

  it('Delete is off on a tier users, pending invites or new sign-ups depend on, saying why with a link to them', () => {
    const pro = { ...TIERS[1], id: 'pro', name: 'Pro' };
    const html = render(el(TierEditor, { tiers: [pro], counts: { pro: 3 }, invites: { pro: 2 }, canManage: true, actions: tierActions }));
    assert.match(html, /disabled=""[^>]*data-testid="tier-pro-delete"|data-testid="tier-pro-delete"[^>]*disabled=""/);
    assert.match(html, /3 users are on this tier\. Move them first\./);
    assert.match(html, /href="\/users\?tier=pro"/);
    assert.match(html, /2 pending invites carry this tier\. Change or revoke them first\./);
    const one = render(el(TierEditor, { tiers: [pro], counts: { pro: 1 }, canManage: true, actions: tierActions }));
    assert.match(one, /One user is on this tier\. Move them first\./);
    const free = render(el(TierEditor, { tiers: [pro], counts: {}, defaultTierId: 'pro', canManage: true, actions: tierActions }));
    assert.match(free, /This tier is the default/);
    const empty = render(el(TierEditor, { tiers: [pro], counts: {}, defaultTierId: 'member', canManage: true, actions: tierActions }));
    assert.doesNotMatch(empty, /disabled=""[^>]*data-testid="tier-pro-delete"|data-testid="tier-pro-delete"[^>]*disabled=""/);
  });

  it('YouTube imports switch: on by default, saved with the form; an unlimited tier shows only the note (AUN-YT-IMPORT)', () => {
    const html = render(el(TierEditor, { tiers: [{ ...CREATOR, importCountsAgainstLimits: false }, UNLIMITED], counts: {}, canManage: true, actions: tierActions }));
    const creator = html.slice(html.indexOf('data-testid="tier-card-creator"'), html.indexOf('data-testid="tier-card-unlimited"'));
    const creatorSwitch = /<input[^>]*data-testid="tier-creator-importCountsAgainstLimits"[^>]*>/.exec(creator)![0];
    assert.doesNotMatch(creatorSwitch, /checked/);
    assert.doesNotMatch(creatorSwitch, /disabled/);
    assert.match(creator, /YouTube imports count against upload limits/);
    const unlimited = html.slice(html.indexOf('data-testid="tier-card-unlimited"'));
    assert.doesNotMatch(unlimited, /data-testid="tier-unlimited-importCountsAgainstLimits"/, 'no unusable switch on an unlimited tier');
    assert.match(unlimited, /Unlimited tiers have no upload limits, so imports never count\./);
    const newTier = html.slice(html.indexOf('data-testid="tier-card-new"'));
    assert.match(/<input[^>]*data-testid="tier-new-importCountsAgainstLimits"[^>]*>/.exec(newTier)![0], /checked/, 'a new tier counts imports');
    // The effect sentence says so when imports are free
    assert.equal(tierEffect({ ...CREATOR, importCountsAgainstLimits: false }, tEn, 'en').endsWith('Videos imported from YouTube do not count against these limits.'), true);
    assert.equal(tierEffect(CREATOR, tEn, 'en').includes('YouTube'), false);
    assert.match(tierEffect({ ...CREATOR, importCountsAgainstLimits: false }, tAr, 'ar'), /يوتيوب/);
  });
});

describe('caption minutes on the user page: overdraft and ledger', () => {
  const noop = async () => ({ ok: true as const, data: null });
  const usage = captionUsageFrom({ period: '2026-11', unlimited: false, via: 'tier', tierMinutes: 120, monthGranted: 0, monthUsed: 120, packsRemaining: 0, overdraft: 7, held: 17 });
  const ledger = [
    { id: 'job-1:settle', holdId: 'job-1', kind: 'settle' as const, minutes: -2, balanceAfter: -7, period: '2026-11', createdAt: '2026-11-14T11:00:00.000Z' },
    { id: 'job-1:start', holdId: 'job-1', kind: 'start' as const, minutes: 17, balanceAfter: -5, period: '2026-11', createdAt: '2026-11-14T10:00:00.000Z' },
  ];

  it('shows the overdraft in red instead of a negative "available", the held minutes, and each step with its signed balance', () => {
    assert.equal(usage.remaining, -7);
    const html = render(el(CaptionGrantControls, { userId: 'u1', usage, grants: [], ledger, canManage: false, grant: noop, revoke: noop }));
    assert.match(html, /data-testid="caption-minutes-overdraft"[^>]*>Over by 7 minutes\./);
    assert.doesNotMatch(html, /minutes available now/);
    assert.match(html, /17 minutes are charged to transcriptions still running/);
    assert.match(html, /Job finished · <bdi dir="ltr">\u22122<\/bdi>/);
    assert.match(html, /text-danger-fg">balance <bdi dir="ltr">\u22127<\/bdi>/);
    assert.match(html, /Job started · <bdi dir="ltr">\+17<\/bdi>/);
    const ar = render(el(CaptionGrantControls, { userId: 'u1', usage, grants: [], ledger, canManage: false, grant: noop, revoke: noop }), 'ar');
    assert.match(ar, /تجاوز الرصيد بـ ٧ من الدقائق/);
    assert.match(ar, /بدأ التفريغ/);
  });
});

describe('tier names in the admin\'s language', () => {
  it('the Arabic admin shows the Arabic name, falling back to the English one; the English admin the English one', () => {
    assert.equal(tierLabel({ name: 'Creator', nameAr: 'صانع محتوى' }, 'ar'), 'صانع محتوى');
    assert.equal(tierLabel({ name: 'Creator', nameAr: 'صانع محتوى' }, 'en'), 'Creator');
    assert.equal(tierLabel({ name: 'Scholar', nameAr: null }, 'ar'), 'Scholar');
    assert.equal(tierLabel({ name: 'Scholar', nameAr: '  ' }, 'ar'), 'Scholar');
  });
  it('the confirmation names the tier in the admin\'s language', () => {
    assert.match(tierChangeMessage({ ...CREATOR, nameAr: 'صانع محتوى' }, tAr, 'ar', { userName: 'أمينة' }), /صانع محتوى/);
  });
});

describe('localized fields (owner rule 2026-11-16)', () => {
  it('the name and the description are needed in English and in Arabic; no fallback', () => {
    const empty: TierFormValues = { ...tierToForm(), name: 'Gold' };
    const errors = validateTierForm(empty, { create: true });
    assert.deepEqual([errors.nameAr?.key, errors.description?.key, errors.descriptionAr?.key], ['creators.errorNameAr', 'creators.errorDescription', 'creators.errorDescriptionAr']);
    assert.equal(validateTierForm({ ...empty, nameAr: ' ', description: 'x', descriptionAr: 'س' }).nameAr?.key, 'creators.errorNameAr', 'spaces are empty');
  });
});

describe('the English name is English (owner review 2026-11-16)', () => {
  it('refuses an Arabic-only English name; mixed or Latin is fine', () => {
    const form: TierFormValues = { ...tierToForm(), name: 'ذهبي', nameAr: 'ذهبي', description: 'Gold', descriptionAr: 'ذهبي' };
    assert.equal(validateTierForm(form).name?.key, 'creators.errorNameNotEnglish');
    assert.equal(validateTierForm({ ...form, name: 'Gold' }).name, undefined);
    assert.equal(validateTierForm({ ...form, name: 'Gold ذهبي' }).name, undefined);
  });
});

describe('legacy tiers without Arabic', () => {
  it('are marked "Arabic missing" (no silent fallback) until both Arabic fields are set', () => {
    assert.equal(arabicMissing({ nameAr: null, descriptionAr: 'وصف' }), true);
    assert.equal(arabicMissing({ nameAr: 'ذهبي', descriptionAr: ' ' }), true);
    assert.equal(arabicMissing({ nameAr: 'ذهبي', descriptionAr: 'وصف' }), false);
    assert.equal(createTranslator('ar')('creators.arabicMissing'), 'العربية ناقصة');
  });
});

describe('hidden tiers (owner, 2026-11-19)', () => {
  const SCHOLAR: CreatorTier = { ...CREATOR, id: 'scholar', name: 'Scholar', nameAr: 'عالِم', hidden: true, sortOrder: 15 };
  const WITH_HIDDEN = [MEMBER, CREATOR, SCHOLAR, UNLIMITED];

  it('a hidden tier: the Hidden switch on, the Hidden chip, no "Set as default", the help in en and ar', () => {
    const html = render(el(TierEditor, { tiers: WITH_HIDDEN, counts: { scholar: 1 }, defaultTierId: 'member', canManage: true, actions: tierActions }));
    const card = html.slice(html.indexOf('id="tier-scholar"'), html.indexOf('id="tier-unlimited"'));
    assert.match(card, /data-testid="tier-scholar-hidden-chip"[^>]*>Hidden</);
    assert.match(card, /data-testid="tier-scholar-hidden"/);
    assert.match(card, /checked=""[^>]*data-testid="tier-scholar-hidden"|data-testid="tier-scholar-hidden"[^>]*checked=""/);
    assert.doesNotMatch(card, /tier-scholar-set-default/, 'a hidden tier cannot be the default');
    assert.match(card, /Only people on this tier see it on the Upgrade page/);
    const arabic = render(el(TierEditor, { tiers: WITH_HIDDEN, counts: {}, defaultTierId: 'member', canManage: true, actions: tierActions }), 'ar');
    assert.match(arabic, /لا يراها في صفحة الترقية إلا من هم عليها/);
    assert.match(arabic, />مخفية</);
  });

  it('the default tier: its switch is off and disabled, with the reason', () => {
    const html = render(el(TierEditor, { tiers: WITH_HIDDEN, counts: {}, defaultTierId: 'creator', canManage: true, actions: tierActions }));
    const card = html.slice(html.indexOf('id="tier-creator"'), html.indexOf('id="tier-scholar"'));
    assert.match(card, /disabled=""[^>]*data-testid="tier-creator-hidden"|data-testid="tier-creator-hidden"[^>]*disabled=""/);
    assert.match(card, /The default tier is always shown/);
  });

  it('the rank list marks a hidden tier; the form keeps the flag; the 409 has words in both languages', () => {
    const rank = render(el(TierRankList, { tiers: WITH_HIDDEN, defaultTierId: 'member', canManage: true }));
    assert.match(rank, /data-testid="tiers-rank-scholar-hidden"[^>]*>Hidden</);
    assert.equal(tierToForm(SCHOLAR).hidden, true);
    assert.equal(tierToForm().hidden, false, 'a new tier is shown');
    assert.equal(tierActionMessage({ status: 409, code: 'default_tier_hidden' }), 'creators.errorDefaultHidden');
    assert.match(tEn('creators.errorDefaultHidden'), /default tier can’t be hidden/);
    assert.match(tAr('creators.errorDefaultHidden'), /لا يمكن إخفاء الفئة الأساسية/);
  });
});
