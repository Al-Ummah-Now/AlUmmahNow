import {
  activeFilterKeys,
  canSearch,
  normalizeState,
  parseSearchParams,
  toSearchParams,
  toSearchQuery,
  withoutFilter,
} from '../url-state';

describe('search URL state', () => {
  it('parses valid params and drops invalid ones', () => {
    const state = parseSearchParams(new URLSearchParams(
      'q=%D8%A7%D9%84%D8%B5%D9%84%D8%A7%D8%A9&type=video&duration=long&date=week&language=ar&category=fiqh&verified=true&channelId=ch_1&sort=date',
    ));
    expect(state).toEqual({
      q: 'الصلاة', type: 'video', duration: 'long', date: 'week', language: 'ar',
      category: 'fiqh', verified: true, channelId: 'ch_1', sort: 'date',
    });
    const bad = parseSearchParams(new URLSearchParams('type=evil&duration=x&date=y&language=zz&category=nope&verified=1&channelId=../x&sort=z'));
    expect(bad).toEqual({ q: '', type: undefined, duration: undefined, date: undefined, language: undefined, category: undefined, verified: false, channelId: undefined, sort: 'relevance' });
  });

  it('round-trips through URLSearchParams, omitting defaults', () => {
    const state = parseSearchParams(new URLSearchParams('q=seerah&type=playlist&sort=popular'));
    expect(toSearchParams(state).toString()).toBe('q=seerah&type=playlist&sort=popular');
    expect(toSearchParams(parseSearchParams(null)).toString()).toBe('');
  });

  it('builds API queries with cursor and limit', () => {
    const state = parseSearchParams(new URLSearchParams('q=fiqh&verified=true'));
    expect(toSearchQuery(state, 'o20', 20)).toMatchObject({ q: 'fiqh', verified: true, cursor: 'o20', limit: 20, sort: 'relevance' });
  });

  it('lists and removes active filters', () => {
    const state = parseSearchParams(new URLSearchParams('q=x&date=today&verified=true&channelId=c1'));
    expect(activeFilterKeys(state)).toEqual(['date', 'verified', 'channelId']);
    expect(activeFilterKeys(withoutFilter(state, 'verified'))).toEqual(['date', 'channelId']);
    expect(activeFilterKeys(withoutFilter(state, 'date'))).toEqual(['verified', 'channelId']);
  });

  it('requires text or a filter before searching', () => {
    expect(canSearch(parseSearchParams(new URLSearchParams('')))).toBe(false);
    expect(canSearch(parseSearchParams(new URLSearchParams('q=%20')))).toBe(false);
    expect(canSearch(parseSearchParams(new URLSearchParams('type=channel')))).toBe(true);
    expect(canSearch(parseSearchParams(new URLSearchParams('category=fiqh')))).toBe(true);
  });

  it('clears the video-only duration filter for other types', () => {
    const state = parseSearchParams(new URLSearchParams('duration=short&type=channel'));
    expect(normalizeState(state).duration).toBeUndefined();
    const video = parseSearchParams(new URLSearchParams('duration=short&type=video'));
    expect(normalizeState(video).duration).toBe('short');
  });
});
