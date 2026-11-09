import { MAX_BULK_SELECTION, parseVideosQuery, rowActions, videosQueryString } from '../videos';

describe('parseVideosQuery', () => {
  it('defaults to Published, newest', () => {
    expect(parseVideosQuery(new URLSearchParams())).toMatchObject({ status: 'published', sort: 'newest', visibility: 'all', type: 'all', duration: 'all', q: '' });
  });

  it('reads valid values', () => {
    expect(parseVideosQuery(new URLSearchParams('status=drafts&sort=views&visibility=private&type=shorts&duration=long&q=hi&category=tafsir&language=ar')))
      .toEqual({ status: 'drafts', sort: 'views', visibility: 'private', type: 'shorts', duration: 'long', q: 'hi', category: 'tafsir', language: 'ar', view: 'list', calendarView: 'month' });
  });

  it('ignores values it does not know', () => {
    expect(parseVideosQuery(new URLSearchParams('status=nope&sort=x&type=live'))).toMatchObject({ status: 'published', sort: 'newest', type: 'all' });
  });

  it('keeps the calendar settings', () => {
    expect(parseVideosQuery(new URLSearchParams('status=scheduled&view=calendar&calendarView=week'))).toMatchObject({ view: 'calendar', calendarView: 'week' });
  });
});

describe('videosQueryString', () => {
  it('leaves out defaults, so links stay short', () => {
    expect(videosQueryString(parseVideosQuery(new URLSearchParams()))).toBe('');
  });

  it('writes what differs', () => {
    expect(videosQueryString({ ...parseVideosQuery(new URLSearchParams()), status: 'failed', q: 'a b' })).toBe('status=failed&q=a+b');
  });

  it('round trips', () => {
    const q = parseVideosQuery(new URLSearchParams('status=scheduled&view=calendar&calendarView=day&sort=title'));
    expect(parseVideosQuery(new URLSearchParams(videosQueryString(q)))).toEqual(q);
  });
});

describe('rowActions', () => {
  it('offers a published video everything for the owner', () => {
    expect(rowActions('published', 'owner')).toEqual(['edit', 'view', 'analytics', 'copyLink', 'schedule', 'delete']);
  });

  it('does not offer to schedule a public video, which the API refuses', () => {
    expect(rowActions('published', 'owner', true)).toEqual(['edit', 'view', 'analytics', 'copyLink', 'delete']);
  });

  it('gives an editor no analytics', () => {
    expect(rowActions('published', 'editor')).toEqual(['edit', 'view', 'copyLink', 'schedule', 'delete']);
  });

  it('offers schedule actions on a scheduled video', () => {
    expect(rowActions('scheduled', 'owner')).toEqual(['edit', 'reschedule', 'publishNow', 'cancelSchedule', 'delete']);
  });

  it('offers only delete while processing', () => {
    expect(rowActions('processing', 'owner')).toEqual(['delete']);
  });

  it('offers edit and delete on a failed video', () => {
    expect(rowActions('failed', 'owner')).toEqual(['edit', 'delete']);
  });

  it('offers publish on a draft', () => {
    expect(rowActions('drafts', 'owner')).toEqual(['edit', 'publishNow', 'schedule', 'delete']);
  });

  it('caps the selection at the API limit', () => {
    expect(MAX_BULK_SELECTION).toBe(50);
  });
});
