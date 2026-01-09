import { logger } from '@/lib/logger-client';

import { useEffect, useRef, useState } from 'react';
import { createVideoPlayer, disposeVideoPlayer } from '@/lib/video/videojs-setup';
import '@/styles/video-player.css';
import type { Player } from 'video.js';

export default function VideoPlayerTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [playerReady, setPlayerReady] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;

    // Prevent double initialization in React Strict Mode
    if (playerRef.current) return;

    // Initialize Video.js player
    playerRef.current = createVideoPlayer(videoRef.current, {
      controls: true,
      sources: [{
        src: 'https://vz-215a1ffd-a5a.b-cdn.net/0a3a5049-0999-4ca4-9003-d507a13d39b4/playlist.m3u8',
        type: 'application/x-mpegURL'
      }],
      poster: 'https://vz-215a1ffd-a5a.b-cdn.net/0a3a5049-0999-4ca4-9003-d507a13d39b4/thumbnail.jpg'
    });

    // Accessibility: Setup screen reader announcements
    const player = playerRef.current;
    if (player) {
      player.ready(() => {
        setPlayerReady(true);

        // Announce play/pause to screen readers
        player.on('play', () => {
          logger.debug('Video playback started');
        });

        player.on('pause', () => {
          logger.debug('Video playback paused');
        });

        player.on('ended', () => {
          logger.debug('Video playback ended');
        });
      });
    }

    // Cleanup on unmount
    return () => {
      disposeVideoPlayer(playerRef.current);
      playerRef.current = null;
      setPlayerReady(false);
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Video.js Test Component</h1>

      {/* Accessibility: Hidden live region for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {playerReady ? 'Video player loaded and ready' : 'Loading video player...'}
      </div>

      <div data-vjs-player>
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered"
          playsInline
          aria-label="Video player"
          tabIndex={0}
        />
      </div>

      <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded">
        <h2 className="font-semibold mb-2">Test Info:</h2>
        <ul className="list-disc list-inside text-sm">
          <li>Video.js version: 8.23.4</li>
          <li>HLS streaming enabled</li>
          <li>Quality selector plugin loaded</li>
          <li>Custom theme applied</li>
          <li>Accessibility features enabled</li>
        </ul>
      </div>

      {/* Accessibility: Keyboard shortcuts help */}
      <details className="mt-4 p-4 bg-muted rounded">
        <summary className="font-semibold cursor-pointer">
          Keyboard Shortcuts
        </summary>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="font-medium">Space / K</dt>
            <dd>Play/Pause</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-medium">M</dt>
            <dd>Mute/Unmute</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-medium">F</dt>
            <dd>Toggle Fullscreen</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-medium">← / →</dt>
            <dd>Seek Backward/Forward</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-medium">↑ / ↓</dt>
            <dd>Volume Up/Down</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-medium">0-9</dt>
            <dd>Jump to % of video</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-medium">C</dt>
            <dd>Toggle Captions</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
