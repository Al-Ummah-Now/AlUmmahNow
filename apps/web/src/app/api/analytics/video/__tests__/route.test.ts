/**
 * /api/analytics/video forwards one view per 'ready' event to the API and
 * passes the embed context through (docs/embeds/README.md §6).
 */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}));
jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { POST } from '../route';

const fetchMock = jest.fn();

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  process.env.API_URL = 'https://videos.api.qa.alummahnow.net';
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

function forwarded(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://videos.api.qa.alummahnow.net/api/videos/v1/view');
  return JSON.parse((init as { body: string }).body);
}

describe('POST /api/analytics/video', () => {
  it('forwards an embed view with its origin', async () => {
    await POST(request({
      events: [{ videoId: 'v1', eventType: 'ready' }, { videoId: 'v1', eventType: 'play' }],
      context: { source: 'embed', embedOrigin: 'https://www.alummahnow.net/page' },
    }));
    expect(forwarded()).toMatchObject({ source: 'embed', embedOrigin: 'https://www.alummahnow.net', referrer: 'embed' });
  });

  it('forwards a watch-page view without context', async () => {
    await POST(request({ events: [{ videoId: 'v1', eventType: 'ready' }] }));
    const body = forwarded();
    expect(body).toMatchObject({ source: 'watch', referrer: 'direct' });
    expect(body).not.toHaveProperty('embedOrigin');
  });

  it('never trusts a forged context', async () => {
    await POST(request({ events: [{ videoId: 'v1', eventType: 'ready' }], context: { source: 'admin', embedOrigin: 'x' } }));
    expect(forwarded()).toMatchObject({ source: 'watch' });
  });

  it('counts nothing without a ready event', async () => {
    await POST(request({ events: [{ videoId: 'v1', eventType: 'play' }], context: { source: 'embed' } }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
