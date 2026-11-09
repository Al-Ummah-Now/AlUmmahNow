/** The progress bar follows a seek made while paused (lib/video/seek-bar-sync.ts) */
import { keepSeekBarOnPlayhead, SEEK_BAR_THROTTLE_MS } from '../seek-bar-sync';

function fakePlayer(seekBar: { update: jest.Mock } | undefined) {
  const handlers = new Map<string, Set<() => void>>();
  const child = (c: unknown) => ({ getChild: () => c as never });
  return {
    handlers,
    getChild: (name: string) => (name === 'ControlBar' ? { getChild: () => child(seekBar) } : undefined),
    on: (t: string, fn: () => void) => { if (!handlers.has(t)) handlers.set(t, new Set()); handlers.get(t)!.add(fn); },
    off: (t: string, fn: () => void) => handlers.get(t)?.delete(fn),
    setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
    clearTimeout: (id: number) => window.clearTimeout(id),
    emit: (t: string) => handlers.get(t)?.forEach((fn) => fn()),
  };
}

describe('keepSeekBarOnPlayhead', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('redraws the bar once after a seek, outside Video.js\'s throttle window', () => {
    const seekBar = { update: jest.fn() };
    const p = fakePlayer(seekBar);
    keepSeekBarOnPlayhead(p);
    p.emit('seeked');
    jest.advanceTimersByTime(SEEK_BAR_THROTTLE_MS);
    expect(seekBar.update).not.toHaveBeenCalled();
    jest.advanceTimersByTime(20);
    expect(seekBar.update).toHaveBeenCalledTimes(1);
  });

  it('redraws once for a burst of seeks (scrubbing)', () => {
    const seekBar = { update: jest.fn() };
    const p = fakePlayer(seekBar);
    keepSeekBarOnPlayhead(p);
    p.emit('seeked');
    jest.advanceTimersByTime(10);
    p.emit('seeked');
    jest.advanceTimersByTime(100);
    expect(seekBar.update).toHaveBeenCalledTimes(1);
  });

  it('stops on release, and copes with a player without a seek bar', () => {
    const seekBar = { update: jest.fn() };
    const p = fakePlayer(seekBar);
    const stop = keepSeekBarOnPlayhead(p);
    p.emit('seeked');
    stop();
    jest.advanceTimersByTime(100);
    expect(seekBar.update).not.toHaveBeenCalled();
    const bare = fakePlayer(undefined);
    keepSeekBarOnPlayhead(bare);
    bare.emit('seeked');
    expect(() => jest.advanceTimersByTime(100)).not.toThrow();
  });
});
