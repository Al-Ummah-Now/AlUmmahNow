/**
 * Tests for channel tabs API functions
 * Tests API requests, responses, authentication, authorization, and error handling
 */
import {
  getChannelTabConfig,
  updateChannelTabConfig,
  verifyChannelOwnership,
} from '../channel-tabs';
import { apiRequestServer, buildApiUrl } from '../api-client';
import { getServerAuthContext } from '../server-auth';
import { getChannelById } from '../channels';
import type { ChannelTabConfig, Channel } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger';

// Mock dependencies
jest.mock('../api-client', () => ({
  apiRequestServer: jest.fn(),
  buildApiUrl: jest.fn((path: string) => `https://api.example.com${path}`),
}));

jest.mock('../server-auth', () => ({
  getServerAuthContext: jest.fn(),
}));

jest.mock('../channels', () => ({
  getChannelById: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockApiRequestServer = apiRequestServer as jest.MockedFunction<typeof apiRequestServer>;
const mockGetServerAuthContext = getServerAuthContext as jest.MockedFunction<typeof getServerAuthContext>;
const mockGetChannelById = getChannelById as jest.MockedFunction<typeof getChannelById>;

// Mock data
const createMockTabConfig = (overrides?: Partial<ChannelTabConfig>): ChannelTabConfig => ({
  channelId: 'test-channel-id',
  defaultTab: 'home',
  version: 1,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
  tabs: [
    { id: 'home', name: 'Home', nameLocalized: { en: 'Home', ar: 'الرئيسية' }, type: 'system', visible: true, position: 0 },
    { id: 'videos', name: 'Videos', nameLocalized: { en: 'Videos', ar: 'الفيديوهات' }, type: 'system', visible: true, position: 1 },
  ],
  ...overrides,
});

const createMockChannel = (overrides?: Partial<Channel>): Channel => ({
  id: 'test-channel-id',
  userId: 'user-123',
  email: 'test@example.com',
  name: 'Test Channel',
  description: 'Test description',
  avatarUrl: 'https://example.com/avatar.jpg',
  isMain: true,
  subscribersCount: 1000,
  videosCount: 50,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('getChannelTabConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch tab configuration successfully', async () => {
    const mockConfig = createMockTabConfig();
    mockApiRequestServer.mockResolvedValue(mockConfig);

    const result = await getChannelTabConfig('test-channel-id');

    expect(result).toEqual(mockConfig);
    expect(mockApiRequestServer).toHaveBeenCalledWith(
      {
        method: 'GET',
        url: 'https://api.example.com/api/channels/test-channel-id/tabs',
        functionName: 'getChannelTabConfig',
      },
      getServerAuthContext,
      false
    );
  });

  it('should return null when channel not found', async () => {
    mockApiRequestServer.mockResolvedValue(null);

    const result = await getChannelTabConfig('non-existent-id');

    expect(result).toBeNull();
  });

  it('should handle API errors gracefully', async () => {
    mockApiRequestServer.mockRejectedValue(new Error('Network error'));

    await expect(getChannelTabConfig('test-channel-id')).rejects.toThrow('Network error');
  });

  it('should use correct API endpoint', async () => {
    mockApiRequestServer.mockResolvedValue(createMockTabConfig());

    await getChannelTabConfig('custom-channel-id');

    expect(mockApiRequestServer).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/api/channels/custom-channel-id/tabs',
      }),
      expect.any(Function),
      false
    );
  });

  it('should not require authentication for public endpoint', async () => {
    mockApiRequestServer.mockResolvedValue(createMockTabConfig());

    await getChannelTabConfig('test-channel-id');

    expect(mockApiRequestServer).toHaveBeenCalledWith(
      expect.any(Object),
      getServerAuthContext,
      false // Public endpoint
    );
  });
});

describe('updateChannelTabConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should update tab configuration successfully', async () => {
    const mockConfig = createMockTabConfig({ defaultTab: 'videos' });
    mockApiRequestServer.mockResolvedValue(mockConfig);

    const updateData = {
      defaultTab: 'videos',
      tabs: [
        { id: 'home', visible: true, position: 0 },
        { id: 'videos', visible: true, position: 1 },
      ],
    };

    const result = await updateChannelTabConfig('test-channel-id', updateData);

    expect(result).toEqual(mockConfig);
    expect(mockApiRequestServer).toHaveBeenCalledWith(
      {
        method: 'PUT',
        url: 'https://api.example.com/api/channels/test-channel-id/tabs',
        body: updateData,
        functionName: 'updateChannelTabConfig',
      },
      getServerAuthContext,
      true
    );
  });

  it('should log update request details', async () => {
    mockApiRequestServer.mockResolvedValue(createMockTabConfig());

    const updateData = {
      defaultTab: 'videos',
      tabs: [{ id: 'home', visible: false }],
    };

    await updateChannelTabConfig('test-channel-id', updateData);

    expect(logger.info).toHaveBeenCalledWith(
      'updateChannelTabConfig: Request',
      {
        channelId: 'test-channel-id',
        defaultTab: 'videos',
        tabsCount: 1,
      }
    );
  });

  it('should require authentication', async () => {
    mockApiRequestServer.mockResolvedValue(createMockTabConfig());

    await updateChannelTabConfig('test-channel-id', { defaultTab: 'videos' });

    expect(mockApiRequestServer).toHaveBeenCalledWith(
      expect.any(Object),
      getServerAuthContext,
      true // Requires auth
    );
  });

  it('should handle update failures', async () => {
    mockApiRequestServer.mockResolvedValue(null);

    const result = await updateChannelTabConfig('test-channel-id', { defaultTab: 'videos' });

    expect(result).toBeNull();
  });

  it('should handle partial updates', async () => {
    const mockConfig = createMockTabConfig();
    mockApiRequestServer.mockResolvedValue(mockConfig);

    const result = await updateChannelTabConfig('test-channel-id', { defaultTab: 'videos' });

    expect(result).toEqual(mockConfig);
    expect(mockApiRequestServer).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { defaultTab: 'videos' },
      }),
      expect.any(Function),
      true
    );
  });

  it('should handle tab visibility updates', async () => {
    const mockConfig = createMockTabConfig();
    mockApiRequestServer.mockResolvedValue(mockConfig);

    const result = await updateChannelTabConfig('test-channel-id', {
      tabs: [
        { id: 'shorts', visible: false },
        { id: 'live', visible: false },
      ],
    });

    expect(result).toEqual(mockConfig);
  });

  it('should handle tab reordering', async () => {
    const mockConfig = createMockTabConfig();
    mockApiRequestServer.mockResolvedValue(mockConfig);

    const result = await updateChannelTabConfig('test-channel-id', {
      tabs: [
        { id: 'videos', position: 0 },
        { id: 'home', position: 1 },
        { id: 'about', position: 2 },
      ],
    });

    expect(result).toEqual(mockConfig);
  });
});

describe('verifyChannelOwnership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return true when user owns the channel', async () => {
    const mockChannel = createMockChannel({ userId: 'user-123' });
    mockGetServerAuthContext.mockResolvedValue({ userId: 'user-123', channelId: 'channel-456' });
    mockGetChannelById.mockResolvedValue(mockChannel);

    const result = await verifyChannelOwnership('test-channel-id');

    expect(result).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'verifyChannelOwnership: Ownership verified',
      {
        channelId: 'test-channel-id',
        userId: 'user-123',
        isOwner: true,
      }
    );
  });

  it('should return false when user does not own the channel', async () => {
    const mockChannel = createMockChannel({ userId: 'other-user' });
    mockGetServerAuthContext.mockResolvedValue({ userId: 'user-123', channelId: 'channel-456' });
    mockGetChannelById.mockResolvedValue(mockChannel);

    const result = await verifyChannelOwnership('test-channel-id');

    expect(result).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      'verifyChannelOwnership: Ownership verified',
      {
        channelId: 'test-channel-id',
        userId: 'user-123',
        isOwner: false,
      }
    );
  });

  it('should return false when user is not authenticated', async () => {
    mockGetServerAuthContext.mockResolvedValue(null);

    const result = await verifyChannelOwnership('test-channel-id');

    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'verifyChannelOwnership: No authenticated user',
      { channelId: 'test-channel-id' }
    );
  });

  it('should return false when auth context has no userId', async () => {
    mockGetServerAuthContext.mockResolvedValue({ channelId: 'channel-456' } as any);

    const result = await verifyChannelOwnership('test-channel-id');

    expect(result).toBe(false);
  });

  it('should return false when channel not found', async () => {
    mockGetServerAuthContext.mockResolvedValue({ userId: 'user-123', channelId: 'channel-456' });
    mockGetChannelById.mockResolvedValue(null);

    const result = await verifyChannelOwnership('test-channel-id');

    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'verifyChannelOwnership: Channel not found',
      { channelId: 'test-channel-id' }
    );
  });

  it('should handle API errors gracefully', async () => {
    mockGetServerAuthContext.mockResolvedValue({ userId: 'user-123', channelId: 'channel-456' });
    mockGetChannelById.mockRejectedValue(new Error('Network error'));

    const result = await verifyChannelOwnership('test-channel-id');

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'verifyChannelOwnership: Error verifying ownership',
      expect.objectContaining({
        channelId: 'test-channel-id',
      })
    );
  });

  it('should fetch channel data from correct API', async () => {
    const mockChannel = createMockChannel();
    mockGetServerAuthContext.mockResolvedValue({ userId: 'user-123', channelId: 'channel-456' });
    mockGetChannelById.mockResolvedValue(mockChannel);

    await verifyChannelOwnership('custom-channel-id');

    expect(mockGetChannelById).toHaveBeenCalledWith('custom-channel-id');
  });
});

describe('API Client Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use buildApiUrl for all endpoints', async () => {
    mockApiRequestServer.mockResolvedValue(createMockTabConfig());

    await getChannelTabConfig('test-channel-id');

    expect(buildApiUrl).toHaveBeenCalledWith('/api/channels/test-channel-id/tabs');
  });

  it('should handle concurrent requests', async () => {
    const config1 = createMockTabConfig({ channelId: 'channel-1' });
    const config2 = createMockTabConfig({ channelId: 'channel-2' });

    mockApiRequestServer
      .mockResolvedValueOnce(config1)
      .mockResolvedValueOnce(config2);

    const [result1, result2] = await Promise.all([
      getChannelTabConfig('channel-1'),
      getChannelTabConfig('channel-2'),
    ]);

    expect(result1?.channelId).toBe('channel-1');
    expect(result2?.channelId).toBe('channel-2');
  });

  it('should maintain request context across calls', async () => {
    mockApiRequestServer.mockResolvedValue(createMockTabConfig());

    await getChannelTabConfig('test-channel-id');
    await updateChannelTabConfig('test-channel-id', { defaultTab: 'videos' });

    expect(mockApiRequestServer).toHaveBeenCalledTimes(2);
  });
});

describe('Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle 404 responses', async () => {
    mockApiRequestServer.mockResolvedValue(null);

    const result = await getChannelTabConfig('non-existent-id');

    expect(result).toBeNull();
  });

  it('should handle 401 unauthorized', async () => {
    mockApiRequestServer.mockRejectedValue(new Error('Unauthorized'));

    await expect(updateChannelTabConfig('test-channel-id', { defaultTab: 'videos' }))
      .rejects.toThrow('Unauthorized');
  });

  it('should handle 403 forbidden', async () => {
    mockApiRequestServer.mockRejectedValue(new Error('Forbidden'));

    await expect(updateChannelTabConfig('test-channel-id', { defaultTab: 'videos' }))
      .rejects.toThrow('Forbidden');
  });

  it('should handle network timeouts', async () => {
    mockApiRequestServer.mockRejectedValue(new Error('Request timeout'));

    await expect(getChannelTabConfig('test-channel-id')).rejects.toThrow('Request timeout');
  });

  it('should handle malformed responses', async () => {
    mockApiRequestServer.mockResolvedValue({} as any);

    const result = await getChannelTabConfig('test-channel-id');

    expect(result).toEqual({});
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle empty update data', async () => {
    mockApiRequestServer.mockResolvedValue(createMockTabConfig());

    const result = await updateChannelTabConfig('test-channel-id', {});

    expect(result).toBeTruthy();
    expect(logger.info).toHaveBeenCalledWith(
      'updateChannelTabConfig: Request',
      expect.objectContaining({
        tabsCount: undefined,
      })
    );
  });

  it('should handle special characters in channel ID', async () => {
    mockApiRequestServer.mockResolvedValue(createMockTabConfig());

    await getChannelTabConfig('channel-with-special-chars-123');

    expect(buildApiUrl).toHaveBeenCalledWith('/api/channels/channel-with-special-chars-123/tabs');
  });

  it('should handle very long channel IDs', async () => {
    const longId = 'a'.repeat(100);
    mockApiRequestServer.mockResolvedValue(createMockTabConfig());

    await getChannelTabConfig(longId);

    expect(buildApiUrl).toHaveBeenCalledWith(`/api/channels/${longId}/tabs`);
  });

  it('should handle null auth context gracefully', async () => {
    mockGetServerAuthContext.mockResolvedValue(null);

    const result = await verifyChannelOwnership('test-channel-id');

    expect(result).toBe(false);
  });
});
