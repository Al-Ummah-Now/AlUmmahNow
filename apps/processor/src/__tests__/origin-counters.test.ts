import { originIncrements, visitIncrements, ORIGIN_DIM_LIMITS } from '../lib/site-visits';
import { viewIncrements } from '../lib/analytics-rollup';

const base = { entityType: 'site' as const, entityId: 'videos', day: '2026-11-19' };

describe('request origin counters (surface, device, country top 50, utm_source)', () => {
  it('adds bounded counters and drops anything malformed', () => {
    const out = originIncrements(base, { surface: 'android', device: 'phone', country: 'EG', campaign: 'newsletter' });
    expect(out.map((i) => `${i.metric}:${i.dim}:${i.maxDims}`)).toEqual([
      `surface:android:${ORIGIN_DIM_LIMITS.surface}`,
      `device:phone:${ORIGIN_DIM_LIMITS.device}`,
      'country:EG:50',
      `campaign:newsletter:${ORIGIN_DIM_LIMITS.campaign}`,
    ]);
    expect(originIncrements(base, { surface: 'DROP TABLE', device: 'fridge', country: 'eg', campaign: 'a b' })).toEqual([]);
  });

  it('a view counts its origin on the video and the channel', () => {
    const inc = viewIncrements(
      { videoId: 'v1', videoChannelId: 'c1', trackedView: true, source: 'watch', originSurface: 'ios', originDevice: 'phone', originCountry: 'SA' } as never,
      '2026-11-19T10:00:00Z',
    )!;
    const origin = inc.filter((i) => ['surface', 'device', 'country'].includes(i.metric));
    expect(origin.map((i) => `${i.entityType}:${i.metric}:${i.dim}`).sort()).toEqual(
      ['channel:country:SA', 'channel:device:phone', 'channel:surface:ios', 'video:country:SA', 'video:device:phone', 'video:surface:ios'].sort(),
    );
  });

  it('a visit counts its origin; a visit without one adds nothing new', () => {
    const withOrigin = visitIncrements([{ landing: 'watch', source: 'email', surface: 'web', device: 'desktop', country: 'GB', campaign: 'weekly' }], '2026-11-19T00:00:00Z');
    expect(withOrigin.map((i) => i.metric)).toEqual(['visits', 'landing', 'source', 'surface', 'device', 'country', 'campaign']);
    const plain = visitIncrements([{ landing: 'home', source: 'direct' }], '2026-11-19T00:00:00Z');
    expect(plain.map((i) => i.metric)).toEqual(['visits', 'landing', 'source']);
  });
});
