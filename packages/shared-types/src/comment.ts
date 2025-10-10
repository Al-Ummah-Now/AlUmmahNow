/**
 * Comment types
 */

import { Timestamps, SoftDelete } from './common';

export interface Comment extends Timestamps, SoftDelete {
  id: string;
  videoId: string;
  userId: string;
  channelId?: string;
  parentCommentId?: string;
  content: string;

  // User info
  userDisplayName: string;
  userAvatarUrl?: string;

  // Stats
  likesCount?: number;
  dislikesCount?: number;
  repliesCount?: number;

  // Status
  isPinned?: boolean;
  isEdited?: boolean;

  // Timestamps
  dateCreated: string;
  dateModified: string;
}

export interface CommentCreateRequest {
  content: string;
  parentCommentId?: string;
}

export interface CommentUpdateRequest {
  content: string;
}

export interface CommentListParams {
  limit?: number;
  cursor?: string;
  videoId: string;
  parentCommentId?: string;
  sortBy?: 'dateCreated' | 'likesCount';
  sortOrder?: 'asc' | 'desc';
}
