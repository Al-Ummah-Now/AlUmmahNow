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
};

jest.mock('@/lib/video/videojs-setup', () => ({
  createVideoPlayer: jest.fn(() => mockPlayer),
  disposeVideoPlayer: jest.fn(),
}));

// Mock VideoAnalytics
const mockTrackReady = jest.fn();
const mockTrackPlay = jest.fn();
const mockTrackPause = jest.fn();
const mockTrackComplete = jest.fn();
const mockTrackError = jest.fn();
const mockDestroy = jest.fn();
const mockGetSessionId = jest.fn(() => '12345-abcde');

jest.mock('@/services/analytics/video-analytics', () => ({
  VideoAnalytics: jest.fn().mockImplementation(() => ({
    trackReady: mockTrackReady,
    trackPlay: mockTrackPlay,
    trackPause: mockTrackPause,
    trackComplete: mockTrackComplete,
    trackError: mockTrackError,
    destroy: mockDestroy,
    getSessionId: mockGetSessionId,
  })),
}));

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
      const { createVideoPlayer } = require('@/lib/video/videojs-setup');

      render(
        <CustomVideoPlayer
          {...defaultProps}
          controls={true}
          autoplay={true}
          poster="https://example.com/poster.jpg"
        />
      );

      await waitFor(() => {
        expect(createVideoPlayer).toHaveBeenCalled();
      });

      const [, options] = createVideoPlayer.mock.calls[0];
      expect(options).toMatchObject({
        controls: true,
        autoplay: true,
        sources: defaultProps.sources,
        poster: 'https://example.com/poster.jpg',
      });
    });

    it('should dispose player on unmount', async () => {
      const { disposeVideoPlayer } = require('@/lib/video/videojs-setup');
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
      const { VideoAnalytics } = require('@/services/analytics/video-analytics');

      render(
        <CustomVideoPlayer
          {...defaultProps}
          userId="user-456"
          enableAnalytics={true}
        />
      );

      await waitFor(() => {
        expect(VideoAnalytics).toHaveBeenCalledWith('test-video-123', 'user-456');
      });
    });

    it('should not initialize analytics when disabled', async () => {
      const { VideoAnalytics } = require('@/services/analytics/video-analytics');
      VideoAnalytics.mockClear();

      render(<CustomVideoPlayer {...defaultProps} enableAnalytics={false} />);

      await waitFor(() => {
        expect(mockReady).toHaveBeenCalled();
      });

      expect(VideoAnalytics).not.toHaveBeenCalled();
    });

    it('should track ready event', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockTrackReady).toHaveBeenCalled();
      });
    });

    it('should track play event', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('play', expect.any(Function));
      });

      // Simulate play event
      const playHandler = mockOn.mock.calls.find(call => call[0] === 'play')?.[1];
      playHandler?.();

      expect(mockTrackPlay).toHaveBeenCalled();
    });

    it('should track pause event', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('pause', expect.any(Function));
      });

      // Simulate pause event
      const pauseHandler = mockOn.mock.calls.find(call => call[0] === 'pause')?.[1];
      pauseHandler?.();

      expect(mockTrackPause).toHaveBeenCalled();
    });

    it('should track ended event', async () => {
      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('ended', expect.any(Function));
      });

      // Simulate ended event
      const endedHandler = mockOn.mock.calls.find(call => call[0] === 'ended')?.[1];
      endedHandler?.();

      expect(mockTrackComplete).toHaveBeenCalled();
    });

    it('should cleanup analytics on unmount', async () => {
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
      const { createVideoErrorHandler } = require('@/lib/video/error-handler');
      const { createVideoFallbackStrategy } = require('@/lib/video/fallback-strategy');

      render(<CustomVideoPlayer {...defaultProps} />);

      await waitFor(() => {
        expect(createVideoErrorHandler).toHaveBeenCalled();
        expect(createVideoFallbackStrategy).toHaveBeenCalled();
      });
    });

    it('should display ErrorDisplay when error occurs', async () => {
      const mockError: VideoError = {
        type: 'NETWORK_ERROR' as any,
        message: 'Network failed',
        code: 'NET_ERR',
        severity: 'WARNING' as any,
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

    it('should call onError callback when error occurs', async () => {
      const onError = jest.fn();
      const mockError: VideoError = {
        type: 'NETWORK_ERROR' as any,
        message: 'Network failed',
        code: 'NET_ERR',
        severity: 'WARNING' as any,
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

    it('should track errors in analytics', async () => {
      const mockError: VideoError = {
        type: 'HLS_ERROR' as any,
        message: 'HLS failed',
        code: 'HLS_ERR',
        severity: 'CRITICAL' as any,
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

    it('should attempt fallback when error has fallback available', async () => {
      const mockError: VideoError = {
        type: 'HLS_ERROR' as any,
        message: 'HLS failed',
        code: 'HLS_ERR',
        severity: 'CRITICAL' as any,
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
});
