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
import { CREATOR_TIER_BOUNDS, type AdminCreatorRow, type CreatorTier } from '@al-ummah/shared-types';
import {
  creatorsHref,
  isUnexpectedFailure,
  parseCreatorsQuery,
  tierActionMessage,
  tierChangeMessage,
  tierEffect,
  validateTierForm,
  type TierFormValues,
} from '../src/lib/creator-tiers';
import { createTranslator } from '../src/i18n/translate';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { CreatorTierControl } from '../src/components/creators/CreatorTierControl';
import { CreatorsTable } from '../src/components/creators/CreatorsTable';
import { LimitHitsNotice } from '../src/components/creators/LimitHitsNotice';
import { TierEditor } from '../src/components/creators/TierEditor';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

// tsx compiles the components' JSX in classic mode (tsconfig jsx: preserve): they read the global React
(globalThis as unknown as { React: unknown }).React = React;

const ARABIC = /[؀-ۿ]/;
const tEn = createTranslator('en');
const tAr = createTranslator('ar');

const CREATOR: CreatorTier = { id: 'creator', name: 'Creator', unlimited: false, perHour: 300, perDay: 2000, maxConcurrent: 20, maxChannels: 3, updatedAt: null, updatedBy: null };
const UNLIMITED: CreatorTier = { id: 'unlimited', name: 'Unlimited', unlimited: true, perHour: 0, perDay: 0, maxConcurrent: 0, maxChannels: null, updatedAt: null, updatedBy: null };
const TIERS = [CREATOR, UNLIMITED];

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
    assert.equal(tierEffect(CREATOR, tEn, 'en'), 'They can upload up to 300 videos per hour and 2,000 per day (20 starting at once), and own up to 3 channels.');
    assert.equal(tierEffect({ ...CREATOR, maxChannels: null }, tEn, 'en').endsWith('own any number of channels.'), true);
    assert.equal(tierEffect(UNLIMITED, tEn, 'en'), 'They can upload and create channels with no limits.');
    assert.equal(tierEffect(null, tEn, 'en'), 'They will not be able to upload or create channels.');
    const arabic = tierEffect(CREATOR, tAr, 'ar');
    assert.match(arabic, ARABIC);
    assert.equal(arabic.includes(new Intl.NumberFormat('ar').format(2000)), true, 'numbers formatted for Arabic');
  });

  it('names who and which tier, for one user or a selection', () => {
    assert.equal(tierChangeMessage(CREATOR, tEn, 'en', { userName: 'Amina' }).startsWith('Give Amina the Creator tier? They can upload up to 300'), true);
    assert.equal(tierChangeMessage(null, tEn, 'en', { count: 4 }), 'Remove the tier from 4 selected users? They will not be able to upload or create channels.');
  });
});

describe('tier form validation (same bounds and rules as api-videos)', () => {
  const base: TierFormValues = { id: 'gold', name: 'Gold', unlimited: false, perHour: 10, perDay: 100, maxConcurrent: 5, maxChannels: 2 };

  it('accepts a valid tier and an unlimited one without limits', () => {
    assert.deepEqual(validateTierForm(base, { create: true }), {});
    assert.deepEqual(validateTierForm({ ...base, unlimited: true, perHour: NaN }), {});
    assert.deepEqual(validateTierForm({ ...base, maxChannels: null }), {}, 'empty channels = no limit');
  });

  it('flags each field outside CREATOR_TIER_BOUNDS, a daily limit under the hourly one, and bad ids or names', () => {
    const errors = validateTierForm({ ...base, perHour: 0, perDay: CREATOR_TIER_BOUNDS.perDay.max + 1, maxConcurrent: 1.5, maxChannels: 0 });
    assert.deepEqual(Object.keys(errors).sort(), ['maxChannels', 'maxConcurrent', 'perDay', 'perHour']);
    assert.deepEqual(errors.perHour, { key: 'creators.errorRange', params: { min: 1, max: 100_000 } });
    assert.equal(validateTierForm({ ...base, perHour: 50, perDay: 20 }).perDay?.key, 'creators.errorPerDay');
    assert.equal(validateTierForm({ ...base, perHour: NaN }).perHour?.key, 'creators.errorRange', 'an emptied field is an error');
    assert.equal(validateTierForm({ ...base, id: 'Gold Tier' }, { create: true }).id?.key, 'creators.errorId');
    assert.equal(validateTierForm({ ...base, id: 'unlimited' }, { create: true }).id?.key, 'creators.errorIdTaken');
    assert.equal(validateTierForm({ ...base, name: '   ' }).name?.key, 'creators.errorName');
    assert.equal(validateTierForm({ ...base, id: '' }).id, undefined, 'the id is checked only when creating');
  });
});

describe('Creators list query', () => {
  it('keeps valid search, filter, tier and page values and drops the rest', () => {
    assert.deepEqual(parseCreatorsQuery({ q: '  amina ', filter: 'limited', tier: 'creator', page: '3' }), { q: 'amina', filter: 'limited', tier: 'creator', page: 3 });
    assert.deepEqual(parseCreatorsQuery({ filter: 'everyone', tier: 'Drop Table', page: '-1' }), { q: '', filter: 'all', tier: '', page: 1 });
    assert.equal(parseCreatorsQuery({ tier: 'none' }).tier, 'none');
  });

  it('builds page links that keep the filters', () => {
    const q = parseCreatorsQuery({ q: 'a b', tier: 'none', filter: 'needs_tier' });
    assert.equal(creatorsHref(q, { page: 2 }), '/creators?q=a+b&filter=needs_tier&tier=none&page=2');
    assert.equal(creatorsHref(parseCreatorsQuery({})), '/creators');
  });
});

describe('friendly errors', () => {
  it('maps refusals to messages and reports only network or server failures', () => {
    assert.equal(tierActionMessage({ status: 409, code: 'super_admin_tier' }), 'creators.errorSuperAdmin');
    assert.equal(tierActionMessage({ status: 404, code: 'tier_not_found' }), 'creators.errorTierGone');
    assert.equal(tierActionMessage({ status: 409, code: 'tier_in_use' }), 'creators.tierInUse');
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

const row = (over: Partial<AdminCreatorRow>): AdminCreatorRow => ({
  userId: 'usr_1',
  displayName: 'Amina',
  userName: 'amina',
  email: 'amina@example.com',
  avatarUrl: null,
  assignment: null,
  origin: null,
  assignedByName: null,
  tierName: null,
  needsTier: false,
  channels: 0,
  videos: 0,
  usage: { hour: 0, day: 0 },
  limitHits7d: 0,
  lastLimitHitAt: null,
  ...over,
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
    assert.match(assigned, /Assigned by an admin · <bdi>Admin Name<\/bdi>, <bdi>Nov 8, 2026<\/bdi>/);
    assert.doesNotMatch(assigned, /<select/, 'read-only for moderators');
  });

  it('the table disables selecting super admins, shows usage against the limits and links a limit hit to the tier', () => {
    const html = render(
      el(CreatorsTable, {
        items: [
          row({ userId: 'usr_owner', displayName: 'Owner', origin: 'super_admin', assignment: { userId: 'usr_owner', tierId: 'unlimited', source: 'admin', assignedBy: 'system:super-admin', assignedAt: '2026-11-10T00:00:00Z' } }),
          row({ userId: 'usr_c', origin: 'admin', assignment: { userId: 'usr_c', tierId: 'creator', source: 'admin', assignedBy: 'a', assignedAt: '2026-11-10T00:00:00Z' }, usage: { hour: 300, day: 1200 }, limitHits7d: 2 }),
        ],
        tiers: TIERS,
        canManage: true,
        setTier,
        bulkSetTier,
      }),
    );
    const owner = html.slice(html.indexOf('data-user-id="usr_owner"'), html.indexOf('data-user-id="usr_c"'));
    assert.match(owner, /data-testid="creator-select"[^>]*disabled|disabled[^>]*data-testid="creator-select"/);
    assert.match(html, /300 of 300 this hour/);
    assert.match(html, /1,200 of 2,000 today/);
    assert.match(html, /href="\/creators\/tiers#tier-creator"/);
    assert.match(html, /href="\/users\/usr_c"/, 'rows open the videos user page');
    assert.doesNotMatch(html, /auth-requests/, 'never the Auth admin');
  });

  it('the limit-hit notice counts this week and links to who and to the limits; nothing when nobody hit one', () => {
    const notice = renderToStaticMarkup(el(LimitHitsNotice, { count: 3, t: tEn, locale: 'en' }) as never);
    assert.match(notice, /3 creators hit their upload limit this week\./);
    assert.match(notice, /href="\/creators\?filter=limited"/);
    assert.match(notice, /href="\/creators\/tiers"/);
    assert.equal(renderToStaticMarkup(el(LimitHitsNotice, { count: 0, t: tEn, locale: 'en' }) as never), '');
  });

  it('the tiers page shows users per tier, field help with the bounds, and keeps the shipped Unlimited unlimited; in Arabic too', () => {
    const html = render(el(TierEditor, { tiers: TIERS, counts: { creator: 12, unlimited: 1 }, canManage: true, actions: tierActions }));
    assert.match(html, /12 users/);
    assert.match(html, /New videos a creator may start uploading in one hour\. 1 to 100,000\./);
    assert.match(html, /id="tier-creator"/);
    const unlimited = html.slice(html.indexOf('data-testid="tier-card-unlimited"'));
    assert.match(unlimited, /data-testid="tier-unlimited-unlimited"[^>]*disabled|disabled[^>]*data-testid="tier-unlimited-unlimited"/);
    assert.match(unlimited, /always stays unlimited/);
    const arabic = render(el(TierEditor, { tiers: TIERS, counts: { creator: 12 }, canManage: true, actions: tierActions }), 'ar');
    assert.match(arabic, new RegExp(`${new Intl.NumberFormat('ar').format(12)} مستخدم`));
  });
});
