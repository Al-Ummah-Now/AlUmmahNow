import { requestWebVideoDownload } from '../download-client';

jest.mock('@/lib/auth/client-token', () => ({
  fetchClientAuthInfo: jest.fn(async () => ({ accessToken: 'tok-123' })),
}));

jest.mock('@/lib/runtime-config', () => ({
  getApiUrl: () => 'https://api.alummahnow.test',
}));

function mockResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => lower[name.toLowerCase()] ?? null,
    },
    json: async () => body,
  };
}

describe('requestWebVideoDownload (E14-S6b)', () => {
  it('sends POST /api/v1/videos/:id/downloads with disposition attachment, auth header, and X-App-Locale', async () => {
    const fetchMock = jest.fn(async () =>
      mockResponse({
        videoId: 'vid-1',
        r2Rev: 'rev-abc',
        media: {
          format: 'mp4',
          url: 'https://media.alummahnow.net/dl/vid-1/rev-abc/Lecture.mp4',
          contentType: 'video/mp4',
          bytes: 5_000_000,
          rung: '480p',
        },
      }),
    );

    const res = await requestWebVideoDownload('vid-1', { locale: 'ar', fetchImpl: fetchMock as unknown as typeof fetch });
    expect(res).toEqual({
      ok: true,
      videoId: 'vid-1',
      r2Rev: 'rev-abc',
      url: 'https://media.alummahnow.net/dl/vid-1/rev-abc/Lecture.mp4',
      contentType: 'video/mp4',
      bytes: 5_000_000,
      rung: '480p',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe('https://api.alummahnow.test/api/v1/videos/vid-1/downloads');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ disposition: 'attachment' }));
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-123',
      'X-App-Locale': 'ar',
    });
  });

  it('parses localized 429 download_rate_limited response and Retry-After', async () => {
    const fetchMock = jest.fn(async () =>
      mockResponse(
        {
          code: 'download_rate_limited',
          message: 'Too many download requests. Try again shortly.',
          retryAfter: 45,
        },
        429,
        { 'Retry-After': '45' },
      ),
    );

    const res = await requestWebVideoDownload('vid-1', { locale: 'en', fetchImpl: fetchMock as unknown as typeof fetch });
    expect(res).toEqual({
      ok: false,
      status: 429,
      code: 'download_rate_limited',
      message: 'Too many download requests. Try again shortly.',
      retryAfter: 45,
    });
  });

  it('forwards the abort signal and reports cancellation separately from network errors', async () => {
    const controller = new AbortController();
    const fetchMock = jest.fn(async (_url: string, init: RequestInit) => {
      controller.abort();
      init.signal?.throwIfAborted();
      return mockResponse(null);
    });

    const result = await requestWebVideoDownload('vid-1', {
      signal: controller.signal,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      signal: controller.signal,
    }));
    expect(result).toEqual({ ok: false, status: 0, code: 'aborted' });
  });

  it('rejects non-HTTP(S) download URLs defensively', async () => {
    const fetchMock = jest.fn(async () =>
      mockResponse({
        videoId: 'vid-1',
        r2Rev: 'rev-abc',
        media: { format: 'mp4', url: 'javascript:alert(1)', contentType: 'video/mp4', rung: '480p' },
      }),
    );

    const res = await requestWebVideoDownload('vid-1', { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(res).toEqual({ ok: false, status: 502, code: 'invalid_response' });
  });
});
