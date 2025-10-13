import videojs, { type Player, type PlayerOptions } from 'video.js';
import 'video.js/dist/video-js.css';
import '@videojs/http-streaming';
import 'videojs-contrib-quality-levels';
import 'videojs-hls-quality-selector';

export const VIDEO_JS_OPTIONS: Partial<PlayerOptions> = {
  responsive: true,
  fluid: true,
  playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
  html5: {
    hls: {
      enableLowInitialPlaylist: true,
      smoothQualityChange: true,
      overrideNative: true
    }
  }
};

/**
 * Creates a Video.js player instance with HLS streaming support
 * @param element - The HTML video element to initialize
 * @param options - Video.js player options (merged with defaults)
 * @returns Initialized Video.js player instance
 * @throws Error if player initialization fails
 * @example
 * const player = createVideoPlayer(videoElement, {
 *   controls: true,
 *   sources: [{ src: 'video.m3u8', type: 'application/x-mpegURL' }]
 * });
 */
export function createVideoPlayer(
  element: HTMLVideoElement,
  options: PlayerOptions
): Player {
  try {
    return videojs(element, {
      ...VIDEO_JS_OPTIONS,
      ...options
    });
  } catch (error) {
    console.error('Failed to create video player:', error);
    throw new Error('Video player initialization failed');
  }
}

/**
 * Safely disposes a Video.js player instance
 * @param player - The Video.js player to dispose, or null
 * @example
 * disposeVideoPlayer(playerRef.current);
 * playerRef.current = null;
 */
export function disposeVideoPlayer(player: Player | null) {
  if (player && !player.isDisposed()) {
    player.dispose();
  }
}
