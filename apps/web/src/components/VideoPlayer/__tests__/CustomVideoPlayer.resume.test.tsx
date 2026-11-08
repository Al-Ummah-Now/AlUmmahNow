/**
 * #242: the watch page offers to resume from the position stored before this
 * watch (5%-95% of the video), once per video. Mock setup mirrors
 * CustomVideoPlayer.test.tsx; useWatchProgress is mocked to control the
 * loaded progress.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useWatchProgress } from '@/hooks/useWatchProgress';
import CustomVideoPlayer from '../CustomVideoPlayer';
import type { VideoError } from '@/lib/video/error-handler';
import { createVideoPlayer } from '@/lib/video/videojs-setup';
import { VideoAnalytics } from '@/services/analytics/video-analytics';

// Mock Video.js setup
const mockDispose = jest.fn();
const mockOn = jest.fn();
const mockReady = jest.fn((callback) => callback());
const mockSrc = jest.fn();
const mockPlayer = {
  dispose: mockDispose,
  on: mockOn,
  ready: mockReady,
  src: mockSrc,
  error: jest.fn(() => null),
  // Methods the component calls in its effects (video.js Player API)
  currentSrc: jest.fn(() => ''),
  currentTime: jest.fn(() => 0),
  duration: jest.fn(() => 0),
  load: jest.fn(),
  poster: jest.fn(),
  one: jest.fn(),
  off: jest.fn(),
  readyState: jest.fn(() => 4),
};

jest.mock('@/lib/video/videojs-setup', () => ({
  createVideoPlayer: jest.fn(),
  disposeVideoPlayer: jest.fn(),
}));
// Typed refs to the mocked exports (assigned after the hoisted jest.mock runs).
// Their behaviour is configured in beforeEach — referencing module-scope consts
// inside the hoisted factory throws a TDZ "Cannot access ... before initialization".
const mockCreateVideoPlayer = createVideoPlayer as jest.Mock;

// Mock VideoAnalytics
const mockTrackReady = jest.fn();
const mockTrackPlay = jest.fn();
const mockTrackPause = jest.fn();
const mockTrackComplete = jest.fn();
const mockTrackError = jest.fn();
const mockDestroy = jest.fn();
const mockGetSessionId = jest.fn(() => '12345-abcde');

jest.mock('@/services/analytics/video-analytics', () => ({
  VideoAnalytics: jest.fn(),
}));
const mockVideoAnalytics = VideoAnalytics as jest.Mock;

// Mock error handler
const mockCategorizeError = jest.fn();
const mockHandleWithRetry = jest.fn();
const mockResetRetryCount = jest.fn();
const mockAddErrorReporter = jest.fn();

jest.mock('@/lib/video/error-handler', () => ({
  createVideoErrorHandler: jest.fn(() => ({
    categorizeError: mockCategorizeError,
    handleWithRetry: mockHandleWithRetry,
    resetRetryCount: mockResetRetryCount,
    addErrorReporter: mockAddErrorReporter,
  })),
  VideoErrorType: {
    NETWORK_ERROR: 'NETWORK_ERROR',
    FORMAT_ERROR: 'FORMAT_ERROR',
    DECODE_ERROR: 'DECODE_ERROR',
    HLS_ERROR: 'HLS_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  },
}));

// Mock fallback strategy
const mockGetNextFallback = jest.fn();
const mockReset = jest.fn();
const mockGetCurrentSource = jest.fn();

jest.mock('@/lib/video/fallback-strategy', () => ({
  createVideoFallbackStrategy: jest.fn(() => ({
    getNextFallback: mockGetNextFallback,
    reset: mockReset,
    getCurrentSource: mockGetCurrentSource,
  })),
}));

// Mock ErrorDisplay
jest.mock('../ErrorDisplay', () => ({
  ErrorDisplay: ({ error }: { error: VideoError }) => (
    <div data-testid="error-display">{error.message}</div>
  ),
}));

// Mock Phase 2.5: Volume controls
jest.mock('@/lib/video/volume-control', () => ({
  initializeVolumeControls: jest.fn(() => jest.fn()), // Returns cleanup function
}));

// Mock Phase 2.6: Fullscreen and PiP
jest.mock('@/lib/video/fullscreen-pip', () => ({
  setupFullscreenPiP: jest.fn(),
  lockOrientationLandscape: jest.fn(() => Promise.resolve()),
}));

// Mock Phase 2.3: Keyboard shortcuts
jest.mock('@/lib/video/keyboard-shortcuts', () => ({
  setupKeyboardShortcuts: jest.fn(() => jest.fn()), // Returns cleanup function
}));

jest.mock('@/hooks/useWatchProgress', () => ({ useWatchProgress: jest.fn() }));
const mockUseWatchProgress = useWatchProgress as jest.Mock;

function progress(currentTime: number, completed = false) {
  return { videoId: 'v1', currentTime, duration: 600, completed, timestamp: '2026-11-08T00:00:00Z' };
}

function renderWith(loadedProgress: ReturnType<typeof progress> | null, isLive = false) {
  mockUseWatchProgress.mockReturnValue({ savedProgress: loadedProgress, loadedProgress, saveProgress: jest.fn(), clearProgress: jest.fn() });
  return render(
    <CustomVideoPlayer
      videoId="v1"
      title="A lecture"
      isLive={isLive}
      enableWebSocket={false}
      sources={[{ src: 'https://example.com/video.m3u8', type: 'application/x-mpegURL' }]}
    />
  );
}

describe('CustomVideoPlayer resume prompt (#242)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateVideoPlayer.mockReturnValue(mockPlayer);
    mockVideoAnalytics.mockImplementation(() => ({
      trackReady: mockTrackReady, trackPlay: mockTrackPlay, trackPause: mockTrackPause,
      trackComplete: mockTrackComplete, trackError: mockTrackError, destroy: mockDestroy, getSessionId: mockGetSessionId,
    }));
    mockCategorizeError.mockReturnValue({ type: 'UNKNOWN_ERROR', severity: 'INFO', message: 'x', timestamp: 0, retryable: false, fallbackAvailable: false });
  });

  it('offers the saved position and seeks there on resume', async () => {
    renderWith(progress(125));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('A lecture');
    expect(dialog).toHaveTextContent('2:05');
    fireEvent.click(screen.getByRole('button', { name: /2:05/ }));
    expect(mockPlayer.currentTime).toHaveBeenCalledWith(125);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('starts from the beginning when asked', async () => {
    renderWith(progress(300));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /start over|beginning/i }));
    expect(mockPlayer.currentTime).toHaveBeenCalledWith(0);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not reappear when the current watch saves new progress', async () => {
    const { rerender } = renderWith(progress(300));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    mockUseWatchProgress.mockReturnValue({ savedProgress: progress(310), loadedProgress: progress(300), saveProgress: jest.fn(), clearProgress: jest.fn() });
    rerender(<CustomVideoPlayer videoId="v1" title="A lecture" enableWebSocket={false} sources={[{ src: 'https://example.com/video.m3u8', type: 'application/x-mpegURL' }]} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['near the start', progress(10), false],
    ['near the end', progress(590), false],
    ['completed', progress(300, true), false],
    ['live', progress(300), true],
    ['nothing stored', null, false],
  ])('is not shown when %s', async (_label, loaded, isLive) => {
    renderWith(loaded, isLive);
    await screen.findByText(/ready/i, { selector: '[role="status"]' }).catch(() => undefined);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
