/**
 * Creator tiers in the videos admin: the sentence that states what a tier
 * lets someone do (shown in every confirmation), the tier form's validation
 * (the same bounds and rules api-videos enforces), and the Users list's
 * tier filter. No imports from server-only modules, so it is unit tested directly.
 */
import {
  ADMIN_USER_TIER_FILTERS,
  CREATOR_TIER_BOUNDS,
  CREATOR_TIER_IDS,
  NO_CREATOR_TIER,
  type AdminUserTierFilter,
  type CreatorTier,
  type CreatorTierOrigin,
} from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { formatNumber, type MessageKey, type Translator } from '@/i18n/translate';

export type TierLimits = Pick<CreatorTier, 'unlimited' | 'perHour' | 'perDay' | 'maxConcurrent' | 'maxChannels'> &
  Partial<Pick<CreatorTier, 'captionMinutesMonth' | 'audioTracksPerVideo' | 'live' | 'liveHoursMonth' | 'liveMaxConcurrent' | 'liveMaxStreamMinutes' | 'importCountsAgainstLimits'>>;

/** The live streaming sentence of a tier's effect (none when the tier predates live). */
function liveEffect(tier: TierLimits, t: Translator, n: (value: number) => string): string {
  if (tier.live === undefined) return '';
  if (!tier.live) return t('creators.effectLiveOff');
  const params = { hours: n(tier.liveHoursMonth ?? 0), concurrent: n(tier.liveMaxConcurrent ?? 1), minutes: n(tier.liveMaxStreamMinutes ?? 0) };
  return tier.liveMaxConcurrent === 1 ? t('creators.effectLiveOne', params) : t('creators.effectLive', params);
}

/** What holding `tier` lets a user do; null = no tier. */
export function tierEffect(tier: TierLimits | null, t: Translator, locale: Locale): string {
  if (!tier) return t('creators.effectNone');
  if (tier.unlimited) return t('creators.effectUnlimited');
  const n = (value: number) => formatNumber(value, locale);
  const uploads = t('creators.effectLimited', {
    perHour: n(tier.perHour),
    perDay: n(tier.perDay),
    concurrent: n(tier.maxConcurrent),
    channels: tier.maxChannels === null ? t('creators.effectChannelsAny') : t('creators.effectChannels', { count: n(tier.maxChannels) }),
  });
  const captions = tier.captionMinutesMonth ? t('creators.effectCaptions', { minutes: n(tier.captionMinutesMonth) }) : '';
  const audio = tier.audioTracksPerVideo ? t('creators.effectAudioTracks', { count: n(tier.audioTracksPerVideo) }) : '';
  const imports = tier.importCountsAgainstLimits === false ? t('creators.effectImportsFree') : '';
  return [uploads, liveEffect(tier, t, n), captions, audio, imports].filter(Boolean).join(' ');
}

/** The confirmation of a change from one tier to another (or none). */
export function tierChangeMessage(next: (TierLimits & { name: string }) | null, t: Translator, locale: Locale, opts: { count?: number; userName?: string } = {}): string {
  const who = opts.count !== undefined ? t('creators.confirmWhoMany', { count: formatNumber(opts.count, locale) }) : opts.userName ?? '';
  const head = next ? t('creators.confirmAssign', { who, tier: next.name }) : t('creators.confirmRemove', { who });
  return `${head} ${tierEffect(next, t, locale)}`;
}

export const ORIGIN_LABEL: Record<CreatorTierOrigin, MessageKey> = {
  admin: 'creators.originAdmin',
  super_admin: 'creators.originSuperAdmin',
  subscription: 'creators.originSubscription',
};

// --- Tier form -------------------------------------------------------------

export interface TierFormValues {
  id?: string;
  name: string;
  unlimited: boolean;
  perHour: number;
  perDay: number;
  maxConcurrent: number;
  maxChannels: number | null;
  captionMinutesMonth: number;
  /** Extra audio tracks a creator may add to one video (wiki AUN-MULTI-AUDIO MA9) */
  audioTracksPerVideo: number;
  live: boolean;
  liveHoursMonth: number;
  liveMaxConcurrent: number;
  liveMaxStreamMinutes: number;
  /** YouTube imports count against perHour/perDay (wiki AUN-YT-IMPORT); ignored when unlimited */
  importCountsAgainstLimits: boolean;
}

export type TierField = 'id' | 'name' | 'perHour' | 'perDay' | 'maxConcurrent' | 'maxChannels' | 'captionMinutesMonth' | 'liveHoursMonth' | 'liveMaxConcurrent' | 'liveMaxStreamMinutes' | 'audioTracksPerVideo';
export type TierFormErrors = Partial<Record<TierField, { key: MessageKey; params?: Record<string, string | number> }>>;

export const TIER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Field errors for a tier form (empty: valid). Mirrors validateTier in api-videos. */
export function validateTierForm(form: TierFormValues, opts: { create?: boolean } = {}): TierFormErrors {
  const errors: TierFormErrors = {};
  if (opts.create && !TIER_ID_PATTERN.test(form.id ?? '')) errors.id = { key: 'creators.errorId' };
  if (opts.create && Object.values(CREATOR_TIER_IDS).includes((form.id ?? '') as never)) errors.id = { key: 'creators.errorIdTaken' };
  const name = form.name.trim();
  if (!name || name.length > 60) errors.name = { key: 'creators.errorName' };
  if (form.unlimited) return errors;
  const inRange = (field: keyof typeof CREATOR_TIER_BOUNDS, value: number) => {
    const { min, max } = CREATOR_TIER_BOUNDS[field];
    if (!Number.isInteger(value) || value < min || value > max) errors[field] = { key: 'creators.errorRange', params: { min, max } };
  };
  inRange('perHour', form.perHour);
  inRange('perDay', form.perDay);
  inRange('maxConcurrent', form.maxConcurrent);
  if (form.maxChannels !== null) inRange('maxChannels', form.maxChannels);
  inRange('captionMinutesMonth', form.captionMinutesMonth);
  inRange('audioTracksPerVideo', form.audioTracksPerVideo);
  if (form.live) {
    inRange('liveHoursMonth', form.liveHoursMonth);
    inRange('liveMaxConcurrent', form.liveMaxConcurrent);
    inRange('liveMaxStreamMinutes', form.liveMaxStreamMinutes);
  }
  if (!errors.perHour && !errors.perDay && form.perDay < form.perHour) errors.perDay = { key: 'creators.errorPerDay' };
  return errors;
}

// --- Users list tier filter ---------------------------------------------------

/**
 * The Users list's tier filter value: needs_tier, has_tier, hit_limit, `none`
 * or a tier id; '' for anything else (filters nothing).
 */
export function parseUserTierFilter(value: string | undefined): string {
  const tier = (value ?? '').trim();
  if ((ADMIN_USER_TIER_FILTERS as readonly string[]).includes(tier)) return tier;
  return tier === NO_CREATOR_TIER || /^[a-z0-9][a-z0-9-]{0,39}$/.test(tier) ? tier : '';
}

/** The old Creators page's "Show" filter as the Users list's tier filter. */
const CREATORS_FILTER_TO_TIER: Record<string, AdminUserTierFilter> = { needs_tier: 'needs_tier', assigned: 'has_tier', limited: 'hit_limit' };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * Where an old /creators?… link lands on the Users list: q and page carry
 * over; a tier (or `none`) wins over the "Show" filter, which maps to
 * needs_tier, has_tier or hit_limit.
 */
export function creatorsToUsersHref(params: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();
  const q = one(params.q).trim().slice(0, 200);
  if (q) search.set('q', q);
  const tier = parseUserTierFilter(one(params.tier)) || CREATORS_FILTER_TO_TIER[one(params.filter)] || '';
  if (tier) search.set('tier', tier);
  const page = Math.floor(Number(one(params.page)));
  if (page > 1) search.set('page', String(Math.min(page, 10000)));
  const s = search.toString();
  return s ? `/users?${s}` : '/users';
}

/** The Tiers page, or one tier's editor on it. */
export const tiersHref = (tierId?: string) => (tierId ? `/tiers#tier-${encodeURIComponent(tierId)}` : '/tiers');

// --- Action errors -----------------------------------------------------------

/** The friendly message for a refused or failed tier change (never the raw error). */
export function tierActionMessage(result: { status: number; code?: string }): MessageKey {
  if (result.status === 401) return 'errors.notAuthenticated';
  if (result.status === 403) return 'creators.errorForbidden';
  if (result.code === 'super_admin_tier') return 'creators.errorSuperAdmin';
  if (result.code === 'tier_not_found') return 'creators.errorTierGone';
  if (result.code === 'tier_in_use' || (result.status === 409 && result.code !== 'tier_exists')) return 'creators.tierInUse';
  if (result.code === 'tier_exists') return 'creators.errorIdTaken';
  if (result.code === 'invalid_tier') return 'creators.errorInvalid';
  return 'creators.saveFailed';
}

/** Failures worth an error report: the network or the server, not a refusal the admin can act on. */
export const isUnexpectedFailure = (result: { status: number }) => result.status === 0 || result.status >= 500;
