/**
 * Ummah Kids curated catalog, review requests, and parental controls
 * (wiki E20 §5). Parent-owned model: zero child personal data is stored.
 */

export const KIDS_TARGET_TYPES = ['video', 'channel', 'playlist'] as const;
export type KidsTargetType = (typeof KIDS_TARGET_TYPES)[number];

export const KIDS_AGE_BANDS = ['3-6', '7-12', 'all'] as const;
export type KidsAgeBand = (typeof KIDS_AGE_BANDS)[number];

export const KIDS_ACTIVE_AGE_BANDS = ['3-6', '7-12'] as const;
export type KidsActiveAgeBand = (typeof KIDS_ACTIVE_AGE_BANDS)[number];

export const KIDS_TOPICS = ['dua', 'prophets_stories', 'arabic_letters', 'nasheed', 'quran', 'character'] as const;
export type KidsTopic = (typeof KIDS_TOPICS)[number];

export const KIDS_CATALOG_STATUSES = ['approved', 'revoked', 'deleted'] as const;
export type KidsCatalogStatus = (typeof KIDS_CATALOG_STATUSES)[number];

export const KIDS_REVIEW_STATUSES = ['pending', 'approved', 'declined'] as const;
export type KidsReviewStatus = (typeof KIDS_REVIEW_STATUSES)[number];

export function isKidsTargetType(value: unknown): value is KidsTargetType {
  return typeof value === 'string' && (KIDS_TARGET_TYPES as readonly string[]).includes(value);
}

export function isKidsAgeBand(value: unknown): value is KidsAgeBand {
  return typeof value === 'string' && (KIDS_AGE_BANDS as readonly string[]).includes(value);
}

export function isKidsActiveAgeBand(value: unknown): value is KidsActiveAgeBand {
  return typeof value === 'string' && (KIDS_ACTIVE_AGE_BANDS as readonly string[]).includes(value);
}

export function isKidsTopic(value: unknown): value is KidsTopic {
  return typeof value === 'string' && (KIDS_TOPICS as readonly string[]).includes(value);
}

export function isKidsCatalogStatus(value: unknown): value is KidsCatalogStatus {
  return typeof value === 'string' && (KIDS_CATALOG_STATUSES as readonly string[]).includes(value);
}

export function cleanKidsTopics(raw: unknown): KidsTopic[] {
  if (!Array.isArray(raw)) return [];
  const out: KidsTopic[] = [];
  for (const item of raw) {
    if (isKidsTopic(item) && !out.includes(item)) out.push(item);
  }
  return out;
}

export function parseKidsTopicsJson(raw: string | null | undefined): KidsTopic[] {
  if (!raw) return [];
  try {
    return cleanKidsTopics(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Age bands visible when browsing with `activeBand`: the band itself plus `'all'`. */
export function matchingKidsAgeBands(activeBand?: KidsActiveAgeBand | null): readonly KidsAgeBand[] {
  if (!activeBand) return KIDS_AGE_BANDS;
  return [activeBand, 'all'];
}

export interface KidsCatalogItem {
  id: string;
  targetType: KidsTargetType;
  targetId: string;
  targetTitle?: string | null;
  ageBand: KidsAgeBand;
  status: KidsCatalogStatus;
  topics: KidsTopic[];
  position: number;
  approvedBy: string;
  approvedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
  purgeAfter: string | null;
  updatedAt: string;
  revokedByEdit?: boolean;
  revocationReason?: string | null;
  revokedAt?: string | null;
}

export interface KidsReviewRequest {
  id: string;
  targetType: KidsTargetType;
  targetId: string;
  targetTitle?: string | null;
  channelId: string;
  channelName?: string | null;
  requestedBy: string;
  requestedByName?: string | null;
  suggestedAgeBand: KidsAgeBand;
  notes: string | null;
  status: KidsReviewStatus;
  decisionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** Parental PIN format: 4–6 ASCII digits (wiki E20 §5.3). */
export const KIDS_PIN_REGEX = /^\d{4,6}$/;
/** Bedtime HH:MM format (24-hour clock). */
export const KIDS_TIME_HHMM_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/** Maximum sign-in age (`auth_time`, seconds) allowed for setting or changing the parental PIN (KIDS-D8). */
export const KIDS_STEP_UP_MAX_AGE_SECONDS = 300;
/** HTTP header & HttpOnly cookie carrying the signed Kids Mode session token. */
export const KIDS_SESSION_HEADER = 'x-kids-session';
export const KIDS_SESSION_COOKIE = 'aun_kids_session';

export const KIDS_ROUTE_MODES = [
  'block_403',
  'suppress_attribution',
  'allowlisted_only',
  'allow_public',
  'admin_internal',
] as const;
export type KidsRouteMode = (typeof KIDS_ROUTE_MODES)[number];

/** Public-facing parental controls state (PIN hash/salt are NEVER exposed). */
export interface ParentalControlsView {
  hasPin: boolean;
  pinUpdatedAt: string | null;
  pinLockedUntil: string | null;
  pinHardLocked: boolean;
  activeAgeBand: KidsActiveAgeBand;
  dailyLimitMinutes: number | null;
  bedtimeStart: string | null;
  bedtimeEnd: string | null;
  bedtimeTimezone: string | null;
  prayerPauseEnabled: boolean;
  updatedAt: string | null;
}

export function isValidKidsPin(value: unknown): value is string {
  return typeof value === 'string' && KIDS_PIN_REGEX.test(value);
}

export function isValidKidsTime(value: unknown): value is string {
  return typeof value === 'string' && KIDS_TIME_HHMM_REGEX.test(value);
}

export interface PinLockoutNext {
  failedAttempts: number;
  lockedUntilIso: string | null;
  retryAfterSeconds: number;
  hardLocked: boolean;
}

/**
 * Escalating parental PIN lockout schedule (wiki E20 §5.2, KIDS-D8):
 * - Attempts 1–4: no lockout
 * - 5th wrong attempt: 5 minutes (300s)
 * - 6th wrong attempt: 15 minutes (900s)
 * - 7th wrong attempt: 1 hour (3600s)
 * - 8th+ wrong attempt: hard stop until fresh SSO step-up PIN reset + parent security alert
 */
export function nextPinLockout(currentFailures: number, nowMs = Date.now()): PinLockoutNext {
  const next = Math.max(0, Math.floor(currentFailures)) + 1;
  if (next >= 8) {
    return {
      failedAttempts: next,
      lockedUntilIso: null,
      retryAfterSeconds: 0,
      hardLocked: true,
    };
  }
  let lockSeconds = 0;
  if (next === 7) lockSeconds = 3600;
  else if (next === 6) lockSeconds = 900;
  else if (next === 5) lockSeconds = 300;
  return {
    failedAttempts: next,
    lockedUntilIso: lockSeconds > 0 ? new Date(nowMs + lockSeconds * 1000).toISOString() : null,
    retryAfterSeconds: lockSeconds,
    hardLocked: false,
  };
}
