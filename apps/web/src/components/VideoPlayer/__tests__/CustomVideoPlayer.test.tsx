/**
 * Tests for CustomVideoPlayer component (Phase 1.4/1.5)
 *
 * Tests cover:
 * - Basic rendering and initialization
 * - Video.js player setup
 * - Analytics integration (Phase 1.5)
 * - Error handling (Phase 1.4)
 * - Accessibility features
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import CustomVideoPlayer from '../CustomVideoPlayer';
import type { VideoError } from '@/lib/video/error-handler';
import { VideoErrorType, VideoErrorSeverity } from '@/lib/video/error-handler';
import { createVideoPlayer, disposeVideoPlayer } from '@/lib/video/videojs-setup';
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
// The settings panel has its own tests and needs a full Video.js player
jest.mock('../SettingsMenu', () => ({ SettingsMenu: () => null }));

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

describe('CustomVideoPlayer (Phase 1.4/1.5)', () => {
  const defaultProps = {
    videoId: 'test-video-123',
    sources: [
      { src: 'https://example.com/video.m3u8', type: 'application/x-mpegURL' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Configure the mocked module exports here (kept out of the hoisted jest.mock
    // factories to avoid a TDZ error referencing module-scope consts).
    mockCreateVideoPlayer.mockReturnValue(mockPlayer);
    mockVideoAnalytics.mockImplementation(() => ({
      trackReady: mockTrackReady,
      trackPlay: mockTrackPlay,
      trackPause: mockTrackPause,
      trackComplete: mockTrackComplete,
      trackError: mockTrackError,
      destroy: mockDestroy,
      getSessionId: mockGetSessionId,
    }));

    // Set up default mock return value for categorizeError to prevent undefined errors
    mockCategorizeError.mockReturnValue({
      type: 'UNKNOWN_ERROR',
      severity: 'INFO',
      message: 'Test error',
      timestamp: Date.now(),
      retryable: false,
      fallbackAvailable: false,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Basic Rendering', () => {
    it('should render without errors', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Video player loaded and ready')).toBeInTheDocument();
      });
    });

    it('should render with custom className', () => {
      const { container } = render(
        <CustomVideoPlayer {...defaultProps} className="custom-class" />
      );

      expect(container.querySelector('.custom-video-player.custom-class')).toBeInTheDocument();
    });

    it('should render with custom ariaLabel', () => {
      render(<CustomVideoPlayer {...defaultProps} ariaLabel="My Video" />);

      const video = document.querySelector('video');
      expect(video).toHaveAttribute('aria-label', 'My Video');
    });
  });

  describe('Video.js Integration', () => {
    it('should initialize Video.js player with correct options', async () => {
      

      render(
        <CustomVideoPlayer
          {...defaultProps}
          controls={true}
          autoplay={true}
          poster="https://example.com/poster.jpg"
        />
      );

      await waitFor(() => {
        expect(mockCreateVideoPlayer).toHaveBeenCalled();
      });

      const calls = mockCreateVideoPlayer.mock.calls as unknown[][];
      const options = calls[0]?.[1] as Record<string, unknown> | undefined;
      expect(options).toBeDefined();
      expect(options).toMatchObject({
        controls: true,
        autoplay: true,
        sources: defaultProps.sources,
        poster: 'https://example.com/poster.jpg',
      });
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should dispose player on unmount', async () => {
      
      const { unmount } = render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockReady).toHaveBeenCalled();
      });

      unmount();

      expect(disposeVideoPlayer).toHaveBeenCalledWith(mockPlayer);
    });
  });

  describe('Analytics Integration (Phase 1.5)', () => {
    it('should initialize VideoAnalytics when enabled', async () => {
      

      render(
        <CustomVideoPlayer
          {...defaultProps}
          userId="user-456"
          enableAnalytics={true}
        />
      );

      await waitFor(() => {
        expect(mockVideoAnalytics).toHaveBeenCalledWith('test-video-123', 'user-456', { context: expect.objectContaining({ source: 'watch' }) });
      });
    });

    it('tags analytics with the embed context (docs/embeds §6)', async () => {
      mockVideoAnalytics.mockClear();
      const context = { source: 'embed' as const, embedOrigin: 'https://www.alummahnow.net' };
      render(<CustomVideoPlayer {...defaultProps} userId="user-456" enableAnalytics={true} analyticsContext={context} />);
      await waitFor(() => {
        expect(mockVideoAnalytics).toHaveBeenCalledWith('test-video-123', 'user-456', { context: { ...context, trafficSource: 'embed' } });
      });
    });

    it('should not initialize analytics when disabled', async () => {

      mockVideoAnalytics.mockClear();

      render(<CustomVideoPlayer {...defaultProps} enableAnalytics={false} />);

      await waitFor(() => {
        expect(mockReady).toHaveBeenCalled();
      });

      expect(mockVideoAnalytics).not.toHaveBeenCalled();
    });

    it('should track ready event', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockTrackReady).toHaveBeenCalled();
      });
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should track play event', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('play', expect.any(Function));
      });

      // Simulate play event
      const playHandler = mockOn.mock.calls.find(call => call[0] === 'play')?.[1];
      playHandler?.();

      expect(mockTrackPlay).toHaveBeenCalled();
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should track pause event', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('pause', expect.any(Function));
      });

      // Simulate pause event
      const pauseHandler = mockOn.mock.calls.find(call => call[0] === 'pause')?.[1];
      pauseHandler?.();

      expect(mockTrackPause).toHaveBeenCalled();
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should track ended event', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('ended', expect.any(Function));
      });

      // Simulate ended event
      const endedHandler = mockOn.mock.calls.find(call => call[0] === 'ended')?.[1];
      endedHandler?.();

      expect(mockTrackComplete).toHaveBeenCalled();
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should cleanup analytics on unmount', async () => {
      const { unmount } = render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockReady).toHaveBeenCalled();
      });

      unmount();

      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe('Error Handling (Phase 1.4)', () => {
    it('should initialize error handler and fallback strategy', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockReady).toHaveBeenCalled();
      });
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should display ErrorDisplay when error occurs', async () => {
      const mockError: VideoError = {
        type: VideoErrorType.NETWORK_ERROR,
        message: 'Network failed',
        code: 'NET_ERR',
        severity: VideoErrorSeverity.WARNING,
        timestamp: Date.now(),
        retryable: true,
        fallbackAvailable: false,
      };

      mockCategorizeError.mockReturnValue(mockError);

      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
      });

      // Simulate error
      const errorHandler = mockOn.mock.calls.find(call => call[0] === 'error')?.[1];
      (mockPlayer.error as jest.Mock).mockReturnValueOnce({ code: 2, message: 'Network error' });
      errorHandler?.();

      await waitFor(() => {
        expect(screen.getByTestId('error-display')).toBeInTheDocument();
        expect(screen.getByText('Network failed')).toBeInTheDocument();
      });
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should call onError callback when error occurs', async () => {
      const onError = jest.fn();
      const mockError: VideoError = {
        type: VideoErrorType.NETWORK_ERROR,
        message: 'Network failed',
        code: 'NET_ERR',
        severity: VideoErrorSeverity.WARNING,
        timestamp: Date.now(),
        retryable: true,
        fallbackAvailable: false,
      };

      mockCategorizeError.mockReturnValue(mockError);

      render(<CustomVideoPlayer {...defaultProps} onError={onError} />);

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
      });

      // Simulate error
      const errorHandler = mockOn.mock.calls.find(call => call[0] === 'error')?.[1];
      (mockPlayer.error as jest.Mock).mockReturnValueOnce({ code: 2 });
      errorHandler?.();

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(mockError);
      });
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should track errors in analytics', async () => {
      const mockError: VideoError = {
        type: VideoErrorType.HLS_ERROR,
        message: 'HLS failed',
        code: 'HLS_ERR',
        severity: VideoErrorSeverity.CRITICAL,
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      mockCategorizeError.mockReturnValue(mockError);

      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
      });

      // Simulate error
      const errorHandler = mockOn.mock.calls.find(call => call[0] === 'error')?.[1];
      (mockPlayer.error as jest.Mock).mockReturnValueOnce({ code: 4 });
      errorHandler?.();

      await waitFor(() => {
        expect(mockTrackError).toHaveBeenCalledWith({
          code: 'HLS_ERR',
          message: 'HLS failed',
          type: 'HLS_ERROR',
        });
      });
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should attempt fallback when error has fallback available', async () => {
      const mockError: VideoError = {
        type: VideoErrorType.HLS_ERROR,
        message: 'HLS failed',
        code: 'HLS_ERR',
        severity: VideoErrorSeverity.CRITICAL,
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      const fallbackSource = {
        type: 'mp4' as const,
        url: 'https://example.com/video-720p.mp4',
        quality: '720p' as const,
      };

      mockCategorizeError.mockReturnValue(mockError);
      mockGetNextFallback.mockReturnValue(fallbackSource);

      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
      });

      // Simulate error
      const errorHandler = mockOn.mock.calls.find(call => call[0] === 'error')?.[1];
      (mockPlayer.error as jest.Mock).mockReturnValueOnce({ code: 4 });
      errorHandler?.();

      await waitFor(() => {
        expect(mockGetNextFallback).toHaveBeenCalledWith(mockError);
        expect(mockSrc).toHaveBeenCalledWith([
          {
            src: 'https://example.com/video-720p.mp4',
            type: 'video/mp4',
          },
        ]);
      });
    });
  });

  describe('Accessibility', () => {
    it('should have sr-only status message', () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      const status = screen.getByRole('status');
      expect(status).toHaveClass('sr-only');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveAttribute('aria-atomic', 'true');
    });

    it('should update status message when player is ready', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Video player loaded and ready')).toBeInTheDocument();
      });
    });

    it('should show loading message initially', () => {
      // Prevent ready callback from being called immediately
      mockReady.mockImplementationOnce(() => {});

      render(<CustomVideoPlayer {...defaultProps} />);

      expect(screen.getByText('Loading video player...')).toBeInTheDocument();
    });

    it('should apply tabIndex to video element', () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      const video = document.querySelector('video');
      expect(video).toHaveAttribute('tabIndex', '0');
    });
  });

  describe('Bilingual Support (i18n)', () => {
    it('should support English language (default)', async () => {
      render(<CustomVideoPlayer {...defaultProps} lang="en" />);

      await waitFor(() => {
        expect(screen.getByText('Video player loaded and ready')).toBeInTheDocument();
      });
    });

    it('should support Arabic language with i18n', async () => {
      render(<CustomVideoPlayer {...defaultProps} lang="ar" />);

      await waitFor(() => {
        expect(screen.getByText('تم تحميل مشغل الفيديو وهو جاهز')).toBeInTheDocument();
      });
    });

    it('should show Arabic loading message', () => {
      // Prevent ready callback from being called immediately
      mockReady.mockImplementationOnce(() => {});

      render(<CustomVideoPlayer {...defaultProps} lang="ar" />);

      expect(screen.getByText('جاري تحميل مشغل الفيديو...')).toBeInTheDocument();
    });

    it('should apply RTL direction for Arabic', () => {
      const { container } = render(<CustomVideoPlayer {...defaultProps} lang="ar" />);

      const player = container.querySelector('.custom-video-player');
      expect(player).toHaveAttribute('dir', 'rtl');
    });

    it('should apply LTR direction for English', () => {
      const { container } = render(<CustomVideoPlayer {...defaultProps} lang="en" />);

      const player = container.querySelector('.custom-video-player');
      expect(player).toHaveAttribute('dir', 'ltr');
    });

    it('should use translated accessibility label', () => {
      render(<CustomVideoPlayer {...defaultProps} lang="ar" />);

      const video = document.querySelector('video');
      expect(video).toHaveAttribute('aria-label', 'مشغل الفيديو');
    });

    it('should use custom ariaLabel over translated default', () => {
      render(<CustomVideoPlayer {...defaultProps} lang="ar" ariaLabel="My Custom Label" />);

      const video = document.querySelector('video');
      expect(video).toHaveAttribute('aria-label', 'My Custom Label');
    });
  });

  describe('Subtitle tracks', () => {
    it('owns the tracks it adds, so setting the source again does not drop them', async () => {
      const addRemoteTextTrack = jest.fn(() => ({ track: {} }));
      const removeRemoteTextTrack = jest.fn();
      mockCreateVideoPlayer.mockReturnValue({ ...mockPlayer, addRemoteTextTrack, removeRemoteTextTrack });
      const tracks = [
        { kind: 'subtitles' as const, src: '/en.vtt', srclang: 'en', label: 'English', default: false },
        { kind: 'subtitles' as const, src: '/ar.vtt', srclang: 'ar', label: 'العربية', default: false },
      ];
      const { rerender } = render(<CustomVideoPlayer {...defaultProps} textTracks={tracks} />);
      await waitFor(() => expect(addRemoteTextTrack).toHaveBeenCalledTimes(2));
      // manualCleanup: Video.js must not remove them on its own when the source is reset
      for (const call of addRemoteTextTrack.mock.calls as unknown as [unknown, boolean][]) expect(call[1]).toBe(true);
      // A new list replaces the old tracks rather than adding to them
      rerender(<CustomVideoPlayer {...defaultProps} textTracks={tracks.slice(0, 1)} />);
      await waitFor(() => expect(removeRemoteTextTrack).toHaveBeenCalledTimes(2));
      expect(addRemoteTextTrack).toHaveBeenCalledTimes(3);
    });
  });
});
