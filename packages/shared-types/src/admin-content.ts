/**
 * Platform content management (admin-web → admin-api → api-videos).
 *
 * Shared by admin-api (enforces permissions, writes the audit log), admin-web
 * (shows only the controls a role may use) and api-videos (owns the data and
 * applies suspensions/bans).
 *
 * Videos admin permissions live here, on the videos side. They are derived
 * from the admin role the token carries; Auth's RBAC is never consulted for
 * them (Auth and Videos are separate apps).
 */

import type { CreatorTierAssignment, CreatorTierOrigin } from './creator-tiers';
import { normalizeRole } from './roles';
import type { MediaRung, TranscodeResult, VideoR2State } from './media-delivery';
import type { MediaOverride, MediaProviderId, PlaybackRules, ProviderMediaStatus } from './media-providers';

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export const ADMIN_CONTENT_PERMISSIONS = [
  /** Edit, verify and suspend channels. */
  'channels:manage',
  /** Move a channel to another owner (super admin only). */
  'channels:transfer',
  /** Edit, move, unpublish and reprocess videos. */
  'videos:manage',
  /** Delete channels, videos, comments, playlists and community posts (soft: restorable for 30 days), and restore them. */
  'content:delete',
  /** Queue a soft-deleted item for permanent deletion before its 30 days are up ("Delete permanently now"). */
  'content:purge',
  /** Edit, ban and erase videos users (videos profiles; never the Auth account). */
  'users:manage',
  /** Assign creator tiers to users and edit the tier definitions (videos-side; never Auth RBAC). */
  'creators:manage',
  /** Warn a videos user (notice in-app and by email) and read their warning history. */
  'users:warn',
  /** Change live streaming provider routing, channel overrides and stream moves, and end stuck sessions (videos admin "Live streaming"). */
  'live:manage',
  /** See the Payments page: providers, prices, subscriptions and billing history (wiki AUN-SUBS). */
  'billing:read',
  /** Prices, tax details, sale modes, price sync, cancel subscriptions and grant complimentary tiers. */
  'billing:manage',
  /** Refund payments (super admin only). */
  'billing:refund',
  /** Payment providers: credentials, test/live mode and the enable switch (super admin only). */
  'billing:providers',
  /**
   * Creator support (wiki AUN-MEMBERS §9.6): see the Support pages, and retry or cancel support jobs.
   * Super admins only. Money actions (refunds, payouts, ledger, providers, disputes) are NOT admin
   * roles: they need a place on the organization's finance list (support:* in support.ts).
   */
  'support:read',
  'support:manage',
] as const;

export type AdminContentPermission = (typeof ADMIN_CONTENT_PERMISSIONS)[number];

/**
 * Role → permissions. Roles are the existing admin roles (snake_case ids);
 * moderators can browse every list and detail page and warn users, but
 * change nothing else here.
 */
export const ROLE_CONTENT_PERMISSIONS: Readonly<Record<string, readonly AdminContentPermission[]>> = {
  super_admin: ADMIN_CONTENT_PERMISSIONS,
  admin: ['channels:manage', 'videos:manage', 'content:delete', 'content:purge', 'users:manage', 'creators:manage', 'users:warn', 'live:manage', 'billing:read', 'billing:manage'],
  moderator: ['users:warn'],
};

/** Every permission granted by any of the roles (display names or ids). */
export function contentPermissionsFor(roles: readonly unknown[] | undefined | null): AdminContentPermission[] {
  const granted = new Set<AdminContentPermission>();
  for (const role of roles ?? []) {
    for (const permission of ROLE_CONTENT_PERMISSIONS[normalizeRole(role)] ?? []) granted.add(permission);
  }
  return ADMIN_CONTENT_PERMISSIONS.filter((p) => granted.has(p));
}

export function hasContentPermission(roles: readonly unknown[] | undefined | null, permission: AdminContentPermission): boolean {
  return contentPermissionsFor(roles).includes(permission);
}

// ---------------------------------------------------------------------------
// Suspension holds
// ---------------------------------------------------------------------------

/**
 * A suspended channel or a banned user hides content by setting `isHidden`,
 * which every public read path, the search index and the ownership index
 * already honour. Each reason is a "hold" (`channel:<id>`, `user:<id>`), so a
 * video hidden by both its channel's suspension and its owner's ban stays
 * hidden until both are lifted, and lifting never un-hides content that
 * moderation hid on its own.
 */
export interface SuspendableRecord {
  isHidden?: boolean;
  suspensionHolds?: string[];
  /** isHidden as it was before the first hold (moderation's own decision). */
  hiddenBeforeSuspension?: boolean;
  [key: string]: unknown;
}

export const channelHold = (channelId: string) => `channel:${channelId}`;
export const userHold = (userId: string) => `user:${userId}`;

/** Adds a hold; returns false when the record already had it. */
export function applySuspensionHold(record: SuspendableRecord, hold: string): boolean {
  const holds = Array.isArray(record.suspensionHolds) ? record.suspensionHolds.filter((h) => typeof h === 'string') : [];
  if (holds.includes(hold)) return false;
  if (holds.length === 0) record.hiddenBeforeSuspension = record.isHidden === true;
  record.suspensionHolds = [...holds, hold];
  record.isHidden = true;
  return true;
}

/** Removes a hold; the last one restores isHidden. Returns false when the record did not have it. */
export function liftSuspensionHold(record: SuspendableRecord, hold: string): boolean {
  const holds = Array.isArray(record.suspensionHolds) ? record.suspensionHolds : [];
  if (!holds.includes(hold)) return false;
  const remaining = holds.filter((h) => h !== hold);
  if (remaining.length > 0) {
    record.suspensionHolds = remaining;
    return true;
  }
  // Moderation may have hidden it while it was held (moderationAction 'removed'/'banned')
  const moderated = record.moderationAction === 'removed' || record.moderationAction === 'banned';
  record.isHidden = record.hiddenBeforeSuspension === true || moderated;
  delete record.suspensionHolds;
  delete record.hiddenBeforeSuspension;
  return true;
}

/**
 * Holds that hide what sits under a soft-deleted channel or user (their
 * videos, live streams, playlists, channels) until it is restored or purged.
 */
export const deletedChannelHold = (channelId: string) => `deleted-channel:${channelId}`;
export const deletedUserHold = (userId: string) => `deleted-user:${userId}`;

export function isHeldBy(record: SuspendableRecord | null | undefined, hold: string): boolean {
  return Array.isArray(record?.suspensionHolds) && record!.suspensionHolds!.includes(hold);
}

/** Who suspended a channel and why (stored on the channel as `suspension`). */
export interface SuspensionInfo {
  at: string;
  by: string;
  reason?: string;
}

/** Error code api-videos answers to a banned user's signed-in requests. */
export const VIDEOS_BANNED_CODE = 'videos_banned';

/**
 * Error code (403) api-videos answers to a signed-in user whose videos data an
 * admin deleted, while that deletion is pending (restorable for 30 days): every
 * write is refused, and GET /api/profile answers it too so clients show the
 * state instead of "create your profile". Reads and sign-in keep working; an
 * admin restore lifts it at once; after the purge the user starts fresh.
 * Body: { success: false, code, error, deletion: { deletedAt, purgeAfter } }.
 * Contract for web and the native apps: docs/native-apps/videos-account-states.md.
 */
export const VIDEOS_ACCOUNT_PENDING_DELETION_CODE = 'videos_account_pending_deletion';

/** The English text sent with VIDEOS_ACCOUNT_PENDING_DELETION_CODE (clients show their own en/ar words). */
export const VIDEOS_ACCOUNT_PENDING_DELETION_MESSAGE = 'Your videos account is scheduled for deletion. Contact support.';

// ---------------------------------------------------------------------------
// List queries and rows (admin-api ↔ api-videos ↔ admin-web)
// ---------------------------------------------------------------------------

export const ADMIN_PAGE_SIZES = [20, 50, 100] as const;

export interface AdminPage<T> {
  items: T[];
  /** -1 when the caller asked for `noTotal` (a picker's page: no COUNT over the whole list) */
  total: number;
  page: number;
  pageSize: number;
  /** False while the admin index is still being (re)built: the list may be partial. */
  indexComplete: boolean;
}

export type AdminChannelSort = 'newest' | 'oldest' | 'name' | 'views';
export const ADMIN_CHANNEL_SORTS: readonly AdminChannelSort[] = ['newest', 'oldest', 'name', 'views'];

export interface AdminChannelQuery {
  q?: string;
  verified?: 'yes' | 'no';
  suspended?: 'yes' | 'no';
  /** Only channels with open reports (admin-api resolves this from the reports DB). */
  ids?: string[];
  createdFrom?: string;
  createdTo?: string;
  ownerId?: string;
  sort?: AdminChannelSort;
  page?: number;
  pageSize?: number;
  /** Skip the total (COUNT over the list): pickers page through and never show it */
  noTotal?: boolean;
}

export interface AdminChannelRow {
  id: string;
  name: string;
  /** Localized names per language ('en', 'ar') when set on the channel. */
  nameLocalized?: Record<string, string>;
  handle: string | null;
  ownerId: string | null;
  ownerEmail: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  isSuspended: boolean;
  isPrivate: boolean;
  isDeleted: boolean;
  subscribers: number;
  views: number;
  createdAt: string | null;
  openReports?: number;
}

export interface AdminChannelDetail extends AdminChannelRow {
  description: string;
  /** Localized descriptions per language ('en', 'ar') when set on the channel. */
  descriptionLocalized?: Record<string, string>;
  coverUrl: string | null;
  isMain: boolean;
  suspension: SuspensionInfo | null;
  stats: { videos: number; subscribers: number; views: number; playlists: number };
  owner: AdminUserRow | null;
}

export type AdminVideoStatus = 'initiated' | 'uploading' | 'processing' | 'ready' | 'failed';
export const ADMIN_VIDEO_STATUSES: readonly AdminVideoStatus[] = ['initiated', 'uploading', 'processing', 'ready', 'failed'];
/** Videos are public or private (isPublic); there is no third stored visibility. */
export type AdminVideoVisibility = 'public' | 'private';
export type AdminVideoSort = 'newest' | 'oldest' | 'views' | 'title';
export const ADMIN_VIDEO_SORTS: readonly AdminVideoSort[] = ['newest', 'oldest', 'views', 'title'];

export interface AdminVideoQuery {
  q?: string;
  channelId?: string;
  /** 'none' = legacy videos without a channel. */
  noChannel?: boolean;
  ownerId?: string;
  status?: AdminVideoStatus;
  visibility?: AdminVideoVisibility;
  hidden?: 'yes' | 'no';
  ids?: string[];
  createdFrom?: string;
  createdTo?: string;
  sort?: AdminVideoSort;
  page?: number;
  pageSize?: number;
  /** Skip the total (COUNT over the list): pickers page through and never show it */
  noTotal?: boolean;
}

/** A video's R2 rendition state as the admin list shows it (from the video record's `r2`; null = never queued). */
export type AdminVideoR2Badge = Pick<VideoR2State, 'status' | 'progress' | 'error'>;

/** What the Processing card shows of a finished transcode: the rungs written, the source read, the timings. */
export interface AdminVideoR2Result {
  rungs: Pick<MediaRung, 'name' | 'width' | 'height' | 'bandwidth' | 'bytes'>[];
  source: Pick<TranscodeResult['source'], 'width' | 'height' | 'file'>;
  timings?: TranscodeResult['timings'];
}

/** The R2 side of a video for the admin video page (the record's `r2`, the transcode result summarised). */
export type AdminVideoR2 = Pick<
  VideoR2State,
  'status' | 'jobId' | 'rev' | 'access' | 'attempts' | 'queuedAt' | 'startedAt' | 'readyAt' | 'failedAt' | 'error' | 'progress' | 'failure' | 'rungs' | 'containerSeconds'
> & { result?: AdminVideoR2Result };

export interface AdminVideoRow {
  id: string;
  /** The stored title; empty when the video has none (never the id: the admin shows "Untitled video"). */
  title: string;
  /** Creator-written titles per language (en, ar); the admin shows the one in its own language first. */
  titleLocalized?: Record<string, string>;
  channelId: string | null;
  channelName: string | null;
  ownerId: string | null;
  /** The uploader's display name (from the admin index); absent from older API builds. */
  ownerName?: string | null;
  status: string | null;
  isPublic: boolean;
  isHidden: boolean;
  isDeleted: boolean;
  views: number;
  duration: number | null;
  thumbnailUrl: string | null;
  createdAt: string | null;
  openReports?: number;
  /** R2 transcode state (epic #687); null when the video was never queued for R2. Absent from older api-videos. */
  r2?: AdminVideoR2Badge | null;
}

export interface AdminVideoDetail extends AdminVideoRow {
  description: string;
  /** Localized descriptions per language ('en', 'ar') when set on the video. */
  descriptionLocalized?: Record<string, string>;
  playUrl: string | null;
  videoUrl: string | null;
  availableResolutions: string[];
  width: number | null;
  height: number | null;
  fileSize: number | null;
  category: string | null;
  language: string | null;
  tags: string[];
  commentCount: number;
  likeCount: number;
  suspensionHolds: string[];
  moderationAction: string | null;
  updatedAt: string | null;
  /** Live status from Bunny Stream when it could be read. */
  processing: { status: string; encodeProgress: number | null; resolutions: string[] } | null;
  /** Why Bunny processing stopped (stalled, needs_reupload …); null or absent when nothing is wrong. */
  processingIssue?: { kind: string; reason?: string; at: string } | null;
  /** R2 transcode state (epic #687); null when the video was never queued for R2. */
  r2?: AdminVideoR2 | null;
  /** Which providers hold the video and how it plays (docs/media-delivery/PROVIDERS.md). Absent from older api-videos. */
  media?: AdminVideoMedia | null;
}

/** One provider's copy of a video as the admin sees it (no provider-side ids). */
export interface AdminVideoProviderCopy {
  provider: MediaProviderId;
  status: ProviderMediaStatus;
  renditions: string[];
  readyAt?: string;
  error?: string;
  /** Read from a row written before provider records existed */
  legacy?: boolean;
}

export interface AdminVideoMedia {
  copies: AdminVideoProviderCopy[];
  /** This video's playback override; null when it follows its channel and the global settings */
  override: MediaOverride | null;
  /** The channel's override applies (Delivery settings) */
  channelOverride: boolean;
  /** The rules a play of this video uses now: global, then channel, then video override */
  effective: PlaybackRules;
  /** Providers switched on in the Delivery settings */
  enabled: MediaProviderId[];
}

export interface AdminCommentRow {
  id: string;
  videoId: string;
  videoTitle: string;
  parentId: string | null;
  userId: string;
  channelId: string | null;
  text: string;
  isHidden: boolean;
  status: string | null;
  createdAt: string;
}

export interface AdminCommentQuery {
  q?: string;
  videoId?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
  /** Skip the total (COUNT over the list): pickers page through and never show it */
  noTotal?: boolean;
}

export interface AdminPlaylistRow {
  id: string;
  title: string;
  /** Per-language names ('en', 'ar'); show with localizedPlaylistText (playlist-title.ts) */
  titleLocalized?: Record<string, string>;
  /** null for a personal playlist (made without a channel, the owner's alone) */
  channelId: string | null;
  ownerId: string | null;
  isPublic: boolean;
  /** Link-only: opens for anyone with the link, never listed */
  isUnlisted?: boolean;
  videoCount: number;
  createdAt: string | null;
}

export interface AdminPostRow {
  id: string;
  channelId: string;
  ownerId: string | null;
  type: string | null;
  text: string;
  likes: number;
  comments: number;
  createdAt: string | null;
}

export interface AdminListQuery {
  q?: string;
  channelId?: string;
  ownerId?: string;
  page?: number;
  pageSize?: number;
}

export type AdminUserSort = 'newest' | 'oldest' | 'name';
export const ADMIN_USER_SORTS: readonly AdminUserSort[] = ['newest', 'oldest', 'name'];

/**
 * The Users list's tier filter: a tier id, `none` (no tier), or one of these
 * (underscores, so no tier id can collide: ids are [a-z0-9-]).
 */
export const ADMIN_USER_TIER_FILTERS = ['needs_tier', 'has_tier', 'hit_limit'] as const;
export type AdminUserTierFilter = (typeof ADMIN_USER_TIER_FILTERS)[number];

export interface AdminUserQuery {
  q?: string;
  banned?: 'yes' | 'no';
  /** needs_tier: owns a channel or uploaded but holds no tier; has_tier; hit_limit: an upload limit in 7 days; `none`; or a tier id */
  tier?: string;
  sort?: AdminUserSort;
  page?: number;
  pageSize?: number;
  /** Skip the total (COUNT over the list): pickers page through and never show it */
  noTotal?: boolean;
}

/** A videos user: the api-videos profile keyed by the token's usr_ id. */
export interface AdminUserRow {
  id: string;
  displayName: string;
  userName: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
  isBanned: boolean;
  /** True when the ban record exists but the videos profile was deleted. */
  profileDeleted?: boolean;
  /**
   * Set by admin-api when the user was invited (docs/admin/INVITES.md):
   * invited (not signed in yet), active (signed in), expired, revoked,
   * sending/failed (the auth account is being made / could not be).
   */
  invite?: { id: string; status: 'sending' | 'failed' | 'invited' | 'active' | 'expired' | 'revoked' } | null;
  /** Set by admin-api: the user's warnings so far (user_warnings); absent when it could not be read. */
  warningCount?: number;
  /** Set on the Users list (api-videos): the user's creator tier, where it came from, and limit hits. */
  creator?: AdminUserCreatorInfo;
}

/** A Users list row's creator tier (what the old Creators page showed per user). */
export interface AdminUserCreatorInfo {
  assignment: CreatorTierAssignment | null;
  /** Where the tier comes from (null: no tier) */
  origin: CreatorTierOrigin | null;
  /** Display name of the admin who assigned it (videos profile), when known */
  assignedByName: string | null;
  /** Owns a channel or has uploaded, but holds no tier */
  needsTier: boolean;
  /** Upload-limit refusals in the last 7 days */
  limitHits7d: number;
}

/** The Users list page: rows plus the creator notices (needs a tier, hit a limit this week). */
export interface AdminUsersPage<T = AdminUserRow> extends AdminPage<T> {
  creators?: { needsTier: number; limitHits7d: number; defaultTier?: { id: string; name: string } | null };
}

/** User search for pickers (channel ownership transfer): 2+ characters, a few best matches. */
export const ADMIN_USER_SEARCH_MIN_LENGTH = 2;
export const ADMIN_USER_SEARCH_MAX_RESULTS = 8;

export interface AdminUserSearchQuery {
  /** Email, display name, @handle (user or channel handle) or usr_ id. */
  q: string;
  /** Leave these users out (the channel's current owner). */
  exclude?: string[];
  /** Report each user's role on this channel. */
  channelId?: string;
  limit?: number;
}

/** One picker result: the user, how many channels they own, and their role on the channel in question. */
export interface AdminUserSearchItem extends AdminUserRow {
  /** Channels the user owns (not deleted). */
  channelCount: number;
  /** The user's member role on `channelId` ('admin' | 'editor' | 'moderator'), if any. */
  channelRole: string | null;
}

export interface VideosBan {
  userId: string;
  reason: string | null;
  bannedBy: string;
  bannedAt: string;
}

export interface AdminUserDetail extends AdminUserRow {
  bio: string;
  timezone: string | null;
  updatedAt: string | null;
  ban: VideosBan | null;
  /** The user's creator tier assignment; null = no tier (cannot upload or create channels). */
  creatorTier?: CreatorTierAssignment | null;
  channels: AdminChannelRow[];
  counts: { videos: number; playlists: number; watchHistory: number; subscriptions: number; comments: number };
  /** Set by admin-api: the user's saved email language (null = never picked or unreadable); the Warn dialog preselects it. */
  emailLanguage?: 'en' | 'ar' | null;
}

/** Result of a cascade (suspension, ban, delete) over a user's or channel's content. */
export interface AdminCascadeResult {
  videos: number;
  channels: number;
  failed: number;
  complete: boolean;
}

/** Audit log entry (admin-api's site_settings_log rows for content keys). */
export interface AdminAuditEntry {
  id: string;
  key: string;
  action: string;
  details: Record<string, unknown> | null;
  actorId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Admin jobs (heavy actions run from a queue, with retries and a DLQ)
// ---------------------------------------------------------------------------

/**
 * Heavy admin actions are jobs: the request makes the quick single-record
 * change (e.g. the channel is suspended at once), queues the rest and
 * returns. Each kind is idempotent, so a retry finishes a partial run.
 */
export const ADMIN_JOB_KINDS = [
  /** Make the channel's videos and live streams follow its suspension state. */
  'channel.sync-holds',
  /** Erase a deleted channel's videos (R2, Bunny, search, notifications) and content. */
  'channel.purge',
  /** Move a channel with its videos and playlists to another videos user. */
  'channel.transfer',
  /** Move a video into another channel. */
  'video.move',
  /** Erase a deleted video (R2, Bunny, search, notifications). */
  'video.purge',
  /** Make a user's channels, videos and live streams follow their ban state. */
  'user.sync-holds',
  /** Erase a user's videos data (privacy path), in resumable steps. */
  'user.delete-data',
  /**
   * Erase an E2E run account (QA/stage) through the indexes, no bucket scans (#887). On its own
   * queue (RUN_ERASE_QUEUE) so the sweep never holds up admin jobs.
   */
  'user.erase-run',
  /**
   * Fill empty fields of usr_ profiles from the user's pre-SSO profile (the
   * fields an admin approved in the dry run; pre-change copy backed up first).
   */
  'profiles.restore-legacy',
  /**
   * Check every video's thumbnail against its shape (Bunny's width/height) and
   * replace auto frames captured at the wrong aspect, in resumable steps
   * (api-videos lib/thumbnail/repair.ts). Target id 'thumbnail-repair'.
   */
  'videos.repair-thumbnails',
  /**
   * Rebuild the ownership index of one kind (videos, channels or profiles:
   * the admin lists) with a full pass over its bucket, in resumable steps; fails
   * (and retries) while the index still misses stored objects (api-videos
   * lib/search/ownershipRebuild.ts). Target id 'ownership-index'; started from
   * the Errors page's "Index out of sync" flag.
   */
  'search.rebuild-ownership',
  /**
   * Add many videos to one channel playlist, in resumable steps (api-videos
   * lib/playlistBulk.ts): adds above the synchronous cap, and adds whose
   * request write failed (the playlist stays, the add finishes here). Target
   * the playlist's channel; params name the playlist and the ordered ids.
   * Idempotent: a video already in the playlist is skipped.
   */
  'playlist.add-videos',
  // Admin Tools import (wiki TOOLS-ADMIN TA-6): a file's sidecars (captions, chapters, thumbnail, playlist, publish date) onto its video
  'import.attach',
  /**
   * Take a CSAM match down (api-videos lib/csam/contain.ts, docs/specs/CSAM-RESPONSE.md):
   * encrypted evidence copy, then every copy purged (R2, originals, Bunny, images, CDN), then the
   * uploader banned. Resumable phases in params; the last failure flags the admin. Target the
   * video, the channel (post, channel image) or the user (profile image).
   */
  'csam.contain',
  /**
   * Fill the image_owners index (api-videos lib/csam/imageOwners.ts) from stored profiles,
   * channels and posts, so a matched avatar, cover or post image maps to its uploader. Resumable,
   * idempotent (INSERT OR IGNORE). Target 'user' / 'image-owners'.
   */
  'images.index-owners',
  /**
   * R2 transcode troubleshooting (videos admin → Delivery): "Retry now" on one video's transcode
   * (api-videos lib/media/troubleshoot.ts retryTranscodeNow). Target the video.
   */
  'media.transcode-retry',
  /** "Cancel" one video's R2 transcode: container stopped, partial output deleted, record marked cancelled. Target the video. */
  'media.transcode-cancel',
  /**
   * Payments (wiki AUN-SUBS; api-videos lib/billing/service.ts). Target kind 'billing':
   * a webhook event id, a provider id, a subscription id or a payment id.
   */
  'billing.webhook',
  'billing.sync-prices',
  'billing.cancel',
  'billing.refund',
  'billing.reconcile',
  /**
   * Discovery ranking (wiki E07; api-videos lib/ranking/job.ts): rank every listed video and
   * rewrite the rails that changed. Queued hourly by the cron and by an admin's "Run now".
   * Target 'video' / 'discovery-rails'.
   */
  'discovery.rank',
  /**
   * Re-read objects whose index write failed (index_repairs) from R2 and
   * rewrite their ownership and search rows, with backoff; objects that keep
   * failing are listed on the Errors page with Retry (api-videos
   * lib/search/repairs.ts). One job at a time, target 'index-repairs'.
   */
  'search.repair-objects',
  /**
   * One full reconcile pass of a search table (search_videos, …) against its
   * bucket, in queued steps of 2000 objects: refreshes rows, queues objects it
   * could not index for repair, prunes rows of objects gone from R2 and sets
   * or clears the search drift flag (api-videos lib/search/backfill.ts).
   * Target 'search-index:<entity>'.
   */
  'search.reconcile',
  /**
   * Creator support (wiki AUN-MEMBERS §9.4; api-videos lib/support/jobs.ts). Target kind 'support':
   * a vendor event id, a payee id or the day. Every job is idempotent; the ledger posts once per key.
   */
  'support.webhook',
  'support.release',
  'support.reconcile',
  'support.payee-sync',
  'support.dispute-deadline',
  'support.dormant',
  /** Payouts (wiki AUN-MEMBERS §2.6, MEM-23): plan a batch, check the rail is funded, send one payout, read statuses. */
  'support.payout-plan',
  'support.payout-fund',
  'support.payout-send',
  'support.payout-status',
] as const;

export type AdminJobKind = (typeof ADMIN_JOB_KINDS)[number];
/** `cancelled`: an admin stopped it (Jobs page Cancel); it runs again only through Retry. */
export const ADMIN_JOB_STATUSES = ['queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled'] as const;
export type AdminJobStatus = (typeof ADMIN_JOB_STATUSES)[number];
export type AdminJobTarget = 'channel' | 'video' | 'user' | 'billing' | 'support';

export interface AdminJob {
  id: string;
  kind: AdminJobKind;
  targetKind: AdminJobTarget;
  targetId: string;
  params: Record<string, unknown>;
  status: AdminJobStatus;
  attempts: number;
  /** Deliveries a run gets before it is marked failed (ADMIN_JOB_MAX_RETRIES + 1) */
  maxAttempts: number;
  /** When the queue delivers it next (a retry after a failed attempt, or a step that waits); null when not waiting */
  nextRunAt: string | null;
  lastError: string | null;
  result: Record<string, unknown> | null;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /** What happened to the job, oldest first (GET /jobs/:id only; the newest ADMIN_JOB_LOG_LIMIT lines) */
  log?: AdminJobLogEntry[];
}

/**
 * One line of a job's log. Events, not sentences, so the admin reads it in their language:
 *   queued       created, or queued again by Retry (`retried: true`)
 *   started      a delivery began (`attempt`)
 *   waiting      a step finished and the next one waits `delaySeconds` (resumable work)
 *   failed_attempt  the attempt threw (`error`); it runs again after `delaySeconds`
 *   failed       the last attempt threw, or the queue refused it (`error`)
 *   succeeded    done
 *   cancelled    an admin stopped it
 */
export const ADMIN_JOB_LOG_EVENTS = ['queued', 'started', 'waiting', 'failed_attempt', 'failed', 'succeeded', 'cancelled'] as const;
export type AdminJobLogEvent = (typeof ADMIN_JOB_LOG_EVENTS)[number];
export interface AdminJobLogEntry {
  at: string;
  event: AdminJobLogEvent;
  attempt?: number;
  error?: string;
  delaySeconds?: number;
  retried?: boolean;
}
/** Lines kept per job: the oldest go first. */
export const ADMIN_JOB_LOG_LIMIT = 50;

/**
 * Kinds Cancel never applies to: a data erasure, once asked for, runs to the end (a cancel arriving
 * after its last step would leave the person's id in the job's own records).
 */
export const ADMIN_JOB_UNCANCELLABLE_KINDS: readonly AdminJobKind[] = ['user.delete-data', 'user.erase-run'];

/** The permission an admin needs to retry a job of each kind (the same one that started it). */
export const ADMIN_JOB_PERMISSIONS: Readonly<Record<AdminJobKind, readonly AdminContentPermission[]>> = {
  'channel.sync-holds': ['channels:manage'],
  'channel.purge': ['content:delete'],
  'channel.transfer': ['channels:transfer'],
  'video.move': ['videos:manage'],
  'video.purge': ['content:delete'],
  'user.sync-holds': ['users:manage'],
  'user.delete-data': ['users:manage', 'content:delete'],
  'user.erase-run': ['users:manage', 'content:delete'],
  'profiles.restore-legacy': ['users:manage'],
  'videos.repair-thumbnails': ['videos:manage'],
  'search.rebuild-ownership': ['videos:manage'],
  'playlist.add-videos': ['videos:manage'],
  'import.attach': ['videos:manage'],
  // admin-api also requires a super admin for this kind (CSAM cases are super-admin only)
  'csam.contain': ['users:manage', 'content:delete'],
  'images.index-owners': ['users:manage'],
  // Started with media:manage (admins and super admins), who also hold videos:manage
  'media.transcode-retry': ['videos:manage'],
  'media.transcode-cancel': ['videos:manage'],
  // Retrying runs the action again, so it needs the action's own permission (wiki AUN-SUBS)
  'billing.webhook': ['billing:manage'],
  'billing.sync-prices': ['billing:providers'],
  'billing.cancel': ['billing:manage'],
  'billing.refund': ['billing:refund'],
  'billing.reconcile': ['billing:manage'],
  'discovery.rank': ['videos:manage'],
  'search.repair-objects': ['videos:manage'],
  'search.reconcile': ['videos:manage'],
  // Support jobs book money that has already moved; retrying them moves none (wiki AUN-MEMBERS §9.6 Jobs)
  'support.webhook': ['support:manage'],
  'support.release': ['support:manage'],
  'support.reconcile': ['support:manage'],
  'support.payee-sync': ['support:manage'],
  'support.dispute-deadline': ['support:manage'],
  'support.dormant': ['support:manage'],
  // A payout retry never pays twice (the payout id is the rail's idempotency key) and only resumes a batch the
  // organization's finance list already approved; approving is the finance list's own action (admin-api)
  'support.payout-plan': ['support:manage'],
  'support.payout-fund': ['support:manage'],
  'support.payout-send': ['support:manage'],
  'support.payout-status': ['support:manage'],
};

// ---------------------------------------------------------------------------
// Restore legacy profile fields (admin job 'profiles.restore-legacy')
// ---------------------------------------------------------------------------

/** The job's target: one job covers every profile it restores (they are audited one by one). */
export const LEGACY_RESTORE_TARGET = { kind: 'user', id: 'legacy-profiles' } as const;

/** One usr_ profile the dry run would fill from its legacy record. */
export interface LegacyRestoreItem {
  /** The usr_ profile */
  id: string;
  /** The legacy (pre-SSO, 32-hex) record it is filled from */
  legacyId: string;
  /**
   * The account's verified email (auth service) the pairing rests on. Shown so
   * the admin confirms the person: no system records who owned a legacy id.
   */
  email: string;
  /** Field paths (`firstNameLocalized.ar`, `coverUrl`) with the value now and the value it would get */
  changes: { field: string; from: unknown; to: unknown }[];
}

/** The dry run: nothing is written. */
export interface LegacyRestorePlan {
  /** Legacy records found in the profiles bucket */
  legacyCount: number;
  /** Legacy records paired with a usr_ profile through the auth service's verified email */
  pairedCount: number;
  items: LegacyRestoreItem[];
  /** Legacy records with no usr_ profile of that verified email (left alone) */
  unmatched: string[];
  /** Emails with several legacy records or several users (left alone); counted, never listed */
  ambiguousCount: number;
}

/** What the job did, per profile (the job's result). */
export interface LegacyRestoreResult {
  written: { id: string; legacyId: string; fields: string[]; backupKey: string }[];
  skipped: { id: string; reason: string }[];
}

/** Retries per job delivery before it is marked failed and dead-lettered (matches the queue's max_retries). */
export const ADMIN_JOB_MAX_RETRIES = 5;

/**
 * Admin autocomplete (admin-api GET /api/suggest/:kind). Every search and
 * lookup box in the admin suggests these as the admin types, so nobody has to
 * know or paste a raw id.
 */
export const ADMIN_SUGGEST_KINDS = ['channel', 'user', 'video', 'playlist', 'post', 'comment', 'contact', 'error', 'invite', 'report'] as const;
export type AdminSuggestKind = (typeof ADMIN_SUGGEST_KINDS)[number];

export interface AdminSuggestion {
  kind: AdminSuggestKind;
  id: string;
  /** Name, title or text: what the admin recognises */
  label: string;
  /** @handle, email, channel or app: what tells two similar labels apart */
  secondary: string | null;
  imageUrl: string | null;
  /** The item this one belongs to (a comment's video, a post's channel), for its link */
  parentId?: string | null;
  /** Reports: open reports on the item (the suggestion id is the group key `${type}:${id}`). */
  count?: number;
  /** Users: invited and not signed in yet (docs/admin/INVITES.md), shown as an "Invited" badge */
  badge?: 'invited' | null;
}

/** Suggestions per request: enough to choose from, small enough to read at a glance. */
export const ADMIN_SUGGEST_LIMIT = 8;

/** A picker's page before anything is typed (pickers open with content; more load on scroll). */
export const ADMIN_SUGGEST_INITIAL_LIMIT = 20;

// ---------------------------------------------------------------------------
// Soft delete (owner rule 2026-11-10): every admin delete is restorable for 30
// days, then a scheduled cleanup purges it. "Delete permanently now" only
// queues the item for that same cleanup; the cleanup is the one hard-delete path.
// ---------------------------------------------------------------------------

/** Days a soft-deleted item stays restorable before the cleanup purges it. */
export const SOFT_DELETE_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

export const ADMIN_DELETION_KINDS = ['channel', 'video', 'comment', 'playlist', 'post', 'user'] as const;
export type AdminDeletionKind = (typeof ADMIN_DELETION_KINDS)[number];

/**
 * deleted: restorable, purged when its 30 days are up;
 * queued: an admin asked for permanent deletion, the next cleanup run purges it (still restorable until then);
 * purging: the purge has started (no longer restorable);
 * purged: gone.
 */
export type AdminDeletionStatus = 'deleted' | 'queued' | 'purging' | 'purged';

export interface AdminDeletion {
  kind: AdminDeletionKind;
  id: string;
  /** The video of a comment, the channel of a community post. */
  parentId: string | null;
  title: string;
  ownerId: string | null;
  channelId: string | null;
  deletedAt: string;
  deletedBy: string;
  reason: string | null;
  purgeRequestedAt: string | null;
  purgeRequestedBy: string | null;
  /** When the cleanup purges it at the latest (deletedAt + 30 days). */
  purgeAfter: string;
  purgeStartedAt: string | null;
  purgedAt: string | null;
  purgeJobId: string | null;
  attempts: number;
  lastError: string | null;
  status: AdminDeletionStatus;
}

export interface AdminDeletionCleanupRun {
  at: string;
  due: number;
  purged: number;
  started: number;
  failed: number;
  skipped: number;
}

export interface AdminDeletionPage {
  items: AdminDeletion[];
  nextCursor: string | null;
  lastRun: AdminDeletionCleanupRun | null;
}

/** deletedAt + 30 days, as an ISO string. */
export function purgeAfterOf(deletedAt: string): string {
  const at = Date.parse(deletedAt);
  return new Date((Number.isFinite(at) ? at : 0) + SOFT_DELETE_RETENTION_DAYS * DAY_MS).toISOString();
}

/** Whole days left before the cleanup purges it (0 when due). */
export function deletionDaysLeft(deletion: Pick<AdminDeletion, 'deletedAt'>, now: number = Date.now()): number {
  const left = Date.parse(purgeAfterOf(deletion.deletedAt)) - now;
  return left <= 0 ? 0 : Math.ceil(left / DAY_MS);
}

/** Whether the cleanup should purge it now: 30 days are up, or an admin queued it. */
export function isPurgeDue(deletion: Pick<AdminDeletion, 'deletedAt' | 'purgeRequestedAt' | 'purgedAt'>, now: number = Date.now()): boolean {
  if (deletion.purgedAt) return false;
  if (deletion.purgeRequestedAt) return true;
  return Date.parse(purgeAfterOf(deletion.deletedAt)) <= now;
}

export function deletionStatusOf(deletion: Pick<AdminDeletion, 'purgeRequestedAt' | 'purgeStartedAt' | 'purgedAt'>): AdminDeletionStatus {
  if (deletion.purgedAt) return 'purged';
  if (deletion.purgeStartedAt) return 'purging';
  if (deletion.purgeRequestedAt) return 'queued';
  return 'deleted';
}
