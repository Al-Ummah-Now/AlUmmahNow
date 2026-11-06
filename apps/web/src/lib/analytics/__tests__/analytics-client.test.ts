import { normalizeClientEvents } from '../client-events';
import { periodChange } from '@/components/analytics/AnalyticsDashboard';

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: jest.fn() }));

describe('normalizeClientEvents', () => {
  it('passes A/B test batches through', () => {
    const result = normalizeClientEvents({ events: [{ eventType: 'exposure' }, 'junk'], userAgent: 'UA', referrer: 'r' });
    expect(result).toEqual({ events: [{ eventType: 'exposure' }], userAgent: 'UA', referrer: 'r' });
  });

  it('flattens single and batched web vitals', () => {
    expect(normalizeClientEvents({ type: 'web-vitals', data: { name: 'LCP', value: 1 } }).events)
      .toEqual([{ metricType: 'web-vitals', name: 'LCP', value: 1 }]);
    expect(normalizeClientEvents({ type: 'web-vitals-batch', data: [{ name: 'CLS' }, { name: 'FID' }] }).events).toHaveLength(2);
  });

  it('wraps player performance objects and rejects non-objects', () => {
    expect(normalizeClientEvents({ fps: 30 }).events).toEqual([{ metricType: 'video-performance', fps: 30 }]);
    expect(normalizeClientEvents('nope').events).toEqual([]);
  });

  it('caps batches at 100 events', () => {
    const events = Array.from({ length: 150 }, (_, i) => ({ i }));
    expect(normalizeClientEvents({ events }).events).toHaveLength(100);
  });
});

describe('periodChange', () => {
  const day = (views: number) => ({ date: '2026-11-01', views, likes: 0, comments: 0, shares: 0, subscribers: 0, watchTime: 0 });

  it('compares the second half of the series with the first half', () => {
    expect(periodChange([day(10), day(10), day(15), day(15)], 'views')).toEqual({ label: '+50%', type: 'positive' });
    expect(periodChange([day(10), day(10), day(5), day(5)], 'views')).toEqual({ label: '-50%', type: 'negative' });
  });

  it('has no change without a baseline', () => {
    expect(periodChange([day(0), day(5)], 'views')).toBeUndefined();
    expect(periodChange(null, 'views')).toBeUndefined();
  });
});
