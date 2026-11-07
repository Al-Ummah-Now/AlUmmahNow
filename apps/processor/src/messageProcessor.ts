import { AlUmmahMessage, ProcessingResult, MessageType, QueueEnvironment } from './types';
import { Logger } from '@al-ummah/logger';
import { handleChannelSectionEvent } from './handlers/channel-section';
import { handlePollVoteEvent } from './handlers/poll-vote';
import { handlePostLikeEvent } from './handlers/post-like';
import { recordViewRollup } from './lib/analytics-rollup';
import { notifyLiveStream, notifyVideoProcessing, ProcessingStatus } from './lib/websocket-notify';
import {
  eraseUserNotifications,
  fanoutNotification,
  insertNotification,
  isNotificationKey,
  pushStoredNotifications,
  removeChannelSubscriber,
  upsertChannelSubscriber,
} from './lib/notifications-store';
import type { NotificationCreatePayload, NotificationFanoutPayload } from '@al-ummah/shared-types';

/** Tombstone replacing a user id after GDPR erasure (matches api-videos lib/privacy/user-data.ts). */
export const DELETED_USER_ID = 'deleted-user';
// Channel tabs are frontend-only, no backend processing needed
// import { handleChannelTabEvent } from './handlers/channel-tab';

export class MessageProcessor {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async processMessage(message: AlUmmahMessage, env: QueueEnvironment): Promise<ProcessingResult> {
    const startTime = Date.now();
    this.logger.info(`Processing message ${message.id} of type ${message.type}`);

    try {
      // Validate message structure
      if (!this.validateMessage(message)) {
        throw new Error('Invalid message structure');
      }

      // Save message to R2 bucket first
      await this.saveMessageToR2(message, env);

      // Process based on message type
      await this.processByType(message, env);

      const processingTime = Date.now() - startTime;
      this.logger.info(`Successfully processed message ${message.id} in ${processingTime}ms`);
      
      return {
        success: true,
        processedAt: new Date().toISOString(),
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`Failed to process message ${message.id} after ${processingTime}ms`, error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        shouldRetry: this.shouldRetry(error, message.retryCount || 0),
        processedAt: new Date().toISOString(),
      };
    }
  }

  private validateMessage(message: AlUmmahMessage): boolean {
    return !!(
      message.id &&
      message.type !== undefined && message.type !== null &&
      message.timestamp &&
      message.payload &&
      typeof message.payload === 'object'
    );
  }

  private async processByType(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    switch (message.type) {
      // Profile-related messages
      case MessageType.ProfileCreate:
      case MessageType.ProfileUpdate:
      case MessageType.ProfileDelete:
      case MessageType.ProfileView:
        await this.processProfileMessage(message);
        break;

      // Channel-related messages
      case MessageType.ChannelCreate:
      case MessageType.ChannelUpdate:
      case MessageType.ChannelDelete:
      case MessageType.ChannelView:
        await this.processChannelMessage(message);
        break;

      // Subscription messages
      case MessageType.Subscribe:
      case MessageType.Unsubscribe:
        await this.processSubscriptionMessage(message, env);
        break;

      // Notification center (Story 29.10)
      case MessageType.NotificationCreate:
        await this.processNotificationCreate(message, env);
        break;
      case MessageType.NotificationFanout:
        await this.processNotificationFanout(message, env);
        break;

      // Video-related messages
      case MessageType.VideoView:
        await this.processVideoViewMessage(message, env);
        break;

      case MessageType.VideoCreate:
      case MessageType.VideoEdit:
      case MessageType.VideoDelete:
      case MessageType.VideoLike:
      case MessageType.VideoUnlike:
      case MessageType.VideoDislike:
      case MessageType.VideoUndislike:
        await this.processVideoMessage(message);
        break;

      // Comment-related messages
      case MessageType.CommentCreate:
      case MessageType.CommentEdit:
      case MessageType.CommentDelete:
      case MessageType.CommentLike:
      case MessageType.CommentDislike:
      case MessageType.CommentUnlike:
      case MessageType.CommentUndislike:
        await this.processCommentMessage(message);
        break;

      // Playlist-related messages
      case MessageType.PlaylistCreate:
      case MessageType.PlaylistEdit:
      case MessageType.PlaylistDelete:
      case MessageType.PlaylistAdd:
      case MessageType.PlaylistRemove:
      case MessageType.PlaylistClone:
        await this.processPlaylistMessage(message);
        break;

      // Watch history messages
      case MessageType.WatchHistory:
        await this.processWatchHistoryMessage(message);
        break;

      // Community post comment events
      case MessageType.PostCommentCreated:
      case MessageType.PostCommentUpdated:
      case MessageType.PostCommentLiked:
      case MessageType.PostCommentUnliked:
      case MessageType.PostCommentDeleted:
      case MessageType.PostCommentPinned:
      case MessageType.PostCommentHearted:
        await this.processPostCommentMessage(message);
        break;

      // Community post events
      case MessageType.CommunityPostCreated:
      case MessageType.CommunityPostUpdated:
      case MessageType.CommunityPostDeleted:
        await this.processCommunityPostMessage(message);
        break;

      // Post like/unlike events - handled separately for like count calculation
      case MessageType.CommunityPostLiked:
      case MessageType.CommunityPostUnliked:
        await handlePostLikeEvent(message, env, this.logger);
        break;

      // Poll vote event - handled separately for score calculation
      case MessageType.PollVoted:
        await handlePollVoteEvent(message, env, this.logger);
        break;

      // Channel section events
      case MessageType.ChannelSectionCreate:
      case MessageType.ChannelSectionUpdate:
      case MessageType.ChannelSectionDelete:
      case MessageType.ChannelSectionReorder:
      case MessageType.ChannelSectionView:
        await handleChannelSectionEvent(message, env, this.logger);
        break;

      // Upload / processing lifecycle events - pushed to the uploader in realtime
      case MessageType.VideoUploadStarted:
      case MessageType.VideoUploadCompleted:
      case MessageType.VideoProcessingCompleted:
      case MessageType.VideoUploadFailed:
      case MessageType.VideoUploadCancelled:
        await this.processUploadLifecycleMessage(message, env);
        break;

      // Live stream lifecycle events - pushed on the shared live-streams channel
      case MessageType.LiveStreamCreate:
      case MessageType.LiveStreamUpdate:
      case MessageType.LiveStreamStart:
      case MessageType.LiveStreamEnd:
      case MessageType.LiveStreamView:
        await this.processLiveStreamMessage(message, env);
        break;

      // Client-side telemetry (A/B test exposures, web vitals, player performance).
      // Persisted by saveMessageToR2; nothing else to do.
      case MessageType.ClientAnalyticsEvent:
        this.logger.info('Client analytics batch stored', {
          kind: (message.payload as { kind?: string }).kind,
          eventCount: Array.isArray((message.payload as { events?: unknown[] }).events)
            ? (message.payload as { events: unknown[] }).events.length
            : 0,
        });
        break;

      // Content moderation events
      case MessageType.ReportCreate:
      case MessageType.ReportResolve:
        await this.processReportMessage(message, env);
        break;

      // GDPR erasure (Story 1.3): anonymise the reporter on moderation reports in D1
      case MessageType.UserDataErased:
        await this.processUserDataErased(message, env);
        break;

      // Channel tab events - REMOVED: tabs are frontend-only, no backend processing
      // case MessageType.ChannelTabCreate:
      // case MessageType.ChannelTabUpdate:
      // case MessageType.ChannelTabDelete:
      // case MessageType.ChannelTabReorder:
      // case MessageType.ChannelTabSwitch:
      //   await handleChannelTabEvent(message, env, this.logger);
      //   break;

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  private async processProfileMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing profile message: ${MessageType[message.type]}`, message.payload);

    const { userId } = message.payload as { userId: string; profileData?: unknown };
    
    if (!userId) {
      throw new Error('Profile message missing required field: userId');
    }

    // Process profile-related actions
    switch (message.type) {
      case MessageType.ProfileCreate:
        this.logger.info(`Profile created for user ${userId}`);
        break;
      case MessageType.ProfileUpdate:
        this.logger.info(`Profile updated for user ${userId}`);
        break;
      case MessageType.ProfileDelete:
        this.logger.info(`Profile deleted for user ${userId}`);
        break;
      case MessageType.ProfileView:
        this.logger.info(`Profile viewed for user ${userId}`);
        break;
    }
  }

  private async processChannelMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing channel message: ${MessageType[message.type]}`, message.payload);

    const { channelId, userId } = message.payload as { channelId: string; userId: string };
    
    if (!channelId || !userId) {
      throw new Error('Channel message missing required fields: channelId, userId');
    }

    // Process channel-related actions
    switch (message.type) {
      case MessageType.ChannelCreate:
        this.logger.info(`Channel ${channelId} created by user ${userId}`);
        break;
      case MessageType.ChannelUpdate:
        this.logger.info(`Channel ${channelId} updated by user ${userId}`);
        break;
      case MessageType.ChannelDelete:
        this.logger.info(`Channel ${channelId} deleted by user ${userId}`);
        break;
      case MessageType.ChannelView:
        this.logger.info(`Channel ${channelId} viewed by user ${userId}`);
        break;
    }
  }

  private async processSubscriptionMessage(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    this.logger.debug(`Processing subscription message: ${MessageType[message.type]}`, message.payload);

    // api-videos sends targetChannelId (the subscribed-to channel); channelId is the legacy name
    const payload = message.payload as { userId: string; channelId?: string; targetChannelId?: string };
    const userId = payload.userId;
    const channelId = payload.targetChannelId || payload.channelId;

    if (!userId || !channelId) {
      throw new Error('Subscription message missing required fields: userId, channelId');
    }

    // Subscriber index used for notification fan-out (per-channel bell lives on the row)
    if (env.NOTIFICATIONS_DB) {
      if (message.type === MessageType.Subscribe) {
        await upsertChannelSubscriber(env.NOTIFICATIONS_DB, channelId, userId);
      } else {
        await removeChannelSubscriber(env.NOTIFICATIONS_DB, channelId, userId);
      }
    }

    // Process subscription actions
    switch (message.type) {
      case MessageType.Subscribe:
        this.logger.info(`User ${userId} subscribed to channel ${channelId}`);
        break;
      case MessageType.Unsubscribe:
        this.logger.info(`User ${userId} unsubscribed from channel ${channelId}`);
        break;
    }
  }

  private async processVideoMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing video message: ${MessageType[message.type]}`, message.payload);

    // VideoView uses viewerId, other video messages use userId
    const payload = message.payload as { videoId: string; userId?: string; viewerId?: string };
    const { videoId, userId, viewerId } = payload;
    const actualUserId = userId || viewerId; // Use whichever is provided

    if (!videoId) {
      throw new Error('Video message missing required field: videoId');
    }

    // Process video-related actions
    switch (message.type) {
      case MessageType.VideoCreate:
        this.logger.info(`Video ${videoId} created by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoEdit:
        this.logger.info(`Video ${videoId} edited by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoDelete:
        this.logger.info(`Video ${videoId} deleted by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoView:
        this.logger.info(`Video ${videoId} viewed by user ${actualUserId || 'anonymous'}`);
        break;
      case MessageType.VideoLike:
        this.logger.info(`Video ${videoId} liked by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoUnlike:
        this.logger.info(`Video ${videoId} unliked by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoDislike:
        this.logger.info(`Video ${videoId} disliked by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoUndislike:
        this.logger.info(`Video ${videoId} undisliked by user ${actualUserId || 'unknown'}`);
        break;
    }
  }

  private async processVideoViewMessage(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    const payload = message.payload as { videoId?: string; searchQuery?: string };

    // Search telemetry is published with the VideoView type but has no videoId.
    if (!payload.videoId && payload.searchQuery !== undefined) {
      this.logger.info('Search event recorded', { query: payload.searchQuery });
      return;
    }

    await this.processVideoMessage(message);

    try {
      const recorded = await recordViewRollup(env.MESSAGES_BUCKET, message.payload, message.timestamp);
      if (recorded) {
        this.logger.debug('View rollup updated', { videoId: payload.videoId });
      }
    } catch (error) {
      // Rollups are derived data; never fail (and retry) the message because of them.
      this.logger.warn('Failed to update view rollup', { videoId: payload.videoId, error });
    }
  }

  private async processUploadLifecycleMessage(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    const payload = message.payload as { videoId?: string; userId?: string; title?: string; error?: string; duration?: number };
    if (!payload.videoId) {
      throw new Error('Upload message missing required field: videoId');
    }

    const statusByType: Partial<Record<MessageType, ProcessingStatus>> = {
      [MessageType.VideoUploadStarted]: 'uploading',
      [MessageType.VideoUploadCompleted]: 'processing',
      [MessageType.VideoProcessingCompleted]: 'ready',
      [MessageType.VideoUploadFailed]: 'failed',
      [MessageType.VideoUploadCancelled]: 'cancelled',
    };
    const status = statusByType[message.type] as ProcessingStatus;
    this.logger.info(`Video ${payload.videoId} upload status: ${status}`, { userId: payload.userId });

    // Terminal states are stored in the uploader's notification center first so
    // the realtime event carries the stored id (or is skipped when opted out).
    let notificationId: string | null | undefined;
    if (env.NOTIFICATIONS_DB && payload.userId && (status === 'ready' || status === 'failed')) {
      const stored = await insertNotification(env.NOTIFICATIONS_DB, {
        notificationId: crypto.randomUUID(),
        recipientUserId: payload.userId,
        notificationKey: status === 'ready' ? 'uploadReady' : 'uploadFailed',
        params: { videoTitle: payload.title || '' },
        actionUrl: `/video/${payload.videoId}`,
        entityId: payload.videoId,
        dedupeKey: `upload:${status}:${payload.videoId}`,
      });
      notificationId = stored ? stored.id : null;
    }

    await notifyVideoProcessing(env, payload.videoId, payload.userId, status, {
      title: payload.title,
      error: payload.error,
      duration: payload.duration,
    }, notificationId);
  }

  /**
   * Persist one notification (produced by api-videos, e.g. new comment, reply,
   * new subscriber) and push it unless the producer already did.
   */
  private async processNotificationCreate(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    const payload = message.payload as unknown as NotificationCreatePayload;
    if (!payload.recipientUserId || !payload.notificationId || !isNotificationKey(payload.notificationKey)) {
      throw new Error('Notification message missing required fields: recipientUserId, notificationId, notificationKey');
    }
    if (!env.NOTIFICATIONS_DB) {
      this.logger.warn('NOTIFICATIONS_DB not bound; notification not stored', { key: payload.notificationKey });
      return;
    }
    const stored = await insertNotification(env.NOTIFICATIONS_DB, payload);
    this.logger.info('Notification stored', {
      userId: payload.recipientUserId,
      key: payload.notificationKey,
      stored: !!stored,
    });
    if (stored && !payload.realtimeSent) {
      await pushStoredNotifications(env, [stored], payload);
    }
  }

  /** Fan a new-video / live-started notification out to the channel's subscribers. */
  private async processNotificationFanout(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    const payload = message.payload as unknown as NotificationFanoutPayload;
    if (!payload.channelId || !payload.entityId || (payload.kind !== 'new_video' && payload.kind !== 'live_started')) {
      throw new Error('Notification fan-out message missing required fields: kind, channelId, entityId');
    }
    if (!env.NOTIFICATIONS_DB) {
      this.logger.warn('NOTIFICATIONS_DB not bound; fan-out skipped', { kind: payload.kind, channelId: payload.channelId });
      return;
    }
    const rows = await fanoutNotification(env.NOTIFICATIONS_DB, payload);
    const pushed = await pushStoredNotifications(env, rows, {
      notificationKey: payload.kind === 'live_started' ? 'liveStarted' : 'newVideo',
      params: payload.params,
      actionUrl: payload.actionUrl,
    });
    this.logger.info('Notification fan-out finished', {
      kind: payload.kind,
      channelId: payload.channelId,
      entityId: payload.entityId,
      recipients: rows.length,
      pushed,
    });
  }

  private async processLiveStreamMessage(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    const payload = message.payload as { liveStreamId?: string; channelId?: string; status?: string; title?: string };
    if (!payload.liveStreamId) {
      throw new Error('Live stream message missing required field: liveStreamId');
    }
    this.logger.info(`Live stream ${payload.liveStreamId} event ${MessageType[message.type]}`, { status: payload.status });

    if (message.type === MessageType.LiveStreamView) return;

    await notifyLiveStream(env, payload.liveStreamId, {
      event: message.type === MessageType.LiveStreamCreate ? 'created' : 'updated',
      status: payload.status
        ?? (message.type === MessageType.LiveStreamStart ? 'live' : message.type === MessageType.LiveStreamEnd ? 'ended' : undefined),
      channelId: payload.channelId,
      title: payload.title,
    });
  }

  private async processCommentMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing comment message: ${MessageType[message.type]}`, message.payload);

    const { commentId, userId, videoId } = message.payload as { commentId: string; userId: string; videoId: string };
    
    if (!commentId || !userId || !videoId) {
      throw new Error('Comment message missing required fields: commentId, userId, videoId');
    }

    // Process comment-related actions
    switch (message.type) {
      case MessageType.CommentCreate:
        this.logger.info(`Comment ${commentId} created by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentEdit:
        this.logger.info(`Comment ${commentId} edited by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentDelete:
        this.logger.info(`Comment ${commentId} deleted by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentLike:
        this.logger.info(`Comment ${commentId} liked by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentDislike:
        this.logger.info(`Comment ${commentId} disliked by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentUnlike:
        this.logger.info(`Comment ${commentId} unliked by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentUndislike:
        this.logger.info(`Comment ${commentId} undisliked by user ${userId} on video ${videoId}`);
        break;
    }
  }

  private async processPlaylistMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing playlist message: ${MessageType[message.type]}`, message.payload);

    const { playlistId, userId } = message.payload as { playlistId: string; userId: string; videoId?: string };
    
    if (!playlistId || !userId) {
      throw new Error('Playlist message missing required fields: playlistId, userId');
    }

    // Process playlist-related actions
    switch (message.type) {
      case MessageType.PlaylistCreate:
        this.logger.info(`Playlist ${playlistId} created by user ${userId}`);
        break;
      case MessageType.PlaylistEdit:
        this.logger.info(`Playlist ${playlistId} edited by user ${userId}`);
        break;
      case MessageType.PlaylistDelete:
        this.logger.info(`Playlist ${playlistId} deleted by user ${userId}`);
        break;
      case MessageType.PlaylistAdd:
        this.logger.info(`Video added to playlist ${playlistId} by user ${userId}`);
        break;
      case MessageType.PlaylistRemove:
        this.logger.info(`Video removed from playlist ${playlistId} by user ${userId}`);
        break;
      case MessageType.PlaylistClone:
        this.logger.info(`Playlist ${playlistId} cloned by user ${userId}`);
        break;
    }
  }

  private async saveMessageToR2(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    try {
      // Create a structured key: year-month-dayThour-min-sec.id
      const messageDate = new Date(message.timestamp);
      const year = messageDate.getUTCFullYear();
      const month = String(messageDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(messageDate.getUTCDate()).padStart(2, '0');
      const hour = String(messageDate.getUTCHours()).padStart(2, '0');
      const minute = String(messageDate.getUTCMinutes()).padStart(2, '0');
      const second = String(messageDate.getUTCSeconds()).padStart(2, '0');

      const key = `${year}-${month}-${day}T${hour}-${minute}-${second}.${message.id}`;

      // Enhance message with human-readable type name for better queryability
      const enhancedMessage = {
        ...message,
        typeName: MessageType[message.type], // Add human-readable type name (e.g., "VideoView")
        timestampISO: new Date(message.timestamp).toISOString(), // Add ISO string for easier filtering
      };

      // Convert enhanced message to JSON string
      const messageJson = JSON.stringify(enhancedMessage, null, 2);

      // Save to R2 bucket with proper Content-Type metadata
      await env.MESSAGES_BUCKET.put(key, messageJson, {
        httpMetadata: {
          contentType: 'application/json',
        },
        customMetadata: {
          messageType: MessageType[message.type],
          messageId: message.id,
        },
      });

      this.logger.debug(`Message ${message.id} saved to R2 bucket with key: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to save message ${message.id} to R2 bucket`, error);
      // Re-throw the error so it can be handled by the main processing logic
      throw new Error(`R2 save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async processWatchHistoryMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing watch history message`, message.payload);

    const { type, userId, videoId, progress, duration } = message.payload as {
      type: string;
      userId: string;
      videoId: string;
      progress: number;
      duration: number;
      timestamp: string;
    };

    if (!type || !userId || !videoId) {
      throw new Error('Watch history message missing required fields: type, userId, videoId');
    }

    // Log watch history events for analytics
    switch (type) {
      case 'watch_started':
        this.logger.info(`User ${userId} started watching video ${videoId}`);
        break;
      case 'watch_progress':
        if (progress !== undefined && duration !== undefined && duration > 0) {
          const percentage = Math.round((progress / duration) * 100);
          this.logger.info(`User ${userId} progress on video ${videoId}: ${percentage}% (${progress}s/${duration}s)`);
        } else {
          this.logger.warn(`Watch progress event missing progress/duration fields for video ${videoId}`);
        }
        break;
      case 'watch_completed':
        this.logger.info(`User ${userId} completed watching video ${videoId}`);
        break;
      default:
        this.logger.warn(`Unknown watch history event type: ${type}`);
    }
  }

  private async processCommunityPostMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing community post message: ${MessageType[message.type]}`, message.payload);

    const { postId, channelId, actor } = message.payload as {
      postId: string;
      channelId: string;
      actor?: { userId: string; channelId?: string };
    };

    if (!postId || !channelId) {
      throw new Error('Community post message missing required fields: postId, channelId');
    }

    // Process community post actions
    switch (message.type) {
      case MessageType.CommunityPostCreated:
        this.logger.info(`Community post ${postId} created on channel ${channelId} by actor`, { actor });
        break;
      case MessageType.CommunityPostUpdated:
        this.logger.info(`Community post ${postId} updated on channel ${channelId} by actor`, { actor });
        break;
      case MessageType.CommunityPostDeleted:
        this.logger.info(`Community post ${postId} deleted from channel ${channelId} by actor`, { actor });
        break;
      // CommunityPostLiked/Unliked are now handled by dedicated handlePostLikeEvent handler
      // PollVoted is now handled by dedicated handlePollVoteEvent handler
    }
  }

  private async processPostCommentMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing post comment message: ${MessageType[message.type]}`, message.payload);

    const { postId, commentId, actor } = message.payload as {
      postId: string;
      commentId: string;
      channelId?: string;
      actor?: { userId: string; channelId?: string };
      parentCommentId?: string;
    };

    if (!postId || !commentId) {
      throw new Error('Post comment message missing required fields: postId, commentId');
    }

    // Process post comment actions
    switch (message.type) {
      case MessageType.PostCommentCreated:
        this.logger.info(`Comment ${commentId} created on post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentUpdated:
        this.logger.info(`Comment ${commentId} updated on post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentLiked:
        this.logger.info(`Comment ${commentId} liked on post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentUnliked:
        this.logger.info(`Comment ${commentId} unliked on post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentDeleted:
        this.logger.info(`Comment ${commentId} deleted from post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentPinned:
        this.logger.info(`Comment ${commentId} pinned on post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentHearted:
        this.logger.info(`Comment ${commentId} hearted on post ${postId} by actor`, { actor });
        break;
    }
  }

  /**
   * Reports are kept for moderation history after a GDPR erasure, but the
   * reporter's identity is replaced with a tombstone (same value api-videos
   * writes to its R2 copy).
   */
  private async processUserDataErased(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    const { userId } = message.payload as { userId?: string };
    if (!userId || userId === DELETED_USER_ID) {
      throw new Error('UserDataErased message missing required field: userId');
    }
    const result = await env.REPORTS_DB.prepare('UPDATE reports SET reporter_id = ? WHERE reporter_id = ?')
      .bind(DELETED_USER_ID, userId)
      .run();
    if (env.NOTIFICATIONS_DB) {
      await eraseUserNotifications(env.NOTIFICATIONS_DB, userId);
    }
    this.logger.info('Anonymised moderation reports after user data erasure', {
      userId,
      changes: (result as { meta?: { changes?: number } })?.meta?.changes ?? 0,
    });
  }

  private async processReportMessage(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    this.logger.debug(`Processing report message: ${MessageType[message.type]}`, message.payload);

    const { reportId, entityType, entityId, reporterId, reason, timestamp } = message.payload as {
      reportId: string;
      entityType: string;
      entityId: string;
      reporterId: string;
      reason: string;
      timestamp: string;
      description?: string;
      moderatorId?: string;
      action?: string;
      moderatorNotes?: string;
    };

    if (!reportId || !entityType || !entityId) {
      throw new Error('Report message missing required fields: reportId, entityType, entityId');
    }

    switch (message.type) {
      case MessageType.ReportCreate:
        const { description } = message.payload as { description?: string };
        const createdAt = timestamp || new Date().toISOString();

        await env.REPORTS_DB.prepare(`
          INSERT OR IGNORE INTO reports (id, entity_type, entity_id, reporter_id, reason, description, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `).bind(reportId, entityType, entityId, reporterId, reason, description || null, createdAt).run();

        this.logger.info(`Report ${reportId} saved for ${entityType} ${entityId}`, {
          reason,
          reporterId,
        });
        break;

      case MessageType.ReportResolve:
        const { moderatorId, action, moderatorNotes, status } = message.payload as {
          moderatorId?: string;
          action?: string;
          moderatorNotes?: string;
          status?: string;
        };
        const resolvedAt = new Date().toISOString();
        // Dismissals must stay 'dismissed'; older admin-api builds sent no
        // status, so derive it from the action in that case.
        const finalStatus = status === 'dismissed' || status === 'resolved'
          ? status
          : action === 'dismissed' ? 'dismissed' : 'resolved';

        // admin-api has usually written this row already; never erase the
        // notes it stored when the message carries none.
        await env.REPORTS_DB.prepare(`
          UPDATE reports
          SET status = ?,
              moderator_id = COALESCE(?, moderator_id),
              action = COALESCE(?, action),
              moderator_notes = COALESCE(?, moderator_notes),
              resolved_at = COALESCE(resolved_at, ?),
              updated_at = ?
          WHERE id = ?
        `).bind(finalStatus, moderatorId ?? null, action ?? null, moderatorNotes || null, resolvedAt, resolvedAt, reportId).run();

        this.logger.info(`Report ${reportId} resolved by moderator ${moderatorId}`, {
          action,
          entityType,
          entityId,
        });
        break;
    }
  }

  private shouldRetry(error: unknown, retryCount: number): boolean {
    // Don't retry if we've already retried too many times
    if (retryCount >= 3) {
      return false;
    }

    // Don't retry validation errors
    if (error instanceof Error && (error.message.includes('missing required fields') || error.message.includes('missing required field'))) {
      return false;
    }

    if (error instanceof Error && error.message.includes('Invalid message structure')) {
      return false;
    }

    // Retry for other types of errors (network issues, temporary failures, etc.)
    return true;
  }
}