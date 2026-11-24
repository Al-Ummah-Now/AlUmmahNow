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
