/**
 * Subtitle track normalization and the browser thumbnail upload client.
 */

import { normalizeSubtitleTrack, upsertSubtitleTrack } from '../subtitle-utils';
import { uploadVideoThumbnail, validateThumbnailFile } from '../video-thumbnail-client';

jest.mock('@/lib/auth/client-token', () => ({
  getClientAuthHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer t', channelId: 'active-channel' }),
}));
jest.mock('@/lib/runtime-config', () => ({
  getApiUrl: () => 'https://api.example.com',
}));
jest.mock('@/lib/logger-client', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('normalizeSubtitleTrack', () => {
  it('maps API status and fields to the web track shape', () => {
    expect(normalizeSubtitleTrack({
      language: 'ar', label: 'العربية', url: 'https://x/ar', isDefault: true,
      uploadedAt: '2026-01-01T00:00:00Z', fileSize: 10, status: 'ready',
    }, 'v1')).toEqual({
      videoId: 'v1', language: 'ar', label: 'العربية', url: 'https://x/ar', isDefault: true,
      fileSize: 10, uploadDate: '2026-01-01T00:00:00Z', status: 'active',
    });
    expect(normalizeSubtitleTrack({ language: 'en', url: 'u', status: 'error' }, 'v1').status).toBe('failed');
  });

  it('upsert replaces the same language and moves the default flag', () => {
    const en = normalizeSubtitleTrack({ language: 'en', url: 'a', isDefault: true }, 'v');
    const ar = normalizeSubtitleTrack({ language: 'ar', url: 'b', isDefault: false }, 'v');
    const newAr = normalizeSubtitleTrack({ language: 'ar', url: 'c', isDefault: true }, 'v');
    const result = upsertSubtitleTrack([en, ar], newAr);
    expect(result).toHaveLength(2);
    expect(result.find((t) => t.language === 'ar')?.url).toBe('c');
    expect(result.filter((t) => t.isDefault).map((t) => t.language)).toEqual(['ar']);
  });
});

describe('video thumbnail client', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('validates type and size', () => {
    expect(validateThumbnailFile(new File(['x'], 'a.gif', { type: 'image/gif' }))).toBe('invalid_type');
    expect(validateThumbnailFile(new File([new Uint8Array(3 * 1024 * 1024)], 'a.jpg', { type: 'image/jpeg' }))).toBe('too_large');
    expect(validateThumbnailFile(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull();
  });

  it('posts multipart to the API with auth and the video channel', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: { thumbnailUrl: 'https://images/x.jpg', thumbnailSizes: { hd: 'h' } } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await uploadVideoThumbnail('vid', new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 'video-channel');

    expect(result).toEqual({ success: true, thumbnailUrl: 'https://images/x.jpg', thumbnailSizes: { hd: 'h' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/videos/vid/thumbnail');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer t', channelId: 'video-channel' });
    expect((init.body as FormData).get('thumbnail')).toBeInstanceOf(File);
  });

  it('returns the API error on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ success: false, error: 'Forbidden' }),
    }) as unknown as typeof fetch;

    const result = await uploadVideoThumbnail('vid', new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect(result).toEqual({ success: false, error: 'Forbidden' });
  });
});
