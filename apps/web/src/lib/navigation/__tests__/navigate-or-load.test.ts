import { navigateOrLoad } from '../navigate-or-load';

jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() } }));

/** window.fetch as the router sees it: each test decides what the next request does */
let fetchImpl: (input: unknown) => Promise<unknown> = () => new Promise(() => undefined);
const fetchCalls: unknown[] = [];
(window as unknown as { fetch: unknown }).fetch = (input: unknown) => {
  fetchCalls.push(input);
  return fetchImpl(input);
};

describe('navigateOrLoad', () => {
  const assign = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers();
    assign.mockReset();
    window.history.replaceState(null, '', '/en/video/a?list=p&index=0');
  });
  afterEach(() => jest.useRealTimers());

  it('a client move that commits needs nothing more', () => {
    navigateOrLoad((href) => window.history.pushState(null, '', href), '/en/video/b?list=p&index=1', 2000, assign);
    jest.advanceTimersByTime(2500);
    expect(assign).not.toHaveBeenCalled();
  });

  it('a move that went nowhere loads the page once it has stalled', () => {
    navigateOrLoad(() => undefined, '/en/video/b?list=p&index=1', 2000, assign, 10_000);
    jest.advanceTimersByTime(9_999);
    expect(assign).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('/en/video/b?list=p&index=1'));
  });

  describe('with resource timing', () => {
    /** A stand-in for the browser's PerformanceObserver: `arrive` reports a finished request */
    let observers: Array<(list: { getEntries: () => Array<{ name: string; startTime: number }> }) => void> = [];
    const arrive = (url: string) => {
      for (const cb of [...observers]) cb({ getEntries: () => [{ name: new URL(url, window.location.href).toString(), startTime: performance.now() }] });
    };
    const original = (global as { PerformanceObserver?: unknown }).PerformanceObserver;
    beforeEach(() => {
      observers = [];
      class FakeObserver {
        static supportedEntryTypes = ['resource'];
        constructor(private cb: (list: { getEntries: () => Array<{ name: string; startTime: number }> }) => void) {}
        observe() { observers.push(this.cb); }
        disconnect() { observers = observers.filter((cb) => cb !== this.cb); }
      }
      (global as { PerformanceObserver?: unknown }).PerformanceObserver = FakeObserver;
    });
    afterEach(() => {
      (global as { PerformanceObserver?: unknown }).PerformanceObserver = original;
    });

    it('fetched and never committed: loads the page 2 s after the data arrived (#1137)', () => {
      navigateOrLoad(() => undefined, '/en/video/b?list=p&index=1', 2000, assign, 10_000);
      jest.advanceTimersByTime(500);
      arrive('/en/video/b?list=p&index=1&_rsc=abc12');
      jest.advanceTimersByTime(1_900);
      expect(assign).not.toHaveBeenCalled();
      jest.advanceTimersByTime(200);
      expect(assign).toHaveBeenCalledWith(expect.stringContaining('/en/video/b?list=p&index=1'));
    });

    it('a move whose data is slower than 2 s is left to commit, not replaced by a page load', () => {
      const href = '/en/video/b?list=p&index=1';
      navigateOrLoad(() => undefined, href, 2000, assign, 10_000);
      // The server answers after 3 s and the router commits 200 ms later
      jest.advanceTimersByTime(3_000);
      arrive(`${href}&_rsc=abc12`);
      jest.advanceTimersByTime(200);
      window.history.pushState(null, '', href);
      jest.advanceTimersByTime(10_000);
      expect(assign).not.toHaveBeenCalled();
    });

    it("another address's data does not count as this move's", () => {
      navigateOrLoad(() => undefined, '/en/video/b?list=p&index=1', 2000, assign, 10_000);
      arrive('/en/video/c?list=p&index=2&_rsc=abc12');
      arrive('/en/video/b?list=p&index=1');
      jest.advanceTimersByTime(5_000);
      expect(assign).not.toHaveBeenCalled();
      jest.advanceTimersByTime(5_100);
      expect(assign).toHaveBeenCalledTimes(1);
    });

    /** A request the test settles by hand */
    const pending = () => {
      let answer!: () => void;
      let fail!: () => void;
      const promise = new Promise<unknown>((resolve, reject) => {
        answer = () => resolve({ ok: true });
        fail = () => reject(new TypeError('network'));
      });
      return { promise, answer, fail };
    };
    const routerPush = (req: Promise<unknown>) => (href: string) => {
      fetchImpl = () => req;
      // As Next's router does: the page's data from the address, with `_rsc` added
      void window.fetch(new URL(`${href}&_rsc=abc12`, window.location.href) as unknown as RequestInfo).catch(() => undefined);
    };
    const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

    it('an answer still streaming past the deadlines is left to the router (CI dev server: 3.2 s + 6.8 s)', async () => {
      const href = '/en/video/b?list=p&index=1';
      const req = pending();
      navigateOrLoad(routerPush(req.promise), href, 2000, assign, 10_000);
      jest.advanceTimersByTime(3_200);
      req.answer();
      await flush();
      jest.advanceTimersByTime(20_000);
      expect(assign).not.toHaveBeenCalled();
      // The last byte arrives; the router commits
      arrive(`${href}&_rsc=abc12`);
      jest.advanceTimersByTime(300);
      window.history.pushState(null, '', href);
      jest.advanceTimersByTime(10_000);
      expect(assign).not.toHaveBeenCalled();
    });

    it('a server that never answers: loads the page `stallMs` after the request', () => {
      const req = pending();
      navigateOrLoad(routerPush(req.promise), '/en/video/b?list=p&index=1', 2000, assign, 10_000);
      jest.advanceTimersByTime(9_999);
      expect(assign).not.toHaveBeenCalled();
      jest.advanceTimersByTime(200);
      expect(assign).toHaveBeenCalledTimes(1);
    });

    it('answered and fully arrived but never committed: loads the page 2 s after the data ended', async () => {
      const href = '/en/video/b?list=p&index=1';
      const req = pending();
      navigateOrLoad(routerPush(req.promise), href, 2000, assign, 10_000);
      req.answer();
      await flush();
      jest.advanceTimersByTime(4_000);
      arrive(`${href}&_rsc=abc12`);
      jest.advanceTimersByTime(1_900);
      expect(assign).not.toHaveBeenCalled();
      jest.advanceTimersByTime(200);
      expect(assign).toHaveBeenCalledTimes(1);
    });

    it('a failed request: loads the page 2 s later', async () => {
      const req = pending();
      navigateOrLoad(routerPush(req.promise), '/en/video/b?list=p&index=1', 2000, assign, 10_000);
      jest.advanceTimersByTime(500);
      req.fail();
      await flush();
      jest.advanceTimersByTime(1_900);
      expect(assign).not.toHaveBeenCalled();
      jest.advanceTimersByTime(200);
      expect(assign).toHaveBeenCalledTimes(1);
    });

    it('passes every fetch through untouched, and ignores requests for other addresses', async () => {
      const own = Promise.resolve({ ok: true });
      fetchImpl = () => own;
      navigateOrLoad(() => undefined, '/en/video/b?list=p&index=1', 2000, assign, 10_000);
      expect(window.fetch('/en/video/c?list=p&index=2&_rsc=x')).toBe(own);
      expect(window.fetch('/api/thing')).toBe(own);
      await flush();
      // Neither was this move's: it still waits for its own request, then gives up at `stallMs`
      jest.advanceTimersByTime(10_100);
      expect(assign).toHaveBeenCalledTimes(1);
    });

    it('a prefetch of the same page that started before the move does not count as its data', () => {
      navigateOrLoad(() => undefined, '/en/video/b?list=p&index=1', 2000, assign, 10_000);
      for (const cb of [...observers]) cb({ getEntries: () => [{ name: new URL('/en/video/b?list=p&index=1&_rsc=pre', window.location.href).toString(), startTime: performance.now() - 5_000 }] });
      jest.advanceTimersByTime(5_000);
      expect(assign).not.toHaveBeenCalled();
    });

    it('stops watching once the move commits', () => {
      navigateOrLoad((href) => window.history.pushState(null, '', href), '/en/video/b?list=p&index=1', 2000, assign, 10_000);
      jest.advanceTimersByTime(200);
      expect(observers).toHaveLength(0);
    });
  });

  it('a later move by the viewer wins over the fallback', () => {
    navigateOrLoad(() => undefined, '/en/video/b?list=p&index=1', 2000, assign);
    window.history.pushState(null, '', '/en/video/c?list=p&index=2');
    jest.advanceTimersByTime(2500);
    expect(assign).not.toHaveBeenCalled();
  });

  it('a move that commits and is then undone by Back does not load the target (seamless next)', () => {
    navigateOrLoad((href) => window.history.pushState(null, '', href), '/en/video/b?list=p&index=1', 2000, assign);
    // The move commits, then the viewer goes Back before the fallback's deadline
    jest.advanceTimersByTime(500);
    window.history.replaceState(null, '', '/en/video/a?list=p&index=0');
    jest.advanceTimersByTime(2000);
    expect(assign).not.toHaveBeenCalled();
  });
});
