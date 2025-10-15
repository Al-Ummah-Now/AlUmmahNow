/**
 * Video Player Internationalization Types
 *
 * Type definitions for the video player i18n system.
 * Ensures type safety and completeness across all translations.
 */

/**
 * Video error types that require translations
 * Extended from VideoErrorHandler to include additional error categories
 */
export type VideoErrorType =
  | 'network'
  | 'format'
  | 'permission'
  | 'unknown'
  | 'timeout'
  | 'quota'
  | 'initialization'
  | 'drm'
  | 'playback'
  | 'buffer';

/**
 * Supported languages for video player UI
 */
export type SupportedLanguage = 'en' | 'ar';

/**
 * Complete translation structure for video player
 * All translations must implement this interface to ensure completeness
 */
export interface VideoPlayerTranslations {
  /**
   * Player status messages
   */
  player: {
    loading: string;
    ready: string;
    buffering: string;
    error: string;
  };

  /**
   * Accessibility labels for screen readers
   */
  accessibility: {
    videoPlayer: string;
    playButton: string;
    pauseButton: string;
    muteButton: string;
    unmuteButton: string;
    fullscreenButton: string;
    exitFullscreenButton: string;
    volumeSlider: string;
    progressBar: string;
    seekSlider: string;
  };

  /**
   * Error messages and labels
   */
  errors: {
    title: Record<VideoErrorType, string>;
    description: Record<VideoErrorType, string>;
    retryButton: string;
    fallbackButton: Record<VideoErrorType, string>;
    details: Record<VideoErrorType, string>;

    /**
     * Error detail labels
     */
    detailLabels: {
      type: string;
      message: string;
      code: string;
      time: string;
      severity: string;
      detailsTitle: string;
    };
  };

  /**
   * Player control labels
   */
  controls: {
    play: string;
    pause: string;
    mute: string;
    unmute: string;
    fullscreen: string;
    exitFullscreen: string;
    settings: string;
    captions: string;
    quality: string;
    speed: string;
    volume: string;
  };

  /**
   * Video quality settings
   */
  quality: {
    auto: string;
    high: string;
    medium: string;
    low: string;
    labels: {
      '2160p': string;
      '1080p': string;
      '720p': string;
      '480p': string;
      '360p': string;
      '240p': string;
    };
  };

  /**
   * Playback speed settings
   */
  speed: {
    normal: string;
    labels: {
      '0.25': string;
      '0.5': string;
      '0.75': string;
      '1': string;
      '1.25': string;
      '1.5': string;
      '1.75': string;
      '2': string;
    };
  };

  /**
   * Time-related labels
   */
  time: {
    hours: string;
    minutes: string;
    seconds: string;
    live: string;
    elapsed: string;
    remaining: string;
  };
}

/**
 * Result type for useVideoPlayerI18n hook
 */
export interface UseVideoPlayerI18nResult {
  /**
   * Complete translation object for current language
   */
  t: VideoPlayerTranslations;

  /**
   * Current language code
   */
  lang: SupportedLanguage;

  /**
   * Whether current language is RTL
   */
  isRTL: boolean;

  /**
   * Text direction ('ltr' or 'rtl')
   */
  dir: 'ltr' | 'rtl';
}
