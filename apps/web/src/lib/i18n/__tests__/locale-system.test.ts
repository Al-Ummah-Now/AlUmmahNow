/**
 * Locale System Tests
 *
 * Tests for the comprehensive locale management system
 */

import { describe, it, expect } from '@jest/globals';
import {
  LOCALES,
  DEFAULT_LOCALE,
  type SupportedLocale,
} from '../locales';
import {
  getLocaleConfig,
  getSupportedLocales,
  getSupportedLocaleCodes,
  isLocaleSupported,
  getValidLocale,
  getTextDirection,
  getRTLLocales,
  getLTRLocales,
} from '../utils/localeHelpers';
import { isRTL, getDirection } from '../utils/isRTL';

describe('Locale Configuration', () => {
  it('should have correct default locale', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('should have at least two locales (en and ar)', () => {
    expect(LOCALES.length).toBeGreaterThanOrEqual(2);
    const codes = LOCALES.map((l) => l.code);
    expect(codes).toContain('en');
    expect(codes).toContain('ar');
  });

  it('should have correct English locale config', () => {
    const en = LOCALES.find((l) => l.code === 'en');
    expect(en).toBeDefined();
    expect(en?.name).toBe('English');
    expect(en?.englishName).toBe('English');
    expect(en?.isRTL).toBe(false);
    expect(en?.isSupported).toBe(true);
    expect(en?.isComplete).toBe(true);
  });

  it('should have correct Arabic locale config', () => {
    const ar = LOCALES.find((l) => l.code === 'ar');
    expect(ar).toBeDefined();
    expect(ar?.name).toBe('العربية');
    expect(ar?.englishName).toBe('Arabic');
    expect(ar?.isRTL).toBe(true);
    expect(ar?.isSupported).toBe(true);
    expect(ar?.isComplete).toBe(true);
  });
});

describe('getLocaleConfig', () => {
  it('should return config for English', () => {
    const config = getLocaleConfig('en');
    expect(config).toBeDefined();
    expect(config?.code).toBe('en');
  });

  it('should return config for Arabic', () => {
    const config = getLocaleConfig('ar');
    expect(config).toBeDefined();
    expect(config?.code).toBe('ar');
  });

  it('should return null for unsupported locale', () => {
    const config = getLocaleConfig('fr');
    expect(config).toBeNull();
  });
});

describe('getSupportedLocales', () => {
  it('should return only supported locales', () => {
    const supported = getSupportedLocales();
    expect(supported.length).toBeGreaterThan(0);
    supported.forEach((locale) => {
      expect(locale.isSupported).toBe(true);
    });
  });

  it('should include en and ar', () => {
    const supported = getSupportedLocales();
    const codes = supported.map((l) => l.code);
    expect(codes).toContain('en');
    expect(codes).toContain('ar');
  });
});

describe('getSupportedLocaleCodes', () => {
  it('should return array of locale codes', () => {
    const codes = getSupportedLocaleCodes();
    expect(Array.isArray(codes)).toBe(true);
    expect(codes).toContain('en');
    expect(codes).toContain('ar');
  });
});

describe('isLocaleSupported', () => {
  it('should return true for English', () => {
    expect(isLocaleSupported('en')).toBe(true);
  });

  it('should return true for Arabic', () => {
    expect(isLocaleSupported('ar')).toBe(true);
  });

  it('should return false for unsupported locale', () => {
    expect(isLocaleSupported('fr')).toBe(false);
    expect(isLocaleSupported('es')).toBe(false);
  });

  it('should return false for invalid locale', () => {
    expect(isLocaleSupported('invalid')).toBe(false);
  });
});

describe('getValidLocale', () => {
  it('should return locale if supported', () => {
    expect(getValidLocale('en')).toBe('en');
    expect(getValidLocale('ar')).toBe('ar');
  });

  it('should return default locale if unsupported', () => {
    expect(getValidLocale('fr')).toBe(DEFAULT_LOCALE);
    expect(getValidLocale('invalid')).toBe(DEFAULT_LOCALE);
  });
});

describe('getTextDirection', () => {
  it('should return ltr for English', () => {
    expect(getTextDirection('en')).toBe('ltr');
  });

  it('should return rtl for Arabic', () => {
    expect(getTextDirection('ar')).toBe('rtl');
  });

  it('should return ltr for unsupported locale (default)', () => {
    expect(getTextDirection('fr')).toBe('ltr');
  });
});

describe('getRTLLocales', () => {
  it('should return only RTL locales', () => {
    const rtlLocales = getRTLLocales();
    rtlLocales.forEach((locale) => {
      expect(locale.isRTL).toBe(true);
    });
  });

  it('should include Arabic', () => {
    const rtlLocales = getRTLLocales();
    const codes = rtlLocales.map((l) => l.code);
    expect(codes).toContain('ar');
  });

  it('should not include English', () => {
    const rtlLocales = getRTLLocales();
    const codes = rtlLocales.map((l) => l.code);
    expect(codes).not.toContain('en');
  });
});

describe('getLTRLocales', () => {
  it('should return only LTR locales', () => {
    const ltrLocales = getLTRLocales();
    ltrLocales.forEach((locale) => {
      expect(locale.isRTL).toBe(false);
    });
  });

  it('should include English', () => {
    const ltrLocales = getLTRLocales();
    const codes = ltrLocales.map((l) => l.code);
    expect(codes).toContain('en');
  });

  it('should not include Arabic', () => {
    const ltrLocales = getLTRLocales();
    const codes = ltrLocales.map((l) => l.code);
    expect(codes).not.toContain('ar');
  });
});

describe('isRTL', () => {
  it('should return false for English', () => {
    expect(isRTL('en')).toBe(false);
  });

  it('should return true for Arabic', () => {
    expect(isRTL('ar')).toBe(true);
  });

  it('should return false for unsupported locale (default)', () => {
    expect(isRTL('fr')).toBe(false);
  });
});

describe('getDirection', () => {
  it('should return ltr for English', () => {
    expect(getDirection('en')).toBe('ltr');
  });

  it('should return rtl for Arabic', () => {
    expect(getDirection('ar')).toBe('rtl');
  });

  it('should return ltr for unsupported locale', () => {
    expect(getDirection('fr')).toBe('ltr');
  });
});

describe('Type Safety', () => {
  it('should allow SupportedLocale type for en and ar', () => {
    const en: SupportedLocale = 'en';
    const ar: SupportedLocale = 'ar';
    expect(en).toBe('en');
    expect(ar).toBe('ar');
  });
});
