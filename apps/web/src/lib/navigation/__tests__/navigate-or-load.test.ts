import { navigateOrLoad } from '../navigate-or-load';

jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() } }));

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

  it('a move that went nowhere loads the page', () => {
    navigateOrLoad(() => undefined, '/en/video/b?list=p&index=1', 2000, assign);
    jest.advanceTimersByTime(1999);
    expect(assign).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('/en/video/b?list=p&index=1'));
  });

  it('a later move by the viewer wins over the fallback', () => {
    navigateOrLoad(() => undefined, '/en/video/b?list=p&index=1', 2000, assign);
    window.history.pushState(null, '', '/en/video/c?list=p&index=2');
    jest.advanceTimersByTime(2500);
    expect(assign).not.toHaveBeenCalled();
  });
});
