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
import { createMockLiveStreams, createMockPaginatedResponse, createMockApiResponse } from '@/__tests__/utils/mock-data';

// Mock the server action
const mockListLiveStreams = jest.fn();
jest.mock('@/lib/api/livestreams', () => ({
  listLiveStreams: (...args: unknown[]) => mockListLiveStreams(...args),
}));

// Mock logger
jest.mock('@/lib/logger-client', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

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
    });

    // Clear all mocks
    jest.clearAllMocks();
    mockListLiveStreams.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const createSuccessResponse = (streams: ReturnType<typeof createMockLiveStreams>, hasMore = false, cursor?: string) => {
    return createMockApiResponse(createMockPaginatedResponse(streams, { hasMore, cursor }));
  };

  describe('Basic Fetching', () => {
    it('fetches live streams successfully', async () => {
      const mockStreams = createMockLiveStreams(5, 'live');
      const mockResponse = createSuccessResponse(mockStreams);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.streams).toHaveLength(5);
      expect(result.current.isError).toBe(false);
    });

    it('starts with loading state', () => {
      mockListLiveStreams.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.streams).toEqual([]);
    });

    it('returns empty array when no streams available', async () => {
      const mockResponse = createSuccessResponse([]);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

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
      const mockResponse = createSuccessResponse(mockStreams);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(
        () => useLiveStreams({ status: 'live' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockListLiveStreams).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'live' })
      );
      expect(result.current.streams).toHaveLength(3);
    });

    it('filters by scheduled status', async () => {
      const mockStreams = createMockLiveStreams(2, 'scheduled');
      const mockResponse = createSuccessResponse(mockStreams);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(
        () => useLiveStreams({ status: 'scheduled' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockListLiveStreams).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'scheduled' })
      );
    });

    it('filters by channel ID', async () => {
      const mockStreams = createMockLiveStreams(1, 'live');
      const mockResponse = createSuccessResponse(mockStreams);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(
        () => useLiveStreams({ channelId: 'channel-123' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockListLiveStreams).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'channel-123' })
      );
    });
  });

  describe('Pagination', () => {
    it('supports infinite scroll pagination', async () => {
      const page1Streams = createMockLiveStreams(5, 'live');
      const page2Streams = createMockLiveStreams(5, 'live');

      const page1Response = createSuccessResponse(page1Streams, true, 'cursor-page2');
      const page2Response = createSuccessResponse(page2Streams, false);

      mockListLiveStreams
        .mockResolvedValueOnce(page1Response)
        .mockResolvedValueOnce(page2Response);

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
      const mockResponse = createSuccessResponse(mockStreams, false);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasNextPage).toBe(false);
    });

    it('respects custom limit parameter', async () => {
      const mockStreams = createMockLiveStreams(12, 'live');
      const mockResponse = createSuccessResponse(mockStreams);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useLiveStreams({ limit: 12 }), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockListLiveStreams).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 12 })
      );
    });
  });

  describe('Error Handling', () => {
    it('handles API errors gracefully', async () => {
      mockListLiveStreams.mockResolvedValueOnce({ success: false });

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.streams).toEqual([]);
    });

    it('handles network errors', async () => {
      mockListLiveStreams.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeTruthy();
    });

    it('handles null response from server action', async () => {
      mockListLiveStreams.mockResolvedValueOnce(null);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toContain('No response from API');
    });

    it('handles missing data in response', async () => {
      mockListLiveStreams.mockResolvedValueOnce({ success: true, data: null });

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toContain('Invalid response format');
    });
  });

  describe('Refetch Behavior', () => {
    it('allows manual refetch', async () => {
      const mockStreams = createMockLiveStreams(3, 'live');
      const mockResponse = createSuccessResponse(mockStreams);

      mockListLiveStreams.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useLiveStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockListLiveStreams).toHaveBeenCalledTimes(1);

      // Manual refetch
      await result.current.refetch();

      await waitFor(() => {
        expect(mockListLiveStreams).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Convenience Hooks', () => {
    it('useLiveNow fetches live streams', async () => {
      const mockStreams = createMockLiveStreams(3, 'live');
      const mockResponse = createSuccessResponse(mockStreams);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useLiveNow(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockListLiveStreams).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'live' })
      );
    });

    it('useScheduledStreams fetches scheduled streams', async () => {
      const mockStreams = createMockLiveStreams(2, 'scheduled');
      const mockResponse = createSuccessResponse(mockStreams);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useScheduledStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockListLiveStreams).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'scheduled' })
      );
    });

    it('useEndedStreams fetches ended streams', async () => {
      const mockStreams = createMockLiveStreams(4, 'ended');
      const mockResponse = createSuccessResponse(mockStreams);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useEndedStreams(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockListLiveStreams).toHaveBeenCalledWith(
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

      expect(mockListLiveStreams).not.toHaveBeenCalled();
      expect(result.current.streams).toEqual([]);
    });

    it('fetches when enabled becomes true', async () => {
      const mockStreams = createMockLiveStreams(2, 'live');
      const mockResponse = createSuccessResponse(mockStreams);

      mockListLiveStreams.mockResolvedValueOnce(mockResponse);

      const { result, rerender } = renderHook(
        ({ enabled }) => useLiveStreams({ enabled }),
        { wrapper, initialProps: { enabled: false } }
      );

      expect(mockListLiveStreams).not.toHaveBeenCalled();

      rerender({ enabled: true });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockListLiveStreams).toHaveBeenCalled();
      expect(result.current.streams).toHaveLength(2);
    });
  });
});
