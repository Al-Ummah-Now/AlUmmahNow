import { classifyInternalPath, createTrafficTracker, trafficFromBatch } from '../traffic-source';

describe('classifyInternalPath', () => {
  it.each([
    ['/en', 'home'],
    ['/ar/', 'home'],
    ['/en/search', 'search'],
    ['/en/feed', 'subscriptions'],
    ['/ar/subscriptions', 'subscriptions'],
    ['/en/channels/abc', 'channel'],
    ['/en/c/alummah', 'channel'],
    ['/en/@alummah', 'channel'],
    ['/en/playlist/p1', 'playlist'],
    ['/en/video', 'up_next'],
    ['/en/explore', 'explore'],
    ['/en/library', 'library'],
    ['/en/history', 'library'],
    ['/en/notifications', 'notification'],
    ['/en/profile', 'direct'],
    ['/en/studio/c1/content', 'direct'],
  ])('%s is %s', (path, source) => {
    expect(classifyInternalPath(path)).toBe(source);
  });
});

const page = (referrer = '', hostname = 'alummahnow.net', host = hostname) => ({ referrer, hostname, host });

describe('traffic tracker', () => {
  it('is direct on the first page with no referrer', () => {
    expect(createTrafficTracker().resolve('/en/video', 'v1', page())).toEqual({ trafficSource: 'direct' });
  });

  it('keeps only the host of another site', () => {
    expect(createTrafficTracker().resolve('/en/video', 'v1', page('https://Example.org/a/b?q=secret')))
      .toEqual({ trafficSource: 'external', referrerHost: 'example.org' });
  });

  it('treats a full page load from our own site as internal', () => {
    expect(createTrafficTracker().resolve('/en/video', 'v1', page('https://alummahnow.net/en/search?q=x')))
      .toEqual({ trafficSource: 'search' });
  });

  it('treats a sibling subdomain, such as sign-in, as direct', () => {
    expect(createTrafficTracker().resolve('/en/video', 'v1', page('https://auth.alummahnow.net/login')))
      .toEqual({ trafficSource: 'direct' });
  });

  it('is direct for an unreadable referrer', () => {
    expect(createTrafficTracker().resolve('/en/video', 'v1', page('not a url'))).toEqual({ trafficSource: 'direct' });
  });

  it('uses the previous page after in-app navigation', () => {
    const t = createTrafficTracker();
    t.record('/en/search');
    t.record('/en/video');
    expect(t.resolve('/en/video', 'v1', page('https://other.org/'))).toEqual({ trafficSource: 'search' });
  });

  it('works when the player resolves before the navigation is recorded', () => {
    const t = createTrafficTracker();
    t.record('/en/explore');
    expect(t.resolve('/en/video', 'v1', page())).toEqual({ trafficSource: 'explore' });
  });

  it('is up_next when another video opens on the watch page', () => {
    const t = createTrafficTracker();
    t.record('/en/search');
    t.record('/en/video');
    expect(t.resolve('/en/video', 'v1', page()).trafficSource).toBe('search');
    expect(t.resolve('/en/video', 'v2', page()).trafficSource).toBe('up_next');
  });

  it('does not call it up_next after leaving the watch page in between', () => {
    const t = createTrafficTracker();
    t.record('/en/video');
    t.resolve('/en/video', 'v1', page());
    t.record('/en/channels/c1');
    t.record('/en/video');
    expect(t.resolve('/en/video', 'v2', page()).trafficSource).toBe('channel');
  });

  it('keeps the same source when one video re-resolves', () => {
    const t = createTrafficTracker();
    t.record('/en/search');
    t.record('/en/video');
    t.resolve('/en/video', 'v1', page());
    expect(t.resolve('/en/video', 'v1', page()).trafficSource).toBe('search');
  });
});

describe('trafficFromBatch', () => {
  it('passes a valid source', () => {
    expect(trafficFromBatch({ trafficSource: 'home' })).toEqual({ trafficSource: 'home' });
  });

  it('passes the host only for external', () => {
    expect(trafficFromBatch({ trafficSource: 'external', referrerHost: 'A.org' })).toEqual({ trafficSource: 'external', referrerHost: 'a.org' });
    expect(trafficFromBatch({ trafficSource: 'home', referrerHost: 'a.org' })).toEqual({ trafficSource: 'home' });
    expect(trafficFromBatch({ trafficSource: 'external', referrerHost: 'a.org/x' })).toEqual({ trafficSource: 'external' });
  });

  it('sends nothing for a missing or invalid source', () => {
    expect(trafficFromBatch(undefined)).toEqual({});
    expect(trafficFromBatch({})).toEqual({});
    expect(trafficFromBatch({ trafficSource: 'bogus' })).toEqual({});
  });
});
