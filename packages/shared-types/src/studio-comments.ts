/**
 * Studio Comments page (docs/specs/CREATOR-STUDIO.md §4.7, #771): the channel's
 * comments across its videos and posts, from the channel_comments index in
 * SEARCH_DB (ids and status) with the text read from R2.
 */

export type StudioCommentKind = 'video' | 'post';
export type StudioCommentStatus = 'published' | 'held' | 'removed';
/** Who holds a held comment; absent = held for the channel's own review. */
export type StudioCommentHeldBy = 'moderation' | 'channel_block';

export const STUDIO_COMMENT_TABS = ['inbox', 'held', 'removed'] as const;
export type StudioCommentTab = (typeof STUDIO_COMMENT_TABS)[number];

export const STUDIO_COMMENT_ACTIONS = ['approve', 'remove', 'restore', 'hold', 'pin', 'unpin', 'heart', 'unheart'] as const;
export type StudioCommentAction = (typeof STUDIO_COMMENT_ACTIONS)[number];

/** Most comments one bulk request may act on, and the largest list page. */
export const STUDIO_COMMENTS_BULK_MAX = 50;
export const STUDIO_COMMENTS_PAGE_MAX = 50;
export const STUDIO_COMMENTS_PAGE_DEFAULT = 20;
/** How long a comment the channel removed stays restorable before the daily purge deletes it. */
export const STUDIO_REMOVED_RETENTION_DAYS = 90;

export interface StudioCommentAuthor {
  userId: string;
  channelId: string | null;
  displayName: string;
  avatarUrl?: string;
}

export interface StudioComment {
  id: string;
  kind: StudioCommentKind;
  targetId: string;
  targetTitle: string;
  /** The video's title per language when the creator wrote one (posts have none) */
  targetTitleLocalized?: Record<string, string>;
  /** '/video/<id>' or '/post/<id>' (no locale prefix) */
  targetUrlPath: string;
  parentId: string | null;
  text: string;
  createdAt: string;
  author: StudioCommentAuthor;
  status: StudioCommentStatus;
  heldBy?: StudioCommentHeldBy;
  isPinned: boolean;
  isHearted: boolean;
  repliesCount: number;
  hasChannelReply: boolean;
  removedAt?: string;
  removedBy?: { userId: string; displayName: string };
}

export interface StudioCommentListResponse {
  success: boolean;
  items: StudioComment[];
  nextCursor: string | null;
  total: number;
  /** The channel's index is being built: lists may be incomplete until it finishes */
  indexing?: boolean;
}

export interface StudioCommentSummaryResponse {
  success: boolean;
  inbox: number;
  held: number;
  removed: number;
  recent: StudioComment[];
  indexing?: boolean;
}

export interface StudioCommentBulkItem {
  kind: StudioCommentKind;
  targetId: string;
  commentId: string;
}

export interface StudioCommentBulkResponse {
  success: boolean;
  results: Array<{ commentId: string; ok: boolean; error?: string }>;
}

export interface ChannelBlockItem {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  blockedAt: string;
}

/** Whether a comment text carries a link (the Studio "has a link" filter). */
export function commentHasLink(text: string | null | undefined): boolean {
  if (!text) return false;
  return /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|me|co|ly|link|app|dev|tv|info|gg)(?:\/\S*)?\b/i.test(text);
}
