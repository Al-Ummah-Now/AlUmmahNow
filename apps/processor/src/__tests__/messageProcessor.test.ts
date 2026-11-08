import { MessageProcessor } from '../messageProcessor';
import { createLogger } from '@al-ummah/logger';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';

describe('MessageProcessor', () => {
  let processor: MessageProcessor;
  let mockEnv: QueueEnvironment;

  beforeEach(() => {
    const logger = createLogger('processor-test', { logLevel: 'debug' });
    processor = new MessageProcessor(logger);
    
    // Mock environment
    mockEnv = {
      MESSAGE_QUEUE: {
        send: jest.fn().mockResolvedValue(undefined),
      },
      DLQ: {
        send: jest.fn().mockResolvedValue(undefined),
      },
      MESSAGES_BUCKET: {
        put: jest.fn().mockResolvedValue(undefined),
      },
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
    };
  });

  describe('processMessage', () => {
    it('should process a valid profile message', async () => {
      const message: AlUmmahMessage = {
        id: 'test-1',
        type: MessageType.ProfileCreate,
        timestamp: new Date().toISOString(),
        payload: {
          userId: 'user-123',
          profileData: { name: 'John Doe', email: 'john@example.com' },
        },
      };

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.processedAt).toBeDefined();
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalled();
    });

    it('should process a valid channel message', async () => {
      const message: AlUmmahMessage = {
        id: 'test-2',
        type: MessageType.ChannelCreate,
        timestamp: new Date().toISOString(),
        payload: {
          channelId: 'channel-456',
          userId: 'user-123',
        },
      };

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalled();
    });

    // QA DLQ root cause: ChannelTabUpdate fell through to `Unknown message type`,
    // was retried 3 times and dead-lettered, one DLQ write per tab save.
    it.each([
      MessageType.ChannelTabCreate,
      MessageType.ChannelTabUpdate,
      MessageType.ChannelTabDelete,
      MessageType.ChannelTabReorder,
      MessageType.ChannelTabSwitch,
    ])('acknowledges channel tab event %s instead of failing it', async (type) => {
      const result = await processor.processMessage(
        { id: `tab-${type}`, type, timestamp: Date.now(), payload: { channelId: 'c1', userId: 'u1', tabs: [] } },
        mockEnv
      );
      expect(result.success).toBe(true);
    });

    it('does not retry a message type the processor does not handle', async () => {
      const result = await processor.processMessage(
        { id: 'unknown-1', type: 9999 as MessageType, timestamp: Date.now(), payload: { x: 1 } },
        mockEnv
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown message type: 9999');
      expect(result.shouldRetry).toBe(false);
    });

    it('accepts anonymous channel and profile views', async () => {
      const channel = await processor.processMessage(
        { id: 'cv-1', type: MessageType.ChannelView, timestamp: Date.now(), payload: { channelId: 'c1' } },
        mockEnv
      );
      const profile = await processor.processMessage(
        { id: 'pv-1', type: MessageType.ProfileView, timestamp: Date.now(), payload: { profileId: 'p1' } },
        mockEnv
      );
      expect(channel.success).toBe(true);
      expect(profile.success).toBe(true);
      // Other channel events still need an actor.
      const update = await processor.processMessage(
        { id: 'cu-1', type: MessageType.ChannelUpdate, timestamp: Date.now(), payload: { channelId: 'c1' } },
        mockEnv
      );
      expect(update.success).toBe(false);
    });

    it('should process a valid subscription message', async () => {
      const message: AlUmmahMessage = {
        id: 'test-3',
        type: MessageType.Subscribe,
        timestamp: new Date().toISOString(),
        payload: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
      };

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalled();
    });

    it('should process a valid video message', async () => {
      const message: AlUmmahMessage = {
        id: 'test-4',
        type: MessageType.VideoView,
        timestamp: new Date().toISOString(),
        payload: {
          videoId: 'video-789',
          userId: 'user-123',
        },
      };

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalled();
    });

    it('should process a valid comment message', async () => {
      const message: AlUmmahMessage = {
        id: 'test-5',
        type: MessageType.CommentCreate,
        timestamp: new Date().toISOString(),
        payload: {
          commentId: 'comment-101',
          userId: 'user-123',
          videoId: 'video-789',
        },
      };

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalled();
    });

    it('should process a valid playlist message', async () => {
      const message: AlUmmahMessage = {
        id: 'test-6',
        type: MessageType.PlaylistCreate,
        timestamp: new Date().toISOString(),
        payload: {
          playlistId: 'playlist-202',
          userId: 'user-123',
        },
      };

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalled();
    });

    it('should fail for invalid profile message', async () => {
      const message: AlUmmahMessage = {
        id: 'test-7',
        type: MessageType.ProfileCreate,
        timestamp: new Date().toISOString(),
        payload: {
          // Missing userId
          profileData: { name: 'John Doe' },
        },
      };

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing required field: userId');
      expect(result.shouldRetry).toBe(false);
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalled();
    });

    it('should fail for invalid channel message', async () => {
      const message: AlUmmahMessage = {
        id: 'test-8',
        type: MessageType.ChannelCreate,
        timestamp: new Date().toISOString(),
        payload: {
          userId: 'user-123',
          // Missing channelId
        },
      };

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing required fields: channelId, userId');
      expect(result.shouldRetry).toBe(false);
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalled();
    });

    it('should fail for invalid video message', async () => {
      const message: AlUmmahMessage = {
        id: 'test-9',
        type: MessageType.VideoView,
        timestamp: new Date().toISOString(),
        payload: {
          userId: 'user-123',
          // Missing videoId
        },
      };

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing required field: videoId');
      expect(result.shouldRetry).toBe(false);
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalled();
    });

    it('accepts WatchHistory events in the envelope api-videos now sends', async () => {
      const message: AlUmmahMessage = {
        id: 'wh-1',
        type: MessageType.WatchHistory,
        timestamp: Date.now(),
        payload: { type: 'watch_progress', userId: 'u1', videoId: 'v1', progress: 30, duration: 100, timestamp: new Date().toISOString() },
      } as AlUmmahMessage;
      const result = await processor.processMessage(message, mockEnv);
      expect(result.success).toBe(true);
    });

    it('consumes VideoWatchTime and adds the seconds to the video rollup (#235)', async () => {
      const message: AlUmmahMessage = {
        id: 'wt-1',
        type: MessageType.VideoWatchTime,
        timestamp: Date.now(),
        payload: { videoId: 'v1', videoChannelId: null, seconds: 20, sessionId: 's-12345678', timestamp: '2026-11-08T10:00:00.000Z' },
      } as AlUmmahMessage;
      (mockEnv.MESSAGES_BUCKET as unknown as { get: jest.Mock }).get = jest.fn(async () => null);
      const result = await processor.processMessage(message, mockEnv);
      expect(result.success).toBe(true);
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        'analytics/rollups/video/v1/2026-11.json',
        expect.stringContaining('"watchTime":20'),
        expect.anything()
      );
    });

    it('rejects the legacy { type: "WatchHistory", data } shape (why history events never landed)', async () => {
      const legacy = { type: 'WatchHistory', data: { type: 'watch_started', userId: 'u1', videoId: 'v1' } } as unknown as AlUmmahMessage;
      const result = await processor.processMessage(legacy, mockEnv);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid message structure');
    });

    it('should fail for invalid message structure', async () => {
      const message: AlUmmahMessage = {
        id: '', // Invalid empty ID
        type: MessageType.VideoView,
        timestamp: new Date().toISOString(),
        payload: {},
      };

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid message structure');
      expect(result.shouldRetry).toBe(false);
      // Should not try to save invalid messages to R2
      expect(mockEnv.MESSAGES_BUCKET.put).not.toHaveBeenCalled();
    });

    it('should save message to R2 with correct key structure', async () => {
      const message: AlUmmahMessage = {
        id: 'test-10',
        type: MessageType.VideoView,
        timestamp: '2024-09-22T10:30:45.123Z',
        payload: {
          videoId: 'video-789',
          userId: 'user-123',
        },
      };

      await processor.processMessage(message, mockEnv);

      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        '2024-09-22T10-30-45.test-10',
        expect.stringContaining('"id": "test-10"'),
        expect.anything()
      );
    });

    it('should handle R2 save failures', async () => {
      const message: AlUmmahMessage = {
        id: 'test-11',
        type: MessageType.VideoView,
        timestamp: new Date().toISOString(),
        payload: {
          videoId: 'video-789',
          userId: 'user-123',
        },
      };

      // Mock R2 put to fail
      (mockEnv.MESSAGES_BUCKET.put as jest.Mock).mockRejectedValue(new Error('R2 is down'));

      const result = await processor.processMessage(message, mockEnv);

      expect(result.success).toBe(false);
      expect(result.error).toContain('R2 save failed');
      expect(result.shouldRetry).toBe(true);
    });
  });
});