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
      if (onError) {
        onError(err);
      }
      return;
    }

    // Initialize Video.js player
    const player = videojs(videoElement, {
      autoplay,
      controls: true,
      responsive: true,
      fluid: true,
      preload: 'metadata',
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

    // Event handlers
    player.on('play', () => {
      if (onPlay) {
        onPlay();
      }
    });

    player.on('pause', () => {
      if (onPause) {
        onPause();
      }
    });

    player.on('ended', () => {
      if (onEnded) {
        onEnded();
      }
    });

    player.on('timeupdate', () => {
      if (onTimeUpdate) {
        const currentTime = player.currentTime();
        const duration = player.duration();
        if (!isNaN(currentTime) && !isNaN(duration)) {
          onTimeUpdate(currentTime, duration);
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
      
      if (onError) {
        onError(playerError);
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
  }, [videoId, bunnyVideoId, title, autoplay, startTime, onPlay, onPause, onEnded, onTimeUpdate, onError, rtl]);

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
