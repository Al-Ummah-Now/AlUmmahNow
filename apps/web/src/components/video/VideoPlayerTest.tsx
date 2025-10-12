'use client';

import { useEffect, useRef } from 'react';
import { createVideoPlayer, disposeVideoPlayer } from '@/lib/video/videojs-setup';
import '@/styles/video-player.css';
import type { Player } from 'video.js';

export default function VideoPlayerTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    // Initialize Video.js player
    playerRef.current = createVideoPlayer(videoRef.current, {
      controls: true,
      sources: [{
        src: 'https://vz-215a1ffd-a5a.b-cdn.net/0a3a5049-0999-4ca4-9003-d507a13d39b4/playlist.m3u8',
        type: 'application/x-mpegURL'
      }],
      poster: 'https://vz-215a1ffd-a5a.b-cdn.net/0a3a5049-0999-4ca4-9003-d507a13d39b4/thumbnail.jpg'
    });

    // Cleanup on unmount
    return () => {
      disposeVideoPlayer(playerRef.current);
      playerRef.current = null;
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Video.js Test Component</h1>
      <div data-vjs-player>
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered"
          playsInline
        />
      </div>
      <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded">
        <h2 className="font-semibold mb-2">Test Info:</h2>
        <ul className="list-disc list-inside text-sm">
          <li>Video.js version: 8.12.0</li>
          <li>HLS streaming enabled</li>
          <li>Quality selector plugin loaded</li>
          <li>Custom theme applied</li>
        </ul>
      </div>
    </div>
  );
}
