/**
 * Tests for CustomVideoPlayer component
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import CustomVideoPlayer from '../CustomVideoPlayer';
import { createBunnyStreamService } from '@/services/bunny';

// Mock Video.js
const mockDispose = jest.fn();
const mockOn = jest.fn();
const mockReady = jest.fn((callback) => callback());
const mockCurrentTime = jest.fn();
const mockDuration = jest.fn(() => 100);
const mockEl = jest.fn(() => ({
  setAttribute: jest.fn(),
}));
const mockError = jest.fn();

const mockPlayer = {
  dispose: mockDispose,
  on: mockOn,
  ready: mockReady,
  currentTime: mockCurrentTime,
  duration: mockDuration,
  el: mockEl,
  error: mockError,
};

jest.mock('video.js', () => {
  return jest.fn(() => mockPlayer);
});

// Mock BunnyStreamService
jest.mock('@/services/bunny', () => ({
  createBunnyStreamService: jest.fn(),
}));

const mockCreateBunnyStreamService = createBunnyStreamService as jest.MockedFunction<
  typeof createBunnyStreamService
>;

describe('CustomVideoPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock behavior
    mockCreateBunnyStreamService.mockReturnValue({
      getHlsUrl: jest.fn((videoId) => `https://cdn.example.com/${videoId}/playlist.m3u8`),
    } as any);
  });

  it('should render without errors', async () => {
    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
      />
    );

    // The player initializes quickly in tests, so check for ready state
    await waitFor(() => {
      expect(screen.getByText('Test Video - Video player ready')).toBeInTheDocument();
    });
  });

  it('should initialize Video.js player with correct configuration', async () => {
    const videojs = require('video.js');
    
    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
        autoplay={true}
      />
    );

    await waitFor(() => {
      expect(videojs).toHaveBeenCalled();
    });

    const config = videojs.mock.calls[0][1];
    expect(config.autoplay).toBe(true);
    expect(config.controls).toBe(true);
    expect(config.responsive).toBe(true);
    expect(config.fluid).toBe(true);
  });

  it('should use BunnyStreamService to get HLS URL', async () => {
    const mockService = {
      getHlsUrl: jest.fn(() => 'https://cdn.example.com/bunny-video-guid/playlist.m3u8'),
    };
    mockCreateBunnyStreamService.mockReturnValue(mockService as any);

    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
      />
    );

    await waitFor(() => {
      expect(mockService.getHlsUrl).toHaveBeenCalledWith('bunny-video-guid');
    });
  });

  it('should set start time when provided', async () => {
    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
        startTime={30}
      />
    );

    await waitFor(() => {
      expect(mockCurrentTime).toHaveBeenCalledWith(30);
    });
  });

  it('should call onPlay callback when play event occurs', async () => {
    const onPlay = jest.fn();

    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
        onPlay={onPlay}
      />
    );

    await waitFor(() => {
      expect(mockOn).toHaveBeenCalledWith('play', expect.any(Function));
    });

    // Simulate play event
    const playHandler = mockOn.mock.calls.find((call) => call[0] === 'play')?.[1];
    if (playHandler) {
      playHandler();
    }

    expect(onPlay).toHaveBeenCalled();
  });

  it('should call onPause callback when pause event occurs', async () => {
    const onPause = jest.fn();

    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
        onPause={onPause}
      />
    );

    await waitFor(() => {
      expect(mockOn).toHaveBeenCalledWith('pause', expect.any(Function));
    });

    // Simulate pause event
    const pauseHandler = mockOn.mock.calls.find((call) => call[0] === 'pause')?.[1];
    if (pauseHandler) {
      pauseHandler();
    }

    expect(onPause).toHaveBeenCalled();
  });

  it('should call onEnded callback when ended event occurs', async () => {
    const onEnded = jest.fn();

    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
        onEnded={onEnded}
      />
    );

    await waitFor(() => {
      expect(mockOn).toHaveBeenCalledWith('ended', expect.any(Function));
    });

    // Simulate ended event
    const endedHandler = mockOn.mock.calls.find((call) => call[0] === 'ended')?.[1];
    if (endedHandler) {
      endedHandler();
    }

    expect(onEnded).toHaveBeenCalled();
  });

  it('should call onTimeUpdate callback with currentTime and duration', async () => {
    const onTimeUpdate = jest.fn();
    mockCurrentTime.mockReturnValue(50);
    mockDuration.mockReturnValue(100);

    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
        onTimeUpdate={onTimeUpdate}
      />
    );

    await waitFor(() => {
      expect(mockOn).toHaveBeenCalledWith('timeupdate', expect.any(Function));
    });

    // Simulate timeupdate event
    const timeupdateHandler = mockOn.mock.calls.find((call) => call[0] === 'timeupdate')?.[1];
    if (timeupdateHandler) {
      timeupdateHandler();
    }

    expect(onTimeUpdate).toHaveBeenCalledWith(50, 100);
  });

  it('should set RTL direction when rtl prop is true', async () => {
    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
        rtl={true}
      />
    );

    await waitFor(() => {
      expect(mockEl).toHaveBeenCalled();
    });

    const element = mockEl.mock.results[0]?.value;
    if (element) {
      expect(element.setAttribute).toHaveBeenCalledWith('dir', 'rtl');
    }
  });

  it('should display error when BunnyStreamService fails', () => {
    mockCreateBunnyStreamService.mockImplementation(() => {
      throw new Error('Service initialization failed');
    });

    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
      />
    );

    expect(screen.getByText('Failed to load video')).toBeInTheDocument();
    expect(screen.getByText('Service initialization failed')).toBeInTheDocument();
  });

  it('should display Arabic error message when rtl is true', () => {
    mockCreateBunnyStreamService.mockImplementation(() => {
      throw new Error('Service initialization failed');
    });

    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
        rtl={true}
      />
    );

    expect(screen.getByText('فشل تحميل الفيديو')).toBeInTheDocument();
  });

  it('should call onError callback when error occurs', async () => {
    const onError = jest.fn();
    const errorMessage = { message: 'Video playback error' };
    mockError.mockReturnValue(errorMessage);

    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
        onError={onError}
      />
    );

    await waitFor(() => {
      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    });

    // Simulate error event
    const errorHandler = mockOn.mock.calls.find((call) => call[0] === 'error')?.[1];
    if (errorHandler) {
      errorHandler();
    }

    expect(onError).toHaveBeenCalledWith(errorMessage);
  });

  it('should dispose player on unmount', async () => {
    const { unmount } = render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
      />
    );

    await waitFor(() => {
      expect(mockReady).toHaveBeenCalled();
    });

    unmount();

    expect(mockDispose).toHaveBeenCalled();
  });

  it('should not initialize player when videoRef is not available', () => {
    // Mock scenario where ref is null
    const originalCreateElement = document.createElement;
    jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
      if (tagName === 'video-js') {
        return null as any;
      }
      return originalCreateElement.call(document, tagName);
    });

    const videojs = require('video.js');
    videojs.mockClear();

    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
      />
    );

    expect(videojs).not.toHaveBeenCalled();

    jest.restoreAllMocks();
  });

  it('should add accessibility attributes to video element', async () => {
    const createElement = jest.spyOn(document, 'createElement');

    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Accessible Video"
      />
    );

    await waitFor(() => {
      expect(createElement).toHaveBeenCalledWith('video-js');
    });

    const videoElement = createElement.mock.results.find(
      (result) => result.value?.tagName === 'VIDEO-JS'
    )?.value;

    if (videoElement) {
      expect(videoElement.getAttribute('aria-label')).toBe('Accessible Video');
      expect(videoElement.getAttribute('role')).toBe('region');
      expect(videoElement.getAttribute('playsinline')).toBe('');
    }

    createElement.mockRestore();
  });

  it('should display ready message in screen reader', async () => {
    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="Test Video"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Test Video - Video player ready')).toBeInTheDocument();
    });
  });

  it('should display Arabic ready message when rtl is true', async () => {
    render(
      <CustomVideoPlayer
        videoId="test-video-1"
        bunnyVideoId="bunny-video-guid"
        title="فيديو تجريبي"
        rtl={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('فيديو تجريبي - مشغل الفيديو جاهز')).toBeInTheDocument();
    });
  });
});
