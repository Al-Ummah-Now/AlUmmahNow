import { AlUmmahMessage, ProcessingResult, MessageType, QueueEnvironment } from './types';
import { Logger } from '@al-ummah/logger';
import { handleChannelSectionEvent } from './handlers/channel-section';
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
        await this.processSubscriptionMessage(message);
        break;

      // Video-related messages
      case MessageType.VideoCreate:
      case MessageType.VideoEdit:
      case MessageType.VideoDelete:
      case MessageType.VideoView:
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
      case MessageType.PostCommentLiked:
      case MessageType.PostCommentDeleted:
      case MessageType.PostCommentPinned:
      case MessageType.PostCommentHearted:
        await this.processPostCommentMessage(message);
        break;

      // Community post events
      case MessageType.CommunityPostCreated:
      case MessageType.CommunityPostLiked:
      case MessageType.CommunityPostDeleted:
      case MessageType.PollVoted:
        await this.processCommunityPostMessage(message);
        break;

      // Channel section events
      case MessageType.ChannelSectionCreate:
      case MessageType.ChannelSectionUpdate:
      case MessageType.ChannelSectionDelete:
      case MessageType.ChannelSectionReorder:
      case MessageType.ChannelSectionView:
        await handleChannelSectionEvent(message, env, this.logger);
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

  private async processSubscriptionMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing subscription message: ${MessageType[message.type]}`, message.payload);

    const { userId, channelId } = message.payload as { userId: string; channelId: string };
    
    if (!userId || !channelId) {
      throw new Error('Subscription message missing required fields: userId, channelId');
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

    const { postId, channelId, userId } = message.payload as {
      postId: string;
      channelId: string;
      userId?: string;
      likerChannelId?: string;
      optionIds?: string[];
    };

    if (!postId || !channelId) {
      throw new Error('Community post message missing required fields: postId, channelId');
    }

    // Process community post actions
    switch (message.type) {
      case MessageType.CommunityPostCreated:
        this.logger.info(`Community post ${postId} created on channel ${channelId} by user ${userId}`);
        break;
      case MessageType.CommunityPostLiked:
        this.logger.info(`Community post ${postId} liked by user ${userId}`);
        break;
      case MessageType.CommunityPostDeleted:
        this.logger.info(`Community post ${postId} deleted from channel ${channelId}`);
        break;
      case MessageType.PollVoted: {
        const { optionIds } = message.payload as { optionIds?: string[] };
        this.logger.info(`User ${userId} voted on poll ${postId} (${optionIds?.length || 0} options selected)`);
        break;
      }
    }
  }

  private async processPostCommentMessage(message: AlUmmahMessage): Promise<void> {
    this.logger.debug(`Processing post comment message: ${MessageType[message.type]}`, message.payload);

    const { postId, commentId, authorChannelId } = message.payload as {
      postId: string;
      commentId: string;
      authorChannelId?: string;
      authorUserId?: string;
      parentCommentId?: string;
    };

    if (!postId || !commentId) {
      throw new Error('Post comment message missing required fields: postId, commentId');
    }

    // Process post comment actions
    switch (message.type) {
      case MessageType.PostCommentCreated:
        this.logger.info(`Comment ${commentId} created by channel ${authorChannelId} on post ${postId}`);
        break;
      case MessageType.PostCommentLiked:
        this.logger.info(`Comment ${commentId} liked on post ${postId}`);
        break;
      case MessageType.PostCommentDeleted:
        this.logger.info(`Comment ${commentId} deleted from post ${postId}`);
        break;
      case MessageType.PostCommentPinned:
        this.logger.info(`Comment ${commentId} pinned on post ${postId}`);
        break;
      case MessageType.PostCommentHearted:
        this.logger.info(`Comment ${commentId} hearted on post ${postId}`);
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