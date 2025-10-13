'use client';

import React, { useEffect, useRef, useState } from 'react';
import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import { createBunnyStreamService } from '@/services/bunny';
import 'video.js/dist/video-js.css';
import './custom-theme.css';

export interface CustomVideoPlayerProps {
  videoId: string;           // Our video ID
  bunnyVideoId: string;      // Bunny.net video GUID
  title: string;
  channelId?: string;
  userId?: string;
  autoplay?: boolean;
  startTime?: number;        // Resume from saved position (seconds)
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onError?: (error: any) => void;
  className?: string;
  rtl?: boolean;
}

export function CustomVideoPlayer({
  videoId,
  bunnyVideoId,
  title,
  channelId, // Now documented: Will be used for analytics tracking
  userId,    // Now documented: Will be used for watch history
  autoplay = false,
  startTime = 0,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  onError,
  className = '',
  rtl = false
}: CustomVideoPlayerProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store callbacks in refs to avoid re-initialization on callback changes
  const callbacksRef = useRef({ onPlay, onPause, onEnded, onTimeUpdate, onError });

  // Update callbacks ref when they change
  useEffect(() => {
    callbacksRef.current = { onPlay, onPause, onEnded, onTimeUpdate, onError };
  }, [onPlay, onPause, onEnded, onTimeUpdate, onError]);

  useEffect(() => {
    // Ensure we're in browser environment
    if (typeof window === 'undefined' || !videoRef.current) {
      return;
    }

    // Prevent re-initialization
    if (playerRef.current) {
      return;
    }

    let mounted = true;

    // Create video element
    const videoElement = document.createElement('video-js');
    videoElement.classList.add('vjs-big-play-centered');
    videoElement.setAttribute('playsinline', '');

    // Add accessibility attributes
    videoElement.setAttribute('aria-label', title);
    videoElement.setAttribute('role', 'region');

    // TODO: Add data attributes for analytics tracking
    if (channelId) {
      videoElement.setAttribute('data-channel-id', channelId);
    }
    if (userId) {
      videoElement.setAttribute('data-user-id', userId);
    }

    videoRef.current.appendChild(videoElement);

    // Get HLS URL from BunnyStreamService
    let hlsUrl: string;
    try {
      const bunnyService = createBunnyStreamService();
      hlsUrl = bunnyService.getHlsUrl(bunnyVideoId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize video service';
      console.error('BunnyStreamService error:', err);
      setError(errorMessage);
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(err);
      }
      return;
    }

    // Initialize Video.js player with all required features
    const player = videojs(videoElement, {
      autoplay,
      controls: true,
      responsive: true,
      fluid: true,
      preload: 'metadata',
      playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      html5: {
        vhs: {
          overrideNative: true,
        },
        nativeVideoTracks: false,
        nativeAudioTracks: false,
        nativeTextTracks: false,
      },
      sources: [{
        src: hlsUrl,
        type: 'application/x-mpegURL'
      }],
      controlBar: {
        pictureInPictureToggle: true,
        volumePanel: {
          inline: false
        }
      },
    });

    playerRef.current = player;

    // Handle player ready event
    player.ready(() => {
      if (!mounted) return;

      setIsReady(true);

      // Resume from saved position if provided
      if (startTime > 0) {
        player.currentTime(startTime);
      }

      // Set RTL direction if needed
      if (rtl) {
        const playerEl = player.el();
        if (playerEl) {
          playerEl.setAttribute('dir', 'rtl');
        }
      }
    });

    // Event handlers using refs to avoid re-initialization
    player.on('play', () => {
      if (callbacksRef.current.onPlay) {
        callbacksRef.current.onPlay();
      }
    });

    player.on('pause', () => {
      if (callbacksRef.current.onPause) {
        callbacksRef.current.onPause();
      }
    });

    player.on('ended', () => {
      if (callbacksRef.current.onEnded) {
        callbacksRef.current.onEnded();
      }
    });

    player.on('timeupdate', () => {
      if (callbacksRef.current.onTimeUpdate) {
        const currentTime = player.currentTime();
        const duration = player.duration();
        // Add explicit type guards for number | undefined
        if (typeof currentTime === 'number' && typeof duration === 'number' &&
            !isNaN(currentTime) && !isNaN(duration)) {
          callbacksRef.current.onTimeUpdate(currentTime, duration);
        }
      }
    });

    player.on('error', () => {
      const playerError = player.error();
      const errorMessage = playerError
        ? `Video error: ${playerError.message || 'Unknown error'}`
        : 'Video playback error';

      console.error('Video.js error:', playerError);
      setError(errorMessage);

      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(playerError);
      }
    });

    // Cleanup function
    return () => {
      mounted = false;
      if (playerRef.current) {
        try {
          playerRef.current.dispose();
        } catch (err) {
          console.error('Error disposing player:', err);
        }
        playerRef.current = null;
      }
    };
  }, [videoId, bunnyVideoId, title, autoplay, startTime, rtl]); // Removed callback dependencies

  // Error state
  if (error) {
    return (
      <div 
        className={`flex items-center justify-center bg-muted rounded-lg p-8 ${className}`}
        role="alert"
        aria-live="assertive"
      >
        <div className="text-center">
          <p className="text-destructive font-semibold mb-2">
            {rtl ? 'فشل تحميل الفيديو' : 'Failed to load video'}
          </p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`video-player-container ${className}`}
      dir={rtl ? 'rtl' : 'ltr'}
    >
      <div 
        ref={videoRef} 
        data-vjs-player
        className="aspect-video"
      />
      
      {/* Screen reader announcement */}
      <div 
        role="status" 
        aria-live="polite" 
        aria-atomic="true" 
        className="sr-only"
      >
        {isReady 
          ? rtl 
            ? `${title} - مشغل الفيديو جاهز` 
            : `${title} - Video player ready`
          : rtl
            ? 'جاري تحميل مشغل الفيديو...'
            : 'Loading video player...'
        }
      </div>
    </div>
  );
}
