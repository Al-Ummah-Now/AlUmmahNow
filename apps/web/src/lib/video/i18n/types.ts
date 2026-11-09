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
 * 2. **Flexibility**: i18n can collapse multiple technical errors into a single
 *    user-facing message (e.g., DECODE_ERROR and HLS_ERROR both map to 'playback').
 * 3. **Naming Conventions**: i18n uses lowercase string literals for consistency
 *    with translation keys, while error-handler uses UPPER_CASE enum values
 *    for TypeScript constants.
 *
 * **Integration**: Use `mapErrorTypeToI18n()` utility to convert between
 * error-handler enum types and i18n string literals.
 *
 * **Mapping**: error-handler.ts has 6 types that map to these 5 i18n categories:
 * - NETWORK_ERROR → 'network'
 * - FORMAT_ERROR → 'format'
 * - DECODE_ERROR → 'playback'
 * - HLS_ERROR → 'format' (treated as format/codec issue for user messaging)
 * - TIMEOUT_ERROR → 'timeout'
 * - UNKNOWN_ERROR → 'unknown'
 *
 * @see {@link ../../error-handler.ts} for VideoErrorHandler enum
 * @see {@link ../utils/mapErrorType.ts} for mapping utility
 */
export type VideoErrorType =
  | 'network'
  | 'format'
  | 'playback'
  | 'timeout'
  | 'unknown';

/**
 * Supported languages for video player UI
 */
export type SupportedLanguage = 'en' | 'ar';

/**
 * Complete translation structure for video player
 * All translations must implement this interface to ensure completeness
 */
/** Plural forms of one phrase; `other` is the required fallback. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export type PluralKey = 'videos' | 'comments' | 'views' | 'hours' | 'minutes' | 'seconds';

export interface VideoPlayerTranslations {
  /** Count-dependent phrases; see utils/plural.ts */
  pluralization: Record<PluralKey, PluralForms>;

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
  /** First-run hint about the touch gestures */
  gestures: {
    hint: string;
    dismiss: string;
  };

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
    currentTime: string;
    duration: string;
    qualityButton: string;
    keyboardHelpButton: string;
    keyboardHelpButtonTitle: string;
    /** Screen reader announcements (live region) */
    announcements: {
      playing: string;
      paused: string;
      muted: string;
      /** Contains a {volume} placeholder */
      volume: string;
      fullscreenOn: string;
      fullscreenOff: string;
      playbackError: string;
      buffering: string;
      readyToPlay: string;
    };
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
    pictureInPicture: string;
    exitPictureInPicture: string;
    pipNotAvailable: string;
    pipNotSupported: string;
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

  /**
   * Keyboard shortcuts
   */
  keyboard: {
    title: string;
    description: string;
    sections: {
      playback: string;
      seeking: string;
      volume: string;
      display: string;
      speed: string;
      navigation: string;
    };
    shortcuts: {
      playPause: { keys: string; description: string };
      rewind5: { keys: string; description: string };
      rewind10: { keys: string; description: string };
      forward5: { keys: string; description: string };
      forward10: { keys: string; description: string };
      volumeUp: { keys: string; description: string };
      volumeDown: { keys: string; description: string };
      mute: { keys: string; description: string };
      fullscreen: { keys: string; description: string };
      pip: { keys: string; description: string };
      speedDecrease: { keys: string; description: string };
      speedIncrease: { keys: string; description: string };
      seekPercent: { keys: string; description: string };
      help: { keys: string; description: string };
      tabNavigation: { keys: string; description: string };
      activate: { keys: string; description: string };
      closeDialog: { keys: string; description: string };
    };
    closeButton: string;
  };

  /**
   * Resume playback modal
   */
  resume: {
    /** Player pill that seeks back to 0 after resuming */
    startOverButton: string;
    /** Polite announcement when the player opens at a saved position; {time} = m:ss */
    resumingAt: string;
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

  /**
   * Text for a count in the current language, e.g. plural('videos', 5)
   */
  plural: (key: PluralKey, count: number) => string;
}
