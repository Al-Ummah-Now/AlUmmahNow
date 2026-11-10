/**
 * Creator tiers in the videos admin: the sentence that states what a tier
 * lets someone do (shown in every confirmation), the tier form's validation
 * (the same bounds and rules api-videos enforces), and the Creators list's
 * query. No imports from server-only modules, so it is unit tested directly.
 */
import {
  ADMIN_CREATOR_FILTERS,
  CREATOR_TIER_BOUNDS,
  CREATOR_TIER_IDS,
  NO_CREATOR_TIER,
  type AdminCreatorFilter,
  type CreatorTier,
  type CreatorTierOrigin,
} from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { formatNumber, type MessageKey, type Translator } from '@/i18n/translate';

export type TierLimits = Pick<CreatorTier, 'unlimited' | 'perHour' | 'perDay' | 'maxConcurrent' | 'maxChannels'>;

/** What holding `tier` lets a user do; null = no tier. */
export function tierEffect(tier: TierLimits | null, t: Translator, locale: Locale): string {
  if (!tier) return t('creators.effectNone');
  if (tier.unlimited) return t('creators.effectUnlimited');
  const n = (value: number) => formatNumber(value, locale);
  return t('creators.effectLimited', {
    perHour: n(tier.perHour),
    perDay: n(tier.perDay),
    concurrent: n(tier.maxConcurrent),
    channels: tier.maxChannels === null ? t('creators.effectChannelsAny') : t('creators.effectChannels', { count: n(tier.maxChannels) }),
  });
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
}

export type TierField = 'id' | 'name' | 'perHour' | 'perDay' | 'maxConcurrent' | 'maxChannels';
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
  if (!errors.perHour && !errors.perDay && form.perDay < form.perHour) errors.perDay = { key: 'creators.errorPerDay' };
  return errors;
}

// --- Creators list query -----------------------------------------------------

export interface CreatorsQuery {
  q: string;
  filter: AdminCreatorFilter;
  /** '' = any tier, `none`, or a tier id */
  tier: string;
  page: number;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export function parseCreatorsQuery(params: Record<string, string | string[] | undefined>): CreatorsQuery {
  const filter = one(params.filter);
  const tier = one(params.tier).trim();
  return {
    q: one(params.q).trim().slice(0, 200),
    filter: (ADMIN_CREATOR_FILTERS as readonly string[]).includes(filter) ? (filter as AdminCreatorFilter) : 'all',
    tier: tier === NO_CREATOR_TIER || /^[a-z0-9][a-z0-9-]{0,39}$/.test(tier) ? tier : '',
    page: Math.max(1, Math.floor(Number(one(params.page))) || 1),
  };
}

/** The Creators page URL for `query` with `next` applied (page resets unless given). */
export function creatorsHref(query: CreatorsQuery, next: Partial<CreatorsQuery> = {}): string {
  const merged = { ...query, page: 1, ...next };
  const search = new URLSearchParams();
  if (merged.q) search.set('q', merged.q);
  if (merged.filter !== 'all') search.set('filter', merged.filter);
  if (merged.tier) search.set('tier', merged.tier);
  if (merged.page > 1) search.set('page', String(merged.page));
  const s = search.toString();
  return s ? `/creators?${s}` : '/creators';
}

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
