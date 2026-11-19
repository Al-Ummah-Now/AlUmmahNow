import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { viewOrigin } from '../src/endpoints/video/videoView';
import { buildTraffic } from '../src/lib/analytics';

describe('view origin and the traffic breakdown', () => {
  it('a view carries surface, device, country and the page utm_source only', () => {
    const req = new Request('https://videos.api.alummahnow.net/api/videos/v1/view', {
      headers: { 'x-aun-client': 'aun-android/2.1.0 (Android 15)', referer: 'https://alummahnow.net/en/video/v1?utm_source=Telegram&t=30', 'cf-ipcountry': 'EG' },
    });
    assert.deepEqual(viewOrigin(req, false), { originSurface: 'android', originDevice: 'phone', originCountry: 'EG', originCampaign: 'telegram' });
    const embed = new Request('https://videos.api.alummahnow.net/api/videos/v1/view', { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605.1.15' } });
    assert.deepEqual(viewOrigin(embed, true), { originSurface: 'embed', originDevice: 'desktop' });
  });

  it('sums surfaces, devices, countries and campaigns over the range', () => {
    const t = buildTraffic(
      [
        { days: { '2026-11-18': { views: 3, watchTime: 0, surfaces: { web: 2, ios: 1 }, devices: { phone: 3 }, countries: { EG: 2, other: 1 }, campaigns: { telegram: 1 } } } },
        { days: { '2026-11-19': { views: 1, watchTime: 0, surfaces: { web: 1 } }, '2026-10-01': { views: 9, watchTime: 0, surfaces: { web: 9 } } } },
      ] as never,
      { from: new Date('2026-11-18T00:00:00Z'), to: new Date('2026-11-19T23:59:59Z') },
    );
    assert.deepEqual(t.surfaces, { web: 3, ios: 1 });
    assert.deepEqual(t.devices, { phone: 3 });
    assert.deepEqual(t.countries, { EG: 2, other: 1 });
    assert.deepEqual(t.campaigns, { telegram: 1 });
  });
});
