/**
 * Community Post Comment types
 * Following YouTube's comment threading structure
 */

export interface PostComment {
  id: string;                        // UUID
  postId: string;                    // Parent post ID
  channelId: string;                 // Commenter's channel ID
  userId: string;                    // Commenter's user ID
  parentCommentId?: string;          // For threaded replies (null for top-level)

  // Content
  content: string;                   // Comment text (max 10,000 chars)

  // User info (denormalized for performance)
  userDisplayName: string;
  userAvatarUrl?: string;
  channelVerified: boolean;

  // Engagement metrics
  likes: number;                     // Total likes count
  repliesCount: number;              // Count of direct replies (0 for replies)

  // Status
  isPinned: boolean;                 // Post owner can pin one comment
  isEdited: boolean;                 // Flag if edited after creation
  isHeartedByCreator: boolean;       // Post owner can "heart" comments

  // Timestamps
  createdAt: string;                 // ISO timestamp
  updatedAt?: string;                // ISO timestamp
  deletedAt?: string;                // Soft delete timestamp
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
