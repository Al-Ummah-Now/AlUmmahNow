/**
 * Unit tests for Video Player i18n system
 */

import {
  getTranslations,
  isLanguageSupported,
  getSupportedLanguages,
  isRTL,
  getDirection,
} from '../index';
import { EN_TRANSLATIONS, AR_TRANSLATIONS } from '../translations';

describe('Video Player i18n', () => {
  describe('getTranslations', () => {
    it('should return English translations by default', () => {
      const translations = getTranslations();
      expect(translations.player.loading).toBe('Loading video player...');
      expect(translations.player.ready).toBe('Video player loaded and ready');
    });

    it('should return English translations for "en"', () => {
      const translations = getTranslations('en');
      expect(translations).toEqual(EN_TRANSLATIONS);
    });

    it('should return Arabic translations for "ar"', () => {
      const translations = getTranslations('ar');
      expect(translations).toEqual(AR_TRANSLATIONS);
      expect(translations.player.loading).toBe('جاري تحميل مشغّل المرئيات...');
      expect(translations.player.ready).toBe('تم تحميل مشغّل المرئيات وهو جاهز');
    });

    it('should have all required translation keys', () => {
      const enTranslations = getTranslations('en');
      const arTranslations = getTranslations('ar');

      // Check both have the same structure
      expect(Object.keys(enTranslations)).toEqual(Object.keys(arTranslations));

      // Check all main categories exist
      expect(enTranslations).toHaveProperty('player');
      expect(enTranslations).toHaveProperty('accessibility');
      expect(enTranslations).toHaveProperty('errors');
      expect(enTranslations).toHaveProperty('controls');
      expect(enTranslations).toHaveProperty('quality');
      expect(enTranslations).toHaveProperty('speed');
      expect(enTranslations).toHaveProperty('time');
    });

    it('should have all error types defined', () => {
      const translations = getTranslations('en');
      // Only 5 error types aligned with error-handler.ts
      // error-handler has 6 types that map to these 5 i18n categories:
      // NETWORK_ERROR → 'network'
      // FORMAT_ERROR → 'format'
      // DECODE_ERROR → 'playback'
      // HLS_ERROR → 'format' (treated as format/codec issue)
      // TIMEOUT_ERROR → 'timeout'
      // UNKNOWN_ERROR → 'unknown'
      const errorTypes = [
        'network',
        'format',
        'playback',
        'timeout',
        'unknown',
      ];

      errorTypes.forEach((type) => {
        expect(translations.errors.title).toHaveProperty(type);
        expect(translations.errors.description).toHaveProperty(type);
        expect(translations.errors.fallbackButton).toHaveProperty(type);
        expect(translations.errors.details).toHaveProperty(type);
      });
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
      expect(isLanguageSupported('de')).toBe(false);
      expect(isLanguageSupported('invalid')).toBe(false);
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return array of supported languages', () => {
      const languages = getSupportedLanguages();
      expect(languages).toEqual(['en', 'ar']);
      expect(languages).toHaveLength(2);
    });
  });

  describe('isRTL', () => {
    it('should return true for RTL languages', () => {
      expect(isRTL('ar')).toBe(true);
    });

    it('should return false for LTR languages', () => {
      expect(isRTL('en')).toBe(false);
    });
  });

  describe('getDirection', () => {
    it('should return "rtl" for Arabic', () => {
      expect(getDirection('ar')).toBe('rtl');
    });

    it('should return "ltr" for English', () => {
      expect(getDirection('en')).toBe('ltr');
    });
  });

  describe('Translation completeness', () => {
    it('should have matching keys in English and Arabic translations', () => {
      const compareObjects = (obj1: unknown, obj2: unknown, path = ''): void => {
        if (typeof obj1 !== 'object' || obj1 === null) return;
        if (typeof obj2 !== 'object' || obj2 === null) return;

        const keys1 = Object.keys(obj1 as Record<string, unknown>);
        const keys2 = Object.keys(obj2 as Record<string, unknown>);

        expect(keys1.sort()).toEqual(keys2.sort());

        keys1.forEach((key) => {
          const val1 = (obj1 as Record<string, unknown>)[key];
          const val2 = (obj2 as Record<string, unknown>)[key];
          const newPath = path ? `${path}.${key}` : key;

          // Each language has its own plural forms; only the table names must match
          if (path === 'pluralization') return;

          if (typeof val1 === 'object' && val1 !== null) {
            compareObjects(val1, val2, newPath);
          }
        });
      };

      compareObjects(EN_TRANSLATIONS, AR_TRANSLATIONS);
    });

    it('should have non-empty translation strings', () => {
      const checkStrings = (obj: unknown, lang: string, path = ''): void => {
        if (typeof obj !== 'object' || obj === null) return;

        Object.entries(obj as Record<string, unknown>).forEach(([key, value]) => {
          const newPath = path ? `${path}.${key}` : key;

          if (typeof value === 'string') {
            expect(value.trim()).not.toBe('');
          } else if (typeof value === 'object' && value !== null) {
            checkStrings(value, lang, newPath);
          }
        });
      };

      checkStrings(EN_TRANSLATIONS, 'en');
      checkStrings(AR_TRANSLATIONS, 'ar');
    });
  });

  describe('Accessibility labels', () => {
    it('should have all accessibility labels defined', () => {
      const enTranslations = getTranslations('en');
      const arTranslations = getTranslations('ar');

      const accessibilityKeys = [
        'videoPlayer',
        'playButton',
        'pauseButton',
        'muteButton',
        'unmuteButton',
        'fullscreenButton',
        'exitFullscreenButton',
        'volumeSlider',
        'progressBar',
        'seekSlider',
      ];

      accessibilityKeys.forEach((key) => {
        expect(enTranslations.accessibility).toHaveProperty(key);
        expect(arTranslations.accessibility).toHaveProperty(key);
      });
    });
  });

  describe('Error detail labels', () => {
    it('should have all error detail labels defined', () => {
      const translations = getTranslations('en');

      expect(translations.errors.detailLabels).toHaveProperty('type');
      expect(translations.errors.detailLabels).toHaveProperty('message');
      expect(translations.errors.detailLabels).toHaveProperty('code');
      expect(translations.errors.detailLabels).toHaveProperty('time');
      expect(translations.errors.detailLabels).toHaveProperty('severity');
      expect(translations.errors.detailLabels).toHaveProperty('detailsTitle');
    });

    it('should have localized error detail labels', () => {
      const enTranslations = getTranslations('en');
      const arTranslations = getTranslations('ar');

      expect(enTranslations.errors.detailLabels.type).toBe('Type:');
      expect(arTranslations.errors.detailLabels.type).toBe('النوع:');

      expect(enTranslations.errors.detailLabels.detailsTitle).toBe('Error Details');
      expect(arTranslations.errors.detailLabels.detailsTitle).toBe('تفاصيل الخطأ');
    });
  });
});
