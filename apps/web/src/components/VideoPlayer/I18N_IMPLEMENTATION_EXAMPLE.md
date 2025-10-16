# Video Player i18n - Complete Implementation Example

This document shows the **exact code** to implement Phase 1 of the i18n system.

## Complete File Contents

### 1. Type Definitions

**File**: `apps/web/src/lib/video/i18n/types.ts`

```typescript
/**
 * Video Player Internationalization Types
 *
 * Defines the structure for all video player translations.
 * All language files must implement VideoPlayerTranslations interface.
 */

import { VideoErrorType } from '../error-handler';

/**
 * Supported languages for video player
 *
 * Add new languages here as they are implemented
 */
export type SupportedLanguage = 'en' | 'ar';

/**
 * Complete translation structure for video player
 *
 * All language files must provide translations for every key
 * TypeScript will enforce completeness at compile time
 */
export interface VideoPlayerTranslations {
  /**
   * Player status messages
   */
  player: {
    /** Shown while video player is loading */
    loading: string;
    /** Announced when video player is ready */
    ready: string;
    /** Shown while video is buffering */
    buffering: string;
    /** Generic error message */
    error: string;
  };

  /**
   * Accessibility labels for screen readers
   */
  accessibility: {
    /** Main video player element label */
    videoPlayer: string;
    /** Play button label */
    playButton: string;
    /** Pause button label */
    pauseButton: string;
    /** Mute button label */
    muteButton: string;
    /** Unmute button label */
    unmuteButton: string;
    /** Enter fullscreen button label */
    fullscreenButton: string;
    /** Exit fullscreen button label */
    exitFullscreenButton: string;
    /** Volume slider label */
    volumeSlider: string;
    /** Video progress bar label */
    progressBar: string;
    /** Seek position slider label */
    seekSlider: string;
  };

  /**
   * Error messages and labels
   */
  errors: {
    /** Error titles by type */
    title: Record<VideoErrorType, string>;
    /** Error descriptions by type */
    description: Record<VideoErrorType, string>;
    /** Generic retry button text */
    retryButton: string;
    /** Fallback button text by error type */
    fallbackButton: Record<VideoErrorType, string>;
    /** Error detail explanations by type */
    details: Record<VideoErrorType, string>;

    /** Labels for error detail display */
    detailLabels: {
      /** "Type:" label */
      type: string;
      /** "Message:" label */
      message: string;
      /** "Code:" label */
      code: string;
      /** "Time:" label */
      time: string;
      /** "Severity:" label */
      severity: string;
      /** "Error Details" section title */
      detailsTitle: string;
    };
  };

  /**
   * Video control labels
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
```

### 2. English Translations

**File**: `apps/web/src/lib/video/i18n/translations/en.ts`

```typescript
/**
 * English translations for video player
 */

import { VideoErrorType } from '../../error-handler';
import type { VideoPlayerTranslations } from '../types';

export const EN_TRANSLATIONS: VideoPlayerTranslations = {
  player: {
    loading: 'Loading video player...',
    ready: 'Video player loaded and ready',
    buffering: 'Buffering...',
    error: 'An error occurred',
  },

  accessibility: {
    videoPlayer: 'Video player',
    playButton: 'Play video',
    pauseButton: 'Pause video',
    muteButton: 'Mute audio',
    unmuteButton: 'Unmute audio',
    fullscreenButton: 'Enter fullscreen mode',
    exitFullscreenButton: 'Exit fullscreen mode',
    volumeSlider: 'Volume control',
    progressBar: 'Video progress',
    seekSlider: 'Seek video position',
  },

  errors: {
    title: {
      [VideoErrorType.NETWORK_ERROR]: 'Network Error',
      [VideoErrorType.FORMAT_ERROR]: 'Format Not Supported',
      [VideoErrorType.DECODE_ERROR]: 'Playback Error',
      [VideoErrorType.HLS_ERROR]: 'Streaming Error',
      [VideoErrorType.TIMEOUT_ERROR]: 'Loading Timeout',
      [VideoErrorType.UNKNOWN_ERROR]: 'Playback Error',
    },
    description: {
      [VideoErrorType.NETWORK_ERROR]:
        'Unable to connect to the video server. Please check your internet connection.',
      [VideoErrorType.FORMAT_ERROR]:
        'Your browser does not support this video format.',
      [VideoErrorType.DECODE_ERROR]:
        'Unable to decode the video. The file may be corrupted.',
      [VideoErrorType.HLS_ERROR]:
        'Unable to load the video stream. Switching to alternative format.',
      [VideoErrorType.TIMEOUT_ERROR]:
        'The video took too long to load. Please try again.',
      [VideoErrorType.UNKNOWN_ERROR]:
        'An unexpected error occurred. Please try again.',
    },
    retryButton: 'Retry',
    fallbackButton: {
      [VideoErrorType.NETWORK_ERROR]: 'Try Alternative Quality',
      [VideoErrorType.FORMAT_ERROR]: 'Try Alternative Format',
      [VideoErrorType.DECODE_ERROR]: 'Try Alternative Quality',
      [VideoErrorType.HLS_ERROR]: 'Use Direct Download',
      [VideoErrorType.TIMEOUT_ERROR]: 'Try Lower Quality',
      [VideoErrorType.UNKNOWN_ERROR]: 'Reload Page',
    },
    details: {
      [VideoErrorType.NETWORK_ERROR]:
        'This error usually occurs due to network connectivity issues.',
      [VideoErrorType.FORMAT_ERROR]:
        'Please try using a different browser or update your current browser.',
      [VideoErrorType.DECODE_ERROR]:
        'This error indicates a problem with the video encoding.',
      [VideoErrorType.HLS_ERROR]:
        'HLS streaming is not available. Trying MP4 format instead.',
      [VideoErrorType.TIMEOUT_ERROR]:
        'This may be due to slow network connection or server issues.',
      [VideoErrorType.UNKNOWN_ERROR]:
        'If the problem persists, please contact support.',
    },
    detailLabels: {
      type: 'Type:',
      message: 'Message:',
      code: 'Code:',
      time: 'Time:',
      severity: 'Severity:',
      detailsTitle: 'Error Details',
    },
  },

  controls: {
    play: 'Play',
    pause: 'Pause',
    mute: 'Mute',
    unmute: 'Unmute',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit Fullscreen',
    settings: 'Settings',
    captions: 'Captions',
    quality: 'Quality',
    speed: 'Speed',
    volume: 'Volume',
  },

  quality: {
    auto: 'Auto',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    labels: {
      '2160p': '2160p (4K Ultra HD)',
      '1080p': '1080p (Full HD)',
      '720p': '720p (HD)',
      '480p': '480p (SD)',
      '360p': '360p (Low)',
      '240p': '240p (Very Low)',
    },
  },

  speed: {
    normal: 'Normal',
    labels: {
      '0.25': '0.25x (Very Slow)',
      '0.5': '0.5x (Slow)',
      '0.75': '0.75x',
      '1': '1x (Normal)',
      '1.25': '1.25x',
      '1.5': '1.5x',
      '1.75': '1.75x',
      '2': '2x (Fast)',
    },
  },

  time: {
    hours: 'hours',
    minutes: 'minutes',
    seconds: 'seconds',
    live: 'LIVE',
    elapsed: 'Elapsed',
    remaining: 'Remaining',
  },
};
```

### 3. Arabic Translations

**File**: `apps/web/src/lib/video/i18n/translations/ar.ts`

```typescript
/**
 * Arabic translations for video player
 */

import { VideoErrorType } from '../../error-handler';
import type { VideoPlayerTranslations } from '../types';

export const AR_TRANSLATIONS: VideoPlayerTranslations = {
  player: {
    loading: 'جاري تحميل مشغل الفيديو...',
    ready: 'مشغل الفيديو جاهز',
    buffering: 'جاري التخزين المؤقت...',
    error: 'حدث خطأ',
  },

  accessibility: {
    videoPlayer: 'مشغل الفيديو',
    playButton: 'تشغيل الفيديو',
    pauseButton: 'إيقاف الفيديو مؤقتاً',
    muteButton: 'كتم الصوت',
    unmuteButton: 'إلغاء كتم الصوت',
    fullscreenButton: 'الدخول في وضع ملء الشاشة',
    exitFullscreenButton: 'الخروج من وضع ملء الشاشة',
    volumeSlider: 'التحكم في مستوى الصوت',
    progressBar: 'تقدم الفيديو',
    seekSlider: 'البحث عن موضع في الفيديو',
  },

  errors: {
    title: {
      [VideoErrorType.NETWORK_ERROR]: 'خطأ في الشبكة',
      [VideoErrorType.FORMAT_ERROR]: 'التنسيق غير مدعوم',
      [VideoErrorType.DECODE_ERROR]: 'خطأ في التشغيل',
      [VideoErrorType.HLS_ERROR]: 'خطأ في البث',
      [VideoErrorType.TIMEOUT_ERROR]: 'انتهت مهلة التحميل',
      [VideoErrorType.UNKNOWN_ERROR]: 'خطأ في التشغيل',
    },
    description: {
      [VideoErrorType.NETWORK_ERROR]:
        'غير قادر على الاتصال بخادم الفيديو. يرجى التحقق من اتصالك بالإنترنت.',
      [VideoErrorType.FORMAT_ERROR]:
        'متصفحك لا يدعم تنسيق الفيديو هذا.',
      [VideoErrorType.DECODE_ERROR]:
        'غير قادر على فك تشفير الفيديو. قد يكون الملف تالفاً.',
      [VideoErrorType.HLS_ERROR]:
        'غير قادر على تحميل البث المباشر. جاري التبديل إلى تنسيق بديل.',
      [VideoErrorType.TIMEOUT_ERROR]:
        'استغرق تحميل الفيديو وقتاً طويلاً. يرجى المحاولة مرة أخرى.',
      [VideoErrorType.UNKNOWN_ERROR]:
        'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.',
    },
    retryButton: 'إعادة المحاولة',
    fallbackButton: {
      [VideoErrorType.NETWORK_ERROR]: 'جرب جودة بديلة',
      [VideoErrorType.FORMAT_ERROR]: 'جرب تنسيق بديل',
      [VideoErrorType.DECODE_ERROR]: 'جرب جودة بديلة',
      [VideoErrorType.HLS_ERROR]: 'استخدم التنزيل المباشر',
      [VideoErrorType.TIMEOUT_ERROR]: 'جرب جودة أقل',
      [VideoErrorType.UNKNOWN_ERROR]: 'إعادة تحميل الصفحة',
    },
    details: {
      [VideoErrorType.NETWORK_ERROR]:
        'يحدث هذا الخطأ عادة بسبب مشاكل في الاتصال بالشبكة.',
      [VideoErrorType.FORMAT_ERROR]:
        'يرجى محاولة استخدام متصفح مختلف أو تحديث متصفحك الحالي.',
      [VideoErrorType.DECODE_ERROR]:
        'يشير هذا الخطأ إلى مشكلة في ترميز الفيديو.',
      [VideoErrorType.HLS_ERROR]:
        'بث HLS غير متاح. جاري المحاولة بتنسيق MP4 بدلاً من ذلك.',
      [VideoErrorType.TIMEOUT_ERROR]:
        'قد يكون هذا بسبب بطء الاتصال بالشبكة أو مشاكل في الخادم.',
      [VideoErrorType.UNKNOWN_ERROR]:
        'إذا استمرت المشكلة، يرجى الاتصال بالدعم.',
    },
    detailLabels: {
      type: 'النوع:',
      message: 'الرسالة:',
      code: 'الكود:',
      time: 'الوقت:',
      severity: 'الخطورة:',
      detailsTitle: 'تفاصيل الخطأ',
    },
  },

  controls: {
    play: 'تشغيل',
    pause: 'إيقاف مؤقت',
    mute: 'كتم',
    unmute: 'إلغاء الكتم',
    fullscreen: 'ملء الشاشة',
    exitFullscreen: 'الخروج من ملء الشاشة',
    settings: 'الإعدادات',
    captions: 'الترجمة',
    quality: 'الجودة',
    speed: 'السرعة',
    volume: 'مستوى الصوت',
  },

  quality: {
    auto: 'تلقائي',
    high: 'عالية',
    medium: 'متوسطة',
    low: 'منخفضة',
    labels: {
      '2160p': '٢١٦٠بكسل (4K فائق الدقة)',
      '1080p': '١٠٨٠بكسل (عالي الدقة الكامل)',
      '720p': '٧٢٠بكسل (عالي الدقة)',
      '480p': '٤٨٠بكسل (دقة قياسية)',
      '360p': '٣٦٠بكسل (منخفضة)',
      '240p': '٢٤٠بكسل (منخفضة جداً)',
    },
  },

  speed: {
    normal: 'عادية',
    labels: {
      '0.25': '٠.٢٥× (بطيء جداً)',
      '0.5': '٠.٥× (بطيء)',
      '0.75': '٠.٧٥×',
      '1': '١× (عادية)',
      '1.25': '١.٢٥×',
      '1.5': '١.٥×',
      '1.75': '١.٧٥×',
      '2': '٢× (سريع)',
    },
  },

  time: {
    hours: 'ساعات',
    minutes: 'دقائق',
    seconds: 'ثواني',
    live: 'مباشر',
    elapsed: 'انقضى',
    remaining: 'متبقي',
  },
};
```

### 4. Translation Barrel Export

**File**: `apps/web/src/lib/video/i18n/translations/index.ts`

```typescript
/**
 * Translation exports
 */

export { EN_TRANSLATIONS } from './en';
export { AR_TRANSLATIONS } from './ar';
```

### 5. Translation Getter Utility

**File**: `apps/web/src/lib/video/i18n/utils/getTranslations.ts`

```typescript
/**
 * Translation loader utility
 *
 * Provides translations for a given language with fallback to English
 */

import type { SupportedLanguage, VideoPlayerTranslations } from '../types';
import { EN_TRANSLATIONS, AR_TRANSLATIONS } from '../translations';

/**
 * Translation registry mapping language codes to translation objects
 */
const TRANSLATIONS: Record<SupportedLanguage, VideoPlayerTranslations> = {
  en: EN_TRANSLATIONS,
  ar: AR_TRANSLATIONS,
};

/**
 * Get translations for specified language
 *
 * @param lang - Language code ('en' or 'ar')
 * @returns Complete translation object for the language
 * @throws {Error} If language is not supported (development only)
 *
 * @example
 * ```typescript
 * const translations = getTranslations('ar');
 * console.log(translations.player.loading); // "جاري تحميل مشغل الفيديو..."
 * ```
 */
export function getTranslations(lang: SupportedLanguage): VideoPlayerTranslations {
  const translations = TRANSLATIONS[lang];

  if (!translations) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[i18n] Translations not found for language: ${lang}, falling back to English`);
    }
    return TRANSLATIONS.en;
  }

  return translations;
}

/**
 * Check if a language is supported
 *
 * @param lang - Language code to check
 * @returns True if language is supported
 *
 * @example
 * ```typescript
 * isLanguageSupported('ar'); // true
 * isLanguageSupported('fr'); // false
 * ```
 */
export function isLanguageSupported(lang: string): lang is SupportedLanguage {
  return lang in TRANSLATIONS;
}

/**
 * Get list of all supported language codes
 *
 * @returns Array of supported language codes
 *
 * @example
 * ```typescript
 * getSupportedLanguages(); // ['en', 'ar']
 * ```
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return Object.keys(TRANSLATIONS) as SupportedLanguage[];
}
```

### 6. RTL Detection Utility

**File**: `apps/web/src/lib/video/i18n/utils/isRTL.ts`

```typescript
/**
 * RTL language detection utility
 */

import type { SupportedLanguage } from '../types';

/**
 * Languages that use right-to-left (RTL) writing direction
 */
const RTL_LANGUAGES: SupportedLanguage[] = ['ar'];

/**
 * Check if language uses RTL writing direction
 *
 * @param lang - Language code
 * @returns True if language is RTL
 *
 * @example
 * ```typescript
 * isRTL('ar'); // true
 * isRTL('en'); // false
 * ```
 */
export function isRTL(lang: SupportedLanguage): boolean {
  return RTL_LANGUAGES.includes(lang);
}

/**
 * Get text direction for language
 *
 * @param lang - Language code
 * @returns 'rtl' or 'ltr'
 *
 * @example
 * ```typescript
 * getDirection('ar'); // 'rtl'
 * getDirection('en'); // 'ltr'
 * ```
 */
export function getDirection(lang: SupportedLanguage): 'rtl' | 'ltr' {
  return isRTL(lang) ? 'rtl' : 'ltr';
}
```

### 7. Utils Barrel Export

**File**: `apps/web/src/lib/video/i18n/utils/index.ts`

```typescript
/**
 * Utility function exports
 */

export { getTranslations, isLanguageSupported, getSupportedLanguages } from './getTranslations';
export { isRTL, getDirection } from './isRTL';
```

### 8. React Hook

**File**: `apps/web/src/lib/video/i18n/hooks/useVideoPlayerI18n.ts`

```typescript
/**
 * React hook for video player internationalization
 */

import { useMemo } from 'react';
import type { SupportedLanguage, VideoPlayerTranslations } from '../types';
import { getTranslations } from '../utils/getTranslations';
import { isRTL } from '../utils/isRTL';

/**
 * Hook return value
 */
export interface UseVideoPlayerI18nResult {
  /** Complete translation object */
  t: VideoPlayerTranslations;
  /** Current language code */
  lang: SupportedLanguage;
  /** Whether language is right-to-left */
  isRTL: boolean;
  /** Text direction ('rtl' or 'ltr') */
  dir: 'rtl' | 'ltr';
}

/**
 * Hook for video player internationalization
 *
 * Provides translations and RTL information for the specified language.
 * Memoized to prevent unnecessary re-computation.
 *
 * @param lang - Language code (defaults to 'en')
 * @returns Translation object and language metadata
 *
 * @example
 * ```typescript
 * function MyComponent({ lang = 'en' }) {
 *   const { t, isRTL, dir } = useVideoPlayerI18n(lang);
 *
 *   return (
 *     <div dir={dir}>
 *       <h1>{t.player.loading}</h1>
 *     </div>
 *   );
 * }
 * ```
 */
export function useVideoPlayerI18n(
  lang: SupportedLanguage = 'en'
): UseVideoPlayerI18nResult {
  // Memoize translations to prevent unnecessary re-renders
  const translations = useMemo(() => getTranslations(lang), [lang]);

  // Memoize RTL detection
  const isRTLLanguage = useMemo(() => isRTL(lang), [lang]);

  // Memoize direction
  const direction = useMemo(() => (isRTLLanguage ? 'rtl' : 'ltr'), [isRTLLanguage]);

  return {
    t: translations,
    lang,
    isRTL: isRTLLanguage,
    dir: direction,
  };
}
```

### 9. Hooks Barrel Export

**File**: `apps/web/src/lib/video/i18n/hooks/index.ts`

```typescript
/**
 * React hooks exports
 */

export { useVideoPlayerI18n } from './useVideoPlayerI18n';
export type { UseVideoPlayerI18nResult } from './useVideoPlayerI18n';
```

### 10. Main Index Export

**File**: `apps/web/src/lib/video/i18n/index.ts`

```typescript
/**
 * Video Player Internationalization
 *
 * Main export file for i18n functionality
 */

// Types
export type { SupportedLanguage, VideoPlayerTranslations } from './types';

// React hooks
export { useVideoPlayerI18n } from './hooks';
export type { UseVideoPlayerI18nResult } from './hooks';

// Utilities
export {
  getTranslations,
  isLanguageSupported,
  getSupportedLanguages,
  isRTL,
  getDirection,
} from './utils';

// Translations (for testing or direct access)
export { EN_TRANSLATIONS, AR_TRANSLATIONS } from './translations';
```

## Updated Component Example

### CustomVideoPlayer.tsx (Updated)

```typescript
// ONLY the changes needed - full file not shown

import { useVideoPlayerI18n } from '@/lib/video/i18n'; // ADD THIS

export default function CustomVideoPlayer({
  videoId,
  userId,
  sources,
  poster,
  controls = true,
  autoplay = false,
  enableAnalytics = true,
  className = '',
  ariaLabel, // REMOVE DEFAULT VALUE
  lang = 'en',
  onError,
  onSourceChange,
}: CustomVideoPlayerProps) {
  // ADD THIS HOOK
  const { t, dir } = useVideoPlayerI18n(lang);

  // ... existing code ...

  return (
    <div className={`custom-video-player ${className}`} dir={dir}> {/* ADD dir */}
      {/* UPDATE THIS SECTION */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {playerReady
          ? t.player.ready          // CHANGED
          : t.player.loading        // CHANGED
        }
      </div>

      {/* Video player container */}
      <div data-vjs-player>
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered"
          playsInline
          aria-label={ariaLabel || t.accessibility.videoPlayer} // CHANGED
          tabIndex={0}
        />
      </div>
    </div>
  );
}
```

### ErrorDisplay.tsx (Updated)

```typescript
// ONLY the changes needed - full file not shown

import { useVideoPlayerI18n } from '@/lib/video/i18n'; // ADD THIS

export function ErrorDisplay({
  error,
  lang,
  onRetry,
  onFallback,
  showDetails = false,
  className = '',
}: ErrorDisplayProps): JSX.Element {
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);

  // ADD THIS HOOK
  const { t, dir } = useVideoPlayerI18n(lang);

  return (
    <div className={`${baseClasses} ${className}`} dir={dir}> {/* ADD dir */}
      {errorIcon}

      <h2 className="text-2xl font-bold mb-2 text-center">
        {t.errors.title[error.type]} {/* CHANGED */}
      </h2>

      <p className="text-gray-300 mb-6 text-center max-w-md">
        {t.errors.description[error.type]} {/* CHANGED */}
      </p>

      <div className="flex gap-4 mb-4 flex-wrap justify-center">
        {onRetry && error.retryable && (
          <button
            onClick={onRetry}
            className="..."
            aria-label={t.errors.retryButton} {/* CHANGED */}
          >
            {/* ... icon ... */}
            {t.errors.retryButton} {/* CHANGED */}
          </button>
        )}

        {onFallback && error.fallbackAvailable && (
          <button
            onClick={onFallback}
            className="..."
            aria-label={t.errors.fallbackButton[error.type]} {/* CHANGED */}
          >
            {/* ... icon ... */}
            {t.errors.fallbackButton[error.type]} {/* CHANGED */}
          </button>
        )}
      </div>

      {showDetails && (
        <div className="w-full max-w-2xl mt-4">
          <button
            onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
            className="..."
            aria-expanded={isDetailsExpanded}
          >
            {/* ... icon ... */}
            {t.errors.detailLabels.detailsTitle} {/* CHANGED */}
          </button>

          {isDetailsExpanded && (
            <div className="...">
              <div className="mb-2">
                <span className="font-semibold text-gray-200">
                  {t.errors.detailLabels.type} {/* CHANGED */}
                </span>{' '}
                {error.type}
              </div>

              <div className="mb-2">
                <span className="font-semibold text-gray-200">
                  {t.errors.detailLabels.message} {/* CHANGED */}
                </span>{' '}
                {error.message}
              </div>

              {error.code && (
                <div className="mb-2">
                  <span className="font-semibold text-gray-200">
                    {t.errors.detailLabels.code} {/* CHANGED */}
                  </span>{' '}
                  {error.code}
                </div>
              )}

              <div className="mb-2">
                <span className="font-semibold text-gray-200">
                  {t.errors.detailLabels.time} {/* CHANGED */}
                </span>{' '}
                {new Date(error.timestamp).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')}
              </div>

              <div className="pt-2 mt-2 border-t border-gray-700">
                {t.errors.details[error.type]} {/* CHANGED */}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

## Testing

### Unit Tests

**File**: `apps/web/src/lib/video/i18n/__tests__/i18n.test.ts`

```typescript
import { getTranslations, isLanguageSupported, getSupportedLanguages, isRTL } from '../index';

describe('Video Player i18n', () => {
  describe('getTranslations', () => {
    it('should return English translations', () => {
      const t = getTranslations('en');
      expect(t.player.loading).toBe('Loading video player...');
      expect(t.player.ready).toBe('Video player loaded and ready');
    });

    it('should return Arabic translations', () => {
      const t = getTranslations('ar');
      expect(t.player.loading).toBe('جاري تحميل مشغل الفيديو...');
      expect(t.player.ready).toBe('مشغل الفيديو جاهز');
    });

    it('should fallback to English for unsupported language', () => {
      // @ts-expect-error Testing unsupported language
      const t = getTranslations('fr');
      expect(t.player.loading).toBe('Loading video player...');
    });
  });

  describe('isLanguageSupported', () => {
    it('should return true for supported languages', () => {
      expect(isLanguageSupported('en')).toBe(true);
      expect(isLanguageSupported('ar')).toBe(true);
    });

    it('should return false for unsupported languages', () => {
      expect(isLanguageSupported('fr')).toBe(false);
      expect(isLanguageSupported('es')).toBe(false);
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return array of supported languages', () => {
      const languages = getSupportedLanguages();
      expect(languages).toEqual(['en', 'ar']);
    });
  });

  describe('isRTL', () => {
    it('should return true for Arabic', () => {
      expect(isRTL('ar')).toBe(true);
    });

    it('should return false for English', () => {
      expect(isRTL('en')).toBe(false);
    });
  });
});
```

### React Hook Tests

**File**: `apps/web/src/lib/video/i18n/__tests__/useVideoPlayerI18n.test.ts`

```typescript
import { renderHook } from '@testing-library/react';
import { useVideoPlayerI18n } from '../hooks/useVideoPlayerI18n';

describe('useVideoPlayerI18n', () => {
  it('should return English translations by default', () => {
    const { result } = renderHook(() => useVideoPlayerI18n());

    expect(result.current.lang).toBe('en');
    expect(result.current.isRTL).toBe(false);
    expect(result.current.dir).toBe('ltr');
    expect(result.current.t.player.loading).toBe('Loading video player...');
  });

  it('should return Arabic translations', () => {
    const { result } = renderHook(() => useVideoPlayerI18n('ar'));

    expect(result.current.lang).toBe('ar');
    expect(result.current.isRTL).toBe(true);
    expect(result.current.dir).toBe('rtl');
    expect(result.current.t.player.loading).toBe('جاري تحميل مشغل الفيديو...');
  });

  it('should memoize translations', () => {
    const { result, rerender } = renderHook(
      ({ lang }) => useVideoPlayerI18n(lang),
      { initialProps: { lang: 'en' as const } }
    );

    const firstTranslations = result.current.t;
    rerender({ lang: 'en' });
    expect(result.current.t).toBe(firstTranslations); // Same reference
  });

  it('should update when language changes', () => {
    const { result, rerender } = renderHook(
      ({ lang }) => useVideoPlayerI18n(lang),
      { initialProps: { lang: 'en' as const } }
    );

    expect(result.current.lang).toBe('en');

    rerender({ lang: 'ar' });
    expect(result.current.lang).toBe('ar');
    expect(result.current.isRTL).toBe(true);
  });
});
```

## Implementation Checklist

- [ ] Create `apps/web/src/lib/video/i18n/types.ts`
- [ ] Create `apps/web/src/lib/video/i18n/translations/en.ts`
- [ ] Create `apps/web/src/lib/video/i18n/translations/ar.ts`
- [ ] Create `apps/web/src/lib/video/i18n/translations/index.ts`
- [ ] Create `apps/web/src/lib/video/i18n/utils/getTranslations.ts`
- [ ] Create `apps/web/src/lib/video/i18n/utils/isRTL.ts`
- [ ] Create `apps/web/src/lib/video/i18n/utils/index.ts`
- [ ] Create `apps/web/src/lib/video/i18n/hooks/useVideoPlayerI18n.ts`
- [ ] Create `apps/web/src/lib/video/i18n/hooks/index.ts`
- [ ] Create `apps/web/src/lib/video/i18n/index.ts`
- [ ] Update `CustomVideoPlayer.tsx`
- [ ] Update `ErrorDisplay.tsx`
- [ ] Create `apps/web/src/lib/video/i18n/__tests__/i18n.test.ts`
- [ ] Create `apps/web/src/lib/video/i18n/__tests__/useVideoPlayerI18n.test.ts`
- [ ] Update existing component tests
- [ ] Run `pnpm --filter @al-ummah/web type-check`
- [ ] Run `pnpm --filter @al-ummah/web test`
- [ ] Verify in browser with both English and Arabic

## Estimated Implementation Time

- Creating i18n files: **30-45 minutes**
- Updating components: **15-20 minutes**
- Writing tests: **20-30 minutes**
- Testing and verification: **15-20 minutes**

**Total**: **1.5-2 hours**

## Success Verification

Run these commands to verify success:

```bash
# Type check should pass
pnpm --filter @al-ummah/web type-check

# All tests should pass
pnpm --filter @al-ummah/web test

# No console errors in browser
pnpm --filter @al-ummah/web dev
# Then test at http://localhost:3000/en/* and /ar/*
```

Visual verification:
- ✅ English version shows English text
- ✅ Arabic version shows Arabic text
- ✅ Arabic version has RTL layout (dir="rtl")
- ✅ Error messages display in correct language
- ✅ Screen readers announce in correct language
- ✅ All accessibility labels are translated

## Next Steps After Implementation

1. Add deprecation warning to `error-messages.ts`
2. Update documentation
3. Create PR for review
4. Plan Phase 2 features (interpolation, pluralization)
5. Consider additional languages (Spanish, French, etc.)

---

This implementation provides a complete, production-ready i18n system with zero hardcoded strings! 🎉
