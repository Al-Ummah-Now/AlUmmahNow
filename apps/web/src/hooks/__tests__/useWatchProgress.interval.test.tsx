/**
 * Regression: the 10s periodic save must run for a signed-in watch that is
 * never paused.
 *
 * CustomVideoPlayer hands the player to the hook on the re-render that follows
 * video.js 'ready'. At that point the media usually has no metadata yet
 * (readyState 0), and the hook waited with player.one('ready') for an event
 * that had already fired, so the interval never started. Pause/seek/ended
 * still saved; a watch closed without pausing never reached the history.
 */

import { renderHook, act } from '@testing-library/react';
import { useWatchProgress } from '../useWatchProgress';
import { WatchHistoryService } from '@/services/api/watch-history';
import { fetchClientAuthToken } from '@/lib/auth/client-token';
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
  fetchClientAuthToken: jest.fn(async () => 'fetched-token'),
}));

/** A player whose 'ready' already fired (one('ready') never calls back) and whose media is still loading. */
function loadingPlayer() {
  const state = { readyState: 0, currentTime: 0 };
  const player = {
    currentTime: jest.fn(() => state.currentTime),
    duration: jest.fn(() => 600),
    readyState: jest.fn(() => state.readyState),
    on: jest.fn(),
    off: jest.fn(),
    one: jest.fn(),
    ready: jest.fn((fn: () => void) => fn()),
  } as unknown as ExtendedPlayer;
  return { player, state };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useWatchProgress - periodic save', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('saves every interval while playing, even when attached before the media had metadata', async () => {
    const { player, state } = loadingPlayer();
    renderHook(() => useWatchProgress('video-1', player, 'user-1'));
    await flush();

    // Metadata arrives and playback runs past one interval, with no pause/seek
    state.readyState = 4;
    state.currentTime = 11;
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    await flush();

    expect(fetchClientAuthToken).toHaveBeenCalled();
    expect(WatchHistoryService.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: 'video-1', currentTime: 11, duration: 600 }),
      'fetched-token'
    );

    state.currentTime = 21;
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    await flush();
    expect(WatchHistoryService.saveProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentTime: 21 }),
      'fetched-token'
    );
  });

  it('does not save before the media is ready', async () => {
    const { player } = loadingPlayer();
    renderHook(() => useWatchProgress('video-1', player, 'user-1'));
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    await flush();
    expect(WatchHistoryService.saveProgress).not.toHaveBeenCalled();
    expect(WatchHistoryService.saveLocal).not.toHaveBeenCalled();
  });
});
