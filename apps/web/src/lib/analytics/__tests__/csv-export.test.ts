import { analyticsCsvFilename, buildAnalyticsCsv, csvCell } from '../csv-export';

const labels = {
  date: 'Date', views: 'Views', likes: 'Likes', comments: 'Comments', shares: 'Shares', subscribers: 'Subscribers',
  watchTimeHours: 'Watch time (hours)', video: 'Video', videoId: 'Video ID', published: 'Published',
};

describe('analytics CSV export (Epic 5.1)', () => {
  it('neutralises formulas in text cells and quotes separators', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('Tafsir, part 1')).toBe('"Tafsir, part 1"');
    expect(csvCell('تفسير')).toBe('تفسير');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('writes the daily series and the top videos with CRLF lines', () => {
    const csv = buildAnalyticsCsv(
      [{ date: '2026-11-07', views: 10, likes: 2, comments: 1, shares: 0, subscribers: 1, watchTime: 5400 }],
      [{ videoId: 'v1', title: '=evil', views: 10, likes: 2, dislikes: 0, comments: 1, shares: 0, watchTime: 0, avgViewDuration: 0, clickThroughRate: 0, engagementRate: 0, dateCreated: '2026-11-01T10:00:00.000Z' }],
      labels,
    );
    expect(csv.split('\r\n')).toEqual([
      'Date,Views,Watch time (hours),Likes,Comments,Shares,Subscribers',
      '2026-11-07,10,1.5,2,1,0,1',
      '',
      'Video,Video ID,Published,Views,Likes,Comments',
      "'=evil,v1,2026-11-01,10,2,1",
      '',
    ]);
  });

  it('header only without data', () => {
    expect(buildAnalyticsCsv(null, [], labels)).toBe('Date,Views,Watch time (hours),Likes,Comments,Shares,Subscribers\r\n');
  });

  it('makes a safe file name', () => {
    expect(analyticsCsvFilename('ch/../1', new Date('2026-11-08T12:00:00Z'))).toBe('analytics-ch1-2026-11-08.csv');
    expect(analyticsCsvFilename(undefined, new Date('2026-11-08T12:00:00Z'))).toBe('analytics-channel-2026-11-08.csv');
  });
});
