import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import { thumbnailRefusalMessage } from '../thumbnail-error';

describe('thumbnailRefusalMessage (#1466)', () => {
  it.each([
    ['en', EN_TRANSLATIONS],
    ['ar', AR_TRANSLATIONS],
  ] as const)('is in the page language, never the server text (%s)', (lang, t) => {
    const limit = thumbnailRefusalMessage(t, { code: 'upload_limit', status: 429, retryAfter: 1380 }, lang);
    // 23 minutes: the noun agrees with the count (#1666), in the page's digits
    expect(limit).toBe(lang === 'ar' ? 'بلغت حد الرفع؛ حاول مرة أخرى بعد ٢٣ دقيقة' : "You've reached the upload limit; try again in 23 minutes");
    expect(thumbnailRefusalMessage(t, { code: 'upload_limit', status: 429 })).toBe(t.creator.limitReachedSoon);
    expect(thumbnailRefusalMessage(t, { code: 'upload_limits_unavailable', status: 503 })).toBe(t.creator.unavailable);
    expect(thumbnailRefusalMessage(t, { code: 'thumbnail_shape', status: 422 })).toBe(t.video.thumbnailWrongShape);
    expect(thumbnailRefusalMessage(t, { status: 400 })).toBe(t.video.thumbnailInvalidType);
    expect(thumbnailRefusalMessage(t, { status: 413 })).toBe(t.video.thumbnailTooLarge);
    for (const status of [403, 404, 500, undefined]) expect(thumbnailRefusalMessage(t, { status })).toBe(t.video.thumbnailUploadFailed);
  });

  it('the Arabic upload-limit message is Arabic', () => {
    expect(thumbnailRefusalMessage(AR_TRANSLATIONS, { code: 'upload_limit', status: 429, retryAfter: 60 })).toMatch(/[؀-ۿ]/);
  });
});
