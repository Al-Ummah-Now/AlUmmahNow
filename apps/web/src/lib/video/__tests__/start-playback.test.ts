import { beginStart } from '../start-playback';

function player({ readyState = 0, paused = true } = {}) {
  const on: Record<string, Array<() => void>> = {};
  const once: Record<string, Array<() => void>> = {};
  const state = { readyState, paused, disposed: false };
  return {
    state,
    on: (e: string, fn: () => void) => { (on[e] ??= []).push(fn); },
    off: (e: string, fn: () => void) => { on[e] = (on[e] ?? []).filter((f) => f !== fn); },
    one: (e: string, fn: () => void) => { (once[e] ??= []).push(fn); },
    paused: () => state.paused,
    readyState: () => state.readyState,
    isDisposed: () => state.disposed,
    fire: (e: string) => {
      const due = once[e] ?? [];
      once[e] = [];
      [...(on[e] ?? []), ...due].forEach((fn) => fn());
    },
    listeners: (e: string) => (on[e] ?? []).length,
  };
}

describe('whenSourceAttached', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs without waiting for an event when the source has metadata, after a timer', () => {
    const fn = jest.fn();
    beginStart(player({ readyState: 1 })).whenSourceAttached(fn);
    expect(fn).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs once, after loadstart and the timer that Video.js clears its flag in', () => {
    const p = player();
    const order: string[] = [];
    // Video.js's, set just before the ready callbacks
    setTimeout(() => order.push('flag cleared'), 1);
    beginStart(p).whenSourceAttached(() => order.push('start'));
    jest.runAllTimers();
    expect(order).toEqual(['flag cleared']);
    p.fire('loadstart');
    p.fire('loadedmetadata');
    jest.runAllTimers();
    expect(order).toEqual(['flag cleared', 'start']);
  });

  it('a loadstart before that timer does not start before it', () => {
    const p = player();
    const order: string[] = [];
    setTimeout(() => order.push('flag cleared'), 1);
    beginStart(p).whenSourceAttached(() => order.push('start'));
    p.fire('loadstart');
    jest.runAllTimers();
    expect(order).toEqual(['flag cleared', 'start']);
  });

  it('runs at loadedmetadata when loadstart came before the player was ready', () => {
    const p = player();
    const fn = jest.fn();
    beginStart(p).whenSourceAttached(fn);
    p.fire('loadedmetadata');
    jest.runAllTimers();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each(['cancelled', 'disposed'])('does nothing when %s meanwhile, also after loadstart', (how) => {
    const p = player();
    const fn = jest.fn();
    const start = beginStart(p);
    start.whenSourceAttached(fn);
    p.fire('loadstart');
    if (how === 'cancelled') start.cancel();
    else p.state.disposed = true;
    jest.runAllTimers();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('afterReload', () => {
  it('runs at loadedmetadata (canplay never comes in WebKit while paused)', () => {
    const p = player();
    const fn = jest.fn();
    beginStart(p).afterReload(fn);
    p.fire('canplay');
    expect(fn).not.toHaveBeenCalled();
    p.fire('loadedmetadata');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1])('never after a pause (readyState %i)', (readyState) => {
    const p = player({ readyState, paused: false });
    const fn = jest.fn();
    const start = beginStart(p);
    p.state.paused = true;
    p.fire('pause');
    start.afterReload(fn);
    p.fire('loadedmetadata');
    p.fire('canplay');
    expect(fn).not.toHaveBeenCalled();
    expect(start.cancelled()).toBe(true);
  });

  it('never when it was paused while waiting for the new source', () => {
    const p = player();
    const fn = jest.fn();
    beginStart(p).afterReload(fn);
    p.fire('pause');
    p.fire('loadedmetadata');
    expect(fn).not.toHaveBeenCalled();
  });

  it('a pause event that comes while it plays again is not a pause (WebKit, after refusing sound)', () => {
    const p = player({ paused: false });
    const fn = jest.fn();
    const start = beginStart(p);
    p.fire('pause');
    start.afterReload(fn);
    p.fire('loadedmetadata');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops watching for pauses once it plays', () => {
    const p = player();
    beginStart(p);
    p.fire('playing');
    expect(p.listeners('pause')).toBe(0);
  });
});
