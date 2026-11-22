import { changePercent, originRows, rangeDates, sumMetrics, topContentTitle, trafficRows } from '../analytics';

const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('rangeDates', () => {
  it('covers the last N days and the N before', () => {
    expect(rangeDates('7', NOW, undefined, 'UTC')).toEqual({
      current: { dateFrom: '2026-11-03', dateTo: '2026-11-09', tz: 'UTC' },
      previous: { dateFrom: '2026-10-27', dateTo: '2026-11-02', tz: 'UTC' },
    });
  });

  it('runs all time from the channel\'s creation, with nothing to compare', () => {
    expect(rangeDates('all', NOW, '2026-01-15T00:00:00.000Z', 'UTC')).toEqual({ current: { dateFrom: '2026-01-15', dateTo: '2026-11-09', tz: 'UTC' }, previous: null });
  });

  // 7:30 pm Eastern on 21 Nov (EST) is 00:30 UTC on 22 Nov: the chart ends on the viewer's 21 Nov
  it('ends on the viewer\'s today just after 7 pm Eastern, when UTC is already tomorrow', () => {
    const evening = new Date('2026-11-22T00:30:00.000Z');
    expect(rangeDates('28', evening, undefined, 'America/New_York')).toEqual({
      current: { dateFrom: '2026-10-25', dateTo: '2026-11-21', tz: 'America/New_York' },
      previous: { dateFrom: '2026-09-27', dateTo: '2026-10-24', tz: 'America/New_York' },
    });
    expect(rangeDates('7', evening, undefined, 'UTC').current.dateTo).toBe('2026-11-22');
    // The channel's first day is its local creation date too
    expect(rangeDates('all', evening, '2026-01-15T02:00:00.000Z', 'America/New_York').current.dateFrom).toBe('2026-01-14');
  });

  it('sends the browser zone by default', () => {
    expect(rangeDates('7', NOW).current.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
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

describe('originRows (where viewers watch)', () => {
  it('ranks by views with the stored overflow last', () => {
    expect(originRows({ other: 2, web: 5, ios: 3 }, 10)).toEqual([
      { key: 'web', views: 5, share: 0.5 },
      { key: 'ios', views: 3, share: 0.3 },
      { key: 'other', views: 2, share: 0.2 },
    ]);
  });

  it('folds rows past the limit into "other" (countries show the top 10)', () => {
    expect(originRows({ EG: 4, GB: 3, US: 2, other: 1 }, 10, 2)).toEqual([
      { key: 'EG', views: 4, share: 0.4 },
      { key: 'GB', views: 3, share: 0.3 },
      { key: 'other', views: 3, share: 0.3 },
    ]);
  });

  it('is empty before anything was collected (older APIs omit the field)', () => {
    expect(originRows(undefined, 10)).toEqual([]);
    expect(originRows({ web: 3 }, 0)).toEqual([]);
  });
});

describe('topContentTitle', () => {
  const item = { title: 'Lantern street at night', titleLocalized: { en: 'Lantern street at night', ar: 'شارع الفوانيس ليلًا' } };

  it('shows the translation for the UI language', () => {
    expect(topContentTitle(item, 'ar')).toBe('شارع الفوانيس ليلًا');
    expect(topContentTitle(item, 'en')).toBe('Lantern street at night');
  });

  it('falls back to the stored title when there is no translation', () => {
    expect(topContentTitle({ title: 'Fresh bread' }, 'ar')).toBe('Fresh bread');
    expect(topContentTitle({ title: 'Fresh bread', titleLocalized: { en: 'Fresh bread' } }, 'ar')).toBe('Fresh bread');
  });

  it('takes its half of a bilingual "EN | AR" title', () => {
    expect(topContentTitle({ title: 'Mint tea | شاي بالنعناع' }, 'ar')).toBe('شاي بالنعناع');
  });
});
