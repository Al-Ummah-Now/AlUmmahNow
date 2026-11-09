/**
 * #242: the player opens already at the position stored before this watch,
 * with a persistent "Start from beginning" pill and no prompt. Mock setup
 * mirrors CustomVideoPlayer.test.tsx; useWatchProgress is mocked to control
 * the loaded progress.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
  currentTime: jest.fn((..._args: number[]) => 0),
  duration: jest.fn(() => 0),
  load: jest.fn(),
  poster: jest.fn(),
  one: jest.fn(),
  off: jest.fn(),
  readyState: jest.fn(() => 4),
  hasStarted: jest.fn(() => false),
  el: jest.fn(() => null),
};

jest.mock('@/components/ThemeDemo/PlayerChrome', () => ({ PlayerChrome: () => null }));
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

function progress(currentTime: number, completed = false, duration = 600) {
  return { videoId: 'v1', currentTime, duration, completed, timestamp: '2026-11-08T00:00:00Z' };
}

type Props = Partial<React.ComponentProps<typeof CustomVideoPlayer>>;

function element(props: Props = {}) {
  return (
    <CustomVideoPlayer
      videoId="v1"
      title="A lecture"
      enableWebSocket={false}
      sources={[{ src: 'https://example.com/video.m3u8', type: 'application/x-mpegURL' }]}
      {...props}
    />
  );
}

function renderWith(loadedProgress: ReturnType<typeof progress> | null, props: Props = {}) {
  mockUseWatchProgress.mockReturnValue({ savedProgress: loadedProgress, loadedProgress, saveProgress: jest.fn(), clearProgress: jest.fn() });
  return render(element(props));
}

/** Player position as the component sees it: the last value it set. */
let position = 0;
function emitTimeUpdate(time: number) {
  position = time;
  const handlers = mockOn.mock.calls.filter(([event]) => event === 'timeupdate').map(([, fn]) => fn);
  act(() => handlers.forEach((fn) => fn()));
}

const startOver = () => screen.queryByTestId('player-start-over');

describe('CustomVideoPlayer resume (#242)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    position = 0;
    mockPlayer.currentTime.mockImplementation((...args: number[]) => {
      if (args.length) position = args[0];
      return position;
    });
    mockPlayer.hasStarted.mockReturnValue(false);
    mockPlayer.readyState.mockReturnValue(4);
    mockCreateVideoPlayer.mockReturnValue(mockPlayer);
    mockVideoAnalytics.mockImplementation(() => ({
      trackReady: mockTrackReady, trackPlay: mockTrackPlay, trackPause: mockTrackPause,
      trackComplete: mockTrackComplete, trackError: mockTrackError, destroy: mockDestroy, getSessionId: mockGetSessionId,
      trackPlayback: jest.fn(), trackProgress: jest.fn(), trackQuartile: jest.fn(), trackSeek: jest.fn(),
    }));
    mockCategorizeError.mockReturnValue({ type: 'UNKNOWN_ERROR', severity: 'INFO', message: 'x', timestamp: 0, retryable: false, fallbackAvailable: false });
  });

  it('opens at the saved position with a Start from beginning pill and no dialog', async () => {
    renderWith(progress(222));
    const pill = await screen.findByTestId('player-start-over');
    expect(mockPlayer.currentTime).toHaveBeenCalledWith(222);
    expect(pill).toHaveAccessibleName('Start from beginning');
    expect(pill.tagName).toBe('BUTTON');
    expect(pill).toHaveClass('vjs-start-over');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('player-resume-announcement')).toHaveTextContent('Resuming at 3:42');
  });

  it('does not hide on its own', async () => {
    jest.useFakeTimers();
    try {
      renderWith(progress(222));
      await act(async () => undefined);
      expect(startOver()).toBeInTheDocument();
      act(() => jest.advanceTimersByTime(60_000));
      expect(startOver()).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('goes back to 0 and removes the pill when clicked', async () => {
    renderWith(progress(222));
    fireEvent.click(await screen.findByTestId('player-start-over'));
    expect(mockPlayer.currentTime).toHaveBeenLastCalledWith(0);
    expect(startOver()).not.toBeInTheDocument();
  });

  it('removes the pill once playback is well past the resume point', async () => {
    renderWith(progress(222));
    await screen.findByTestId('player-start-over');
    emitTimeUpdate(240);
    expect(startOver()).toBeInTheDocument();
    emitTimeUpdate(252);
    expect(startOver()).not.toBeInTheDocument();
  });

  it('announces in Arabic for the Arabic player', async () => {
    renderWith(progress(222), { lang: 'ar' });
    expect(await screen.findByTestId('player-start-over')).toHaveAccessibleName('البدء من البداية');
    expect(screen.getByTestId('player-resume-announcement')).toHaveTextContent('الاستئناف من 3:42');
  });

  it('waits for metadata before seeking', async () => {
    mockPlayer.readyState.mockReturnValue(0);
    renderWith(progress(222));
    await act(async () => undefined);
    expect(mockPlayer.currentTime).not.toHaveBeenCalledWith(222);
    // The resume seek registers after the player's own metadata handlers
    const onMeta = mockPlayer.one.mock.calls.filter(([event]) => event === 'loadedmetadata').pop()?.[1];
    expect(onMeta).toBeDefined();
    act(() => onMeta());
    expect(mockPlayer.currentTime).toHaveBeenCalledWith(222);
    expect(startOver()).toBeInTheDocument();
  });

  it('lets a ?t= start position win over the saved one', async () => {
    renderWith(progress(222), { startTime: 30 });
    await act(async () => undefined);
    expect(mockPlayer.currentTime).not.toHaveBeenCalledWith(222);
    expect(startOver()).not.toBeInTheDocument();
  });

  it('does not move a viewer who already pressed play', async () => {
    mockPlayer.hasStarted.mockReturnValue(true);
    renderWith(progress(222));
    await act(async () => undefined);
    expect(mockPlayer.currentTime).not.toHaveBeenCalledWith(222);
    expect(startOver()).not.toBeInTheDocument();
  });

  it('is decided once: saves of the current watch never move the player', async () => {
    const { rerender } = renderWith(progress(222));
    fireEvent.click(await screen.findByTestId('player-start-over'));
    mockUseWatchProgress.mockReturnValue({ savedProgress: progress(310), loadedProgress: progress(222), saveProgress: jest.fn(), clearProgress: jest.fn() });
    rerender(element());
    expect(mockPlayer.currentTime).toHaveBeenLastCalledWith(0);
    expect(startOver()).not.toBeInTheDocument();
  });

  it.each([
    ['nothing stored (never played)', null, {}],
    ['near the start', progress(5), {}],
    ['near the end', progress(595), {}],
    ['completed', progress(300, true), {}],
    ['a short', progress(30, false, 45), {}],
    ['live', progress(300), { isLive: true }],
  ])('starts from the beginning when %s', async (_label, loaded, props) => {
    renderWith(loaded, props as Props);
    await act(async () => undefined);
    expect(mockPlayer.currentTime).not.toHaveBeenCalledWith(expect.any(Number));
    expect(startOver()).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
