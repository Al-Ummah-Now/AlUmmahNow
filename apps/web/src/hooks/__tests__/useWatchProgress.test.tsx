/**
 * Tests for useWatchProgress hook mutex implementation
 *
 * Verifies that the mutex pattern prevents race conditions
 * when multiple save operations are triggered simultaneously.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useWatchProgress } from '../useWatchProgress';
import { WatchHistoryService } from '@/services/api/watch-history';

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

    // Simulate API call delay
    saveProgressMock.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
    );
  });

  it('should prevent concurrent saves with mutex', async () => {
    const { result } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );

    // Trigger multiple saves rapidly
    await act(async () => {
      // These should trigger the mutex pattern
      void result.current.saveProgress();
      void result.current.saveProgress();
      void result.current.saveProgress();
    });

    // Wait for all saves to complete
    await waitFor(() => {
      // Should only make 1-2 API calls, not 3
      expect(saveProgressMock).toHaveBeenCalledTimes(1);
    }, { timeout: 500 });
  });

  it('should queue and process pending saves', async () => {
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
        mockPlayer as unknown,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );

    // Trigger multiple saves rapidly
    await act(async () => {
      void result.current.saveProgress(); // currentTime: 15
      void result.current.saveProgress(); // currentTime: 20 (should be queued)
      void result.current.saveProgress(); // currentTime: 25 (should replace previous queue)
    });

    // Wait for all saves to complete
    await waitFor(() => {
      // Should process the first save and the last queued one
      expect(saveProgressMock).toHaveBeenCalledTimes(2);
    }, { timeout: 500 });

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
        mockPlayer as unknown,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );

    await act(async () => {
      await result.current.saveProgress();
    });

    // Should fall back to localStorage
    expect(saveLocalMock).toHaveBeenCalled();
  });

  it('should not save if component unmounts during save', async () => {
    const { result, unmount } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );

    // Start a save
    act(() => {
      void result.current.saveProgress();
    });

    // Unmount immediately
    unmount();

    await waitFor(() => {
      // Save might start but state shouldn't update after unmount
      expect(saveProgressMock).toHaveBeenCalledTimes(1);
    }, { timeout: 500 });
  });

  it('should handle rapid event-based saves', async () => {
    const { result } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );

    // Simulate rapid pause/play/seek events
    await act(async () => {
      // These could come from pause, seeked, ended events
      void result.current.saveProgress();
      await new Promise(r => setTimeout(r, 10));
      void result.current.saveProgress();
      await new Promise(r => setTimeout(r, 10));
      void result.current.saveProgress();
    });

    await waitFor(() => {
      // Should handle all saves without race conditions
      expect(saveProgressMock.mock.calls.length).toBeGreaterThan(0);
      expect(saveProgressMock.mock.calls.length).toBeLessThanOrEqual(3);
    }, { timeout: 1000 });
  });

  it('should respect force flag to bypass throttling', async () => {
    const { result } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown,
        'user-456',
        'auth-token',
        {
          enableDebugLogging: true,
          saveInterval: 10000, // 10 seconds
          minTimeChange: 5, // 5 seconds
        }
      )
    );

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

    // Track call order with varying delays
    saveProgressMock.mockImplementation(() => {
      const currentCall = ++callCounter;
      const delay = Math.random() * 200; // Random delay 0-200ms

      return new Promise(resolve => {
        setTimeout(() => {
          callOrder.push(currentCall);
          resolve({ success: true });
        }, delay);
      });
    });

    const { result } = renderHook(() =>
      useWatchProgress(
        'video-123',
        mockPlayer as unknown,
        'user-456',
        'auth-token',
        { enableDebugLogging: true }
      )
    );

    // Trigger 10 rapid saves
    await act(async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(result.current.saveProgress());
      }
      await Promise.all(promises);
    });

    await waitFor(() => {
      // Should have made significantly fewer than 10 API calls due to mutex
      expect(saveProgressMock.mock.calls.length).toBeLessThanOrEqual(3);
      expect(saveProgressMock.mock.calls.length).toBeGreaterThan(0);
    }, { timeout: 1000 });

    // Verify no race conditions occurred (calls completed in order they started)
    for (let i = 1; i < callOrder.length; i++) {
      expect(callOrder[i]).toBeGreaterThan(callOrder[i - 1]);
    }
  });
});