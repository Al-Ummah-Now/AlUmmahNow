import { changePercent, rangeDates, sumMetrics, trafficRows } from '../analytics';

const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('rangeDates', () => {
  it('covers the last N days and the N before', () => {
    expect(rangeDates('7', NOW)).toEqual({
      current: { dateFrom: '2026-11-03', dateTo: '2026-11-09' },
      previous: { dateFrom: '2026-10-27', dateTo: '2026-11-02' },
    });
  });

  it('runs all time from the channel\'s creation, with nothing to compare', () => {
    expect(rangeDates('all', NOW, '2026-01-15T00:00:00.000Z')).toEqual({ current: { dateFrom: '2026-01-15', dateTo: '2026-11-09' }, previous: null });
  });
});

describe('sumMetrics', () => {
  it('adds the days up and works out average duration', () => {
    const totals = sumMetrics([
      { date: 'a', views: 2, likes: 1, comments: 0, subscribers: 1, watchTime: 100 },
      { date: 'b', views: 3, likes: 0, comments: 2, subscribers: 0, watchTime: 150 },
    ]);
    expect(totals).toEqual({ views: 5, watchTime: 250, avgViewDuration: 50, likes: 1, comments: 2, subscribers: 1 });
  });

  it('copes with no views', () => {
    expect(sumMetrics([]).avgViewDuration).toBe(0);
  });
});

describe('changePercent', () => {
  it('compares with the previous period', () => {
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(50, 100)).toBe(-50);
  });

  it('has no change to show from nothing', () => {
    expect(changePercent(5, 0)).toBeNull();
    expect(changePercent(5, undefined)).toBeNull();
  });
});

describe('trafficRows', () => {
  it('ranks by views with shares, Not shared last', () => {
    expect(trafficRows({ totalViews: 10, sources: { unknown: 6, home: 1, search: 3 }, externalHosts: [] })).toEqual([
      { source: 'search', views: 3, share: 0.3 },
      { source: 'home', views: 1, share: 0.1 },
      { source: 'unknown', views: 6, share: 0.6 },
    ]);
  });

  it('is empty with no views', () => {
    expect(trafficRows({ totalViews: 0, sources: {}, externalHosts: [] })).toEqual([]);
  });
});
