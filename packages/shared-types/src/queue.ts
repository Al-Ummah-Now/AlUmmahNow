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

  // Client-side telemetry forwarded by the web app (A/B exposures, performance beacons).
  // Appended last: values are numeric and already-queued messages must keep their meaning.
  ClientAnalyticsEvent,

  // GDPR erasure completed in api-videos (payload: { userId, timestamp }).
  // Consumers anonymise copies they own (e.g. processor: D1 moderation reports).
  // Appended last for the same reason as above.
  UserDataErased,

  // Notification center (Story 29.10). Explicit values in a reserved range so
  // concurrent additions above cannot shift them.
  // Persist a notification for one recipient (payload: NotificationCreatePayload).
  NotificationCreate = 200,
  // Fan a notification out to a channel's subscribers (payload: NotificationFanoutPayload).
  NotificationFanout = 201,

  // Search index sync (Story 29.9). Payload: SearchIndexSyncPayload ({ entity, id, object? }).
  // The processor projects the object and updates the D1 search index (no object = deleted).
  // Explicit value in its own reserved range, like the notification types above.
  SearchIndexSync = 210,
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
