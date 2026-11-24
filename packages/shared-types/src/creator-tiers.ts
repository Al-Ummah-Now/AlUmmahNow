/**
 * Creator tiers (videos-side; never Auth RBAC).
 *
 * Nobody is ever tierless: every account has a stored tier (owner,
 * 2026-11-15). Invited users get the tier set on the invite; everyone else
 * gets the **default tier** written to their account when their profile is
 * created (sign-up). The default (picked on Tiers, "Set as default") is only
 * what new sign-ups get: changing it never changes existing users. The shipped
 * default is **Free** (the minimum, never deletable), whose flags allow no
 * uploads and no channel creation, so uploading and creating channels stay by
 * invitation (wiki AUN-TIER-REQUESTS). An account somehow without a row (before
 * the Free backfill) is treated as Free. Admins assign a tier in the videos admin (Users,
 * user page) or approve a user's tier request (/upgrade). A tier sets what its
 * holder may do (uploads, channels), the upload limits and how many
 * channels they may own. The videos "Super Admin" role is always Unlimited.
 * Managers and editors of a channel upload under the channel owner's tier.
 *
 * An assignment carries its `source` so paid subscriptions can grant tiers
 * later next to the admin's own assignments.
 */

/**
 * Tier ids shipped by migration; admins can add more. `unlimited` ignores every
 * limit. `member` is the **Free** tier («مجاني»): the id is kept from when it
 * was called Member, so existing assignments carry over (owner, 2026-11-15).
 */
export const CREATOR_TIER_IDS = { member: 'member', creator: 'creator', unlimited: 'unlimited' } as const;

/**
 * The shipped **Free** tier (id `member`; owner, 2026-11-15; migration 0065),
 * the one minimum tier and the default out of the box: it cannot be deleted,
 * and it ships with exactly what a user with no tier could do before. An
 * account without a row is treated as Free. The default for new sign-ups is a
 * setting (DefaultTierId); never read this as "the default".
 */
export const DEFAULT_TIER_ID = CREATOR_TIER_IDS.member;

/**
 * The old "no tier at all" default value. Free replaced it (owner,
 * 2026-11-15): it can no longer be chosen, and a stored 'none' reads as Free.
 */
export const NO_DEFAULT_TIER = 'none';

/** A tier id: what new sign-ups (and invites without a picked tier) get. */
export type DefaultTierId = string;

/** `assigned_by` of the default tier written to a new account at sign-up (source 'admin'). */
export const SIGNUP_TIER_ASSIGNER = 'system:signup';

export const CREATOR_TIER_SOURCES = ['admin', 'subscription'] as const;
export type CreatorTierSource = (typeof CREATOR_TIER_SOURCES)[number];

/**
 * `assigned_by` of the Unlimited assignment stored automatically for a user
 * holding the "Super Admin" role (source 'admin', tier 'unlimited').
 */
export const SUPER_ADMIN_TIER_ASSIGNER = 'system:super-admin';

/**
 * Where a user's tier comes from, as the admin shows it: an admin, the super
 * admin role (automatic Unlimited), a subscription, or the default given at
 * sign-up.
 */
export type CreatorTierOrigin = CreatorTierSource | 'super_admin' | 'signup';

export function creatorTierOrigin(assignment: Pick<CreatorTierAssignment, 'source' | 'assignedBy'> | null | undefined): CreatorTierOrigin | null {
  if (!assignment) return null;
  if (assignment.assignedBy === SUPER_ADMIN_TIER_ASSIGNER) return 'super_admin';
  if (assignment.assignedBy === SIGNUP_TIER_ASSIGNER) return 'signup';
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
  /**
   * Creator support (wiki AUN-MEMBERS, MEM-D5 "tier capability"): owners on this tier may receive
   * support. Absent = no. Read only while the support policy's `receiversRule` is 'tierCapability'.
   */
  supportReceive?: boolean;
  /** Listed on /upgrade, where users may request it */
  requestable: boolean;
  /**
   * Hidden (owner, 2026-11-19): never on the Upgrade page or any tier list a user sees, except as the
   * current tier of the people on it. Admins still list, invite to and grant it. The default tier is never hidden.
   */
  hidden: boolean;
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
  /**
   * YouTube imports (wiki AUN-YT-IMPORT) count against perHour/perDay like
   * uploads (true, the default) or skip those counters (false). A tier is
   * still needed to import; ignored when `unlimited`. Missing (a tier stored
   * before the field existed) means true: only an explicit false skips them.
   */
  importCountsAgainstLimits?: boolean;
  /**
   * Extra audio tracks per video (wiki AUN-MULTI-AUDIO MA9; the original is not counted).
   * 0 = none; ignored when `unlimited` (still bounded by AUDIO_TRACKS_HARD_MAX).
   */
  audioTracksPerVideo: number;
  /** May edit human-supplied reciter metadata (E21); the channel owner's tier applies. */
  recitationMetadata: boolean;
  /**
   * May go live (Studio Live, D3). The limits below apply unless `unlimited`.
   * The tier that applies is the channel OWNER's, like uploads.
   */
  live: boolean;
  /** Hours of live streaming per calendar month (UTC), summed over the holder's channels */
  liveHoursMonth: number;
  /** Streams live at once across the holder's channels */
  liveMaxConcurrent: number;
  /** Longest single stream, in minutes; a longer one is ended (the recording is kept) */
  liveMaxStreamMinutes: number;
  /** Live chat on the holder's streams and premieres (wiki E17). Absent = the same as `live` */
  liveChat?: boolean;
  /** Show a finished video as a premiere (wiki E17). Absent = the same as `live` */
  livePremieres?: boolean;
  /** Event tags on streams (wiki E17). Absent = the same as `live` */
  liveEvents?: boolean;
  /** Private video notes (wiki E21-D9) a holder may keep; null = no limit */
  notesMax?: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * The shipped **Free** tier («مجاني», id `member`), the one minimum tier and
 * the default out of the box (owner, 2026-11-15): never deletable, every limit
 * editable. It ships with today's no-tier rights: watching, saving and
 * commenting (never gated), no uploads, no channels, no pages, 0 caption
 * minutes. Not requestable: nobody requests the bottom tier. Also the
 * fallback when D1 has no row.
 */
export const DEFAULT_MEMBER_TIER: Omit<CreatorTier, 'updatedAt' | 'updatedBy'> = {
  id: CREATOR_TIER_IDS.member,
  name: 'Free',
  nameAr: 'مجاني',
  description: 'Watch, save, comment and subscribe.',
  descriptionAr: 'شاهد واحفظ وعلّق واشترك.',
  unlimited: false,
  uploads: false,
  channels: false,
  requestable: false,
  hidden: false,
  sortOrder: 0,
  perHour: 10,
  perDay: 50,
  maxConcurrent: 3,
  maxChannels: 1,
  captionMinutesMonth: 0,
  audioTracksPerVideo: 0,
  recitationMetadata: true,
  // No live: Member has no channels to stream on (migration 0060's column defaults)
  live: false,
  liveHoursMonth: 20,
  liveMaxConcurrent: 1,
  liveMaxStreamMinutes: 240,
  notesMax: 1000,
};

/** The defaults of the shipped Creator tier (also the fallback when D1 has no row). */
export const DEFAULT_CREATOR_TIER: Omit<CreatorTier, 'updatedAt' | 'updatedBy'> = {
  id: CREATOR_TIER_IDS.creator,
  name: 'Creator',
  nameAr: 'صانع محتوى',
  description: 'Upload videos and run your own channels.',
  descriptionAr: 'ارفع المرئيات وأدِر قنواتك.',
  unlimited: false,
  uploads: true,
  channels: true,
  requestable: true,
  hidden: false,
  sortOrder: 10,
  perHour: 300,
  perDay: 2000,
  maxConcurrent: 20,
  maxChannels: 3,
  captionMinutesMonth: 0,
  importCountsAgainstLimits: true,
  audioTracksPerVideo: 0,
  recitationMetadata: true,
  // Live (owner 2026-11-14): on, 20 h a month, one stream at a time, 4 h per stream.
  // Self-hosted live costs Workers requests + R2 (no egress): about $0.01 per stream-hour
  // at 100 viewers, so a full month of every Creator's hours stays far inside the budget.
  live: true,
  liveHoursMonth: 20,
  liveMaxConcurrent: 1,
  liveMaxStreamMinutes: 240,
  notesMax: 1000,
};

export const DEFAULT_UNLIMITED_TIER: Omit<CreatorTier, 'updatedAt' | 'updatedBy'> = {
  id: CREATOR_TIER_IDS.unlimited,
  name: 'Unlimited',
  nameAr: 'غير محدود',
  description: 'Everything, with no limits.',
  descriptionAr: 'كل شيء، بلا حدود.',
  unlimited: true,
  uploads: true,
  channels: true,
  requestable: false,
  hidden: false,
  sortOrder: 100,
  perHour: 0,
  perDay: 0,
  maxConcurrent: 0,
  maxChannels: null,
  captionMinutesMonth: 0,
  importCountsAgainstLimits: true,
  audioTracksPerVideo: 0,
  recitationMetadata: true,
  live: true,
  liveHoursMonth: 0,
  liveMaxConcurrent: 0,
  liveMaxStreamMinutes: 0,
  notesMax: null,
};

/** Bounds an admin may set on a tier (validation, not a policy). */
export const CREATOR_TIER_BOUNDS = {
  perHour: { min: 1, max: 100_000 },
  perDay: { min: 1, max: 1_000_000 },
  maxConcurrent: { min: 1, max: 1000 },
  maxChannels: { min: 1, max: 1000 },
  captionMinutesMonth: { min: 0, max: 1_000_000 },
  audioTracksPerVideo: { min: 0, max: 16 },
  liveHoursMonth: { min: 1, max: 10_000 },
  liveMaxConcurrent: { min: 1, max: 100 },
  liveMaxStreamMinutes: { min: 10, max: 1440 },
  notesMax: { min: 1, max: 100_000 },
  sortOrder: { min: 0, max: 10_000 },
} as const;

/** Text lengths of a tier's names and descriptions. */
export const CREATOR_TIER_TEXT = { name: 60, description: 200 } as const;

/** Whether a tier lets its holder upload (unlimited implies it). */
/**
 * A tier's rank: its stored `sortOrder` (column sort_order), which admins set
 * by reordering the Tiers list (drag or move up/down). Lowest first: Free
 * ships at the bottom, Creator in between, Unlimited on top. It orders the
 * Upgrade page and every tier picker, and an upgrade is a tier ranked above
 * the user's current one (owner, 2026-11-15).
 */
export const tierRank = (tier: Pick<CreatorTier, 'sortOrder'> | null | undefined): number => (!tier ? -1 : tier.sortOrder);

/** Ranks written by a reorder: 0, 10, 20, … in list order (room for a new tier in between). */
export const TIER_RANK_STEP = 10;

export const tierAllowsUploads = (tier: Pick<CreatorTier, 'unlimited' | 'uploads'> | null | undefined): boolean => !!tier && (tier.unlimited || tier.uploads);
/** Whether a tier lets its holder create channels (unlimited implies it). */
export const tierAllowsChannels = (tier: Pick<CreatorTier, 'unlimited' | 'channels'> | null | undefined): boolean => !!tier && (tier.unlimited || tier.channels);

/** Whether a tier lets its holder go live (unlimited implies it). */
export const tierAllowsLive = (tier: Pick<CreatorTier, 'unlimited' | 'live'> | null | undefined): boolean => !!tier && (tier.unlimited || tier.live);

/** Error codes for offline download requests (wiki E14, E14-D1 & E14-D2). */
export const OFFLINE_DOWNLOAD_ERROR_CODES = {
  disabled: 'download_disabled_by_creator',
  notAllowed: 'download_not_allowed',
  rateLimited: 'download_rate_limited',
  renditionNotReady: 'rendition_not_ready',
} as const;
export type OfflineDownloadErrorCode = (typeof OFFLINE_DOWNLOAD_ERROR_CODES)[keyof typeof OFFLINE_DOWNLOAD_ERROR_CODES];

/** Why live streaming is refused before any provider is asked (403 / 402, `code` in the answer). */
export const LIVE_TIER_ERROR_CODES = {
  /** 403: the channel owner's tier does not include live streaming (or they hold no tier) */
  notInTier: 'live_not_in_tier',
  /** 402: this month's live hours are used up */
  hoursUsed: 'live_hours_used',
  /** 403: the tier's streams-at-once limit is reached */
  concurrentLimit: 'live_concurrent_limit',
} as const;
export type LiveTierErrorCode = (typeof LIVE_TIER_ERROR_CODES)[keyof typeof LIVE_TIER_ERROR_CODES];

/** Live streaming the signed-in user may do on their own channels (part of GET /api/me/creator). */
export interface LiveAccess {
  allowed: boolean;
  /** Why not: no tier, the tier leaves live out, the month's hours are used, or a pending account deletion */
  reason: 'no_tier' | 'not_in_tier' | 'hours_used' | 'pending_deletion' | null;
  unlimited: boolean;
  /** null when unlimited */
  hoursMonth: number | null;
  /** Minutes streamed this calendar month (UTC) on the user's channels */
  usedMinutes: number;
  maxConcurrent: number | null;
  maxStreamMinutes: number | null;
}

/** A user's tier assignment. */
export interface CreatorTierAssignment {
  userId: string;
  tierId: string;
  source: CreatorTierSource;
  assignedBy: string;
  assignedAt: string;
}

/**
 * Why a tier applies: a stored tier, the super admin role, or 'none' (no row
 * yet, before the Free backfill: treated as Free). 'default' is no longer
 * produced (the default is only written at sign-up); kept for old clients.
 */
export type CreatorTierVia = 'tier' | 'super_admin' | 'default' | 'none';

/**
 * What the signed-in user may do (GET /api/me/creator), for the web UI to show
 * or hide upload and channel-create controls. `via` says why: the stored
 * tier, the super admin role, or 'none' (no row yet: Free).
 */
export interface CreatorAccess {
  /** The user's tier (Free when no row is stored yet) with its uploads and channels flags */
  tier: { id: string; name: string; nameAr?: string | null; unlimited: boolean; uploads?: boolean; channels?: boolean } | null;
  via: CreatorTierVia;
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
  channelsOwned: number;
  maxChannels: number | null;
  limits: { perHour: number; perDay: number; maxConcurrent: number } | null;
  usage: { hour: number; day: number };
  /** Live streaming on the user's own channels */
  live: LiveAccess;
  /**
   * The Upgrade page's mode (tier-requests.ts UPGRADE_MODES), so the header's
   * pill can follow it: "Request tier" (request), "Upgrade" (pay), hidden
   * (closed, or no mode: it could not be read; never advertise requests that may be off)
   */
  upgradeMode?: 'pay' | 'request' | 'closed';
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
  /** The default tier users without an assignment hold (null: the default is None) */
  defaultTier: { id: string; name: string } | null;
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
  /** The tier new sign-ups get (Free as shipped) */
  defaultTierId: DefaultTierId;
  counts: CreatorTierCounts;
  /** Users who hit an upload limit in the last 7 days (the tiers page notice) */
  limitHits7d: number;
  /** Pending invites per tier (admin-api adds it; a tier they carry cannot be deleted) */
  pendingInvites?: Record<string, number>;
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

/** The live capabilities a tier may set on its own; unset, they follow `live` (wiki E17 §3.2). */
export const TIER_LIVE_CAPABILITIES = ['liveChat', 'livePremieres', 'liveEvents'] as const;
export type TierLiveCapability = (typeof TIER_LIVE_CAPABILITIES)[number];

/** Whether a tier includes one of them: never without `live`; unlimited tiers have them all. */
export function tierAllowsLiveCapability(tier: Pick<CreatorTier, 'unlimited' | 'live' | TierLiveCapability> | null | undefined, capability: TierLiveCapability): boolean {
  return !!tier && (tier.unlimited || (tier.live && tier[capability] !== false));
}
