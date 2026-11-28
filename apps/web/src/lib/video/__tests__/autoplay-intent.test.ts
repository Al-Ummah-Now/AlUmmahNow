/**
 * The in-app autoplay request survives the page load navigateOrLoad falls back to (memory is gone
 * then), and nothing else: never the URL, consumed when the video mounts, short-lived (#1137).
 */
type IntentModule = typeof import('../autoplay-intent');

/** A fresh copy of the module: what a full page load does to its in-memory request */
function load(): IntentModule {
  let mod!: IntentModule;
  jest.isolateModules(() => {
    mod = jest.requireActual('../autoplay-intent');
  });
  return mod;
}

describe('autoplay intent', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    jest.useRealTimers();
  });

  it('asks only the requested video to play', () => {
    const intent = load();
    intent.requestAutoplay('next', { auto: true });
    expect(intent.hasAutoplayIntent('next')).toBe(true);
    expect(intent.isAutoAdvance('next')).toBe(true);
    expect(intent.hasAutoplayIntent('other')).toBe(false);
  });

  it('survives a page load (the client move fell back to loading the page)', () => {
    load().requestAutoplay('next', { auto: true });
    const afterLoad = load();
    expect(afterLoad.hasAutoplayIntent('next')).toBe(true);
    expect(afterLoad.isAutoAdvance('next')).toBe(true);
  });

  it('is consumed when the video mounts: a reload afterwards does not autoplay', () => {
    load().requestAutoplay('next');
    const page = load();
    page.clearAutoplayIntent('next');
    expect(page.hasAutoplayIntent('next')).toBe(false);
    expect(load().hasAutoplayIntent('next')).toBe(false);
  });

  it('a client move that commits just after the fallback fired does not consume the loaded page\'s request (#1137)', () => {
    jest.useFakeTimers();
    let intent!: IntentModule;
    let nav!: typeof import('../../navigation/navigate-or-load');
    jest.isolateModules(() => {
      jest.doMock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() } }));
      intent = jest.requireActual('../autoplay-intent');
      nav = jest.requireActual('../../navigation/navigate-or-load');
    });
    const assign = jest.fn();
    window.history.replaceState(null, '', '/en/video/a');
    intent.requestAutoplay('next', { auto: true });
    // The countdown's push has not committed in time: the fallback starts loading the page...
    nav.navigateOrLoad(() => undefined, '/en/video/next', 2000, assign, 2000);
    jest.advanceTimersByTime(2000);
    expect(assign).toHaveBeenCalled();
    // ...then the client move commits after all and the next video mounts on this page
    intent.clearAutoplayIntent('next');
    // The loaded page still starts the video on its own
    const afterLoad = load();
    expect(afterLoad.hasAutoplayIntent('next')).toBe(true);
    expect(afterLoad.isAutoAdvance('next')).toBe(true);
  });

  it('expires: an old request never starts a later visit', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    const intent = load();
    load().requestAutoplay('next');
    jest.setSystemTime(Date.now() + intent.AUTOPLAY_INTENT_TTL_MS + 1);
    expect(load().hasAutoplayIntent('next')).toBe(false);
  });

  it('is never written to the URL', () => {
    const before = window.location.href;
    load().requestAutoplay('next');
    expect(window.location.href).toBe(before);
  });

  it('works in memory when storage is blocked', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const intent = load();
      intent.requestAutoplay('next');
      expect(intent.hasAutoplayIntent('next')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
