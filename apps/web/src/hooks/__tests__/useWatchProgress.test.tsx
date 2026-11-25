/**
 * Tests for useWatchProgress hook mutex implementation
 *
 * Verifies that the mutex pattern prevents race conditions
 * when multiple save operations are triggered simultaneously.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useWatchProgress } from '../useWatchProgress';
import { WatchHistoryService } from '@/services/api/watch-history';
import type { ExtendedPlayer } from '@/lib/video/videojs';
import { simulatePlayback } from '@/test/watch-playback';

// Mock the service
jest.mock('@/services/api/watch-history', () => ({
  WatchHistoryService: {
    saveProgress: jest.fn(),
    getProgress: jest.fn(),
    saveLocal: jest.fn(),
    getLocal: jest.fn(),
    clearProgress: jest.fn(),
    shouldSaveProgress: jest.fn(() => true),
    isCompleted: jest.fn((current, duration) => current / duration >= 0.9),
  },
}));

// Mock player
const createMockPlayer = (currentTime = 0, duration = 100) => ({
  currentTime: jest.fn(() => currentTime),
  duration: jest.fn(() => duration),
  readyState: jest.fn(() => 4),
  on: jest.fn(),
  off: jest.fn(),
  one: jest.fn(),
});

describe('useWatchProgress - Mutex Pattern', () => {
  let mockPlayer: ReturnType<typeof createMockPlayer>;
  let saveProgressMock: jest.Mock;
  let saveLocalMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayer = createMockPlayer(10, 100);

    saveProgressMock = WatchHistoryService.saveProgress as jest.Mock;
    saveLocalMock = WatchHistoryService.saveLocal as jest.Mock;

    saveProgressMock.mockImplementation(() => Promise.resolve({ success: true }));
  });

  /**
   * Makes every API save wait until the test lets it finish, so "a save is in flight" is a state the
   * test sets and ends, not a 100 ms the machine may stretch (a loaded runner failed the 500 ms
   * waits that used to stand for it).
   */
  const holdSaves = () => {
    const finish: Array<() => void> = [];
    saveProgressMock.mockImplementation(() => new Promise((resolve) => { finish.push(() => resolve({ success: true })); }));
    /** Lets the oldest save finish, and the hook go on to the queued one, if any */
    const finishOldest = async () => {
      await act(async () => { finish.shift()?.(); });
      await act(async () => {});
    };
    return { finishOldest, inFlight: () => finish.length };
  };

  it('should prevent concurrent saves with mutex', async () => {
    const { finishOldest } = holdSaves();
    const { result } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown as ExtendedPlayer | null,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );
    // Past the "played long enough" gate (#242)
    simulatePlayback(mockPlayer, 10);

    // Trigger multiple saves rapidly
    await act(async () => {
      // These should trigger the mutex pattern
      void result.current.saveProgress();
      void result.current.saveProgress();
      void result.current.saveProgress();
    });

    // One save is in flight; the other two did not start a second one
    expect(saveProgressMock).toHaveBeenCalledTimes(1);

    // When it finishes the hook saves what was queued meanwhile, once (2 API calls, not 3)
    await finishOldest();
    expect(saveProgressMock).toHaveBeenCalledTimes(2);
    await finishOldest();
    expect(saveProgressMock).toHaveBeenCalledTimes(2);
  });

  it('should queue and process pending saves', async () => {
    const { finishOldest } = holdSaves();
    let currentTime = 10;
    mockPlayer = createMockPlayer(currentTime, 100);

    // Make currentTime change for each call
    mockPlayer.currentTime = jest.fn(() => {
      currentTime += 5;
      return currentTime;
    });

    const { result } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown as ExtendedPlayer | null,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );
    // Past the "played long enough" gate (#242)
    simulatePlayback(mockPlayer, 10);

    // Trigger multiple saves rapidly
    await act(async () => {
      void result.current.saveProgress(); // currentTime: 15
      void result.current.saveProgress(); // currentTime: 20 (should be queued)
      void result.current.saveProgress(); // currentTime: 25 (should replace previous queue)
    });

    // The first save is in flight; the other two are queued, the later replacing the earlier
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
    await finishOldest();
    // Should process the first save and the last queued one
    expect(saveProgressMock).toHaveBeenCalledTimes(2);
    await finishOldest();

    // Verify the last saved position is the most recent
    const lastCall = saveProgressMock.mock.calls[saveProgressMock.mock.calls.length - 1];
    expect(lastCall[0].currentTime).toBeGreaterThanOrEqual(20);
  });

  it('should handle API failures gracefully', async () => {
    saveProgressMock.mockImplementation(() =>
      Promise.resolve({ success: false, error: 'Network error' })
    );

    const { result } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown as ExtendedPlayer | null,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );
    // Past the "played long enough" gate (#242)
    simulatePlayback(mockPlayer, 10);

    await act(async () => {
      await result.current.saveProgress();
    });

    // Should fall back to localStorage
    expect(saveLocalMock).toHaveBeenCalled();
  });

  it('should not save if component unmounts during save', async () => {
    const { finishOldest } = holdSaves();
    const { result, unmount } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown as ExtendedPlayer | null,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );
    // Past the "played long enough" gate (#242)
    simulatePlayback(mockPlayer, 10);

    // Start a save
    act(() => {
      void result.current.saveProgress();
    });

    // Unmount immediately
    unmount();

    // Save might start but state shouldn't update after unmount
    await waitFor(() => expect(saveProgressMock).toHaveBeenCalledTimes(1));
    await finishOldest();
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
  });

  it('should handle rapid event-based saves', async () => {
    const { finishOldest, inFlight } = holdSaves();
    const { result } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown as ExtendedPlayer | null,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );
    // Past the "played long enough" gate (#242)
    simulatePlayback(mockPlayer, 10);

    // Simulate rapid pause/play/seek events
    await act(async () => {
      // These could come from pause, seeked, ended events
      void result.current.saveProgress();
      await Promise.resolve();
      void result.current.saveProgress();
      await Promise.resolve();
      void result.current.saveProgress();
    });

    // Should handle all saves without race conditions: the first in flight, the rest queued as one
    for (let i = 0; i < 5 && inFlight() > 0; i++) await finishOldest();
    expect(saveProgressMock.mock.calls.length).toBeGreaterThan(0);
    expect(saveProgressMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('should respect force flag to bypass throttling', async () => {
    const { result } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown as ExtendedPlayer | null,
        'user-456',
        'auth-token',
        {
          enableDebugLogging: true,
          saveInterval: 10000, // 10 seconds
          minTimeChange: 5, // 5 seconds
        }
      )
    );
    // Past the "played long enough" gate (#242)
    simulatePlayback(mockPlayer, 10);

    await act(async () => {
      // First save (force=true by default)
      await result.current.saveProgress(true);
    });

    // Without force, this should be throttled
    mockPlayer.currentTime = jest.fn(() => 11); // Only 1 second change

    await act(async () => {
      // This should be throttled (not forced, small time change)
      await result.current.saveProgress(false);
    });

    // Only the first save should have gone through
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
  });
});

describe('useWatchProgress - Race Condition Scenarios', () => {
  let mockPlayer: ReturnType<typeof createMockPlayer>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayer = createMockPlayer(10, 100);
  });

  it('should handle 10 rapid concurrent saves without race conditions', async () => {
    const saveProgressMock = WatchHistoryService.saveProgress as jest.Mock;
    const callOrder: number[] = [];
    let callCounter = 0;
    const finish: Array<() => void> = [];

    // Each save is finished by the test. What the mutex promises is counted here: how many saves were
    // in flight at once (the test finishing them in the order they started cannot hide an overlap)
    let inFlight = 0;
    let mostInFlight = 0;
    saveProgressMock.mockImplementation(() => {
      const currentCall = ++callCounter;
      mostInFlight = Math.max(mostInFlight, ++inFlight);
      return new Promise(resolve => {
        finish.push(() => {
          inFlight--;
          callOrder.push(currentCall);
          resolve({ success: true });
        });
      });
    });

    const { result } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown as ExtendedPlayer | null,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );
    // Past the "played long enough" gate (#242)
    simulatePlayback(mockPlayer, 10);

    // Trigger 10 rapid saves
    const all: Array<Promise<void>> = [];
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        all.push(result.current.saveProgress());
      }
    });
    for (let i = 0; i < 10 && finish.length > 0; i++) {
      await act(async () => { finish.shift()?.(); });
      await act(async () => {});
    }
    await act(async () => { await Promise.all(all); });

    // The mutex: never two saves in flight, and significantly fewer than 10 API calls
    expect(mostInFlight).toBe(1);
    expect(saveProgressMock.mock.calls.length).toBeLessThanOrEqual(3);
    expect(saveProgressMock.mock.calls.length).toBeGreaterThan(0);

    // Verify no race conditions occurred (calls completed in order they started)
    for (let i = 1; i < callOrder.length; i++) {
      expect(callOrder[i]).toBeGreaterThan(callOrder[i - 1]);
    }
  });
});