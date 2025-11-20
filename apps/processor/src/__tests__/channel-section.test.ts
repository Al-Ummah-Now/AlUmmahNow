import { handleChannelSectionEvent } from '../handlers/channel-section';
import { createLogger } from '@al-ummah/logger';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';

describe('Channel Section Event Handler', () => {
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

  describe('ChannelSectionCreate', () => {
    it('should process channel section create event', async () => {
      const message: AlUmmahMessage = {
        id: 'test-section-1',
        type: MessageType.ChannelSectionCreate,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          sectionId: 'section-456',
          userId: 'user-789',
          sectionType: 'featured_videos',
          position: 0,
          title: 'Featured Videos',
        },
      };

      await handleChannelSectionEvent(message, mockEnv, mockLogger);

      // Verify R2 bucket was called twice (analytics + creation metrics)
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledTimes(2);

      // Verify the analytics save
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('channel-sections/'),
        expect.stringContaining('"sectionId": "section-456"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );

      // Verify the creation metrics save
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/sections/creation/'),
        expect.stringContaining('"event": "section_created"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );
    });

    it('should fail if required fields are missing', async () => {
      const message: AlUmmahMessage = {
        id: 'test-section-2',
        type: MessageType.ChannelSectionCreate,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          // Missing sectionId and userId
        },
      };

      await expect(
        handleChannelSectionEvent(message, mockEnv, mockLogger)
      ).rejects.toThrow('Channel section message missing required fields');
    });
  });

  describe('ChannelSectionView', () => {
    it('should track section view metrics', async () => {
      const message: AlUmmahMessage = {
        id: 'test-section-3',
        type: MessageType.ChannelSectionView,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          sectionId: 'section-456',
          userId: 'user-789',
          sectionType: 'popular_uploads',
        },
      };

      await handleChannelSectionEvent(message, mockEnv, mockLogger);

      // Verify view metrics were saved
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/sections/views/'),
        expect.stringContaining('"event": "section_viewed"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );
    });
  });

  describe('ChannelSectionReorder', () => {
    it('should track section reorder events', async () => {
      const message: AlUmmahMessage = {
        id: 'test-section-4',
        type: MessageType.ChannelSectionReorder,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          sectionId: 'section-456',
          userId: 'user-789',
          position: 2,
        },
      };

      await handleChannelSectionEvent(message, mockEnv, mockLogger);

      // Verify reorder metrics were saved
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/sections/reorders/'),
        expect.stringContaining('"event": "sections_reordered"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );
    });
  });

  describe('ChannelSectionUpdate', () => {
    it('should track section update events', async () => {
      const message: AlUmmahMessage = {
        id: 'test-section-5',
        type: MessageType.ChannelSectionUpdate,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          sectionId: 'section-456',
          userId: 'user-789',
          title: 'Updated Title',
          sectionType: 'playlists',
        },
      };

      await handleChannelSectionEvent(message, mockEnv, mockLogger);

      // Verify update metrics were saved
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/sections/updates/'),
        expect.stringContaining('"event": "section_updated"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );
    });
  });

  describe('ChannelSectionDelete', () => {
    it('should track section deletion events', async () => {
      const message: AlUmmahMessage = {
        id: 'test-section-6',
        type: MessageType.ChannelSectionDelete,
        timestamp: Date.now(),
        payload: {
          channelId: 'channel-123',
          sectionId: 'section-456',
          userId: 'user-789',
        },
      };

      await handleChannelSectionEvent(message, mockEnv, mockLogger);

      // Verify deletion metrics were saved
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringContaining('analytics/sections/deletions/'),
        expect.stringContaining('"event": "section_deleted"'),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      );
    });
  });

  describe('Analytics Key Structure', () => {
    it('should save with correct date-based key structure', async () => {
      const timestamp = '2025-01-18T12:30:45.123Z';
      const message: AlUmmahMessage = {
        id: 'test-section-7',
        type: MessageType.ChannelSectionView,
        timestamp,
        payload: {
          channelId: 'channel-123',
          sectionId: 'section-456',
          userId: 'user-789',
        },
      };

      await handleChannelSectionEvent(message, mockEnv, mockLogger);

      // Verify the key structure includes year/month/day
      expect(mockEnv.MESSAGES_BUCKET.put).toHaveBeenCalledWith(
        expect.stringMatching(/channel-sections\/2025\/01\/18\/\d+-test-section-7\.json/),
        expect.any(String),
        expect.any(Object)
      );
    });
  });
});