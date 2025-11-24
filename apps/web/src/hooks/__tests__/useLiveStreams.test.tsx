/**
 * useLiveStreams Hook Tests
 * Task 1.12: Mobile/Desktop Testing Strategy
 *
 * Comprehensive tests for useLiveStreams hook including:
 * - Data fetching and pagination
 * - Filtering by status
 * - Error handling and retry logic
 * - Caching behavior
 * - Auto-refetch for live streams
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useLiveStreams, useLiveNow, useScheduledStreams, useEndedStreams } from '../useLiveStreams';
import { LiveStreamsAPI } from '@/lib/api/livestreams';
import { createMockLiveStreams } from '@/__tests__/utils/mock-data';

// Mock the LiveStreamsAPI
jest.mock('@/lib/api/livestreams', () => ({
  LiveStreamsAPI: {
    list: jest.fn(),
  },
}));

const mockedAPI = LiveStreamsAPI as jest.Mocked<typeof LiveStreamsAPI>;

describe('useLiveStreams Hook', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    // Create a new QueryClient for each test
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
      logger: {
        log: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    // Clear all mocks
    jest.clearAllMocks();

    // Suppress console logs in tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    queryClient.clear();
    jest.restoreAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('Basic Fetching', () => {
    it('fetches live streams successfully', async () => {
      const mockStreams = createMockLiveStreams(5, 'live');
      const mockResponse = {
        success: true,
        result: {
          data: mockStreams,
          cursor: undefined,
          total: 5,
        },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.streams).toHaveLength(5);
      expect(result.current.isError).toBe(false);
    });

    it('starts with loading state', () => {
      mockedAPI.list.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.streams).toEqual([]);
    });

    it('returns empty array when no streams available', async () => {
      const mockResponse = {
        success: true,
        result: {
          data: [],
          cursor: undefined,
          total: 0,
        },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.streams).toEqual([]);
      expect(result.current.isError).toBe(false);
    });
  });

  describe('Filtering', () => {
    it('filters by live status', async () => {
      const mockStreams = createMockLiveStreams(3, 'live');
      const mockResponse = {
        success: true,
        result: { data: mockStreams, cursor: undefined, total: 3 },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(
        () => useLiveStreams({ status: 'live' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAPI.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'live' })
      );
      expect(result.current.streams).toHaveLength(3);
    });

    it('filters by scheduled status', async () => {
      const mockStreams = createMockLiveStreams(2, 'scheduled');
      const mockResponse = {
        success: true,
        result: { data: mockStreams, cursor: undefined, total: 2 },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(
        () => useLiveStreams({ status: 'scheduled' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAPI.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'scheduled' })
      );
    });

    it('filters by category', async () => {
      const mockStreams = createMockLiveStreams(2, 'live');
      const mockResponse = {
        success: true,
        result: { data: mockStreams, cursor: undefined, total: 2 },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(
        () => useLiveStreams({ category: 'Islamic Lectures' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAPI.list).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Islamic Lectures' })
      );
    });

    it('filters by channel ID', async () => {
      const mockStreams = createMockLiveStreams(1, 'live');
      const mockResponse = {
        success: true,
        result: { data: mockStreams, cursor: undefined, total: 1 },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(
        () => useLiveStreams({ channelId: 'channel-123' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAPI.list).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'channel-123' })
      );
    });
  });

  describe('Pagination', () => {
    it('supports infinite scroll pagination', async () => {
      const page1Streams = createMockLiveStreams(5, 'live');
      const page2Streams = createMockLiveStreams(5, 'live');

      const page1Response = {
        success: true,
        result: {
          data: page1Streams,
          cursor: 'cursor-page2',
          total: 10,
        },
      };

      const page2Response = {
        success: true,
        result: {
          data: page2Streams,
          cursor: undefined,
          total: 10,
        },
      };

      mockedAPI.list
        .mockResolvedValueOnce(page1Response as any)
        .mockResolvedValueOnce(page2Response as any);

      const { result } = renderHook(() => useLiveStreams({ limit: 5 }), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.streams).toHaveLength(5);
      expect(result.current.hasNextPage).toBe(true);

      // Fetch next page
      await result.current.fetchNextPage();

      await waitFor(() => {
        expect(result.current.streams).toHaveLength(10);
      });

      expect(result.current.hasNextPage).toBe(false);
    });

    it('sets hasNextPage to false when no more pages', async () => {
      const mockStreams = createMockLiveStreams(5, 'live');
      const mockResponse = {
        success: true,
        result: {
          data: mockStreams,
          cursor: undefined,
          total: 5,
        },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasNextPage).toBe(false);
    });

    it('respects custom limit parameter', async () => {
      const mockStreams = createMockLiveStreams(12, 'live');
      const mockResponse = {
        success: true,
        result: { data: mockStreams, cursor: undefined, total: 12 },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(() => useLiveStreams({ limit: 12 }), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAPI.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 12 })
      );
    });
  });

  describe('Error Handling', () => {
    it('handles API errors gracefully', async () => {
      const errorResponse = {
        success: false,
        error: 'Failed to fetch streams',
      };

      mockedAPI.list.mockResolvedValueOnce(errorResponse as any);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.streams).toEqual([]);
    });

    it('handles network errors', async () => {
      mockedAPI.list.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeTruthy();
    });

    it('handles null response', async () => {
      mockedAPI.list.mockResolvedValueOnce(null as any);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toContain('No response from API');
    });
  });

  describe('Refetch Behavior', () => {
    it('allows manual refetch', async () => {
      const mockStreams = createMockLiveStreams(3, 'live');
      const mockResponse = {
        success: true,
        result: { data: mockStreams, cursor: undefined, total: 3 },
      };

      mockedAPI.list.mockResolvedValue(mockResponse as any);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAPI.list).toHaveBeenCalledTimes(1);

      // Manual refetch
      await result.current.refetch();

      await waitFor(() => {
        expect(mockedAPI.list).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Convenience Hooks', () => {
    it('useLiveNow fetches live streams', async () => {
      const mockStreams = createMockLiveStreams(3, 'live');
      const mockResponse = {
        success: true,
        result: { data: mockStreams, cursor: undefined, total: 3 },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(() => useLiveNow(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAPI.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'live' })
      );
    });

    it('useScheduledStreams fetches scheduled streams', async () => {
      const mockStreams = createMockLiveStreams(2, 'scheduled');
      const mockResponse = {
        success: true,
        result: { data: mockStreams, cursor: undefined, total: 2 },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(() => useScheduledStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAPI.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'scheduled' })
      );
    });

    it('useEndedStreams fetches ended streams', async () => {
      const mockStreams = createMockLiveStreams(4, 'ended');
      const mockResponse = {
        success: true,
        result: { data: mockStreams, cursor: undefined, total: 4 },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result } = renderHook(() => useEndedStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAPI.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ended' })
      );
    });
  });

  describe('Enabled Option', () => {
    it('does not fetch when enabled is false', async () => {
      const { result } = renderHook(
        () => useLiveStreams({ enabled: false }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      }, { timeout: 500 });

      expect(mockedAPI.list).not.toHaveBeenCalled();
      expect(result.current.streams).toEqual([]);
    });

    it('fetches when enabled becomes true', async () => {
      const mockStreams = createMockLiveStreams(2, 'live');
      const mockResponse = {
        success: true,
        result: { data: mockStreams, cursor: undefined, total: 2 },
      };

      mockedAPI.list.mockResolvedValueOnce(mockResponse as any);

      const { result, rerender } = renderHook(
        ({ enabled }) => useLiveStreams({ enabled }),
        { wrapper, initialProps: { enabled: false } }
      );

      expect(mockedAPI.list).not.toHaveBeenCalled();

      rerender({ enabled: true });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAPI.list).toHaveBeenCalled();
      expect(result.current.streams).toHaveLength(2);
    });
  });

  describe('Loading States', () => {
    it('sets isFetchingNextPage when loading next page', async () => {
      const page1Streams = createMockLiveStreams(5, 'live');
      const page2Streams = createMockLiveStreams(5, 'live');

      const page1Response = {
        success: true,
        result: {
          data: page1Streams,
          cursor: 'cursor-page2',
          total: 10,
        },
      };

      const page2Response = {
        success: true,
        result: {
          data: page2Streams,
          cursor: undefined,
          total: 10,
        },
      };

      mockedAPI.list
        .mockResolvedValueOnce(page1Response as any)
        .mockResolvedValueOnce(page2Response as any);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const fetchPromise = result.current.fetchNextPage();

      // Should be fetching next page
      await waitFor(() => {
        expect(result.current.isFetchingNextPage).toBe(true);
      });

      await fetchPromise;

      await waitFor(() => {
        expect(result.current.isFetchingNextPage).toBe(false);
      });
    });
  });
});
