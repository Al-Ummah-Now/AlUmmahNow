import { renderHook, act, waitFor } from '@testing-library/react';
import { useWatchHistory } from '../useWatchHistory';
import { WatchHistoryService } from '@/services/api/watch-history';

jest.mock('@/services/api/watch-history', () => ({
  WatchHistoryService: {
    list: jest.fn(async () => ({ entries: [], total: 0, hasMore: false })),
    remove: jest.fn(),
    clearAll: jest.fn(),
    getPaused: jest.fn(),
    setPaused: jest.fn(),
  },
}));

describe('useWatchHistory - pause', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the pause setting and toggles it', async () => {
    (WatchHistoryService.getPaused as jest.Mock).mockResolvedValue(false);
    (WatchHistoryService.setPaused as jest.Mock).mockResolvedValue(true);
    const { result } = renderHook(() => useWatchHistory(true));

    await waitFor(() => expect(result.current.paused).toBe(false));
    await act(async () => {
      await result.current.togglePause();
    });

    expect(WatchHistoryService.setPaused).toHaveBeenCalledWith(true);
    expect(result.current.paused).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('keeps the old value and reports an error when the change fails', async () => {
    (WatchHistoryService.getPaused as jest.Mock).mockResolvedValue(true);
    (WatchHistoryService.setPaused as jest.Mock).mockResolvedValue(null);
    const { result } = renderHook(() => useWatchHistory(true));

    await waitFor(() => expect(result.current.paused).toBe(true));
    await act(async () => {
      await result.current.togglePause();
    });

    expect(result.current.paused).toBe(true);
    expect(result.current.error).toBe('pause');
  });

  it('does not load anything for signed-out users', () => {
    renderHook(() => useWatchHistory(false));
    expect(WatchHistoryService.getPaused).not.toHaveBeenCalled();
    expect(WatchHistoryService.list).not.toHaveBeenCalled();
  });
});
