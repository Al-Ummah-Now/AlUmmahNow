/**
 * The page asks for playback (autoplayIntent): tried again after a source change aborted it, never
 * after a pause, and never for a video the page has moved on from.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import { useWatchProgress } from '@/hooks/useWatchProgress';
import CustomVideoPlayer from '../CustomVideoPlayer';
import type { VideoError } from '@/lib/video/error-handler';
import { createVideoPlayer } from '@/lib/video/videojs-setup';
import { VideoAnalytics } from '@/services/analytics/video-analytics';

// A player with real event lists: play() answers what the test queued
const on: Record<string, Array<() => void>> = {};
const once: Record<string, Array<() => void>> = {};
const state = { readyState: 0, paused: true, muted: false };
const plays: Array<{ muted: boolean; reject: (name: string) => Promise<void> }> = [];
const fire = async (event: string) => {
  const due = once[event] ?? [];
  once[event] = [];
  await act(async () => { [...(on[event] ?? []), ...due].forEach((fn) => fn()); });
};
const mockPlayer = {
  dispose: jest.fn(),
  isDisposed: () => false,
  on: (e: string, fn: () => void) => { (on[e] ??= []).push(fn); },
  off: (e: string, fn: () => void) => { on[e] = (on[e] ?? []).filter((f) => f !== fn); },
  one: (e: string, fn: () => void) => { (once[e] ??= []).push(fn); },
  ready: (fn: () => void) => fn(),
  play: () => new Promise<void>((_resolve, reject) => {
    state.paused = false;
    plays.push({
      muted: state.muted,
      reject: async (name) => {
        state.paused = true;
        await act(async () => { reject(Object.assign(new Error(name), { name })); });
      },
    });
  }),
  paused: () => state.paused,
  muted: (v?: boolean) => (v === undefined ? state.muted : (state.muted = v)),
  volume: () => 1,
  src: jest.fn(),
  error: () => null,
  currentSrc: () => 'https://example.com/video.m3u8',
  currentTime: () => 0,
  duration: () => 0,
  load: jest.fn(),
  poster: jest.fn(),
  readyState: () => state.readyState,
  hasStarted: () => false,
  videoWidth: () => 16,
  videoHeight: () => 9,
  el: () => null,
  tech: () => undefined,
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
  markAutoMuted: jest.fn(),
  applySavedVolume: jest.fn(),
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
// The features answer (every feature off; useFeatures would fetch it)
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ ready: true, features: {} }) }));
const mockUseWatchProgress = useWatchProgress as jest.Mock;


const element = (n = 1) => (
  <CustomVideoPlayer
    videoId={`v${n}`}
    title="A lecture"
    enableWebSocket={false}
    autoplayIntent
    enableAnalytics={false}
    sources={[{ src: n === 1 ? 'https://example.com/video.m3u8' : `https://example.com/video${n}.m3u8`, type: 'application/x-mpegURL' }]}
  />
);

describe('CustomVideoPlayer autoplay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const list of [on, once]) for (const key of Object.keys(list)) delete list[key];
    Object.assign(state, { readyState: 0, paused: true, muted: false });
    plays.length = 0;
    mockUseWatchProgress.mockReturnValue({ savedProgress: null, loadedProgress: null, saveProgress: jest.fn(), clearProgress: jest.fn() });
    mockCreateVideoPlayer.mockReturnValue(mockPlayer);
    mockVideoAnalytics.mockImplementation(() => ({
      trackReady: mockTrackReady, trackPlay: mockTrackPlay, trackPause: mockTrackPause,
      trackComplete: mockTrackComplete, trackError: mockTrackError, destroy: mockDestroy, getSessionId: mockGetSessionId,
    }));
  });

  const pause = async () => {
    state.paused = true;
    await fire('pause');
  };

  it('plays at loadedmetadata, and once more after a source change aborted it', async () => {
    render(element());
    expect(plays).toHaveLength(0);
    await fire('loadedmetadata');
    expect(plays).toHaveLength(1);
    await plays[0].reject('AbortError');
    await fire('loadedmetadata');
    expect(plays).toHaveLength(2);
  });

  it('a pause while it waits for the metadata ends it', async () => {
    render(element());
    await pause();
    await fire('loadedmetadata');
    expect(plays).toHaveLength(0);
  });

  it('a pause during the play ends it: no retry', async () => {
    render(element());
    await fire('loadedmetadata');
    await pause();
    await plays[0].reject('AbortError');
    await fire('loadedmetadata');
    await fire('canplay');
    expect(plays).toHaveLength(1);
  });

  it('sound refused: plays muted, unless it was paused meanwhile', async () => {
    render(element());
    await fire('loadedmetadata');
    await plays[0].reject('NotAllowedError');
    expect(plays.map((p) => p.muted)).toEqual([false, true]);
  });

  it('sound refused after a pause: not muted, not played', async () => {
    render(element());
    await fire('loadedmetadata');
    await pause();
    await plays[0].reject('NotAllowedError');
    expect(plays).toHaveLength(1);
    expect(state.muted).toBe(false);
  });

  it("the next video's start replaces the last one's", async () => {
    const { rerender } = render(element());
    await act(async () => rerender(element(2)));
    expect(mockPlayer.src).toHaveBeenCalledTimes(1);
    // Both waited for loadedmetadata; only the new one plays
    await fire('loadedmetadata');
    expect(plays).toHaveLength(1);
  });

  it("the last video's aborted play is not retried for the next video", async () => {
    const { rerender } = render(element());
    await fire('loadedmetadata');
    await act(async () => rerender(element(2)));
    await plays[0].reject('AbortError');
    await fire('loadedmetadata');
    expect(plays).toHaveLength(2);
  });
});
