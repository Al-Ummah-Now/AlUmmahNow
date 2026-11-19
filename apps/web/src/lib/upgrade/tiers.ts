/**
 * /upgrade (wiki AUN-TIER-REQUESTS): what a tier card says and what its button
 * does, the request form's checks and the API error copy. Pure, so the page
 * and its tests share it. Never prices: a card offers "Request".
 */
import { formatInteger, TIER_REQUEST_ERRORS, TIER_REQUEST_LIMITS, type PublicTier, type UpgradeOverview } from '@al-ummah/shared-types';
import type { AppTranslations } from '@al-ummah/shared-types';

type UpgradeCopy = AppTranslations['upgrade'];
export type Lang = 'en' | 'ar';

const fill = (text: string, params: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));

export const formatCount = (n: number, lang: Lang) => formatInteger(lang, n);

/** The tier's name in the page language (the admin's Arabic name, else the English one). */
export const tierName = (tier: Pick<PublicTier, 'name' | 'nameAr'>, lang: Lang) => (lang === 'ar' && tier.nameAr ? tier.nameAr : tier.name);
export const tierDescription = (tier: Pick<PublicTier, 'description' | 'descriptionAr'>, lang: Lang) =>
  (lang === 'ar' ? tier.descriptionAr || tier.description : tier.description) || null;

export interface TierFeature {
  key: 'watch' | 'uploads' | 'channels' | 'captions';
  included: boolean;
  text: string;
}

/** What a tier includes, from its capability flags (the same rows on every card, so cards compare line by line). */
export function tierFeatures(tier: PublicTier, t: UpgradeCopy, lang: Lang): TierFeature[] {
  const n = (count: number) => formatCount(count, lang);
  const uploads = !tier.uploads
    ? t.noUploads
    : tier.uploadsPerDay === null
      ? t.uploadsUnlimited
      : fill(t.uploadsPerDay, { count: n(tier.uploadsPerDay) });
  const channels = !tier.channels
    ? t.noChannels
    : tier.maxChannels === null
      ? t.channelsUnlimited
      : tier.maxChannels === 1
        ? t.channelsOne
        : fill(t.channelsUpTo, { count: n(tier.maxChannels) });
  const captions = tier.unlimited ? t.captionsUnlimited : tier.captionMinutesMonth > 0 ? fill(t.captionMinutes, { count: n(tier.captionMinutesMonth) }) : t.noCaptionMinutes;
  return [
    { key: 'watch', included: true, text: t.watch },
    { key: 'uploads', included: tier.uploads, text: uploads },
    { key: 'channels', included: tier.channels, text: channels },
    { key: 'captions', included: tier.unlimited || tier.captionMinutesMonth > 0, text: captions },
  ];
}

/**
 * What a card's footer shows:
 * - current: "Your current tier" (the lit card)
 * - requested: the tier of the user's pending request
 * - request: a Request button
 * - waiting: another request is pending, so no second one (the button is disabled)
 * - sign-in: signed out
 * - none: no action (the page is not in request mode: payments on, or requests off)
 */
export type CardState = 'current' | 'requested' | 'request' | 'waiting' | 'sign-in' | 'none';

export function cardState(tier: PublicTier, overview: Pick<UpgradeOverview, 'currentTierId' | 'request'> & Partial<Pick<UpgradeOverview, 'mode'>>, signedIn: boolean): CardState {
  if (signedIn && overview.currentTierId !== null && tier.id === overview.currentTierId) return 'current';
  // Requests only in request mode (owner rule 2026-11-15, shared-types UPGRADE_MODES)
  if ((overview.mode ?? 'request') !== 'request') return 'none';
  if (!signedIn || overview.currentTierId === null) return 'sign-in';
  const pending = overview.request?.status === 'pending' ? overview.request : null;
  if (pending?.tierId === tier.id) return 'requested';
  if (pending) return 'waiting';
  return tier.requestable ? 'request' : 'waiting';
}

export interface FormErrors {
  name?: string;
  about?: string;
}

const length = (s: string) => [...s.trim()].length;

/** The form's own checks (the server checks the same limits). */
export function validateRequestForm(values: { name: string; about: string }, t: UpgradeCopy['form']): FormErrors {
  const errors: FormErrors = {};
  const { name, about } = TIER_REQUEST_LIMITS;
  const nameLength = length(values.name.replace(/\s+/g, ' '));
  if (nameLength < name.min || nameLength > name.max) errors.name = fill(t.nameInvalid, { min: name.min, max: name.max });
  const aboutLength = length(values.about);
  if (aboutLength < about.min) errors.about = fill(t.aboutTooShort, { min: about.min });
  else if (aboutLength > about.max) errors.about = fill(t.aboutTooLong, { max: about.max });
  return errors;
}

/** The API's refusal in the page language. */
export function requestErrorMessage(code: string | undefined, t: UpgradeCopy['errors']): string {
  switch (code) {
    case TIER_REQUEST_ERRORS.alreadyPending:
      return t.pending;
    case TIER_REQUEST_ERRORS.alreadyHeld:
      return t.held;
    case TIER_REQUEST_ERRORS.tierNotRequestable:
      return t.notRequestable;
    case TIER_REQUEST_ERRORS.tooMany:
      return t.tooMany;
    case 'human_check_required':
    case TIER_REQUEST_ERRORS.turnstile:
      return t.humanCheck;
    default:
      return t.failed;
  }
}

export { fill as fillCopy };
