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

describe('useWatchHistory - Continue watching view', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks for unfinished videos only, on the first page and the next', async () => {
    (WatchHistoryService.getPaused as jest.Mock).mockResolvedValue(false);
    (WatchHistoryService.list as jest.Mock).mockResolvedValueOnce({
      entries: [{ videoId: 'a' }], total: 2, hasMore: true, cursor: 'c1',
    }).mockResolvedValueOnce({ entries: [{ videoId: 'b' }], total: 2, hasMore: false });
    const { result } = renderHook(() => useWatchHistory(true, { completed: false }));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(WatchHistoryService.list).toHaveBeenCalledWith({ limit: 20, completed: false });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(WatchHistoryService.list).toHaveBeenLastCalledWith({ limit: 20, cursor: 'c1', completed: false });
    expect(result.current.entries.map((e) => e.videoId)).toEqual(['a', 'b']);
  });

  it('asks for everything without the option', async () => {
    (WatchHistoryService.getPaused as jest.Mock).mockResolvedValue(false);
    renderHook(() => useWatchHistory(true));
    await waitFor(() => expect(WatchHistoryService.list).toHaveBeenCalledWith({ limit: 20, completed: undefined }));
  });
});
