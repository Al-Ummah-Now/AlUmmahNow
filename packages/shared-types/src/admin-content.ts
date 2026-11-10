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

import type { CreatorTierAssignment } from './creator-tiers';
import { normalizeRole } from './roles';

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
  /** Delete channels, videos, comments, playlists and community posts. */
  'content:delete',
  /** Edit, ban and erase videos users (videos profiles; never the Auth account). */
  'users:manage',
  /** Assign creator tiers to users and edit the tier definitions (videos-side; never Auth RBAC). */
  'creators:manage',
] as const;

export type AdminContentPermission = (typeof ADMIN_CONTENT_PERMISSIONS)[number];

/**
 * Role → permissions. Roles are the existing admin roles (snake_case ids);
 * moderators can browse every list and detail page but change nothing here.
 */
export const ROLE_CONTENT_PERMISSIONS: Readonly<Record<string, readonly AdminContentPermission[]>> = {
  super_admin: ADMIN_CONTENT_PERMISSIONS,
  admin: ['channels:manage', 'videos:manage', 'content:delete', 'users:manage', 'creators:manage'],
  moderator: [],
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

// ---------------------------------------------------------------------------
// List queries and rows (admin-api ↔ api-videos ↔ admin-web)
// ---------------------------------------------------------------------------

export const ADMIN_PAGE_SIZES = [20, 50, 100] as const;

export interface AdminPage<T> {
  items: T[];
  /** Matching rows, counted up to ADMIN_TOTAL_CAP (see totalCapped). */
  total: number;
  page: number;
  pageSize: number;
  /** False while the admin index is still being (re)built: the list may be partial. */
  indexComplete: boolean;
  /** Next page (pass back as `cursor`); empty or absent at the end. Pages are keyset seeks however deep. */
  cursor?: string;
  /** True when more than ADMIN_TOTAL_CAP rows match (`total` is the cap: show "cap+"). */
  totalCapped?: boolean;
}

/** Admin list totals are counted up to this many rows (a bounded count per request). */
export const ADMIN_TOTAL_CAP = 1000;

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
  /** Keyset cursor of the previous page (AdminPage.cursor); takes precedence over `page`. */
  cursor?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminChannelRow {
  id: string;
  name: string;
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
  /** Keyset cursor of the previous page (AdminPage.cursor); takes precedence over `page`. */
  cursor?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminVideoRow {
  id: string;
  title: string;
  channelId: string | null;
  channelName: string | null;
  ownerId: string | null;
  status: string | null;
  isPublic: boolean;
  isHidden: boolean;
  isDeleted: boolean;
  views: number;
  duration: number | null;
  thumbnailUrl: string | null;
  createdAt: string | null;
  openReports?: number;
}

export interface AdminVideoDetail extends AdminVideoRow {
  description: string;
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
  /** Keyset cursor of the previous page (AdminPage.cursor); takes precedence over `page`. */
  cursor?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminPlaylistRow {
  id: string;
  title: string;
  channelId: string | null;
  ownerId: string | null;
  isPublic: boolean;
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

export interface AdminUserQuery {
  q?: string;
  banned?: 'yes' | 'no';
  sort?: AdminUserSort;
  /** Keyset cursor of the previous page (AdminPage.cursor); takes precedence over `page`. */
  cursor?: string;
  page?: number;
  pageSize?: number;
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
] as const;

export type AdminJobKind = (typeof ADMIN_JOB_KINDS)[number];
export const ADMIN_JOB_STATUSES = ['queued', 'running', 'retrying', 'succeeded', 'failed'] as const;
export type AdminJobStatus = (typeof ADMIN_JOB_STATUSES)[number];
export type AdminJobTarget = 'channel' | 'video' | 'user';

export interface AdminJob {
  id: string;
  kind: AdminJobKind;
  targetKind: AdminJobTarget;
  targetId: string;
  params: Record<string, unknown>;
  status: AdminJobStatus;
  attempts: number;
  lastError: string | null;
  result: Record<string, unknown> | null;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/** The permission an admin needs to retry a job of each kind (the same one that started it). */
export const ADMIN_JOB_PERMISSIONS: Readonly<Record<AdminJobKind, readonly AdminContentPermission[]>> = {
  'channel.sync-holds': ['channels:manage'],
  'channel.purge': ['content:delete'],
  'channel.transfer': ['channels:transfer'],
  'video.move': ['videos:manage'],
  'video.purge': ['content:delete'],
  'user.sync-holds': ['users:manage'],
  'user.delete-data': ['users:manage', 'content:delete'],
  'profiles.restore-legacy': ['users:manage'],
  'videos.repair-thumbnails': ['videos:manage'],
  'search.rebuild-ownership': ['videos:manage'],
  'playlist.add-videos': ['videos:manage'],
  'search.repair-objects': ['videos:manage'],
  'search.reconcile': ['videos:manage'],
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
