// Queue Message Types - Shared across all services

export enum MessageType {
  // Profile events
  ProfileCreate,
  ProfileUpdate,
  ProfileDelete,
  ProfileView,

  // Channel events
  ChannelCreate,
  ChannelUpdate,
  ChannelDelete,
  ChannelView,

  // Subscription events
  Subscribe,
  Unsubscribe,

  // Video events
  VideoCreate,
  VideoEdit,
  VideoDelete,
  VideoView,
  VideoLike,
  VideoUnlike,
  VideoDislike,
  VideoUndislike,

  // Comment events (video comments)
  CommentCreate,
  CommentEdit,
  CommentDelete,
  CommentLike,
  CommentDislike,
  CommentUnlike,
  CommentUndislike,

  // Playlist events
  PlaylistCreate,
  PlaylistEdit,
  PlaylistDelete,
  PlaylistAdd,
  PlaylistRemove,
  PlaylistClone,

  // Live streaming events
  LiveStreamCreate,
  LiveStreamUpdate,
  LiveStreamStart,
  LiveStreamEnd,
  LiveStreamView,

  // Video upload events
  VideoUploadStarted,
  VideoUploadCompleted,
  VideoUploadCancelled,
  VideoProcessingCompleted,
  VideoUploadFailed,

  // Watch history events
  WatchHistory,

  // Community post comment events
  PostCommentCreated,
  PostCommentUpdated,
  PostCommentLiked,
  PostCommentUnliked,
  PostCommentDeleted,
  PostCommentPinned,
  PostCommentHearted,

  // Community post events
  CommunityPostCreated,
  CommunityPostUpdated,
  CommunityPostLiked,
  CommunityPostUnliked,
  CommunityPostDeleted,
  PollVoted,

  // Channel section events
  ChannelSectionCreate,
  ChannelSectionUpdate,
  ChannelSectionDelete,
  ChannelSectionReorder,
  ChannelSectionView,

  // Channel tab events
  ChannelTabCreate,
  ChannelTabUpdate,
  ChannelTabDelete,
  ChannelTabReorder,
  ChannelTabSwitch,

  // Content moderation events
  ReportCreate,
  ReportResolve,
}

// Generic message structure for queue messages
export interface QueueMessage<T = Record<string, unknown>> {
  id: string;
  type: MessageType;
  payload: T;
  timestamp: number;
  retryCount?: number;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  failureReason?: string;
  failedAt?: string;
}

// Result of processing a queue message
export interface ProcessingResult {
  success: boolean;
  error?: string;
  shouldRetry?: boolean;
  processedAt: string;
}
