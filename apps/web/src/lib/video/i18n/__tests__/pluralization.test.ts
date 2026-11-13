import { renderHook } from '@testing-library/react';
import { plural, isValidLanguage, isLanguageSupported, useVideoPlayerI18n, EN_TRANSLATIONS, AR_TRANSLATIONS } from '../index';

describe('plural', () => {
  it.each([
    [0, 'no videos'],
    [1, '1 video'],
    [2, '2 videos'],
    [1234, '1,234 videos'],
  ])('English videos: %d', (count, text) => {
    expect(plural('en', 'videos', count)).toBe(text);
  });

  it.each([
    [0, 'لا توجد مرئيات'],
    [1, 'مرئي واحد'],
    [2, 'مرئيان'],
    [5, '٥ مرئيات'],
    [15, '١٥ مرئيًا'],
    [100, '١٠٠ مرئي'],
    [103, '١٠٣ مرئيات'],
  ])('Arabic videos: %d', (count, text) => {
    expect(plural('ar', 'videos', count)).toBe(text);
  });

  it('every table in both languages has the required forms', () => {
    for (const table of Object.values(EN_TRANSLATIONS.pluralization)) {
      expect(table.one && table.other).toBeTruthy();
    }
    for (const table of Object.values(AR_TRANSLATIONS.pluralization)) {
      expect(table.one && table.two && table.few && table.many && table.other).toBeTruthy();
    }
  });

  it('is exposed by the hook for the current language', () => {
    const { result } = renderHook(() => useVideoPlayerI18n('ar'));
    expect(result.current.plural('views', 2)).toBe('مشاهدتان');
  });
});

describe('isValidLanguage', () => {
  it('accepts only the supported languages and agrees with isLanguageSupported', () => {
    for (const [code, valid] of [['en', true], ['ar', true], ['fr', false], ['', false], ['EN', false]] as const) {
      expect(isValidLanguage(code)).toBe(valid);
      expect(isLanguageSupported(code)).toBe(valid);
    }
  });
});
