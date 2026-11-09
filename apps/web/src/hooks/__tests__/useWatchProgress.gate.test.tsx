/**
 * #242: a resume point is recorded only after real playback. Opening the
 * page, a ?t= seek, scrubbing without playing, pausing or leaving saves
 * nothing; a signed-in viewer never resumes from device storage (it holds no
 * user id, so it may be a guest watch or another account's).
 */
import { renderHook, act } from '@testing-library/react';
import { useWatchProgress } from '../useWatchProgress';
import { WatchHistoryService } from '@/services/api/watch-history';
import { simulatePlayback } from '@/test/watch-playback';
import type { ExtendedPlayer } from '@/lib/video/videojs';

jest.mock('@/services/api/watch-history', () => ({
  WatchHistoryService: {
    saveProgress: jest.fn(async () => ({ success: true })),
    getProgress: jest.fn(async () => null),
    saveLocal: jest.fn(async () => undefined),
    getLocal: jest.fn(async () => null),
    clearProgress: jest.fn(),
    shouldSaveProgress: jest.fn(() => true),
    isCompleted: jest.fn((current: number, duration: number) => current / duration >= 0.9),
  },
}));

jest.mock('@/lib/auth/client-token', () => ({
  fetchClientAuthToken: jest.fn(async () => 'token'),
}));

function mockPlayer(state = { time: 0, paused: true }) {
  const player = {
    currentTime: jest.fn(() => state.time),
    duration: jest.fn(() => 600),
    readyState: jest.fn(() => 4),
    paused: jest.fn(() => state.paused),
    seeking: jest.fn(() => false),
    on: jest.fn(),
    off: jest.fn(),
    one: jest.fn(),
  };
  const fire = (event: string) =>
    act(() => player.on.mock.calls.filter(([e]) => e === event).forEach(([, fn]) => fn()));
  return { player, state, fire };
}

const saves = () =>
  (WatchHistoryService.saveProgress as jest.Mock).mock.calls.length +
  (WatchHistoryService.saveLocal as jest.Mock).mock.calls.length;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useWatchProgress - real playback gate (#242)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves nothing when the page is opened, sought and left without playing', async () => {
    jest.useFakeTimers();
    try {
      const { player, state, fire } = mockPlayer();
      const { unmount } = renderHook(() =>
        useWatchProgress('v1', player as unknown as ExtendedPlayer, 'user-1')
      );
      await flush();
      // Interval ticks while the page just sits there
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      // A ?t= / chapter / scrub seek while paused
      state.time = 222;
      fire('timeupdate');
      fire('seeked');
      fire('pause');
      unmount();
      await flush();
      expect(saves()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not count a seek jump as watched time', async () => {
    const { player, state, fire } = mockPlayer({ time: 0, paused: false });
    renderHook(() => useWatchProgress('v1', player as unknown as ExtendedPlayer, 'user-1'));
    await flush();
    fire('timeupdate');
    state.time = 300; // jumped while "playing"
    fire('timeupdate');
    fire('seeked');
    await flush();
    expect(saves()).toBe(0);
  });

  it('saves once the viewer has really played 10 s', async () => {
    const { player, state, fire } = mockPlayer();
    renderHook(() => useWatchProgress('v1', player as unknown as ExtendedPlayer, 'user-1'));
    await flush();
    simulatePlayback(player, 9.5, 100);
    state.time = 109.5;
    fire('pause');
    await flush();
    expect(saves()).toBe(0);

    simulatePlayback(player, 1, 109.5);
    state.time = 110.5;
    fire('pause');
    await flush();
    expect(WatchHistoryService.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: 'v1', currentTime: 110.5 }),
      'token'
    );
  });

  it('loads only the account progress for a signed-in viewer', async () => {
    (WatchHistoryService.getLocal as jest.Mock).mockResolvedValue({
      videoId: 'v1', currentTime: 222, duration: 600, completed: false, timestamp: '2026-11-08T00:00:00Z',
    });
    const { player } = mockPlayer();
    const { result } = renderHook(() => useWatchProgress('v1', player as unknown as ExtendedPlayer, 'user-1'));
    await flush();
    expect(WatchHistoryService.getProgress).toHaveBeenCalledWith('v1', 'token');
    expect(WatchHistoryService.getLocal).not.toHaveBeenCalled();
    expect(result.current.loadedProgress).toBeNull();
  });

  it('loads device progress for a signed-out viewer', async () => {
    const stored = { videoId: 'v1', currentTime: 222, duration: 600, completed: false, timestamp: '2026-11-08T00:00:00Z' };
    (WatchHistoryService.getLocal as jest.Mock).mockResolvedValue(stored);
    const { player } = mockPlayer();
    const { result } = renderHook(() => useWatchProgress('v1', player as unknown as ExtendedPlayer));
    await flush();
    expect(WatchHistoryService.getProgress).not.toHaveBeenCalled();
    expect(result.current.loadedProgress).toEqual(stored);
  });
});
