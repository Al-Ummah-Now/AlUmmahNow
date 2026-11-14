/**
 * @jest-environment node
 */
const writeDataPoint = jest.fn();
const ctx = { env: { RUM: { writeDataPoint }, NEXTJS_ENV: 'production' } as Record<string, unknown> };
jest.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ctx }));
jest.mock('@/lib/logger-server', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));

import { POST } from '../route';

const post = (body: string, headers: Record<string, string> = {}) => POST(new Request('https://videos.alummahnow.net/api/rum', { method: 'POST', body, headers }));

describe('POST /api/rum (#1207)', () => {
  beforeEach(() => {
    writeDataPoint.mockReset();
    ctx.env = { RUM: { writeDataPoint }, NEXTJS_ENV: 'production' };
  });

  it('should write one data point per metric with only the page kind, device, locale and environment', async () => {
    const res = await post(JSON.stringify({ k: 'watch', d: 'phone', l: 'ar', m: { LCP: 2100, CLS: 0.02, INP: 140 } }), { cookie: 'session=abc', 'user-agent': 'UA' });
    expect(res.status).toBe(204);
    expect(writeDataPoint.mock.calls.map((c) => c[0])).toEqual([
      { indexes: ['LCP'], blobs: ['LCP', 'watch', 'phone', 'ar', 'production'], doubles: [2100] },
      { indexes: ['CLS'], blobs: ['CLS', 'watch', 'phone', 'ar', 'production'], doubles: [0.02] },
      { indexes: ['INP'], blobs: ['INP', 'watch', 'phone', 'ar', 'production'], doubles: [140] },
    ]);
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toMatch(/session|UA/);
  });

  it('should drop anything that is not a beacon, always answering 204', async () => {
    for (const body of ['', 'not json', JSON.stringify({ k: 'x', d: 'phone', l: 'en', m: { LCP: 1 } }), 'x'.repeat(600)]) {
      expect((await post(body)).status).toBe(204);
    }
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('should drop beacons from headless and automated browsers (E2E, Lighthouse)', async () => {
    const beacon = JSON.stringify({ k: 'home', d: 'desktop', l: 'en', m: { LCP: 900 } });
    for (const ua of [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'Playwright/1.56',
    ]) {
      expect((await post(beacon, { 'user-agent': ua })).status).toBe(204);
    }
    expect(writeDataPoint).not.toHaveBeenCalled();
    await post(beacon, { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
  });

  it('should accept and drop beacons where no dataset is bound (local)', async () => {
    ctx.env = {};
    expect((await post(JSON.stringify({ k: 'home', d: 'desktop', l: 'en', m: { LCP: 900 } }))).status).toBe(204);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
});
