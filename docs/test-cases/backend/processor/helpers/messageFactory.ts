/**
 * Message Factory for Processor Testing
 * Generates test messages for all supported message types
 */

// Utility functions
const randomString = (length: number = 10): string => {
  return Math.random().toString(36).substring(2, 2 + length);
};

const randomInt = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const randomBoolean = (probability: number = 0.5): boolean => {
  return Math.random() < probability;
};

const randomChoice = <T>(array: T[]): T => {
  return array[Math.floor(Math.random() * array.length)];
};

const randomDate = (past: boolean = true): string => {
  const now = new Date();
  const days = past ? -randomInt(1, 365) : randomInt(1, 365);
  const date = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
  return date.toISOString();
};

// Message type definitions
export interface AlUmmahMessage {
  id: string;
  type: string;
  timestamp: string;
  data: any;
  priority?: 'low' | 'normal' | 'high';
}

export interface ProfileData {
  userId: string;
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatar?: string;
}

export interface VideoData {
  videoId: string;
  userId: string;
  channelId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: 'public' | 'private' | 'unlisted';
  duration?: number;
  watchTime?: number;
  completed?: boolean;
  lastPosition?: number;
}

export interface ChannelData {
  channelId: string;
  userId: string;
  name?: string;
  description?: string;
  avatar?: string;
  banner?: string;
}

export interface CommentData {
  commentId: string;
  userId: string;
  videoId: string;
  content?: string;
  parentId?: string;
}

export interface SubscriptionData {
  userId: string;
  channelId: string;
}

export interface PlaylistData {
  playlistId?: string;
  userId: string;
  name?: string;
  description?: string;
  videoId?: string;
  videoIds?: string[];
  isPublic?: boolean;
}

export interface WatchHistoryData {
  userId: string;
  videoId: string;
  watchTime?: number;
  duration?: number;
  completed?: boolean;
  lastPosition?: number;
}

/**
 * Message Factory Class
 */
export class MessageFactory {
  /**
   * Create a base message structure
   */
  private static createBaseMessage(type: string, data: any, priority: string = 'normal'): AlUmmahMessage {
    return {
      id: `msg-${Date.now()}-${randomString(9)}`,
      type,
      timestamp: new Date().toISOString(),
      data,
      priority
    };
  }

  /**
   * Profile Messages
   */
  static createProfileMessage(type: string, overrides: Partial<ProfileData> = {}): AlUmmahMessage {
    const data: ProfileData = {
      userId: `user-${randomString(9)}`,
      email: `${randomString(8)}@example.com`,
      username: `${randomString(6)}_${randomInt(100, 999)}`,
      firstName: randomChoice(['John', 'Jane', 'Mike', 'Sarah', 'David', 'Emily']),
      lastName: randomChoice(['Smith', 'Johnson', 'Williams', 'Brown', 'Jones']),
      bio: 'Test user bio',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${randomString(6)}`,
      ...overrides
    };

    return this.createBaseMessage(type, data);
  }

  /**
   * Video Messages
   */
  static createVideoMessage(type: string, overrides: Partial<VideoData> = {}): AlUmmahMessage {
    const data: VideoData = {
      videoId: `video-${randomString(9)}`,
      userId: `user-${randomString(9)}`,
      channelId: `channel-${randomString(9)}`,
      title: `Test Video ${randomSentence(3, 6)}`,
      description: 'Test video description',
      tags: randomChoice([['education', 'tutorial'], ['entertainment', 'comedy'], ['gaming', 'review']]),
      visibility: randomChoice(['public', 'private', 'unlisted']),
      duration: randomInt(60, 7200),
      watchTime: randomInt(0, 300),
      completed: randomBoolean(0.3),
      lastPosition: randomInt(0, 300),
      ...overrides
    };

    return this.createBaseMessage(type, data);
  }

  /**
   * Channel Messages
   */
  static createChannelMessage(type: string, overrides: Partial<ChannelData> = {}): AlUmmahMessage {
    const data: ChannelData = {
      channelId: `channel-${randomString(9)}`,
      userId: `user-${randomString(9)}`,
      name: `Test Channel ${randomInt(1, 999)}`,
      description: 'Test channel description',
      avatar: `https://picsum.photos/200/200?random=${randomInt(1, 1000)}`,
      banner: `https://picsum.photos/1920/480?random=${randomInt(1, 1000)}`,
      ...overrides
    };

    return this.createBaseMessage(type, data);
  }

  /**
   * Comment Messages
   */
  static createCommentMessage(type: string, overrides: Partial<CommentData> = {}): AlUmmahMessage {
    const data: CommentData = {
      commentId: `comment-${randomString(9)}`,
      userId: `user-${randomString(9)}`,
      videoId: `video-${randomString(9)}`,
      content: randomChoice([
        'Great video! Thanks for sharing.',
        'This was really helpful, thank you!',
        'Amazing content, subscribed!',
        'Perfect timing, I needed this!',
        'You explain things so clearly.'
      ]),
      parentId: randomBoolean(0.2) ? `comment-${randomString(9)}` : undefined,
      ...overrides
    };

    return this.createBaseMessage(type, data);
  }

  /**
   * Subscription Messages
   */
  static createSubscriptionMessage(type: string, overrides: Partial<SubscriptionData> = {}): AlUmmahMessage {
    const data: SubscriptionData = {
      userId: `user-${randomString(9)}`,
      channelId: `channel-${randomString(9)}`,
      ...overrides
    };

    return this.createBaseMessage(type, data);
  }

  /**
   * Playlist Messages
   */
  static createPlaylistMessage(type: string, overrides: Partial<PlaylistData> = {}): AlUmmahMessage {
    const data: PlaylistData = {
      playlistId: `playlist-${randomString(9)}`,
      userId: `user-${randomString(9)}`,
      name: `My Playlist ${randomInt(1, 999)}`,
      description: 'Test playlist description',
      videoId: `video-${randomString(9)}`,
      videoIds: Array.from({ length: randomInt(1, 20) }, () => `video-${randomString(9)}`),
      isPublic: randomBoolean(0.7),
      ...overrides
    };

    return this.createBaseMessage(type, data);
  }

  /**
   * Watch History Messages
   */
  static createWatchHistoryMessage(type: string, overrides: Partial<WatchHistoryData> = {}): AlUmmahMessage {
    const duration = randomInt(60, 7200);
    const watchTime = randomInt(0, duration);
    
    const data: WatchHistoryData = {
      userId: `user-${randomString(9)}`,
      videoId: `video-${randomString(9)}`,
      watchTime,
      duration,
      completed: watchTime >= duration * 0.9,
      lastPosition: watchTime,
      ...overrides
    };

    return this.createBaseMessage(type, data);
  }

  /**
   * Create specific message types
   */
  static createProfileCreate(overrides: Partial<ProfileData> = {}): AlUmmahMessage {
    return this.createProfileMessage('ProfileCreate', overrides);
  }

  static createProfileUpdate(overrides: Partial<ProfileData> = {}): AlUmmahMessage {
    return this.createProfileMessage('ProfileUpdate', overrides);
  }

  static createProfileDelete(overrides: Partial<ProfileData> = {}): AlUmmahMessage {
    return this.createProfileMessage('ProfileDelete', overrides);
  }

  static createProfileView(overrides: Partial<ProfileData> = {}): AlUmmahMessage {
    return this.createProfileMessage('ProfileView', overrides);
  }

  static createVideoCreate(overrides: Partial<VideoData> = {}): AlUmmahMessage {
    return this.createVideoMessage('VideoCreate', overrides);
  }

  static createVideoEdit(overrides: Partial<VideoData> = {}): AlUmmahMessage {
    return this.createVideoMessage('VideoEdit', overrides);
  }

  static createVideoDelete(overrides: Partial<VideoData> = {}): AlUmmahMessage {
    return this.createVideoMessage('VideoDelete', overrides);
  }

  static createVideoView(overrides: Partial<VideoData> = {}): AlUmmahMessage {
    return this.createVideoMessage('VideoView', overrides);
  }

  static createVideoLike(overrides: Partial<VideoData> = {}): AlUmmahMessage {
    return this.createVideoMessage('VideoLike', overrides);
  }

  static createVideoUnlike(overrides: Partial<VideoData> = {}): AlUmmahMessage {
    return this.createVideoMessage('VideoUnlike', overrides);
  }

  static createVideoDislike(overrides: Partial<VideoData> = {}): AlUmmahMessage {
    return this.createVideoMessage('VideoDislike', overrides);
  }

  static createVideoUndislike(overrides: Partial<VideoData> = {}): AlUmmahMessage {
    return this.createVideoMessage('VideoUndislike', overrides);
  }

  static createChannelCreate(overrides: Partial<ChannelData> = {}): AlUmmahMessage {
    return this.createChannelMessage('ChannelCreate', overrides);
  }

  static createChannelUpdate(overrides: Partial<ChannelData> = {}): AlUmmahMessage {
    return this.createChannelMessage('ChannelUpdate', overrides);
  }

  static createChannelDelete(overrides: Partial<ChannelData> = {}): AlUmmahMessage {
    return this.createChannelMessage('ChannelDelete', overrides);
  }

  static createChannelView(overrides: Partial<ChannelData> = {}): AlUmmahMessage {
    return this.createChannelMessage('ChannelView', overrides);
  }

  static createCommentCreate(overrides: Partial<CommentData> = {}): AlUmmahMessage {
    return this.createCommentMessage('CommentCreate', overrides);
  }

  static createCommentEdit(overrides: Partial<CommentData> = {}): AlUmmahMessage {
    return this.createCommentMessage('CommentEdit', overrides);
  }

  static createCommentDelete(overrides: Partial<CommentData> = {}): AlUmmahMessage {
    return this.createCommentMessage('CommentDelete', overrides);
  }

  static createCommentLike(overrides: Partial<CommentData> = {}): AlUmmahMessage {
    return this.createCommentMessage('CommentLike', overrides);
  }

  static createCommentUnlike(overrides: Partial<CommentData> = {}): AlUmmahMessage {
    return this.createCommentMessage('CommentUnlike', overrides);
  }

  static createCommentDislike(overrides: Partial<CommentData> = {}): AlUmmahMessage {
    return this.createCommentMessage('CommentDislike', overrides);
  }

  static createCommentUndislike(overrides: Partial<CommentData> = {}): AlUmmahMessage {
    return this.createCommentMessage('CommentUndislike', overrides);
  }

  static createSubscribe(overrides: Partial<SubscriptionData> = {}): AlUmmahMessage {
    return this.createSubscriptionMessage('Subscribe', overrides);
  }

  static createUnsubscribe(overrides: Partial<SubscriptionData> = {}): AlUmmahMessage {
    return this.createSubscriptionMessage('Unsubscribe', overrides);
  }

  static createPlaylistCreate(overrides: Partial<PlaylistData> = {}): AlUmmahMessage {
    return this.createPlaylistMessage('PlaylistCreate', overrides);
  }

  static createPlaylistEdit(overrides: Partial<PlaylistData> = {}): AlUmmahMessage {
    return this.createPlaylistMessage('PlaylistEdit', overrides);
  }

  static createPlaylistDelete(overrides: Partial<PlaylistData> = {}): AlUmmahMessage {
    return this.createPlaylistMessage('PlaylistDelete', overrides);
  }

  static createPlaylistAdd(overrides: Partial<PlaylistData> = {}): AlUmmahMessage {
    return this.createPlaylistMessage('PlaylistAdd', overrides);
  }

  static createPlaylistRemove(overrides: Partial<PlaylistData> = {}): AlUmmahMessage {
    return this.createPlaylistMessage('PlaylistRemove', overrides);
  }

  static createPlaylistClone(overrides: Partial<PlaylistData> = {}): AlUmmahMessage {
    return this.createPlaylistMessage('PlaylistClone', overrides);
  }

  static createWatchHistoryUpdate(overrides: Partial<WatchHistoryData> = {}): AlUmmahMessage {
    return this.createWatchHistoryMessage('WatchHistoryUpdate', overrides);
  }

  static createWatchHistoryDelete(overrides: Partial<WatchHistoryData> = {}): AlUmmahMessage {
    return this.createWatchHistoryMessage('WatchHistoryDelete', overrides);
  }

  /**
   * Bulk message generation
   */
  static generateBulkMessages(type: string, count: number, overrides: any = {}): AlUmmahMessage[] {
    const messages: AlUmmahMessage[] = [];
    
    for (let i = 0; i < count; i++) {
      switch (type) {
        case 'VideoView':
          messages.push(this.createVideoView(overrides));
          break;
        case 'VideoLike':
          messages.push(this.createVideoLike(overrides));
          break;
        case 'ProfileView':
          messages.push(this.createProfileView(overrides));
          break;
        case 'Subscribe':
          messages.push(this.createSubscribe(overrides));
          break;
        case 'CommentCreate':
          messages.push(this.createCommentCreate(overrides));
          break;
        default:
          messages.push(this.createVideoView(overrides));
      }
    }
    
    return messages;
  }

  /**
   * Create invalid messages for error testing
   */
  static createInvalidMessage(errorType: string): any {
    switch (errorType) {
      case 'missingType':
        return {
          id: `msg-${randomString(9)}`,
          timestamp: new Date().toISOString(),
          data: { userId: 'user-123' }
        };
      
      case 'missingData':
        return {
          id: `msg-${randomString(9)}`,
          type: 'VideoView',
          timestamp: new Date().toISOString()
        };
      
      case 'invalidTimestamp':
        return {
          id: `msg-${randomString(9)}`,
          type: 'VideoView',
          timestamp: 'invalid-date',
          data: { userId: 'user-123' }
        };
      
      case 'invalidType':
        return {
          id: `msg-${randomString(9)}`,
          type: 'InvalidMessageType',
          timestamp: new Date().toISOString(),
          data: { userId: 'user-123' }
        };
      
      default:
        return {};
    }
  }
}

// Helper function for generating random sentences
function randomSentence(minWords: number, maxWords: number): string {
  const words = ['Amazing', 'Tutorial', 'Guide', 'Tips', 'Best', 'How', 'To', 'Create', 'Build', 'Learn'];
  const wordCount = randomInt(minWords, maxWords);
  const selected = [];
  
  for (let i = 0; i < wordCount; i++) {
    selected.push(randomChoice(words));
  }
  
  return selected.join(' ');
}