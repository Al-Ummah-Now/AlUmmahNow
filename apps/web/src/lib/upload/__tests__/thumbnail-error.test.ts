import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import { thumbnailRefusalMessage } from '../thumbnail-error';

describe('thumbnailRefusalMessage (#1466)', () => {
  it.each([
    ['en', EN_TRANSLATIONS],
    ['ar', AR_TRANSLATIONS],
  ] as const)('is in the page language, never the server text (%s)', (_lang, t) => {
    const limit = thumbnailRefusalMessage(t, { code: 'upload_limit', status: 429, retryAfter: 1380 });
    expect(limit).toBe(t.creator.limitReached.replace('{time}', t.creator.minutes.replace('{count}', '23')));
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
