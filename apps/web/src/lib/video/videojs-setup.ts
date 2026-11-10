import videojs, { type Player, type PlayerOptions } from 'video.js';
// Video.js 8 bundles @videojs/http-streaming (VHS) and the quality-levels
// plugin. Importing them again registered both twice ("A plugin named
// qualityLevels already exists") and added their code to the bundle again.
// Quality is chosen in the settings menu (settings-model.ts), which keeps the
// behaviour of the videojs-hls-quality-selector menu it replaces.
import videojsArabic from 'video.js/dist/lang/ar.json';
import { logger } from '@/lib/logger-client';
import type { QualityLevelList } from '@/lib/video/videojs';
import { setupClickOnlyMenus } from '@/lib/video/menu-interaction';
import { applyBuiltInIcons, layerCaptionSettings, registerFanousComponents, syncCustomCaptions, type ChromeCopy } from '@/lib/video/components';
import { AR_TRANSLATIONS, EN_TRANSLATIONS } from '@/lib/video/i18n/translations';
import { guardNativePipToggle } from '@/lib/video/native-pip-toggle';
import { syncDurationWithPlaylist } from '@/lib/video/live-state';
import { keepSeekBarOnPlayhead } from '@/lib/video/seek-bar-sync';



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
    nativeTextTracks: false
    // HLS: VHS's defaults apply (it reads `html5.vhs`; the `hls` options that stood here were never
    // read). Browsers without native HLS play through VHS with the Quality menu; Safari plays
    // natively and adapts quality itself, so the menu hides its Quality row there.
  },
  // Live streams with a DVR window get a seekable progress bar and the live badge
  liveui: true,
  // Control bar (docs/specs/VIDEO-PLAYER.md section 4): full-width progress on
  // its own row (CSS), then play, next, volume and time at the start, and
  // captions, settings, picture in picture, theatre and fullscreen at the end.
  controlBar: {
    children: [
      'progressControl',
      'playToggle',
      'fanousNextButton',
      'volumePanel',
      'currentTimeDisplay',
      'timeDivider',
      'durationDisplay',
      'fanousLiveBadge',
      'customControlSpacer',
      'fanousCaptionsToggle',
      'fanousSettingsButton',
      'pictureInPictureToggle',
      'fanousTheatreToggle',
      'fullscreenToggle'
    ],
    volumePanel: {
      // The slider always keeps its space, so neighbours never move under the pointer
      inline: true
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
    logger.debug('[createVideoPlayer] Options received:', options);
    logger.debug('[createVideoPlayer] Poster URL:', options.poster);

    registerFanousComponents();
    const copy = chromeCopy(options.language === 'ar' ? 'ar' : 'en');
    const base = VIDEO_JS_OPTIONS.controlBar as Record<string, unknown>;
    player = videojs(element, {
      ...VIDEO_JS_OPTIONS,
      ...options,
      controlBar: {
        ...base,
        fanousNextButton: { copy },
        fanousLiveBadge: { copy },
        fanousCaptionsToggle: { copy },
        fanousSettingsButton: { copy },
        fanousTheatreToggle: { copy },
        ...((options.controlBar as Record<string, unknown> | undefined) ?? {})
      }
    });
    // The skin (player-skin.css) is scoped to this class
    player.el()?.classList.add('vjs-fanous');
    applyBuiltInIcons(player.el());

    player.ready(() => {
      if (player) applyBuiltInIcons(player.el());
      if (player) trackQualityLevelAvailability(player);
      if (player) {
        syncCustomCaptions(player as unknown as Parameters<typeof syncCustomCaptions>[0]);
        layerCaptionSettings(player as unknown as Parameters<typeof layerCaptionSettings>[0]);
        // Firefox's own Picture-in-Picture toggle would take presses meant for the controls
        const releasePipToggle = guardNativePipToggle(player.el()?.querySelector('video'));
        player.on('dispose', releasePipToggle);
        // Firefox reports no duration before metadata, so a live stream read as a 0:00 video
        const stopDurationSync = syncDurationWithPlaylist(player as unknown as Parameters<typeof syncDurationWithPlaylist>[0]);
        player.on('dispose', stopDurationSync);
        // Video.js drops the bar's redraw for a seek made just after a pause
        const stopSeekBarSync = keepSeekBarOnPlayhead(player as unknown as Parameters<typeof keepSeekBarOnPlayhead>[0]);
        player.on('dispose', stopSeekBarSync);
      }
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

/** Control labels for the player's own components, in the player's language. */
export function chromeCopy(lang: 'en' | 'ar'): ChromeCopy {
  const t = lang === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS;
  return {
    next: t.chrome.next,
    theatre: t.chrome.theatre,
    exitTheatre: t.chrome.exitTheatre,
    captions: t.controls.captions,
    settings: t.controls.settings,
    live: t.chrome.live,
    goToLive: t.chrome.goToLive,
    behind: t.chrome.behind,
  };
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
