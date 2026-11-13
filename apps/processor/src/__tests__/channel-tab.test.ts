import { handleChannelTabEvent } from '../handlers/channel-tab';
import { createLogger } from '@al-ummah/logger';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';

describe('Channel Tab Event Handler', () => {
  let mockEnv: QueueEnvironment;
  let mockLogger: ReturnType<typeof createLogger>;

  beforeEach(() => {
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

    mockLogger = createLogger('test', { logLevel: 'debug' });
  });

  describe('ChannelTabCreate', () => {
    it('should process channel tab create event', async () => {
      const message: AlUmmahMessage = {
        id: 'test-tab-1',
        type: MessageType.ChannelTabCreate,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          tabId: 'tab-456',
          userId: 'user-789',
          tabType: 'videos',
          tabName: 'Latest Videos',
          position: 0,
          isDefault: true,
        },
      };

      await handleChannelTabEvent(message, mockEnv, mockLogger);

      // Verify R2 bucket was called twice (analytics + creation metrics)
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledTimes(2);

      // Verify the analytics save
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('channel-tabs/'),
        expect.stringContaining('"tabId": "tab-456"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );

      // Verify the creation metrics save
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/tabs/creation/'),
        expect.stringContaining('"event":"tab_created"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );
    });

    it('should fail if required fields are missing', async () => {
      const message: AlUmmahMessage = {
        id: 'test-tab-2',
        type: MessageType.ChannelTabCreate,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          // Missing tabId and userId
        },
      };

      await expect(
        handleChannelTabEvent(message, mockEnv, mockLogger)
      ).rejects.toThrow('Channel tab message missing required fields');
    });
  });

  describe('ChannelTabSwitch', () => {
    it('should track tab switch metrics with session duration', async () => {
      const message: AlUmmahMessage = {
        id: 'test-tab-3',
        type: MessageType.ChannelTabSwitch,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          tabId: 'tab-456',
          userId: 'user-789',
          tabType: 'community',
          tabName: 'Community',
          previousTabId: 'tab-123',
          sessionDuration: 120, // 2 minutes on previous tab
        },
      };

      await handleChannelTabEvent(message, mockEnv, mockLogger);

      // Verify popularity metrics were saved
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/tabs/popularity/'),
        expect.stringContaining('"event":"tab_switched"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );

      // No per-user copy, and no viewer id in the metrics (#1177)
      const puts = (mockEnv.MESSAGES_BUCKET.put as jest.Mock).mock.calls;
      expect(puts.some((call) => String(call[0]).includes('analytics/tabs/user-behavior/'))).toBe(false);
      expect(puts.some((call) => String(call[1]).includes('user-789'))).toBe(false);

      // Verify session duration metrics were saved
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/tabs/sessions/'),
        expect.stringContaining('"event":"tab_session_ended"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );
    });

    it('should handle tab switch without session duration', async () => {
      const message: AlUmmahMessage = {
        id: 'test-tab-4',
        type: MessageType.ChannelTabSwitch,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          tabId: 'tab-456',
          userId: 'user-789',
          tabType: 'playlists',
          // No previousTabId or sessionDuration
        },
      };

      await handleChannelTabEvent(message, mockEnv, mockLogger);

      // Should still save popularity and user behavior metrics
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalled();

      // Should not save session metrics
      const calls = (mockEnv.MESSAGES_BUCKET.put as jest.Mock).mock.calls;
      const sessionCall = calls.find(call =>
        call[0].includes('analytics/tabs/sessions/')
      );
      expect(sessionCall).toBeUndefined();
    });
  });

  describe('ChannelTabReorder', () => {
    it('should track tab reorder events', async () => {
      const message: AlUmmahMessage = {
        id: 'test-tab-5',
        type: MessageType.ChannelTabReorder,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          tabId: 'tab-456',
          userId: 'user-789',
          position: 2,
        },
      };

      await handleChannelTabEvent(message, mockEnv, mockLogger);

      // Verify reorder metrics were saved
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/tabs/reorders/'),
        expect.stringContaining('"event":"tabs_reordered"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );
    });
  });

  describe('ChannelTabUpdate', () => {
    it('should track tab update events', async () => {
      const message: AlUmmahMessage = {
        id: 'test-tab-6',
        type: MessageType.ChannelTabUpdate,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          tabId: 'tab-456',
          userId: 'user-789',
          tabName: 'Updated Tab Name',
          tabType: 'custom',
        },
      };

      await handleChannelTabEvent(message, mockEnv, mockLogger);

      // Verify update metrics were saved
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/tabs/updates/'),
        expect.stringContaining('"event":"tab_updated"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );
    });
  });

  describe('ChannelTabDelete', () => {
    it('should track tab deletion events', async () => {
      const message: AlUmmahMessage = {
        id: 'test-tab-7',
        type: MessageType.ChannelTabDelete,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          tabId: 'tab-456',
          userId: 'user-789',
        },
      };

      await handleChannelTabEvent(message, mockEnv, mockLogger);

      // Verify deletion metrics were saved
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/tabs/deletions/'),
        expect.stringContaining('"event":"tab_deleted"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );
    });
  });

  describe('Analytics Key Structure', () => {
    it('should save with correct date-based key structure', async () => {
      const timestamp = '2025-01-18T14:30:45.123Z';
      const message: AlUmmahMessage = {
        id: 'test-tab-8',
        type: MessageType.ChannelTabSwitch,
        timestamp,
        payload: {
          channelId: 'channel-123',
          tabId: 'tab-456',
          userId: 'user-789',
        },
      };

      await handleChannelTabEvent(message, mockEnv, mockLogger);

      // Verify the key structure includes year/month/day
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringMatching(/channel-tabs\/2025\/01\/18\/\d+-test-tab-8\.json/),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('Tab Engagement Metrics', () => {
    it('should track comprehensive metrics for tab engagement', async () => {
      const message: AlUmmahMessage = {
        id: 'test-tab-9',
        type: MessageType.ChannelTabSwitch,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          tabId: 'tab-popular',
          userId: 'user-789',
          tabType: 'shorts',
          tabName: 'Shorts',
          previousTabId: 'tab-videos',
          sessionDuration: 300, // 5 minutes
        },
      };

      await handleChannelTabEvent(message, mockEnv, mockLogger);

      // Verify multiple analytics paths were used
      const calls = (mockEnv.MESSAGES_BUCKET.put as jest.Mock).mock.calls;

      // Should have analytics, popularity and session metrics (no per-user copy, #1177)
      expect(calls.length).toBeGreaterThanOrEqual(3);

      // Check for different metric types
      const hasPopularityMetric = calls.some(call =>
        call[0].includes('analytics/tabs/popularity/')
      );
      const hasUserBehaviorMetric = calls.some(call =>
        call[0].includes('analytics/tabs/user-behavior/')
      );
      const hasSessionMetric = calls.some(call =>
        call[0].includes('analytics/tabs/sessions/')
      );

      expect(hasPopularityMetric).toBe(true);
      expect(hasUserBehaviorMetric).toBe(false);
      expect(hasSessionMetric).toBe(true);
    });
  });
});