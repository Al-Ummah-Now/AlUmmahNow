/**
 * Unit tests for useVideoPlayerI18n hook
 */

import { renderHook } from '@testing-library/react';
import { useVideoPlayerI18n } from '../hooks/useVideoPlayerI18n';
import { EN_TRANSLATIONS, AR_TRANSLATIONS } from '../translations';

describe('useVideoPlayerI18n hook', () => {
  it('should return English translations by default', () => {
    const { result } = renderHook(() => useVideoPlayerI18n());

    expect(result.current.lang).toBe('en');
    expect(result.current.t).toEqual(EN_TRANSLATIONS);
    expect(result.current.isRTL).toBe(false);
    expect(result.current.dir).toBe('ltr');
  });

  it('should return English translations for "en"', () => {
    const { result } = renderHook(() => useVideoPlayerI18n('en'));

    expect(result.current.lang).toBe('en');
    expect(result.current.t).toEqual(EN_TRANSLATIONS);
    expect(result.current.isRTL).toBe(false);
    expect(result.current.dir).toBe('ltr');
  });

  it('should return Arabic translations for "ar"', () => {
    const { result } = renderHook(() => useVideoPlayerI18n('ar'));

    expect(result.current.lang).toBe('ar');
    expect(result.current.t).toEqual(AR_TRANSLATIONS);
    expect(result.current.isRTL).toBe(true);
    expect(result.current.dir).toBe('rtl');
  });

  it('should return correct translations for player status', () => {
    const { result: enResult } = renderHook(() => useVideoPlayerI18n('en'));
    const { result: arResult } = renderHook(() => useVideoPlayerI18n('ar'));

    expect(enResult.current.t.player.loading).toBe('Loading video player...');
    expect(arResult.current.t.player.loading).toBe('جاري تحميل مشغل الفيديو...');

    expect(enResult.current.t.player.ready).toBe('Video player loaded and ready');
    expect(arResult.current.t.player.ready).toBe('تم تحميل مشغل الفيديو وهو جاهز');
  });

  it('should return correct accessibility labels', () => {
    const { result: enResult } = renderHook(() => useVideoPlayerI18n('en'));
    const { result: arResult } = renderHook(() => useVideoPlayerI18n('ar'));

    expect(enResult.current.t.accessibility.videoPlayer).toBe('Video player');
    expect(arResult.current.t.accessibility.videoPlayer).toBe('مشغل الفيديو');

    expect(enResult.current.t.accessibility.playButton).toBe('Play video');
    expect(arResult.current.t.accessibility.playButton).toBe('تشغيل الفيديو');
  });

  it('should return correct error translations', () => {
    const { result: enResult } = renderHook(() => useVideoPlayerI18n('en'));
    const { result: arResult } = renderHook(() => useVideoPlayerI18n('ar'));

    expect(enResult.current.t.errors.title.network).toBe('Network Error');
    expect(arResult.current.t.errors.title.network).toBe('خطأ في الشبكة');

    expect(enResult.current.t.errors.retryButton).toBe('Try Again');
    expect(arResult.current.t.errors.retryButton).toBe('حاول مرة أخرى');
  });

  it('should memoize translations for same language', () => {
    const { result, rerender } = renderHook(
      ({ lang }) => useVideoPlayerI18n(lang),
      { initialProps: { lang: 'en' as const } }
    );

    const firstTranslations = result.current.t;

    rerender({ lang: 'en' as const });

    expect(result.current.t).toBe(firstTranslations);
  });

  it('should update translations when language changes', () => {
    const { result, rerender } = renderHook(
      ({ lang }: { lang: 'en' | 'ar' }) => useVideoPlayerI18n(lang),
      { initialProps: { lang: 'en' as 'en' | 'ar' } }
    );

    expect(result.current.lang).toBe('en');
    expect(result.current.isRTL).toBe(false);
    expect(result.current.t.player.loading).toBe('Loading video player...');

    rerender({ lang: 'ar' });

    expect(result.current.lang).toBe('ar');
    expect(result.current.isRTL).toBe(true);
    expect(result.current.t.player.loading).toBe('جاري تحميل مشغل الفيديو...');
  });

  it('should have correct type structure', () => {
    const { result } = renderHook(() => useVideoPlayerI18n('en'));

    expect(result.current).toHaveProperty('t');
    expect(result.current).toHaveProperty('lang');
    expect(result.current).toHaveProperty('isRTL');
    expect(result.current).toHaveProperty('dir');

    expect(typeof result.current.t).toBe('object');
    expect(typeof result.current.lang).toBe('string');
    expect(typeof result.current.isRTL).toBe('boolean');
    expect(typeof result.current.dir).toBe('string');
  });
});
