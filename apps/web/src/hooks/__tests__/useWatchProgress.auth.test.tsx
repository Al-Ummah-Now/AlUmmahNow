/**
 * Regression: signed-in watches must reach the API.
 *
 * The watch page renders the player with `userId` but no `authToken` (auth
 * cookies are httpOnly). The hook used to require both, so every signed-in
 * watch was written to device storage only and account history stayed empty.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useWatchProgress } from '../useWatchProgress';
import { WatchHistoryService } from '@/services/api/watch-history';
import { fetchClientAuthToken } from '@/lib/auth/client-token';
import { simulatePlayback } from '@/test/watch-playback';
import type { ExtendedPlayer } from '@/lib/video/videojs';

jest.mock('@/services/api/watch-history', () => ({
  WatchHistoryService: {
    saveProgress: jest.fn(async () => ({ success: true })),
    getProgress: jest.fn(async () => null),
    saveLocal: jest.fn(async () => undefined),
    getLocal: jest.fn(async () => null),
    clearProgress: jest.fn(async () => undefined),
    shouldSaveProgress: jest.fn(() => true),
    isCompleted: jest.fn((current: number, duration: number) => current / duration >= 0.9),
  },
}));

jest.mock('@/lib/auth/client-token', () => ({
  fetchClientAuthToken: jest.fn(),
}));

const player = {
  currentTime: jest.fn(() => 42),
  duration: jest.fn(() => 600),
  readyState: jest.fn(() => 4),
  on: jest.fn(),
  off: jest.fn(),
  one: jest.fn(),
} as unknown as ExtendedPlayer;

describe('useWatchProgress - auth token resolution', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches the token for a signed-in user when no authToken prop is passed', async () => {
    (fetchClientAuthToken as jest.Mock).mockResolvedValue('fetched-token');
    const { result } = renderHook(() => useWatchProgress('video-1', player, 'user-1'));
    simulatePlayback(player, 10);

    await act(async () => {
      await result.current.saveProgress(true);
    });

    await waitFor(() => {
      expect(WatchHistoryService.saveProgress).toHaveBeenCalledWith(
        expect.objectContaining({ videoId: 'video-1', currentTime: 42, duration: 600 }),
        'fetched-token'
      );
    });
    expect(WatchHistoryService.saveLocal).not.toHaveBeenCalled();
    expect(WatchHistoryService.getProgress).toHaveBeenCalledWith('video-1', 'fetched-token');
  });

  it('falls back to device storage when the session has no token', async () => {
    (fetchClientAuthToken as jest.Mock).mockResolvedValue(null);
    const { result } = renderHook(() => useWatchProgress('video-1', player, 'user-1'));
    simulatePlayback(player, 10);

    await act(async () => {
      await result.current.saveProgress(true);
    });

    expect(WatchHistoryService.saveProgress).not.toHaveBeenCalled();
    expect(WatchHistoryService.saveLocal).toHaveBeenCalled();
  });

  it('never asks for a token for anonymous viewers', async () => {
    const { result } = renderHook(() => useWatchProgress('video-1', player));
    simulatePlayback(player, 10);

    await act(async () => {
      await result.current.saveProgress(true);
    });

    expect(fetchClientAuthToken).not.toHaveBeenCalled();
    expect(WatchHistoryService.saveLocal).toHaveBeenCalled();
  });
});
