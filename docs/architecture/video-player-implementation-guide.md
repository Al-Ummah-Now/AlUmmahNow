# Custom Video Player Implementation Guide

## Table of Contents
1. [Quick Start](#quick-start)
2. [Bunny.net Integration](#bunnynet-integration)
3. [Core Components](#core-components)
4. [Analytics Implementation](#analytics-implementation)
5. [Code Examples](#code-examples)
6. [Testing Strategy](#testing-strategy)

## Quick Start

### Installation

```bash
# Install required packages
pnpm --filter @al-ummah/web add video.js @videojs/http-streaming videojs-contrib-quality-levels videojs-hls-quality-selector
pnpm --filter @al-ummah/web add -D @types/video.js
```

### Basic Setup

```typescript
// app/web/src/components/VideoPlayer/CustomVideoPlayer.tsx
'use client';

import React, { useEffect, useRef } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import '@videojs/http-streaming';
import 'videojs-contrib-quality-levels';
import 'videojs-hls-quality-selector';

export function CustomVideoPlayer({ videoId, hlsUrl }: Props) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<videojs.Player | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    const videoElement = document.createElement('video-js');
    videoRef.current.appendChild(videoElement);

    const player = videojs(videoElement, {
      autoplay: false,
      controls: true,
      responsive: true,
      fluid: true,
      sources: [{
        src: hlsUrl,
        type: 'application/x-mpegURL'
      }]
    });

    playerRef.current = player;

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
      }
    };
  }, [hlsUrl]);

  return <div ref={videoRef} className="video-player-container" />;
}
```

## Bunny.net Integration

### URL Generation Service

```typescript
// apps/web/src/services/bunny/stream.service.ts

interface BunnyConfig {
  pullZoneUrl: string;  // e.g., "vz-xxxxx.b-cdn.net"
  libraryId: string;
  apiKey?: string;      // For authenticated requests
}

export class BunnyStreamService {
  constructor(private config: BunnyConfig) {}

  /**
   * Generate HLS manifest URL for a video
   */
  getHLSUrl(videoId: string): string {
    return `https://${this.config.pullZoneUrl}/${videoId}/playlist.m3u8`;
  }

  /**
   * Generate direct MP4 URL for specific quality
   */
  getMP4Url(videoId: string, quality: '240p' | '360p' | '480p' | '720p' | '1080p'): string {
    return `https://${this.config.pullZoneUrl}/${videoId}/play_${quality}.mp4`;
  }

  /**
   * Generate thumbnail URL
   */
  getThumbnailUrl(videoId: string, time?: number): string {
    if (time !== undefined) {
      return `https://${this.config.pullZoneUrl}/${videoId}/thumbnail.jpg?t=${time}`;
    }
    return `https://${this.config.pullZoneUrl}/${videoId}/thumbnail.jpg`;
  }

  /**
   * Generate preview animation URL
   */
  getPreviewUrl(videoId: string): string {
    return `https://${this.config.pullZoneUrl}/${videoId}/preview.webp`;
  }

  /**
   * Generate captions/subtitles URL
   */
  getCaptionsUrl(videoId: string, language: string): string {
    return `https://${this.config.pullZoneUrl}/${videoId}/captions/${language}.vtt`;
  }

  /**
   * Generate token-authenticated URL (if using token authentication)
   */
  getAuthenticatedUrl(videoId: string, expiryTime: number): string {
    // Implementation depends on your token auth setup
    const token = this.generateToken(videoId, expiryTime);
    return `${this.getHLSUrl(videoId)}?token=${token}&expires=${expiryTime}`;
  }

  private generateToken(videoId: string, expiryTime: number): string {
    // SHA256 hash of: apiKey + videoId + expiryTime
    // Implementation details in Bunny.net docs
    return 'generated_token_here';
  }
}
```

### API Integration for Video Metadata

```typescript
// apps/web/src/services/api/video.service.ts

export class VideoAPIService {
  private apiUrl = process.env.NEXT_PUBLIC_API_URL;

  async getVideoDetails(videoId: string): Promise<VideoDetails> {
    const response = await fetch(`${this.apiUrl}/api/videos/${videoId}`);
    if (!response.ok) throw new Error('Failed to fetch video');
    return response.json();
  }

  async updateWatchProgress(
    videoId: string,
    watchTime: number,
    duration: number,
    completed: boolean = false
  ): Promise<void> {
    await fetch(`${this.apiUrl}/api/profile/watch-history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({
        videoId,
        watchTime,
        totalDuration: duration,
        completed
      })
    });
  }
}
```

## Core Components

### 1. Main Video Player Component

```typescript
// apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx

import React, { useEffect, useRef, useState, useCallback } from 'react';
import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import { VideoControls } from './VideoControls';
import { VideoAnalytics } from '@/services/analytics/video-analytics';
import { BunnyStreamService } from '@/services/bunny/stream.service';
import { useWebSocket } from '@/hooks/useWebSocket';
import 'video.js/dist/video-js.css';
import './custom-theme.css';

interface CustomVideoPlayerProps {
  videoId: string;
  bunnyVideoId: string;
  title: string;
  channelId?: string;
  userId?: string;
  autoplay?: boolean;
  startTime?: number;
  onEnded?: () => void;
  rtl?: boolean;
}

export function CustomVideoPlayer({
  videoId,
  bunnyVideoId,
  title,
  channelId,
  userId,
  autoplay = false,
  startTime = 0,
  onEnded,
  rtl = false
}: CustomVideoPlayerProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [isReady, setIsReady] = useState(false);
  const analytics = useRef(new VideoAnalytics(videoId, userId));
  const bunnyService = useRef(new BunnyStreamService({
    pullZoneUrl: process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE!
  }));

  // WebSocket for real-time updates
  const { sendMessage } = useWebSocket({
    channel: `video:${videoId}`,
    onMessage: handleWebSocketMessage
  });

  // Initialize player
  useEffect(() => {
    if (!videoRef.current) return;

    const videoElement = document.createElement('video-js');
    videoElement.classList.add('vjs-big-play-centered');
    videoRef.current.appendChild(videoElement);

    const player = videojs(videoElement, {
      autoplay,
      controls: true,
      responsive: true,
      fluid: true,
      playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      sources: [{
        src: bunnyService.current.getHLSUrl(bunnyVideoId),
        type: 'application/x-mpegURL'
      }],
      html5: {
        hls: {
          enableLowInitialPlaylist: true,
          smoothQualityChange: true,
          overrideNative: true
        }
      },
      controlBar: {
        pictureInPictureToggle: true,
        volumePanel: {
          inline: false
        },
        currentTimeDisplay: true,
        timeDivider: true,
        durationDisplay: true,
        remainingTimeDisplay: false,
        fullscreenToggle: true
      }
    });

    playerRef.current = player;

    // Setup event listeners
    setupPlayerEvents(player);

    // Setup quality selector
    (player as any).hlsQualitySelector({
      displayCurrentQuality: true
    });

    // Load saved progress
    if (startTime > 0) {
      player.one('loadedmetadata', () => {
        player.currentTime(startTime);
      });
    }

    // Setup keyboard shortcuts
    setupKeyboardShortcuts(player);

    player.ready(() => {
      setIsReady(true);
      analytics.current.trackReady();
    });

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [bunnyVideoId, autoplay, startTime]);

  // Player event handlers
  const setupPlayerEvents = (player: Player) => {
    player.on('play', () => {
      analytics.current.trackPlay();
      sendMessage({
        type: 'video_play',
        videoId,
        userId
      });
    });

    player.on('pause', () => {
      analytics.current.trackPause();
      saveProgress();
    });

    player.on('ended', () => {
      analytics.current.trackComplete();
      saveProgress(true);
      onEnded?.();
    });

    player.on('timeupdate', throttle(() => {
      const currentTime = player.currentTime();
      const duration = player.duration();

      analytics.current.trackProgress(currentTime, duration);

      // Check for quartile events
      const progress = (currentTime / duration) * 100;
      if (progress >= 25 && !analytics.current.hasReachedQuartile(25)) {
        analytics.current.trackQuartile(25);
      }
      if (progress >= 50 && !analytics.current.hasReachedQuartile(50)) {
        analytics.current.trackQuartile(50);
      }
      if (progress >= 75 && !analytics.current.hasReachedQuartile(75)) {
        analytics.current.trackQuartile(75);
      }
    }, 5000)); // Update every 5 seconds

    player.on('volumechange', () => {
      const volume = player.volume();
      const muted = player.muted();
      localStorage.setItem('videoPlayerVolume', JSON.stringify({ volume, muted }));
    });

    player.on('error', (error: any) => {
      analytics.current.trackError(error);
      console.error('Video playback error:', error);
    });

    player.on('waiting', () => {
      analytics.current.trackBufferingStart();
    });

    player.on('playing', () => {
      analytics.current.trackBufferingEnd();
    });
  };

  // Keyboard shortcuts
  const setupKeyboardShortcuts = (player: Player) => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Don't handle if user is typing in input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      switch(e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          player.paused() ? player.play() : player.pause();
          break;
        case 'arrowleft':
          e.preventDefault();
          player.currentTime(Math.max(0, player.currentTime() - 5));
          break;
        case 'arrowright':
          e.preventDefault();
          player.currentTime(Math.min(player.duration(), player.currentTime() + 5));
          break;
        case 'arrowup':
          e.preventDefault();
          player.volume(Math.min(1, player.volume() + 0.1));
          break;
        case 'arrowdown':
          e.preventDefault();
          player.volume(Math.max(0, player.volume() - 0.1));
          break;
        case 'm':
          e.preventDefault();
          player.muted(!player.muted());
          break;
        case 'f':
          e.preventDefault();
          player.isFullscreen() ? player.exitFullscreen() : player.requestFullscreen();
          break;
        case 'p':
          e.preventDefault();
          if ((player as any).pictureInPictureEnabled) {
            (player as any).requestPictureInPicture();
          }
          break;
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          e.preventDefault();
          const percent = parseInt(e.key) * 10;
          player.currentTime((percent / 100) * player.duration());
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);

    player.on('dispose', () => {
      document.removeEventListener('keydown', handleKeyPress);
    });
  };

  // Save watch progress
  const saveProgress = async (completed = false) => {
    if (!playerRef.current) return;

    const currentTime = playerRef.current.currentTime();
    const duration = playerRef.current.duration();

    try {
      await fetch('/api/profile/watch-history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({
          videoId,
          watchTime: currentTime,
          totalDuration: duration,
          completed
        })
      });
    } catch (error) {
      console.error('Failed to save progress:', error);
    }
  };

  // WebSocket message handler
  function handleWebSocketMessage(message: any) {
    if (message.type === 'viewer_update') {
      // Handle real-time viewer count updates
    }
  }

  return (
    <div className={`video-player-wrapper ${rtl ? 'rtl' : 'ltr'}`}>
      <div ref={videoRef} className="video-js-container" />
      {isReady && (
        <VideoControls
          player={playerRef.current!}
          videoId={videoId}
          title={title}
        />
      )}
    </div>
  );
}

// Utility function to throttle events
function throttle(func: Function, delay: number) {
  let timeoutId: NodeJS.Timeout | null;
  let lastExecTime = 0;

  return function (...args: any[]) {
    const currentTime = Date.now();

    if (currentTime - lastExecTime > delay) {
      func.apply(this, args);
      lastExecTime = currentTime;
    } else {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        func.apply(this, args);
        lastExecTime = Date.now();
      }, delay - (currentTime - lastExecTime));
    }
  };
}
```

### 2. Custom Controls Overlay

```typescript
// apps/web/src/components/VideoPlayer/VideoControls.tsx

import React, { useState, useEffect } from 'react';
import type Player from 'video.js/dist/types/player';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Maximize,
  Settings,
  Subtitles,
  Share2,
  ThumbsUp,
  ThumbsDown
} from 'lucide-react';

interface VideoControlsProps {
  player: Player;
  videoId: string;
  title: string;
}

export function VideoControls({ player, videoId, title }: VideoControlsProps) {
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [quality, setQuality] = useState('auto');

  useEffect(() => {
    const updateState = () => {
      setIsPlaying(!player.paused());
      setCurrentTime(player.currentTime());
      setDuration(player.duration());
      setVolume(player.volume());
      setIsMuted(player.muted());
      setPlaybackRate(player.playbackRate());
    };

    player.on('play', updateState);
    player.on('pause', updateState);
    player.on('timeupdate', updateState);
    player.on('volumechange', updateState);
    player.on('ratechange', updateState);

    return () => {
      player.off('play', updateState);
      player.off('pause', updateState);
      player.off('timeupdate', updateState);
      player.off('volumechange', updateState);
      player.off('ratechange', updateState);
    };
  }, [player]);

  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="video-controls-overlay">
      {/* Progress bar with preview */}
      <div className="progress-container">
        <input
          type="range"
          min="0"
          max={duration || 0}
          value={currentTime}
          onChange={(e) => player.currentTime(parseFloat(e.target.value))}
          className="progress-bar"
        />
        <div className="time-display">
          <span>{formatTime(currentTime)}</span>
          <span>/</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Control buttons */}
      <div className="control-buttons">
        <button onClick={() => player.currentTime(currentTime - 10)}>
          <SkipBack size={20} />
        </button>

        <button onClick={() => isPlaying ? player.pause() : player.play()}>
          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
        </button>

        <button onClick={() => player.currentTime(currentTime + 10)}>
          <SkipForward size={20} />
        </button>

        <div className="volume-control">
          <button onClick={() => player.muted(!isMuted)}>
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={(e) => player.volume(parseFloat(e.target.value))}
          />
        </div>

        <div className="spacer" />

        <select
          value={playbackRate}
          onChange={(e) => player.playbackRate(parseFloat(e.target.value))}
        >
          <option value="0.25">0.25x</option>
          <option value="0.5">0.5x</option>
          <option value="0.75">0.75x</option>
          <option value="1">Normal</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="1.75">1.75x</option>
          <option value="2">2x</option>
        </select>

        <button onClick={() => player.requestFullscreen()}>
          <Maximize size={20} />
        </button>
      </div>
    </div>
  );
}
```

### 3. Analytics Service

```typescript
// apps/web/src/services/analytics/video-analytics.ts

export class VideoAnalytics {
  private videoId: string;
  private userId?: string;
  private sessionId: string;
  private startTime: number;
  private watchedSegments: Set<number> = new Set();
  private quartiles: Set<number> = new Set();
  private bufferStartTime?: number;
  private eventQueue: AnalyticsEvent[] = [];
  private flushInterval?: NodeJS.Timeout;

  constructor(videoId: string, userId?: string) {
    this.videoId = videoId;
    this.userId = userId;
    this.sessionId = this.generateSessionId();
    this.startTime = Date.now();

    // Flush events every 30 seconds
    this.flushInterval = setInterval(() => this.flush(), 30000);

    // Flush on page unload
    window.addEventListener('beforeunload', () => this.flush());
  }

  trackReady() {
    this.addEvent({
      eventType: 'ready',
      timestamp: Date.now() - this.startTime
    });
  }

  trackPlay() {
    this.addEvent({
      eventType: 'play',
      timestamp: Date.now() - this.startTime
    });
  }

  trackPause() {
    this.addEvent({
      eventType: 'pause',
      timestamp: Date.now() - this.startTime
    });
  }

  trackProgress(currentTime: number, duration: number) {
    // Track 10-second segments watched
    const segment = Math.floor(currentTime / 10);
    if (!this.watchedSegments.has(segment)) {
      this.watchedSegments.add(segment);
      this.addEvent({
        eventType: 'segment_watched',
        data: { segment, currentTime, duration }
      });
    }
  }

  trackQuartile(quartile: 25 | 50 | 75) {
    if (!this.quartiles.has(quartile)) {
      this.quartiles.add(quartile);
      this.addEvent({
        eventType: `quartile_${quartile}`,
        timestamp: Date.now() - this.startTime
      });
    }
  }

  trackComplete() {
    this.addEvent({
      eventType: 'complete',
      timestamp: Date.now() - this.startTime,
      data: {
        watchedSegments: Array.from(this.watchedSegments),
        totalWatchTime: Date.now() - this.startTime
      }
    });
    this.flush();
  }

  trackQualityChange(from: string, to: string) {
    this.addEvent({
      eventType: 'quality_change',
      data: { from, to }
    });
  }

  trackBufferingStart() {
    this.bufferStartTime = Date.now();
    this.addEvent({
      eventType: 'buffer_start'
    });
  }

  trackBufferingEnd() {
    if (this.bufferStartTime) {
      const bufferDuration = Date.now() - this.bufferStartTime;
      this.addEvent({
        eventType: 'buffer_end',
        data: { duration: bufferDuration }
      });
      this.bufferStartTime = undefined;
    }
  }

  trackError(error: any) {
    this.addEvent({
      eventType: 'error',
      data: {
        code: error.code,
        message: error.message,
        type: error.type
      }
    });
    this.flush();
  }

  trackEngagement(action: 'like' | 'dislike' | 'share' | 'comment') {
    this.addEvent({
      eventType: action,
      timestamp: Date.now() - this.startTime
    });
  }

  hasReachedQuartile(quartile: number): boolean {
    return this.quartiles.has(quartile);
  }

  private addEvent(event: Partial<AnalyticsEvent>) {
    this.eventQueue.push({
      videoId: this.videoId,
      userId: this.userId,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      ...event
    } as AnalyticsEvent);

    // Flush if queue is getting large
    if (this.eventQueue.length >= 20) {
      this.flush();
    }
  }

  private async flush() {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    try {
      await fetch('/api/analytics/video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ events })
      });
    } catch (error) {
      console.error('Failed to send analytics:', error);
      // Re-add events to queue on failure
      this.eventQueue.unshift(...events);
    }
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  destroy() {
    this.flush();
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    window.removeEventListener('beforeunload', () => this.flush());
  }
}

interface AnalyticsEvent {
  videoId: string;
  userId?: string;
  sessionId: string;
  eventType: string;
  timestamp: string;
  data?: any;
}
```

## Testing Strategy

### Unit Tests

```typescript
// apps/web/src/components/VideoPlayer/__tests__/CustomVideoPlayer.test.tsx

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomVideoPlayer } from '../CustomVideoPlayer';
import videojs from 'video.js';

jest.mock('video.js');

describe('CustomVideoPlayer', () => {
  const mockProps = {
    videoId: 'test-video-123',
    bunnyVideoId: 'bunny-123',
    title: 'Test Video',
    channelId: 'channel-123'
  };

  beforeEach(() => {
    (videojs as jest.Mock).mockImplementation(() => ({
      ready: jest.fn((cb) => cb()),
      play: jest.fn(),
      pause: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      dispose: jest.fn(),
      currentTime: jest.fn(() => 0),
      duration: jest.fn(() => 100),
      volume: jest.fn(() => 1),
      muted: jest.fn(() => false)
    }));
  });

  it('should render video player', () => {
    render(<CustomVideoPlayer {...mockProps} />);
    expect(videojs).toHaveBeenCalled();
  });

  it('should handle autoplay prop', () => {
    render(<CustomVideoPlayer {...mockProps} autoplay={true} />);
    expect(videojs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ autoplay: true })
    );
  });

  it('should resume from saved position', () => {
    const startTime = 30;
    render(<CustomVideoPlayer {...mockProps} startTime={startTime} />);
    // Verify currentTime is set after metadata loads
  });

  it('should track analytics events', async () => {
    const { rerender } = render(<CustomVideoPlayer {...mockProps} />);
    // Simulate play event and verify analytics
  });
});
```

### Integration Tests

```typescript
// apps/web/src/components/VideoPlayer/__tests__/integration.test.tsx

import { render, waitFor } from '@testing-library/react';
import { CustomVideoPlayer } from '../CustomVideoPlayer';
import { setupServer } from 'msw/node';
import { rest } from 'msw';

const server = setupServer(
  rest.get('/api/videos/:id', (req, res, ctx) => {
    return res(ctx.json({
      id: req.params.id,
      hlsUrl: 'https://example.com/video.m3u8',
      title: 'Test Video'
    }));
  }),

  rest.post('/api/analytics/video', (req, res, ctx) => {
    return res(ctx.json({ success: true }));
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Video Player Integration', () => {
  it('should load video and track analytics', async () => {
    render(<CustomVideoPlayer videoId="123" bunnyVideoId="456" title="Test" />);

    await waitFor(() => {
      // Verify video loads
      // Verify analytics are sent
    });
  });
});
```

### E2E Tests

```typescript
// apps/web/e2e/video-player.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Video Player', () => {
  test('should play video', async ({ page }) => {
    await page.goto('/video/test-video-123');

    // Wait for player to load
    await page.waitForSelector('.video-js');

    // Click play button
    await page.click('.vjs-play-control');

    // Verify video is playing
    await expect(page.locator('video')).toHaveAttribute('playing');
  });

  test('should handle keyboard shortcuts', async ({ page }) => {
    await page.goto('/video/test-video-123');
    await page.waitForSelector('.video-js');

    // Test spacebar for play/pause
    await page.keyboard.press('Space');
    await expect(page.locator('video')).toHaveAttribute('playing');

    await page.keyboard.press('Space');
    await expect(page.locator('video')).not.toHaveAttribute('playing');

    // Test arrow keys for seeking
    await page.keyboard.press('ArrowRight');
    const currentTime = await page.locator('video').evaluate((el: HTMLVideoElement) => el.currentTime);
    expect(currentTime).toBeGreaterThan(0);
  });

  test('should save watch progress', async ({ page }) => {
    await page.goto('/video/test-video-123');
    await page.waitForSelector('.video-js');

    // Play video
    await page.click('.vjs-play-control');

    // Wait for progress to be saved
    await page.waitForTimeout(5000);

    // Pause video
    await page.click('.vjs-play-control');

    // Verify progress was saved
    await page.waitForRequest((req) =>
      req.url().includes('/api/profile/watch-history') &&
      req.method() === 'POST'
    );
  });
});
```

## Performance Optimization

```typescript
// apps/web/src/components/VideoPlayer/optimizations.ts

// 1. Lazy load Video.js
export const VideoPlayer = dynamic(
  () => import('./CustomVideoPlayer'),
  {
    ssr: false,
    loading: () => <VideoPlayerSkeleton />
  }
);

// 2. Preload video metadata
export function preloadVideo(videoId: string) {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'fetch';
  link.href = `https://cdn.example.com/${videoId}/playlist.m3u8`;
  document.head.appendChild(link);
}

// 3. Use Intersection Observer for lazy loading
export function useLazyVideoLoad(videoRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Load video player
          }
        });
      },
      { threshold: 0.1 }
    );

    if (videoRef.current) {
      observer.observe(videoRef.current);
    }

    return () => observer.disconnect();
  }, [videoRef]);
}

// 4. Optimize HLS settings
export const hlsConfig = {
  enableLowInitialPlaylist: true,
  maxBufferLength: 30,
  maxMaxBufferLength: 600,
  maxBufferSize: 60 * 1000 * 1000, // 60 MB
  maxBufferHole: 0.5,
  highBufferWatchdogPeriod: 2,
  nudgeOffset: 0.1,
  nudgeMaxRetry: 3,
  maxFragLookUpTolerance: 0.25,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: Infinity,
  liveDurationInfinity: true,
  enableWorker: true,
  enableSoftwareAES: true,
  manifestLoadingTimeOut: 10000,
  manifestLoadingMaxRetry: 1,
  manifestLoadingRetryDelay: 1000,
  manifestLoadingMaxRetryTimeout: 64000,
  startLevel: -1,
  levelLoadingTimeOut: 10000,
  levelLoadingMaxRetry: 4,
  levelLoadingRetryDelay: 1000,
  levelLoadingMaxRetryTimeout: 64000,
  fragLoadingTimeOut: 20000,
  fragLoadingMaxRetry: 6,
  fragLoadingRetryDelay: 1000,
  fragLoadingMaxRetryTimeout: 64000
};
```

## Deployment Checklist

- [ ] Install all required npm packages
- [ ] Configure Bunny.net API credentials
- [ ] Set up environment variables
- [ ] Create custom Video.js theme CSS
- [ ] Implement analytics endpoint
- [ ] Set up WebSocket connection
- [ ] Add error tracking (Sentry)
- [ ] Configure CDN for Video.js assets
- [ ] Test on all target browsers
- [ ] Test on mobile devices
- [ ] Verify RTL support
- [ ] Load test with multiple concurrent streams
- [ ] Monitor initial implementation metrics
- [ ] Set up A/B testing framework
- [ ] Create rollback plan

## Monitoring & Metrics

Key metrics to track:
- Time to first frame (TTFF)
- Rebuffering ratio
- Average bitrate
- Quality switches
- Error rate
- Engagement metrics (watch time, completion rate)
- Player load time
- API response times

## References

- [Video.js Documentation](https://docs.videojs.com/)
- [Bunny.net Stream API](https://docs.bunny.net/reference/stream-api-overview)
- [HLS.js Configuration](https://github.com/video-dev/hls.js/blob/master/docs/API.md)
- [Web Video Best Practices](https://web.dev/media/)
- [MDN Video Element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video)