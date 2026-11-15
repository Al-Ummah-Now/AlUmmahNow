/**
 * Creator tiers (videos-side; never Auth RBAC).
 *
 * Every user holds a tier. A user with no assignment row holds the shipped
 * **Member** tier, the default, whose capability flags allow no uploads and no
 * channel creation, so uploading and creating channels stay by invitation
 * (wiki AUN-TIER-REQUESTS). Admins assign a tier in the videos admin (Users,
 * user page) or approve a user's tier request (/upgrade). A tier sets what its
 * holder may do (uploads, channels, pages), the upload limits and how many
 * channels they may own. The videos "Super Admin" role is always Unlimited.
 * Managers and editors of a channel upload under the channel owner's tier.
 *
 * An assignment carries its `source` so paid subscriptions can grant tiers
 * later next to the admin's own assignments.
 */

/** Tier ids shipped by migration; admins can add more. `unlimited` ignores every limit. */
export const CREATOR_TIER_IDS = { member: 'member', creator: 'creator', unlimited: 'unlimited' } as const;

/** The tier of every user without an assignment row (wiki AUN-TIER-REQUESTS). */
export const DEFAULT_TIER_ID = CREATOR_TIER_IDS.member;

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
  /** Arabic name shown on the Arabic /upgrade page; null = `name` */
  nameAr: string | null;
  /** One line under the name on /upgrade (English); null = none */
  description: string | null;
  /** Arabic line under the name; null = `description` */
  descriptionAr: string | null;
  /** No session, hourly, daily, concurrency or channel limit (implies uploads and channels) */
  unlimited: boolean;
  /** May upload videos (the Member tier ships with false: uploads are by invitation) */
  uploads: boolean;
  /** May create channels, up to `maxChannels` */
  channels: boolean;
  /** May create pages (reserved: no page feature reads it yet; shown on /upgrade) */
  pages: boolean;
  /** Listed on /upgrade, where users may request it */
  requestable: boolean;
  /** Order on /upgrade and in the admin (low first) */
  sortOrder: number;
  /** Upload sessions (one per video) per hour */
  perHour: number;
  /** Upload sessions per day */
  perDay: number;
  /** Upload initiations in flight at once */
  maxConcurrent: number;
  /** Channels the holder may own; null = no limit */
  maxChannels: number | null;
  /**
   * Caption minutes per calendar month (UTC) for on-demand transcription and
   * translation (AUN-CAPTIONS §6; 1 per video-minute per language). 0 = none
   * unless an admin grants minutes; ignored when `unlimited`.
   */
  captionMinutesMonth: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * The shipped Member tier: every user's tier until an admin assigns another.
 * Watching, saving and commenting are never gated; it allows no uploads and no
 * channels (both are by invitation during the beta), which an admin can change
 * later without code (wiki AUN-TIER-REQUESTS).
 */
export const DEFAULT_MEMBER_TIER: Omit<CreatorTier, 'updatedAt' | 'updatedBy'> = {
  id: CREATOR_TIER_IDS.member,
  name: 'Member',
  nameAr: 'عضو',
  description: null,
  descriptionAr: null,
  unlimited: false,
  uploads: false,
  channels: false,
  pages: false,
  requestable: true,
  sortOrder: 0,
  perHour: 10,
  perDay: 50,
  maxConcurrent: 3,
  maxChannels: 1,
  captionMinutesMonth: 0,
};

/** The defaults of the shipped Creator tier (also the fallback when D1 has no row). */
export const DEFAULT_CREATOR_TIER: Omit<CreatorTier, 'updatedAt' | 'updatedBy'> = {
  id: CREATOR_TIER_IDS.creator,
  name: 'Creator',
  nameAr: 'صانع محتوى',
  description: null,
  descriptionAr: null,
  unlimited: false,
  uploads: true,
  channels: true,
  pages: false,
  requestable: true,
  sortOrder: 10,
  perHour: 300,
  perDay: 2000,
  maxConcurrent: 20,
  maxChannels: 3,
  captionMinutesMonth: 0,
};

export const DEFAULT_UNLIMITED_TIER: Omit<CreatorTier, 'updatedAt' | 'updatedBy'> = {
  id: CREATOR_TIER_IDS.unlimited,
  name: 'Unlimited',
  nameAr: 'غير محدود',
  description: null,
  descriptionAr: null,
  unlimited: true,
  uploads: true,
  channels: true,
  pages: true,
  requestable: false,
  sortOrder: 100,
  perHour: 0,
  perDay: 0,
  maxConcurrent: 0,
  maxChannels: null,
  captionMinutesMonth: 0,
};

/** Bounds an admin may set on a tier (validation, not a policy). */
export const CREATOR_TIER_BOUNDS = {
  perHour: { min: 1, max: 100_000 },
  perDay: { min: 1, max: 1_000_000 },
  maxConcurrent: { min: 1, max: 1000 },
  maxChannels: { min: 1, max: 1000 },
  captionMinutesMonth: { min: 0, max: 1_000_000 },
  sortOrder: { min: 0, max: 10_000 },
} as const;

/** Text lengths of a tier's names and descriptions. */
export const CREATOR_TIER_TEXT = { name: 60, description: 200 } as const;

/** Whether a tier lets its holder upload (unlimited implies it). */
export const tierAllowsUploads = (tier: Pick<CreatorTier, 'unlimited' | 'uploads'> | null | undefined): boolean => !!tier && (tier.unlimited || tier.uploads);
/** Whether a tier lets its holder create channels (unlimited implies it). */
export const tierAllowsChannels = (tier: Pick<CreatorTier, 'unlimited' | 'channels'> | null | undefined): boolean => !!tier && (tier.unlimited || tier.channels);
/** Whether a tier lets its holder create pages (unlimited implies it). */
export const tierAllowsPages = (tier: Pick<CreatorTier, 'unlimited' | 'pages'> | null | undefined): boolean => !!tier && (tier.unlimited || tier.pages);

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
 * or hide upload and channel-create controls. `via` says why: an assigned
 * tier, the super admin role, or none ('none': no assignment, so the user holds
 * the default Member tier, which `tier` then describes).
 */
export interface CreatorAccess {
  /** The user's own tier (Member when none is assigned) with its uploads and channels flags */
  tier: { id: string; name: string; unlimited: boolean; uploads?: boolean; channels?: boolean } | null;
  via: 'tier' | 'super_admin' | 'none';
  /**
   * True when the user can upload somewhere: with their own tier (to the
   * channels they own), or to a channel they help run whose owner has a tier
   * (`uploadChannelIds`). Uploads to a channel run under its owner's tier.
   */
  canUpload: boolean;
  /**
   * Channels the user holds an uploading role on (not owned) whose owner's
   * tier allows uploads (#759). Owned channels follow `tier`. A hint for the
   * upload page's picker: the server checks every upload again.
   */
  uploadChannelIds?: string[];
  canCreateChannel: boolean;
  /** The tier's "create pages" flag (no page feature reads it yet) */
  canCreatePages?: boolean;
  channelsOwned: number;
  maxChannels: number | null;
  limits: { perHour: number; perDay: number; maxConcurrent: number } | null;
  usage: { hour: number; day: number };
  /** Set while an admin deletion of the user's videos data is pending: nothing can be uploaded or created */
  pendingDeletion?: boolean;
}

/** Error codes the upload and channel-create paths answer with (the web maps them to en/ar messages). */
export const CREATOR_ERROR_CODES = {
  /** 403: the user's tier does not allow uploads (or channel creation) */
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
