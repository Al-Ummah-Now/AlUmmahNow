import videojs, { type Player, type PlayerOptions } from 'video.js';
import '@videojs/http-streaming';
import 'videojs-contrib-quality-levels';
import 'videojs-hls-quality-selector';
import { logger } from '@/lib/logger-server';


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
  },
  // Accessibility: Enable keyboard controls
  // V3 Design: Standard control bar layout (YouTube/Netflix/Video.js/Plyr research)
  // Order: Play → Volume (inline slider) → Progress → Time → Quality → Fullscreen
  controlBar: {
    children: [
      'playToggle',           // 1. Play/Pause button (leftmost)
      'volumePanel',          // 2. Volume button with inline slider
      'progressControl',      // 3. Progress bar (center, large - 700px width)
      'remainingTimeDisplay', // 4. Time remaining display
      'hlsQualitySelector',   // 5. Quality/Settings button
      'fullscreenToggle'      // 6. Fullscreen button (rightmost)
    ],
    remainingTimeDisplay: true,
    pictureInPictureToggle: false, // Removed from V3 design
    volumePanel: {
      inline: true // Show volume slider inline with control bar
    }
  },
  // Accessibility: Better UX for screen readers
  language: 'en',
  languages: {
    en: {
      'Play': 'Play Video',
      'Pause': 'Pause Video',
      'Mute': 'Mute Audio',
      'Unmute': 'Unmute Audio',
      'Fullscreen': 'Enter Fullscreen',
      'Exit Fullscreen': 'Exit Fullscreen',
      'Captions': 'Show Captions',
      'Subtitles': 'Show Subtitles'
    },
    ar: {
      'Play': 'تشغيل الفيديو',
      'Pause': 'إيقاف الفيديو',
      'Mute': 'كتم الصوت',
      'Unmute': 'إلغاء كتم الصوت',
      'Fullscreen': 'ملء الشاشة',
      'Exit Fullscreen': 'الخروج من ملء الشاشة',
      'Captions': 'إظهار التسميات التوضيحية',
      'Subtitles': 'إظهار الترجمة'
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
  let player: Player | null = null;

  try {
    logger.info('[createVideoPlayer] Options received:', options);
    logger.info('[createVideoPlayer] Poster URL:', options.poster);

    player = videojs(element, {
      ...VIDEO_JS_OPTIONS,
      ...options
    });

    // Initialize quality selector plugin when player is ready
    player.ready(() => {
      if (player && typeof player.hlsQualitySelector === 'function') {
        try {
          player.hlsQualitySelector({
            displayCurrentQuality: true
          });
        } catch (error) {
          logger.warn('HLS quality selector plugin failed to initialize:', error);
        }
      } else {
        logger.warn('HLS quality selector plugin not available');
      }
    });

    return player;
  } catch (error) {
    // Cleanup on error
    if (player && !player.isDisposed()) {
      player.dispose();
    }
    logger.error('Failed to create video player:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Video player initialization failed: ${errorMessage}`);
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
