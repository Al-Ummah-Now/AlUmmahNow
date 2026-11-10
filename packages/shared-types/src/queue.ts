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
  // Deliver stored notifications to the recipients' push devices (payload: PushDispatchPayload, Epic 9.4).
  PushDispatch = 202,

  // Search index sync (Story 29.9). Payload: SearchIndexSyncPayload ({ entity, id, object? }).
  // The processor projects the object and updates the D1 search index (no object = deleted).
  // Explicit value in its own reserved range, like the notification types above.
  SearchIndexSync = 210,

  // Analytics (#235). Explicit values in their own reserved range (220-229).
  // Played seconds since the last report for one playback session (payload:
  // VideoWatchTimePayload). The processor adds them to the video and channel
  // rollups' watchTime without counting a view.
  VideoWatchTime = 220,

  // AI-assisted moderation (Epic 28). Explicit value in its own reserved range (230-239).
  // Sent by api-videos to the dedicated moderation queue (payload: ModerationScanPayload).
  ModerationScan = 230,
  // AI category suggestion for a video or an upload-form draft (payload: CategorySuggestPayload,
  // see category-suggestion.ts). Same reserved range: it shares the moderation queue's AI consumer.
  CategorySuggest = 231,

  // Admin content job (api-videos lib/admin/jobs.ts), on the admin-jobs queue. Payload: { jobId }.
  AdminJob = 240,

  // Account erasure, Contact us step (processor contact/erase.ts). Queued by the processor's
  // UserDataErased handler on its own queue so it retries and dead-letters on its own.
  // Payload: ContactDataErasePayload. Explicit value in its own reserved range (250-259).
  ContactDataErase = 250,
}

/** Payload of MessageType.ContactDataErase. */
export interface ContactDataErasePayload {
  /** The erased account: its Contact us messages and their staff notes are deleted. */
  userId: string;
}

/** Payload of MessageType.VideoWatchTime. */
export interface VideoWatchTimePayload {
  videoId: string;
  /** Owning channel; null for legacy (imported) videos */
  videoChannelId: string | null;
  /** Played seconds since the previous report, 0 < seconds <= 60 */
  seconds: number;
  sessionId: string;
  viewerId?: string;
  /** ISO time of the report (selects the rollup day) */
  timestamp: string;
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
