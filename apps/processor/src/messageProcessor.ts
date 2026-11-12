import { AlUmmahMessage, ProcessingResult, MessageType, QueueEnvironment } from './types';
import { Logger } from '@al-ummah/logger';
import { handleChannelSectionEvent } from './handlers/channel-section';
import { handlePollVoteEvent } from './handlers/poll-vote';
import { handlePostLikeEvent } from './handlers/post-like';
import { eraseUserPostInteractions } from './lib/post-counters';
import { applyModerationToSearchIndex, handleSearchIndexSync } from './handlers/search-index';
import { recordRetentionRollup, recordViewRollup, recordWatchTimeRollup } from './lib/analytics-rollup';
import { CounterBatch } from './lib/analytics-counters';
import { notifyLiveStream, notifyVideoProcessing, ProcessingStatus, uploadResultActionUrl, uploadResultDedupeKey } from './lib/websocket-notify';
import {
  eraseUserNotifications,
  fanoutNotificationPage,
  markPushed,
  unpushedNotification,
  insertNotification,
  isNotificationKey,
  pushStoredNotifications,
  reconcileChannelSubscriber,
} from './lib/notifications-store';
import { eraseUserModerationData } from './moderation/store';
import { eraseUserContactData } from './contact/erase';
import type { NotificationCreatePayload, NotificationFanoutPayload, PushDispatchPayload } from '@al-ummah/shared-types';
import { publishAdminLive } from '@al-ummah/shared-types';
import { dispatchPush, enqueuePush } from './push/dispatch';
import { resolvePushProviders, type PushProviders } from './push/provider';

/** Tombstone replacing a user id after GDPR erasure (matches api-videos lib/privacy/user-data.ts). */
export const DELETED_USER_ID = 'deleted-user';
// Channel tabs are frontend-only, no backend processing needed
// import { handleChannelTabEvent } from './handlers/channel-tab';

export class MessageProcessor {
  private logger: Logger;

  /** Push providers per service; injectable for tests. */
  private readonly pushProviders: PushProviders;

  /**
   * Analytics increments of the messages processed by this instance. The queue
   * handler creates one processor per batch and flushes once at the end
   * (`batchCounters`), so a batch costs one D1 write transaction; otherwise
   * each message flushes its own.
   */
  private readonly counters = new CounterBatch();
  private readonly batchCounters: boolean;

  constructor(logger: Logger, pushProviders: PushProviders = resolvePushProviders(), opts: { batchCounters?: boolean } = {}) {
    this.logger = logger;
    this.pushProviders = pushProviders;
    this.batchCounters = opts.batchCounters ?? false;
  }

  /**
   * Writes the queued analytics increments (one D1 transaction of atomic
   * upserts). Rollups are derived data: a failure is logged, never retried
   * through the queue (that would repeat the message's other effects).
   */
  async flushCounters(env: QueueEnvironment): Promise<void> {
    if (this.counters.size === 0) return;
    if (!env.NOTIFICATIONS_DB) {
      this.logger.warn('NOTIFICATIONS_DB not bound; analytics increments dropped', { rows: this.counters.size });
      this.counters.clear();
      return;
    }
    const rows = this.counters.size;
    try {
      await this.counters.flush(env.NOTIFICATIONS_DB);
      this.logger.debug('Analytics counters written', { rows });
    } catch (error) {
      this.logger.error('Failed to write analytics counters', { rows, error });
    }
  }

  async processMessage(message: AlUmmahMessage, env: QueueEnvironment): Promise<ProcessingResult> {
    const startTime = Date.now();
    this.logger.debug(`Processing message ${message.id} of type ${message.type}`);

    try {
      // Validate message structure
      if (!this.validateMessage(message)) {
        throw new Error('Invalid message structure');
      }

      // Save message to R2 bucket first
      await this.saveMessageToR2(message, env);

      // Process based on message type
      await this.processByType(message, env);
      if (!this.batchCounters) await this.flushCounters(env);

      const processingTime = Date.now() - startTime;
      this.logger.debug(`Successfully processed message ${message.id} in ${processingTime}ms`);
      
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
      case MessageType.PushDispatch:
        await this.processPushDispatch(message, env);
        break;

      // Video-related messages
      case MessageType.VideoView:
        await this.processVideoViewMessage(message, env);
        break;

      // Analytics: played seconds (#235)
      case MessageType.VideoWatchTime:
        await this.processVideoWatchTimeMessage(message, env);
        break;

      // Analytics: retention buckets (docs/specs/CREATOR-STUDIO.md §8.4)
      case MessageType.VideoRetention:
        this.processVideoRetentionMessage(message);
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
        this.logger.debug('Client analytics batch stored', {
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

      // Account erasure, Contact us step (#616): queued by processUserDataErased
      case MessageType.ContactDataErase:
        await this.processContactDataErase(message, env);
        break;

      // Search index (Story 29.9): content written outside api-videos
      case MessageType.SearchIndexSync:
        await handleSearchIndexSync(message, env, this.logger);
        break;

      // Channel tab events: tabs are frontend-only, there is no backend processing.
      // The message is already archived by saveMessageToR2; acknowledge it. These
      // used to fall through to `Unknown message type`, which was retried and
      // dead-lettered every ChannelTabUpdate (the QA DLQ traffic).
      case MessageType.ChannelTabCreate:
      case MessageType.ChannelTabUpdate:
      case MessageType.ChannelTabDelete:
      case MessageType.ChannelTabReorder:
      case MessageType.ChannelTabSwitch:
        this.logger.debug(`Channel tab event acknowledged: ${MessageType[message.type]}`);
        break;

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  private async processProfileMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing profile message: ${MessageType[message.type]}`, message.payload);

    const { userId } = message.payload as { userId: string; profileData?: unknown };
    
    // Views can be anonymous (signed-out viewers); every other profile event has an actor.
    if (!userId && message.type !== MessageType.ProfileView) {
      throw new Error('Profile message missing required field: userId');
    }

    // Process profile-related actions
    switch (message.type) {
      case MessageType.ProfileCreate:
        this.logger.debug(`Profile created for user ${userId}`);
        break;
      case MessageType.ProfileUpdate:
        this.logger.debug(`Profile updated for user ${userId}`);
        break;
      case MessageType.ProfileDelete:
        this.logger.debug(`Profile deleted for user ${userId}`);
        break;
      case MessageType.ProfileView:
        this.logger.debug(`Profile viewed by ${userId || 'anonymous'}`);
        break;
    }
  }

  private async processChannelMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing channel message: ${MessageType[message.type]}`, message.payload);

    const { channelId, userId } = message.payload as { channelId: string; userId: string };
    
    // Views can be anonymous (signed-out viewers); every other channel event has an actor.
    if (!channelId || (!userId && message.type !== MessageType.ChannelView)) {
      throw new Error('Channel message missing required fields: channelId, userId');
    }

    // Process channel-related actions
    switch (message.type) {
      case MessageType.ChannelCreate:
        this.logger.debug(`Channel ${channelId} created by user ${userId}`);
        break;
      case MessageType.ChannelUpdate:
        this.logger.debug(`Channel ${channelId} updated by user ${userId}`);
        break;
      case MessageType.ChannelDelete:
        this.logger.debug(`Channel ${channelId} deleted by user ${userId}`);
        break;
      case MessageType.ChannelView:
        this.logger.debug(`Channel ${channelId} viewed by ${userId || 'anonymous'}`);
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

    // Subscriber index used for notification fan-out (per-channel bell lives
    // on the row). api-videos keeps it in step with the subscription in the
    // same transaction; this re-syncs it from the stored state, so it is
    // correct whatever order the events arrive in.
    if (env.NOTIFICATIONS_DB) {
      await reconcileChannelSubscriber(env.NOTIFICATIONS_DB, channelId, userId, message.type === MessageType.Subscribe ? 'subscribe' : 'unsubscribe');
    }

    // Process subscription actions
    switch (message.type) {
      case MessageType.Subscribe:
        this.logger.debug(`User ${userId} subscribed to channel ${channelId}`);
        break;
      case MessageType.Unsubscribe:
        this.logger.debug(`User ${userId} unsubscribed from channel ${channelId}`);
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
        this.logger.debug(`Video ${videoId} created by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoEdit:
        this.logger.debug(`Video ${videoId} edited by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoDelete:
        this.logger.debug(`Video ${videoId} deleted by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoView:
        this.logger.debug(`Video ${videoId} viewed by user ${actualUserId || 'anonymous'}`);
        break;
      case MessageType.VideoLike:
        this.logger.debug(`Video ${videoId} liked by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoUnlike:
        this.logger.debug(`Video ${videoId} unliked by user ${actualUserId || 'unknown'}`);
        break;
      case MessageType.VideoDislike:
        // Dislikes are turned off (owner decision 2026-11-11): the API no longer
        // sends this; one still in the queue is acknowledged and not counted.
        // Stored dislikes stay as they are.
        this.logger.debug(`Video ${videoId} dislike ignored: dislikes are turned off`, { userId: actualUserId });
        break;
      case MessageType.VideoUndislike:
        this.logger.debug(`Video ${videoId} undisliked by user ${actualUserId || 'unknown'}`);
        break;
    }
  }

  private async processVideoViewMessage(message: AlUmmahMessage, _env: QueueEnvironment): Promise<void> {
    const payload = message.payload as { videoId?: string; searchQuery?: string };

    // Search telemetry is published with the VideoView type but has no videoId.
    if (!payload.videoId && payload.searchQuery !== undefined) {
      this.logger.debug('Search event recorded', { query: payload.searchQuery });
      return;
    }

    await this.processVideoMessage(message);

    if (recordViewRollup(this.counters, message.payload, message.timestamp)) {
      this.logger.debug('View rollup queued', { videoId: payload.videoId });
    }
  }

  private async processVideoWatchTimeMessage(message: AlUmmahMessage, _env: QueueEnvironment): Promise<void> {
    const payload = message.payload as { videoId?: string };
    if (!recordWatchTimeRollup(this.counters, message.payload, message.timestamp)) {
      this.logger.warn('Invalid watch-time message ignored', { videoId: payload.videoId });
    }
  }

  private processVideoRetentionMessage(message: AlUmmahMessage): void {
    if (!recordRetentionRollup(this.counters, message.payload, message.timestamp)) {
      this.logger.warn('Invalid retention message ignored', { videoId: (message.payload as { videoId?: string }).videoId });
    }
  }

  private async processUploadLifecycleMessage(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    const payload = message.payload as { videoId?: string; userId?: string; title?: string; error?: string; duration?: number; attempt?: unknown };
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
    this.logger.debug(`Video ${payload.videoId} upload status: ${status}`, { userId: payload.userId });

    // Terminal states are stored in the uploader's notification center first so
    // the realtime event carries the stored id (or is skipped when opted out).
    let notificationId: string | null | undefined;
    if (env.NOTIFICATIONS_DB && payload.userId && (status === 'ready' || status === 'failed')) {
      const stored = await insertNotification(env.NOTIFICATIONS_DB, {
        notificationId: crypto.randomUUID(),
        recipientUserId: payload.userId,
        notificationKey: status === 'ready' ? 'uploadReady' : 'uploadFailed',
        params: { videoTitle: payload.title || '' },
        actionUrl: uploadResultActionUrl(payload.videoId, status),
        entityId: payload.videoId,
        dedupeKey: uploadResultDedupeKey(payload.videoId, status, payload.attempt),
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
    // Push the row unless it was already pushed: a retry after a failure
    // between store and push still pushes it (SCALABILITY-AUDIT PR-10)
    const pending = await unpushedNotification(env.NOTIFICATIONS_DB, payload);
    this.logger.debug('Notification stored', {
      userId: payload.recipientUserId,
      key: payload.notificationKey,
      stored: !!stored,
      pending: !!pending,
    });
    if (pending) {
      if (!payload.realtimeSent) await pushStoredNotifications(env, [pending], payload);
      await enqueuePush(env, [pending], payload);
      await markPushed(env.NOTIFICATIONS_DB, [pending]);
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
    const data = {
      notificationKey: payload.kind === 'live_started' ? ('liveStarted' as const) : ('newVideo' as const),
      params: payload.params,
      actionUrl: payload.actionUrl,
    };
    // One page of subscribers per message (SCALABILITY-AUDIT PR-5): the next
    // page is queued first, so a failure below retries only this page
    const page = await fanoutNotificationPage(env.NOTIFICATIONS_DB, payload);
    let nextQueued = false;
    if (page.more && page.lastUserId) {
      const next: NotificationFanoutPayload = { ...payload, afterUserId: page.lastUserId };
      if (env.MESSAGE_QUEUE) {
        await env.MESSAGE_QUEUE.send({
          id: `${message.id}:${page.lastUserId}`,
          type: MessageType.NotificationFanout,
          timestamp: Date.now(),
          payload: next as unknown as Record<string, unknown>,
        });
        nextQueued = true;
      }
    }
    // Realtime: one batched call; push: one queue batch; then mark them pushed (PR-6, PR-7, PR-10)
    const pushed = await pushStoredNotifications(env, page.rows, data);
    await enqueuePush(env, page.rows, data);
    await markPushed(env.NOTIFICATIONS_DB, page.rows);
    this.logger.debug('Notification fan-out page finished', {
      kind: payload.kind,
      channelId: payload.channelId,
      entityId: payload.entityId,
      afterUserId: page.afterUserId,
      recipients: page.rows.length,
      pushed,
      nextQueued,
    });
    if (page.more && page.lastUserId && !nextQueued) {
      // No queue to page through: carry on in this invocation
      await this.processNotificationFanout({ ...message, payload: { ...payload, afterUserId: page.lastUserId } as unknown as Record<string, unknown> }, env);
    }
  }

  /** Deliver stored notifications to the recipients' push devices (Epic 9.4). */
  private async processPushDispatch(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    const payload = message.payload as unknown as PushDispatchPayload;
    if (!Array.isArray(payload.recipients) || !isNotificationKey(payload.notificationKey)) {
      throw new Error('Push dispatch message missing required fields: recipients, notificationKey');
    }
    if (!env.NOTIFICATIONS_DB) {
      this.logger.warn('NOTIFICATIONS_DB not bound; push skipped', { key: payload.notificationKey });
      return;
    }
    const summary = await dispatchPush(env.NOTIFICATIONS_DB, payload, this.pushProviders);
    this.logger.debug('Push dispatch finished', { key: payload.notificationKey, recipients: payload.recipients.length, ...summary });
  }

  private async processLiveStreamMessage(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    const payload = message.payload as { liveStreamId?: string; channelId?: string; status?: string; title?: string };
    if (!payload.liveStreamId) {
      throw new Error('Live stream message missing required field: liveStreamId');
    }
    this.logger.debug(`Live stream ${payload.liveStreamId} event ${MessageType[message.type]}`, { status: payload.status });

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
        this.logger.debug(`Comment ${commentId} created by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentEdit:
        this.logger.debug(`Comment ${commentId} edited by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentDelete:
        this.logger.debug(`Comment ${commentId} deleted by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentLike:
        this.logger.debug(`Comment ${commentId} liked by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentDislike:
        // Comment dislikes are turned off (owner decision 2026-11-12): the API no
        // longer sends this; one still in the queue is acknowledged and not
        // counted. Stored dislikes stay as they are.
        this.logger.debug(`Comment ${commentId} dislike ignored: dislikes are turned off`, { videoId, userId });
        break;
      case MessageType.CommentUnlike:
        this.logger.debug(`Comment ${commentId} unliked by user ${userId} on video ${videoId}`);
        break;
      case MessageType.CommentUndislike:
        this.logger.debug(`Comment ${commentId} undisliked by user ${userId} on video ${videoId}`);
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
        this.logger.debug(`Playlist ${playlistId} created by user ${userId}`);
        break;
      case MessageType.PlaylistEdit:
        this.logger.debug(`Playlist ${playlistId} edited by user ${userId}`);
        break;
      case MessageType.PlaylistDelete:
        this.logger.debug(`Playlist ${playlistId} deleted by user ${userId}`);
        break;
      case MessageType.PlaylistAdd:
        this.logger.debug(`Video added to playlist ${playlistId} by user ${userId}`);
        break;
      case MessageType.PlaylistRemove:
        this.logger.debug(`Video removed from playlist ${playlistId} by user ${userId}`);
        break;
      case MessageType.PlaylistClone:
        this.logger.debug(`Playlist ${playlistId} cloned by user ${userId}`);
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
        this.logger.debug(`User ${userId} started watching video ${videoId}`);
        break;
      case 'watch_progress':
        if (progress !== undefined && duration !== undefined && duration > 0) {
          const percentage = Math.round((progress / duration) * 100);
          this.logger.debug(`User ${userId} progress on video ${videoId}: ${percentage}% (${progress}s/${duration}s)`);
        } else {
          this.logger.warn(`Watch progress event missing progress/duration fields for video ${videoId}`);
        }
        break;
      case 'watch_completed':
        this.logger.debug(`User ${userId} completed watching video ${videoId}`);
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
        this.logger.debug(`Community post ${postId} created on channel ${channelId} by actor`, { actor });
        break;
      case MessageType.CommunityPostUpdated:
        this.logger.debug(`Community post ${postId} updated on channel ${channelId} by actor`, { actor });
        break;
      case MessageType.CommunityPostDeleted:
        this.logger.debug(`Community post ${postId} deleted from channel ${channelId} by actor`, { actor });
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
        this.logger.debug(`Comment ${commentId} created on post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentUpdated:
        this.logger.debug(`Comment ${commentId} updated on post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentLiked:
        this.logger.debug(`Comment ${commentId} liked on post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentUnliked:
        this.logger.debug(`Comment ${commentId} unliked on post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentDeleted:
        this.logger.debug(`Comment ${commentId} deleted from post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentPinned:
        this.logger.debug(`Comment ${commentId} pinned on post ${postId} by actor`, { actor });
        break;
      case MessageType.PostCommentHearted:
        this.logger.debug(`Comment ${commentId} hearted on post ${postId} by actor`, { actor });
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
    // Contact us messages (#616) are erased by their own queued step, so it retries and
    // dead-letters on its own. Queued first: if a later step fails, this message is
    // retried and queues it again, which is harmless (the step is idempotent).
    await this.queueContactDataErase(message, userId, env);
    const result = await env.REPORTS_DB.prepare('UPDATE reports SET reporter_id = ? WHERE reporter_id = ?')
      .bind(DELETED_USER_ID, userId)
      .run();
    // AI moderation signals (Epic 28): tombstone the author, drop reviewer translations
    await eraseUserModerationData(env.REPORTS_DB, userId, DELETED_USER_ID);
    if (env.NOTIFICATIONS_DB) {
      await eraseUserNotifications(env.NOTIFICATIONS_DB, userId);
      // Their community post likes and poll votes come off the counters (PR-2/3/4)
      await eraseUserPostInteractions(env.NOTIFICATIONS_DB, userId);
    }
    this.logger.debug('Anonymised moderation reports after user data erasure', {
      userId,
      changes: (result as { meta?: { changes?: number } })?.meta?.changes ?? 0,
    });
  }

  private async queueContactDataErase(message: AlUmmahMessage, userId: string, env: QueueEnvironment): Promise<void> {
    const step: AlUmmahMessage = {
      id: `${message.id}:contact`,
      type: MessageType.ContactDataErase,
      timestamp: new Date().toISOString(),
      payload: { userId },
    };
    if (env.MESSAGE_QUEUE) {
      await env.MESSAGE_QUEUE.send(step);
      return;
    }
    // No producer binding (local dev): do the step inline
    await this.processContactDataErase(step, env);
  }

  /** Deletes the erased account's Contact us messages and notes (idempotent; contact/erase.ts). */
  private async processContactDataErase(message: AlUmmahMessage, env: QueueEnvironment): Promise<void> {
    const { userId } = message.payload as { userId?: string };
    if (!userId || userId === DELETED_USER_ID) {
      throw new Error('ContactDataErase message missing required field: userId');
    }
    const erased = await eraseUserContactData(env.REPORTS_DB, userId);
    this.logger.debug('Erased Contact us data after user data erasure', { userId, ...erased });
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

        this.logger.debug(`Report ${reportId} saved for ${entityType} ${entityId}`, {
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

        this.logger.debug(`Report ${reportId} resolved by moderator ${moderatorId}`, {
          action,
          entityType,
          entityId,
        });
        await applyModerationToSearchIndex({ entityType, entityId, action }, env, this.logger);
        break;
    }
    // The admin Reports queue changed: live admin pages refetch it (docs/admin/LIVE_OPS.md). Never throws.
    await publishAdminLive(env, 'moderation', { kind: 'changed', key: 'reports', queue: 'reports' });
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

    // A type this processor does not handle will not start working on a retry.
    if (error instanceof Error && error.message.startsWith('Unknown message type')) {
      return false;
    }

    // Retry for other types of errors (network issues, temporary failures, etc.)
    return true;
  }
}