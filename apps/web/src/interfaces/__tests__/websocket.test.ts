/**
 * Tests for WebSocket types and interfaces
 */
import {
  WebSocketMessage,
  WebSocketEventType,
  CommentEvent,
  LikeEvent,
  ViewCountEvent,
  NotificationEvent,
  PresenceEvent,
  WebSocketConnectionState,
  WebSocketSubscription,
  WebSocketConfig,
} from '../websocket';

describe('WebSocket Interfaces', () => {
  describe('WebSocketMessage', () => {
    it('should have correct structure', () => {
      const message: WebSocketMessage = {
        id: 'msg-123',
        type: 'comment_added',
        timestamp: Date.now(),
        data: { commentId: 'comment-1' },
      };

      expect(message.id).toBe('msg-123');
      expect(message.type).toBe('comment_added');
      expect(message.timestamp).toBeDefined();
      expect(message.data).toBeDefined();
    });
  });

  describe('CommentEvent', () => {
    it('should support comment_added event', () => {
      const event: CommentEvent = {
        type: 'comment_added',
        videoId: 'video-1',
        commentId: 'comment-1',
        comment: {
          id: 'comment-1',
          userId: 'user-1',
          channelId: 'channel-1',
          videoId: 'video-1',
          text: 'Great video!',
          dateCreated: new Date().toISOString(),
          dateModified: new Date().toISOString(),
          likesCount: 0,
          dislikesCount: 0,
          repliesCount: 0,
          isEdited: false,
          isDeleted: false,
          isPinned: false,
        },
      };

      expect(event.type).toBe('comment_added');
      expect(event.videoId).toBe('video-1');
      expect(event.comment).toBeDefined();
    });

    it('should support comment_deleted event without comment data', () => {
      const event: CommentEvent = {
        type: 'comment_deleted',
        videoId: 'video-1',
        commentId: 'comment-1',
      };

      expect(event.type).toBe('comment_deleted');
      expect(event.comment).toBeUndefined();
    });
  });

  describe('LikeEvent', () => {
    it('should track like events', () => {
      const event: LikeEvent = {
        type: 'video_liked',
        videoId: 'video-1',
        userId: 'user-1',
        likesCount: 10,
        dislikesCount: 2,
      };

      expect(event.type).toBe('video_liked');
      expect(event.likesCount).toBe(10);
      expect(event.dislikesCount).toBe(2);
    });
  });

  describe('ViewCountEvent', () => {
    it('should track view count updates', () => {
      const event: ViewCountEvent = {
        type: 'view_count_updated',
        videoId: 'video-1',
        viewCount: 1000,
      };

      expect(event.type).toBe('view_count_updated');
      expect(event.viewCount).toBe(1000);
    });
  });

  describe('NotificationEvent', () => {
    it('should support different notification types', () => {
      const event: NotificationEvent = {
        type: 'notification',
        notificationId: 'notif-1',
        userId: 'user-1',
        title: 'New Comment',
        message: 'Someone commented on your video',
        actionUrl: '/videos/video-1',
        notificationType: 'comment',
      };

      expect(event.type).toBe('notification');
      expect(event.notificationType).toBe('comment');
      expect(event.actionUrl).toBeDefined();
    });

    it('should support notifications without action URL', () => {
      const event: NotificationEvent = {
        type: 'notification',
        notificationId: 'notif-2',
        userId: 'user-1',
        title: 'System Update',
        message: 'System maintenance scheduled',
        notificationType: 'system',
      };

      expect(event.actionUrl).toBeUndefined();
    });
  });

  describe('PresenceEvent', () => {
    it('should track user presence', () => {
      const event: PresenceEvent = {
        type: 'user_joined',
        videoId: 'video-1',
        userId: 'user-1',
        userDisplayName: 'John Doe',
        viewerCount: 5,
      };

      expect(event.type).toBe('user_joined');
      expect(event.viewerCount).toBe(5);
    });
  });

  describe('WebSocketConnectionState', () => {
    it('should track connection status', () => {
      const state: WebSocketConnectionState = {
        status: 'connected',
        lastConnected: new Date(),
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
      };

      expect(state.status).toBe('connected');
      expect(state.reconnectAttempts).toBe(0);
    });

    it('should support different connection states', () => {
      const states: WebSocketConnectionState['status'][] = [
        'connecting',
        'connected',
        'disconnected',
        'error',
      ];

      states.forEach(status => {
        const state: WebSocketConnectionState = {
          status,
          reconnectAttempts: 0,
          maxReconnectAttempts: 5,
        };

        expect(state.status).toBe(status);
      });
    });
  });

  describe('WebSocketSubscription', () => {
    it('should define subscription structure', () => {
      const callback = jest.fn();
      const subscription: WebSocketSubscription = {
        channel: 'video:123',
        callback,
      };

      expect(subscription.channel).toBe('video:123');
      expect(subscription.callback).toBe(callback);
    });
  });

  describe('WebSocketConfig', () => {
    it('should define complete configuration', () => {
      const config: WebSocketConfig = {
        url: 'wss://example.com/ws',
        reconnectInterval: 3000,
        maxReconnectAttempts: 5,
        heartbeatInterval: 30000,
        userId: 'user-1',
        authToken: 'token-123',
      };

      expect(config.url).toBe('wss://example.com/ws');
      expect(config.reconnectInterval).toBe(3000);
      expect(config.heartbeatInterval).toBe(30000);
    });

    it('should support minimal configuration', () => {
      const config: WebSocketConfig = {
        url: 'wss://example.com/ws',
        reconnectInterval: 3000,
        maxReconnectAttempts: 5,
        heartbeatInterval: 30000,
      };

      expect(config.userId).toBeUndefined();
      expect(config.authToken).toBeUndefined();
    });
  });

  describe('WebSocketEventType', () => {
    it('should include all event types', () => {
      const eventTypes: WebSocketEventType[] = [
        'comment_added',
        'comment_updated',
        'comment_deleted',
        'video_liked',
        'video_unliked',
        'view_count_updated',
        'notification',
        'presence_update',
        'user_joined',
        'user_left',
        'connection_acknowledged',
        'heartbeat',
        'subscribe',
        'unsubscribe',
      ];

      eventTypes.forEach(type => {
        const message: WebSocketMessage = {
          id: 'msg-1',
          type,
          timestamp: Date.now(),
          data: {},
        };

        expect(message.type).toBe(type);
      });
    });
  });
});
