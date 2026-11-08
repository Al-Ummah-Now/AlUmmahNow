import videojs, { type Player, type PlayerOptions } from 'video.js';
// Video.js 8 bundles @videojs/http-streaming (VHS) and the quality-levels
// plugin. Importing them again registered both twice ("A plugin named
// qualityLevels already exists") and added their code to the bundle again.
import 'videojs-hls-quality-selector';
import videojsArabic from 'video.js/dist/lang/ar.json';
import { logger } from '@/lib/logger-client';
import type { QualityLevelList } from '@/lib/video/videojs';
import { setupClickOnlyMenus } from '@/lib/video/menu-interaction';



export const VIDEO_JS_OPTIONS: Partial<PlayerOptions> = {
  responsive: true,
  fluid: true,
  // Controls stay up 4s after the last activity (#87 item 8); Video.js already
  // holds them open while the pointer is over the bar.
  inactivityTimeout: 4000,
  playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
  html5: {
    // Emulate text tracks so cross-origin WebVTT (served by the API with CORS)
    // loads consistently in every browser, including with MSE-based HLS.
    nativeTextTracks: false,
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
      'subsCapsButton',       // Subtitles/captions menu (hidden when the video has no tracks)
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
    // Full Video.js Arabic pack first so every built-in control text and
    // accessible name (sliders, menus, time displays) is translated on /ar
    // routes; the app-specific wording below overrides it.
    ar: {
      ...(videojsArabic as Record<string, string>),
      'Play': 'تشغيل الفيديو',
      'Pause': 'إيقاف الفيديو',
      'Mute': 'كتم الصوت',
      'Unmute': 'إلغاء كتم الصوت',
      'Fullscreen': 'ملء الشاشة',
      'Exit Fullscreen': 'الخروج من ملء الشاشة',
      'Captions': 'إظهار التسميات التوضيحية',
      'Subtitles': 'إظهار الترجمة',
      // videojs-hls-quality-selector localizes these; the Arabic pack has neither
      'Auto': 'تلقائي',
      'Quality': 'الجودة'
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
            displayCurrentQuality: true,
            placementIndex: qualityButtonPlacementIndex(player)
          });
        } catch (error) {
          logger.warn('HLS quality selector plugin failed to initialize:', error);
        }
      } else {
        logger.warn('HLS quality selector plugin not available');
      }
      if (player) trackQualityLevelAvailability(player);
      // Quality, captions and speed menus open on click/tap only, never on hover
      if (player) setupClickOnlyMenus(player as unknown as Parameters<typeof setupClickOnlyMenus>[0]);
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
 * Control-bar index for the quality button: just before the remaining-time
 * display, as in production. The plugin's default ("second to last child")
 * drifts as more controls are added (captions, keyboard help) and pushed the
 * button after the time display. Returns undefined to keep the plugin default
 * when there is no remaining-time display.
 */
export function qualityButtonPlacementIndex(player: Player): number | undefined {
  const controlBar = (player as Player & {
    controlBar?: { children: () => unknown[]; getChild: (name: string) => unknown };
  }).controlBar;
  if (!controlBar) return undefined;
  const index = controlBar.children().indexOf(controlBar.getChild('remainingTimeDisplay'));
  return index >= 0 ? index : undefined;
}

export const NO_QUALITY_LEVELS_CLASS = 'vjs-no-quality-levels';

/**
 * Hides the quality menu while the stream exposes no renditions. Safari/iOS
 * play HLS natively, so the quality-levels list stays empty and the button
 * opened an empty "Quality" menu. The class is toggled as levels come and go.
 */
export function trackQualityLevelAvailability(player: Player): void {
  const qualityLevels = (player as Player & { qualityLevels?: () => QualityLevelList }).qualityLevels?.();
  const update = () => {
    const empty = !qualityLevels || qualityLevels.length === 0;
    player.el()?.classList.toggle(NO_QUALITY_LEVELS_CLASS, empty);
  };
  update();
  qualityLevels?.on('addqualitylevel', update);
  qualityLevels?.on('removequalitylevel', update);
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
