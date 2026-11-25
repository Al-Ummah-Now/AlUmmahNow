/** A bar that can still be seen takes the tap (lib/video/bar-fade.ts, #2024) */
import { BAR_FADE_GRACE_MS, BAR_FADING_CLASS, keepBarTappableWhileItFades } from '../bar-fade';

function fakePlayer(withBar = true) {
  const handlers = new Map<string, Set<() => void>>();
  const el = document.createElement('div');
  const bar = withBar ? document.createElement('div') : null;
  const userActive = jest.fn();
  return {
    bar,
    userActive,
    fading: () => el.classList.contains(BAR_FADING_CLASS),
    el: () => el,
    getChild: (name: string) => (name === 'ControlBar' && bar ? { el: () => bar } : undefined),
    on: (t: string, fn: () => void) => { if (!handlers.has(t)) handlers.set(t, new Set()); handlers.get(t)!.add(fn); },
    off: (t: string, fn: () => void) => { handlers.get(t)?.delete(fn); },
    setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
    clearTimeout: (id: number) => window.clearTimeout(id),
    emit: (t: string) => handlers.get(t)?.forEach((fn) => fn()),
  };
}

describe('keepBarTappableWhileItFades', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('marks the start of the fade, and no longer', () => {
    const p = fakePlayer();
    keepBarTappableWhileItFades(p);
    expect(p.fading()).toBe(false);
    p.emit('userinactive');
    expect(p.fading()).toBe(true);
    jest.advanceTimersByTime(BAR_FADE_GRACE_MS - 1);
    expect(p.fading()).toBe(true);
    jest.advanceTimersByTime(1);
    expect(p.fading()).toBe(false);
  });

  it('ends at once when the viewer is active again, and a new fade gets its full time', () => {
    const p = fakePlayer();
    keepBarTappableWhileItFades(p);
    p.emit('userinactive');
    jest.advanceTimersByTime(BAR_FADE_GRACE_MS - 100);
    p.emit('useractive');
    expect(p.fading()).toBe(false);
    p.emit('userinactive');
    jest.advanceTimersByTime(200); // past the first fade's timer
    expect(p.fading()).toBe(true);
  });

  it('with reduced motion the bar is gone at once: nothing is marked', () => {
    const original = window.matchMedia;
    window.matchMedia = jest.fn((query: string) => ({ matches: /prefers-reduced-motion: reduce/.test(query) })) as unknown as typeof window.matchMedia;
    try {
      const p = fakePlayer();
      keepBarTappableWhileItFades(p);
      p.emit('userinactive');
      expect(p.fading()).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it('a finger put down on the bar is activity', () => {
    const p = fakePlayer();
    keepBarTappableWhileItFades(p);
    p.bar!.dispatchEvent(new Event('touchstart', { bubbles: true }));
    expect(p.userActive).toHaveBeenCalledWith(true);
  });

  it('stops on release, and copes with a player without a bar', () => {
    const p = fakePlayer();
    const stop = keepBarTappableWhileItFades(p);
    p.emit('userinactive');
    stop();
    expect(p.fading()).toBe(false);
    p.emit('userinactive');
    p.bar!.dispatchEvent(new Event('touchstart'));
    expect(p.fading()).toBe(false);
    expect(p.userActive).not.toHaveBeenCalled();
    const bare = fakePlayer(false);
    expect(() => keepBarTappableWhileItFades(bare)()).not.toThrow();
  });
});
