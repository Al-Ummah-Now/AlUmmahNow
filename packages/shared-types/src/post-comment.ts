/**
 * Community Post Comment types
 * Following YouTube's comment threading structure
 */

import { SoftDelete, Moderation } from './common';

/** Who last moderated a comment for its channel, and how (stored on the comment). */
export interface CommentModerationRecord {
  action: string;
  userId: string;
  at: string;
}

export interface PostComment extends SoftDelete, Moderation {
  id: string;                        // UUID
  postId: string;                    // Parent post ID
  channelId: string;                 // Commenter's channel ID
  userId: string;                    // Commenter's user ID
  parentCommentId?: string;          // For threaded replies (null for top-level)

  // Content
  content: string;                   // Comment text (max 10,000 chars)

  // User info (denormalized for performance)
  userDisplayName: string;
  /** Added on read, never stored: the channel's current name per language (en, ar), #1610 */
  userDisplayNameLocalized?: Record<string, string>;
  userAvatarUrl?: string;
  channelVerified: boolean;

  // Engagement metrics
  likes: number;                     // Total likes count
  repliesCount: number;              // Count of direct replies (0 for replies)

  // Status
  isPinned: boolean;                 // Post owner can pin one comment
  isEdited: boolean;                 // Flag if edited after creation
  isHeartedByCreator: boolean;       // Post owner can "heart" comments

  // Viewer state (computed per request, never stored)
  isLikedByViewer?: boolean;         // Present when the request is authenticated

  // Review state (Studio Comments, #771). Absent = published.
  /** 'held': seen only by its author (and in Studio) until approved */
  status?: 'published' | 'held';
  /** Who holds it: platform moderation or a channel block (silent); absent = the channel's review */
  heldBy?: 'moderation' | 'channel_block';
  /** Set when the post's channel removed it (soft: restorable for 90 days, then purged) */
  removedBy?: 'channel';
  removedAt?: string;
  removedByUserId?: string;
  /** Comments the removal took off the post's count (itself and its replies), given back on restore */
  removedCount?: number;
  /** The last channel moderation action on it (audit) */
  moderation?: CommentModerationRecord;

  // Timestamps
  createdAt: string;                 // ISO timestamp
  updatedAt?: string;                // ISO timestamp
  // deletedAt, isDeleted, markedForDeletion inherited from SoftDelete
  // isHidden, hiddenAt, hiddenByUserId, hiddenReason inherited from Moderation
}

// Request/Response types

export interface PostCommentCreateRequest {
  content: string;                   // 1-10,000 characters
  parentCommentId?: string;          // For replies to top-level comments
}

export interface PostCommentUpdateRequest {
  content: string;                   // 1-10,000 characters
}

export interface PostCommentListParams {
  limit?: number;                    // Default: 20, max: 100 (top-level) or 50 (replies)
  cursor?: string;                   // Pagination cursor (last comment ID)
  sortBy?: 'top' | 'newest';        // Sort order (only for top-level)
}

export interface PostCommentListResponse {
  success: boolean;
  comments: PostComment[];
  pagination: {
    limit: number;
    cursor?: string;                 // Next page cursor
    hasNext: boolean;
  };
}

export interface PostCommentCreateResponse {
  success: boolean;
  comment: PostComment;
}

export interface PostCommentLikeResponse {
  success: boolean;
  liked: boolean;                    // true after like, false after unlike
  totalLikes: number;
}

export interface PostCommentPinResponse {
  success: boolean;
  pinned: boolean;                   // true after pin, false after unpin
  commentId: string;
}

export interface PostCommentHeartResponse {
  success: boolean;
  hearted: boolean;                  // true after heart, false after unheart
  commentId: string;
}

// Internal storage types

export interface PostCommentIndex {
  postId: string;
  commentIds: string[];              // Ordered list of comment IDs
  lastUpdated: string;
}

export interface PostCommentLikeRecord {
  userId: string;
  postId: string;
  commentId: string;
  likedAt: string;                   // ISO timestamp
}

// Queue event types for processor

export interface PostCommentCreatedEvent {
  type: 'post_comment_created';
  postId: string;
  commentId: string;
  authorChannelId: string;
  authorUserId: string;
  parentCommentId?: string;          // If reply
  timestamp: string;
}

export interface PostCommentLikedEvent {
  type: 'post_comment_liked';
  postId: string;
  commentId: string;
  likerChannelId: string;
  likerUserId: string;
  timestamp: string;
}

export interface PostCommentDeletedEvent {
  type: 'post_comment_deleted';
  postId: string;
  commentId: string;
  deletedByUserId: string;
  timestamp: string;
}

export interface PostCommentPinnedEvent {
  type: 'post_comment_pinned';
  postId: string;
  commentId: string;
  timestamp: string;
}

export interface PostCommentHeartedEvent {
  type: 'post_comment_hearted';
  postId: string;
  commentId: string;
  hearted: boolean;                  // true if hearted, false if unhearted
  timestamp: string;
}

export type PostCommentEvent =
  | PostCommentCreatedEvent
  | PostCommentLikedEvent
  | PostCommentDeletedEvent
  | PostCommentPinnedEvent
  | PostCommentHeartedEvent;
