/**
 * Creator tiers (videos-side; never Auth RBAC).
 *
 * Uploading and creating channels are by invitation: a user with no tier
 * ("None", the default) can do neither. Admins assign a tier in the videos
 * admin (Creators page, user page). A tier sets the upload limits and how many
 * channels its holder may own. The videos "Super Admin" role is always
 * Unlimited. Managers and editors of a channel upload under the channel
 * owner's tier.
 *
 * An assignment carries its `source` so paid subscriptions can grant tiers
 * later next to the admin's own assignments.
 */

/** Tier ids shipped by migration; admins can add more. `unlimited` ignores every limit. */
export const CREATOR_TIER_IDS = { creator: 'creator', unlimited: 'unlimited' } as const;

export const CREATOR_TIER_SOURCES = ['admin', 'subscription'] as const;
export type CreatorTierSource = (typeof CREATOR_TIER_SOURCES)[number];

/**
 * `assigned_by` of the Unlimited assignment stored automatically for a user
 * holding the "Super Admin" role (source 'admin', tier 'unlimited').
 */
export const SUPER_ADMIN_TIER_ASSIGNER = 'system:super-admin';

/**
 * Where a user's tier comes from, as the admin shows it: an admin, the super
 * admin role (automatic Unlimited) or a subscription.
 */
export type CreatorTierOrigin = CreatorTierSource | 'super_admin';

export function creatorTierOrigin(assignment: Pick<CreatorTierAssignment, 'source' | 'assignedBy'> | null | undefined): CreatorTierOrigin | null {
  if (!assignment) return null;
  if (assignment.assignedBy === SUPER_ADMIN_TIER_ASSIGNER) return 'super_admin';
  return assignment.source;
}

/** A tier definition, editable by admins. */
export interface CreatorTier {
  id: string;
  name: string;
  /** No session, hourly, daily, concurrency or channel limit */
  unlimited: boolean;
  /** Upload sessions (one per video) per hour */
  perHour: number;
  /** Upload sessions per day */
  perDay: number;
  /** Upload initiations in flight at once */
  maxConcurrent: number;
  /** Channels the holder may own; null = no limit */
  maxChannels: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** The defaults of the shipped Creator tier (also the fallback when D1 has no row). */
export const DEFAULT_CREATOR_TIER: Omit<CreatorTier, 'updatedAt' | 'updatedBy'> = {
  id: CREATOR_TIER_IDS.creator,
  name: 'Creator',
  unlimited: false,
  perHour: 300,
  perDay: 2000,
  maxConcurrent: 20,
  maxChannels: 3,
};

export const DEFAULT_UNLIMITED_TIER: Omit<CreatorTier, 'updatedAt' | 'updatedBy'> = {
  id: CREATOR_TIER_IDS.unlimited,
  name: 'Unlimited',
  unlimited: true,
  perHour: 0,
  perDay: 0,
  maxConcurrent: 0,
  maxChannels: null,
};

/** Bounds an admin may set on a tier (validation, not a policy). */
export const CREATOR_TIER_BOUNDS = {
  perHour: { min: 1, max: 100_000 },
  perDay: { min: 1, max: 1_000_000 },
  maxConcurrent: { min: 1, max: 1000 },
  maxChannels: { min: 1, max: 1000 },
} as const;

/** A user's tier assignment. */
export interface CreatorTierAssignment {
  userId: string;
  tierId: string;
  source: CreatorTierSource;
  assignedBy: string;
  assignedAt: string;
}

/**
 * What the signed-in user may do (GET /api/me/creator), for the web UI to show
 * or hide upload and channel-create controls. `via` says why: their own tier,
 * the super admin role, or none.
 */
export interface CreatorAccess {
  tier: { id: string; name: string; unlimited: boolean } | null;
  via: 'tier' | 'super_admin' | 'none';
  canUpload: boolean;
  canCreateChannel: boolean;
  channelsOwned: number;
  maxChannels: number | null;
  limits: { perHour: number; perDay: number; maxConcurrent: number } | null;
  usage: { hour: number; day: number };
}

/** Error codes the upload and channel-create paths answer with (the web maps them to en/ar messages). */
export const CREATOR_ERROR_CODES = {
  /** 403: the user has no creator tier */
  uploadsByInvitation: 'uploads_by_invitation',
  /** 403: the tier's channel limit is reached */
  channelLimit: 'channel_limit',
  /** 429: an upload limit was reached; `retryAfter` (s) says when uploading works again */
  uploadLimit: 'upload_limit',
} as const;

/** A row of the admin's Creators page. */
export interface AdminCreatorRow {
  userId: string;
  displayName: string;
  userName: string | null;
  email: string | null;
  avatarUrl: string | null;
  assignment: CreatorTierAssignment | null;
  /** Where the tier comes from (null: no tier) */
  origin: CreatorTierOrigin | null;
  /** Display name of the admin who assigned it (videos profile), when known */
  assignedByName: string | null;
  tierName: string | null;
  /** Owns a channel or has uploaded, but holds no tier: cannot upload or create channels until assigned */
  needsTier: boolean;
  channels: number;
  videos: number;
  usage: { hour: number; day: number };
  /** Upload-limit refusals in the last 7 days (the admin's cue to raise a limit) */
  limitHits7d: number;
  lastLimitHitAt: string | null;
}

export interface AdminCreatorsPage {
  items: AdminCreatorRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Users who hit an upload limit in the last 24 hours */
  limitHits24h: number;
  /** Users who hit an upload limit in the last 7 days (the page's notice) */
  limitHits7d: number;
  needsTier: number;
}

/** Filters of the admin's Creators list. */
export const ADMIN_CREATOR_FILTERS = ['all', 'needs_tier', 'assigned', 'limited'] as const;
export type AdminCreatorFilter = (typeof ADMIN_CREATOR_FILTERS)[number];
/** The tier filter's value for users without a tier. */
export const NO_CREATOR_TIER = 'none';

/** How many users hold each tier (tier id -> users), and how many videos users hold none. */
export interface CreatorTierCounts {
  byTier: Record<string, number>;
  none: number;
}

/** GET creator-tiers: the definitions and how many users hold each. */
export interface CreatorTiersList {
  items: CreatorTier[];
  counts: CreatorTierCounts;
  /** Users who hit an upload limit in the last 7 days (the tiers page notice) */
  limitHits7d: number;
}

/** Most users one bulk tier change takes (one page of the Creators list, with room). */
export const MAX_BULK_CREATOR_TIER = 100;

/** The outcome of a bulk tier change. */
export interface CreatorTierBulkResult {
  /** Users whose tier changed, with the assignment they had before */
  changed: { userId: string; previous: CreatorTierAssignment | null }[];
  /** Users who already had the requested tier (from an admin) */
  unchanged: string[];
  /** Super admins: their automatic Unlimited is never changed in bulk */
  skippedSuperAdmin: string[];
}
