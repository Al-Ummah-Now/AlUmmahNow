/** Live detection that does not depend on the tracker's window threshold (lib/video/live-state.ts) */
import { isLivePlayback, isTrackingLive, syncDurationWithPlaylist } from '../live-state';

const player = (tracking: boolean | undefined, duration: number) => ({
  liveTracker: tracking === undefined ? undefined : { isLive: () => tracking },
  duration: () => duration,
});

describe('isLivePlayback', () => {
  it('is live while the tracker runs', () => {
    expect(isLivePlayback(player(true, Infinity))).toBe(true);
    expect(isTrackingLive(player(true, Infinity))).toBe(true);
  });

  it('is live with a window too short for the tracker (unbounded duration)', () => {
    expect(isLivePlayback(player(false, Infinity))).toBe(true);
    expect(isTrackingLive(player(false, Infinity))).toBe(false);
  });

  it('is live without a tracker at all', () => {
    expect(isLivePlayback(player(undefined, Infinity))).toBe(true);
  });

  it('is not live for a video with a duration, or before metadata', () => {
    expect(isLivePlayback(player(false, 90))).toBe(false);
    expect(isLivePlayback(player(false, NaN))).toBe(false);
  });
});

describe('syncDurationWithPlaylist', () => {
  function fakeTech() {
    const handlers = new Map<string, Set<() => void>>();
    const fired: string[] = [];
    return {
      fired,
      on: (type: string, fn: () => void) => {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type)!.add(fn);
      },
      off: (type: string, fn: () => void) => handlers.get(type)?.delete(fn),
      trigger: (type: string) => {
        fired.push(type);
        handlers.get(type)?.forEach((fn) => fn());
      },
    };
  }

  it('reads the duration again each time the playlist moves the seekable window', () => {
    const tech = fakeTech();
    const stop = syncDurationWithPlaylist({ tech: () => tech });
    tech.trigger('seekablechanged');
    tech.trigger('seekablechanged');
    expect(tech.fired.filter((t) => t === 'durationchange')).toHaveLength(2);
    stop();
    tech.trigger('seekablechanged');
    expect(tech.fired.filter((t) => t === 'durationchange')).toHaveLength(2);
  });

  it('does nothing without a tech', () => {
    expect(() => syncDurationWithPlaylist({ tech: () => undefined })()).not.toThrow();
  });
});
