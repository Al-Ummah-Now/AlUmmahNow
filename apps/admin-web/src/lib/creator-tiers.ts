/**
 * Creator tiers in the videos admin: the sentence that states what a tier
 * lets someone do (shown in every confirmation), the tier form's validation
 * (the same bounds and rules api-videos enforces), and the Users list's
 * tier filter. No imports from server-only modules, so it is unit tested directly.
 */
import {
  ADMIN_USER_TIER_FILTERS,
  CREATOR_TIER_BOUNDS,
  CREATOR_TIER_TEXT,
  DEFAULT_CREATOR_TIER,
  DEFAULT_TIER_ID,
  NO_CREATOR_TIER,
  NO_DEFAULT_TIER,
  type AdminUserTierFilter,
  type CreatorTier,
  type CreatorTierOrigin,
} from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { formatNumber, type MessageKey, type Translator } from '@/i18n/translate';

export type TierLimits = Pick<CreatorTier, 'unlimited' | 'perHour' | 'perDay' | 'maxConcurrent' | 'maxChannels'> &
  Partial<Pick<CreatorTier, 'captionMinutesMonth' | 'audioTracksPerVideo' | 'live' | 'liveHoursMonth' | 'liveMaxConcurrent' | 'liveMaxStreamMinutes' | 'uploads' | 'channels'>>;

/** The live streaming sentence of a tier's effect (none when the tier predates live). */
function liveEffect(tier: TierLimits, t: Translator, n: (value: number) => string): string {
  if (tier.live === undefined) return '';
  if (!tier.live) return t('creators.effectLiveOff');
  const params = { hours: n(tier.liveHoursMonth ?? 0), concurrent: n(tier.liveMaxConcurrent ?? 1), minutes: n(tier.liveMaxStreamMinutes ?? 0) };
  return tier.liveMaxConcurrent === 1 ? t('creators.effectLiveOne', params) : t('creators.effectLive', params);
}

/** What holding `tier` lets a user do; null = no tier. Missing flags read as allowed (tiers before the flags). */
export function tierEffect(tier: TierLimits | null, t: Translator, locale: Locale): string {
  if (!tier) return t('creators.effectNone');
  if (tier.unlimited) return t('creators.effectUnlimited');
  const n = (value: number) => formatNumber(value, locale);
  const uploads = tier.uploads !== false;
  const channels = tier.channels !== false;
  const channelText = tier.maxChannels === null ? t('creators.effectChannelsAny') : t('creators.effectChannels', { count: n(tier.maxChannels) });
  const limits = { perHour: n(tier.perHour), perDay: n(tier.perDay), concurrent: n(tier.maxConcurrent), channels: channelText };
  const parts = [
    uploads && channels
      ? t('creators.effectLimited', limits)
      : uploads
        ? t('creators.effectUploadsOnly', limits)
        : channels
          ? t('creators.effectChannelsOnly', limits)
          : t('creators.effectWatchOnly'),
  ];
  // A watch-only tier already says it cannot upload or create channels: no live sentence too
  if (uploads || channels) parts.push(liveEffect(tier, t, n));
  if (tier.captionMinutesMonth) parts.push(t('creators.effectCaptions', { minutes: n(tier.captionMinutesMonth) }));
  if (tier.audioTracksPerVideo) parts.push(t('creators.effectAudioTracks', { count: n(tier.audioTracksPerVideo) }));
  return parts.filter(Boolean).join(' ');
}

/** The confirmation of a change from one tier to another (or none). */
export function tierChangeMessage(next: (TierLimits & { name: string; nameAr?: string | null }) | null, t: Translator, locale: Locale, opts: { count?: number; userName?: string } = {}): string {
  const who = opts.count !== undefined ? t('creators.confirmWhoMany', { count: formatNumber(opts.count, locale) }) : opts.userName ?? '';
  const head = next ? t('creators.confirmAssign', { who, tier: tierLabel(next, locale) }) : t('creators.confirmRemove', { who });
  return `${head} ${tierEffect(next, t, locale)}`;
}

/**
 * A tier's name for the admin's language: its Arabic name in the Arabic admin
 * (falling back to the English one when none is set), the English name otherwise.
 */
export function tierLabel(tier: { name: string; nameAr?: string | null }, locale: Locale): string {
  return locale === 'ar' && tier.nameAr?.trim() ? tier.nameAr.trim() : tier.name;
}

/** Text with Arabic letters and no Latin letter or digit (the English name may not be that). */
export const isArabicOnly = (text: string) => /[\u0600-\u06FF]/.test(text) && !/[A-Za-z0-9]/.test(text);
/**
 * A tier saved before both languages were required (owner rule 2026-11-16) with its Arabic name or
 * Arabic description missing: the Tiers page marks it ("Arabic missing") instead of falling back silently.
 */
export function arabicMissing(tier: { nameAr?: string | null; descriptionAr?: string | null }): boolean {
  return !tier.nameAr?.trim() || !tier.descriptionAr?.trim();
}

export const ORIGIN_LABEL: Record<CreatorTierOrigin, MessageKey> = {
  admin: 'creators.originAdmin',
  super_admin: 'creators.originSuperAdmin',
  subscription: 'creators.originSubscription',
  signup: 'creators.originSignup',
};

// --- Tier form -------------------------------------------------------------

export interface TierFormValues {
  id?: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  unlimited: boolean;
  uploads: boolean;
  channels: boolean;
  requestable: boolean;
  sortOrder: number;
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
}

export type TierField = 'name' | 'nameAr' | 'description' | 'descriptionAr' | 'sortOrder' | 'perHour' | 'perDay' | 'maxConcurrent' | 'maxChannels' | 'captionMinutesMonth' | 'liveHoursMonth' | 'liveMaxConcurrent' | 'liveMaxStreamMinutes' | 'audioTracksPerVideo';
export type TierFormErrors = Partial<Record<TierField, { key: MessageKey; params?: Record<string, string | number> }>>;

/** Field errors for a tier form (empty: valid). Mirrors validateTier in api-videos. No id: api-videos makes it from the name. */
export function validateTierForm(form: TierFormValues, _opts: { create?: boolean } = {}): TierFormErrors {
  const errors: TierFormErrors = {};
  const name = form.name.trim();
  if (!name || name.length > CREATOR_TIER_TEXT.name) errors.name = { key: 'creators.errorName' };
  // The English name is English: Arabic-only text belongs in the Arabic name (owner review 2026-11-16)
  else if (isArabicOnly(name)) errors.name = { key: 'creators.errorNameNotEnglish' };
  // Localized fields (owner rule 2026-11-16): both languages of the name and the description, no fallback
  const text = (field: 'nameAr' | 'description' | 'descriptionAr', max: number) => {
    const value = form[field].trim();
    if (!value) errors[field] = { key: field === 'nameAr' ? 'creators.errorNameAr' : field === 'description' ? 'creators.errorDescription' : 'creators.errorDescriptionAr' };
    else if (value.length > max) errors[field] = { key: 'creators.errorText', params: { max } };
  };
  text('nameAr', CREATOR_TIER_TEXT.name);
  text('description', CREATOR_TIER_TEXT.description);
  text('descriptionAr', CREATOR_TIER_TEXT.description);
  const inRange = (field: keyof typeof CREATOR_TIER_BOUNDS, value: number) => {
    const { min, max } = CREATOR_TIER_BOUNDS[field];
    if (!Number.isInteger(value) || value < min || value > max) errors[field] = { key: 'creators.errorRange', params: { min, max } };
  };
  inRange('sortOrder', form.sortOrder);
  if (form.unlimited) return errors;
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

/** The form for a saved tier (or a new one): what the editor starts from. */
export function tierToForm(tier?: CreatorTier): TierFormValues {
  return {
    id: tier?.id ?? '',
    name: tier?.name ?? '',
    nameAr: tier?.nameAr ?? '',
    description: tier?.description ?? '',
    descriptionAr: tier?.descriptionAr ?? '',
    unlimited: tier?.unlimited ?? false,
    // A new tier allows uploads and channels, as api-videos assumes
    uploads: tier?.uploads ?? true,
    channels: tier?.channels ?? true,
    requestable: tier?.requestable ?? false,
    sortOrder: tier?.sortOrder ?? 50,
    perHour: tier?.perHour || 300,
    perDay: tier?.perDay || 2000,
    maxConcurrent: tier?.maxConcurrent || 20,
    maxChannels: tier ? tier.maxChannels : 3,
    captionMinutesMonth: tier?.captionMinutesMonth ?? 0,
    audioTracksPerVideo: tier?.audioTracksPerVideo ?? 0,
    // A new tier starts without live; its limits start from the Creator tier's
    live: tier?.live ?? false,
    liveHoursMonth: tier?.liveHoursMonth || DEFAULT_CREATOR_TIER.liveHoursMonth,
    liveMaxConcurrent: tier?.liveMaxConcurrent || DEFAULT_CREATOR_TIER.liveMaxConcurrent,
    liveMaxStreamMinutes: tier?.liveMaxStreamMinutes || DEFAULT_CREATOR_TIER.liveMaxStreamMinutes,
  };
}

/** What a tier save sends to admin-api: optional text is null when empty (the English name or description is used). */
export type TierPayload = Omit<TierFormValues, 'nameAr' | 'description' | 'descriptionAr'> & { nameAr: string | null; description: string | null; descriptionAr: string | null };

export function tierFormPayload(form: TierFormValues): TierPayload {
  const orNull = (v: string) => v.trim() || null;
  return { ...form, name: form.name.trim(), nameAr: orNull(form.nameAr), description: orNull(form.description), descriptionAr: orNull(form.descriptionAr) };
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
  if (result.code === 'tier_is_default') return 'creators.tierIsDefault';
  if (result.code === 'tier_has_invites') return 'creators.errorTierHasInvites';
  if (result.code === 'default_tier_deleted') return 'creators.errorDefaultDeleted';
  if (result.code === 'tier_in_use' || result.status === 409) return 'creators.tierInUse';
  if (result.code === 'tier_text_missing') return 'creators.errorTextMissing';
  if (result.code === 'tier_name_not_english') return 'creators.errorNameNotEnglish';
  if (result.code === 'invalid_tier') return 'creators.errorInvalid';
  return 'creators.saveFailed';
}

/** Failures worth an error report: the network or the server, not a refusal the admin can act on. */
export const isUnexpectedFailure = (result: { status: number }) => result.status === 0 || result.status >= 500;

/**
 * The default tier's name (the retired 'none' reads as Free): what a user without an assigned tier
 * holds, shown as just the tier's name (owner, 2026-11-15: "Default" marks only
 * the tier on the Tiers list).
 */
export function defaultTierName(defaultTierId: string | null | undefined, tiers: readonly Pick<CreatorTier, 'id' | 'name' | 'nameAr'>[], _t: Translator, locale: Locale = 'en'): string {
  const id = !defaultTierId || defaultTierId === NO_DEFAULT_TIER ? DEFAULT_TIER_ID : defaultTierId;
  const tier = tiers.find((x) => x.id === id);
  return tier ? tierLabel(tier, locale) : id;
}
