/**
 * Video Player Internationalization Types
 *
 * Type definitions for the video player i18n system.
 * Ensures type safety and completeness across all translations.
 */

/**
 * Video error types for i18n translations
 *
 * **Design Decision**: This type is intentionally separate from VideoErrorType
 * in error-handler.ts (which uses enum values like 'NETWORK_ERROR').
 *
 * **Rationale**:
 * 1. **Separation of Concerns**: error-handler.ts defines error categorization
 *    for the video playback system, while i18n defines user-facing labels.
 * 2. **Flexibility**: i18n can have more granular error types (e.g., 'drm', 'buffer')
 *    that don't exist in error-handler, or collapse multiple technical errors
 *    into a single user-facing message.
 * 3. **Naming Conventions**: i18n uses lowercase string literals for consistency
 *    with translation keys, while error-handler uses UPPER_CASE enum values
 *    for TypeScript constants.
 *
 * **Integration**: Use `mapErrorTypeToI18n()` utility to convert between
 * error-handler enum types and i18n string literals.
 *
 * @see {@link ../../error-handler.ts} for VideoErrorHandler enum
 * @see {@link ../utils/mapErrorType.ts} for mapping utility
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
