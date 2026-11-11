import type { LiveQoeBeacon } from '@al-ummah/shared-types';
import {
  LiveQoeMonitor,
  clockOffset,
  isSampled,
  latencyMs,
  programTimeAt,
  qoeForced,
  resetSamplingForTests,
  type QoePlayerSource,
  type SegmentLike,
} from '../qoe';

jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

describe('sampling', () => {
  beforeEach(resetSamplingForTests);

  it('samples with the given probability', () => {
    expect(isSampled(0.2, { random: () => 0.19 })).toBe(true);
    resetSamplingForTests();
    expect(isSampled(0.2, { random: () => 0.2 })).toBe(false);
    resetSamplingForTests();
    expect(isSampled(0, { random: () => 0 })).toBe(false);
  });

  it('decides once per page load', () => {
    expect(isSampled(1, { random: () => 0.5 })).toBe(true);
    expect(isSampled(0, { random: () => 0.5 })).toBe(true);
    resetSamplingForTests();
    expect(isSampled(0, { random: () => 0.5 })).toBe(false);
    expect(isSampled(1, { random: () => 0 })).toBe(false);
  });

  it('?liveqoe=1 forces sampling on', () => {
    expect(qoeForced('?liveqoe=1')).toBe(true);
    expect(qoeForced('?liveqoe=0')).toBe(false);
    expect(isSampled(0, { forced: qoeForced('?a=b&liveqoe=1') })).toBe(true);
  });

  it('clamps nonsense rates', () => {
    expect(isSampled(Number.NaN, { random: () => 0 })).toBe(false);
    resetSamplingForTests();
    expect(isSampled(5, { random: () => 0.999 })).toBe(true);
  });
});

describe('clock offset', () => {
  it('uses the server time at the middle of the round trip', () => {
    expect(clockOffset({ sentAt: 1000, receivedAt: 1200, serverNow: 5100 })).toBe(4000);
  });

  it('falls back to the Date header (second resolution: its midpoint)', () => {
    const header = new Date(10_000).toUTCString();
    expect(clockOffset({ sentAt: 9_000, receivedAt: 9_400, dateHeader: header })).toBe(10_000 + 500 - 9_200);
  });

  it('is unknown without either', () => {
    expect(clockOffset({ sentAt: 1, receivedAt: 2 })).toBeNull();
    expect(clockOffset({ sentAt: 1, receivedAt: 2, dateHeader: 'nonsense' })).toBeNull();
  });
});

describe('latency math', () => {
  const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);
  const segs = (n: number, duration = 2, withStart = false): SegmentLike[] =>
    Array.from({ length: n }, (_, i) => ({ duration, dateTimeObject: new Date(T0 + i * duration * 1000), ...(withStart ? { start: 100 + i * duration } : {}) }));

  it('reads the program date-time at the playhead from known segment positions', () => {
    // Segment 2 starts at 104 s; 1.5 s into it
    expect(programTimeAt(segs(5, 2, true), 105.5, null)).toBe(T0 + 4000 + 1500);
  });

  it('fills unknown positions from the nearest known segment', () => {
    const list = segs(4);
    list[2].start = 50;
    expect(programTimeAt(list, 47, null)).toBe(T0 + 1000); // segment 0 starts at 46
    expect(programTimeAt(list, 53, null)).toBe(T0 + 7000); // segment 3 starts at 52
  });

  it('anchors the last segment at the live edge when no position is known', () => {
    // 3 segments of 2 s ending at 30 s: they start at 24, 26 and 28
    expect(programTimeAt(segs(3), 29, 30)).toBe(T0 + 4000 + 1000);
    expect(programTimeAt(segs(3), 29, null)).toBeNull();
  });

  it('needs PROGRAM-DATE-TIME', () => {
    expect(programTimeAt([{ duration: 2, start: 0 }], 1, null)).toBeNull();
    expect(programTimeAt([], 1, 2)).toBeNull();
  });

  it('latency is the corrected now minus the program time, within bounds', () => {
    expect(latencyMs(T0, T0 + 4000, 1000)).toBe(5000);
    expect(latencyMs(T0, T0 + 4000, null)).toBe(4000);
    expect(latencyMs(T0, T0 - 5000, 0)).toBeNull();
    expect(latencyMs(null, T0, 0)).toBeNull();
    expect(latencyMs(T0, T0 + 700_000, 0)).toBeNull();
  });
});

class FakePlayer implements QoePlayerSource {
  private listeners = new Map<string, Set<() => void>>();
  time = 0;
  isPaused = true;
  isSeeking = false;
  edge: number | null = 30;
  list: SegmentLike[] | null = null;
  media = { id: 'r720', bandwidth: 2_500_000 };
  dropped = 0;
  on(event: string, fn: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
  off(event: string, fn: () => void) {
    this.listeners.get(event)?.delete(fn);
  }
  emit(event: string) {
    if (event === 'playing') this.isPaused = false;
    if (event === 'pause') this.isPaused = true;
    this.listeners.get(event)?.forEach((fn) => fn());
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
  currentTime() { return this.time; }
  paused() { return this.isPaused; }
  seeking() { return this.isSeeking; }
  seekableEnd() { return this.edge; }
  liveEdge() { return null; }
  segments() { return this.list; }
  startDate() { return null; }
  rendition() { return this.media; }
  droppedFrames() { return this.dropped; }
  errorCode() { return 'MEDIA_ERR_2'; }
}

describe('LiveQoeMonitor', () => {
  let now = 0;
  let sent: LiveQoeBeacon[];
  let player: FakePlayer;
  const make = (extra: Partial<ConstructorParameters<typeof LiveQoeMonitor>[1]> = {}) =>
    new LiveQoeMonitor(player, {
      streamId: 's1',
      sessionId: 'sess1',
      provider: 'selfhosted',
      beaconUrl: 'https://api.example/api/live-streams/s1/qoe',
      clockOffsetMs: 0,
      attachedAt: 1_000,
      now: () => now,
      send: (_url, beacon) => sent.push(beacon),
      ...extra,
    });

  beforeEach(() => {
    jest.useFakeTimers();
    now = 1_000;
    sent = [];
    player = new FakePlayer();
  });
  afterEach(() => {
    jest.useRealTimers();
    delete (window as unknown as { __liveQoe?: unknown }).__liveQoe;
  });

  it('sends start once at the first frame with the startup time, then a window every 30 s', () => {
    const monitor = make().start();
    now = 1_800;
    player.emit('play');
    now = 2_500;
    player.emit('playing');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'start', startupMs: 700, streamId: 's1', sessionId: 'sess1', provider: 'selfhosted', watchMs: 0 });
    // A second 'playing' (after a pause) is not a new start
    player.emit('pause');
    player.emit('playing');
    expect(sent.filter((b) => b.kind === 'start')).toHaveLength(1);

    now += 30_000;
    jest.advanceTimersByTime(30_000);
    const window = sent.find((b) => b.kind === 'window')!;
    expect(window).toBeDefined();
    expect(window.watchMs).toBe(30_000);
    expect(window.startupMs).toBeUndefined();
    monitor.stop();
  });

  it('counts rebuffers (waiting → playing) per window, not during seeks or startup', () => {
    const monitor = make().start();
    player.emit('waiting'); // startup: not a rebuffer
    now = 2_000;
    player.emit('playing');
    now = 5_000;
    player.emit('waiting');
    now = 6_500;
    player.emit('playing');
    player.isSeeking = true;
    player.emit('waiting');
    player.isSeeking = false;
    expect(monitor.stats.window).toMatchObject({ rebufferCount: 1, rebufferMs: 1_500 });
    now = 10_000;
    monitor.flushWindow();
    const window = sent.at(-1)!;
    expect(window).toMatchObject({ kind: 'window', rebufferCount: 1, rebufferMs: 1_500, watchMs: 3_000 + 3_500 });
    // The next window starts empty
    expect(monitor.stats.window).toMatchObject({ rebufferCount: 0, rebufferMs: 0, watchMs: 0 });
    expect(monitor.stats.total.rebufferCount).toBe(1);
    monitor.stop();
  });

  it('samples latency, live edge, bitrate, switches and dropped frames on each tick', () => {
    const T0 = 1_700_000_000_000;
    player.list = [0, 1, 2].map((i) => ({ duration: 2, dateTimeObject: new Date(T0 + i * 2000) }));
    player.edge = 30;
    player.time = 27;
    now = T0 + 9_000;
    const monitor = make({ clockOffsetMs: 500, attachedAt: now }).start();
    player.emit('playing');
    monitor.tick();
    // Segments start at 24, 26, 28: playhead 27 is 1 s into segment 1 (T0 + 3 s); now + 0.5 s offset − that
    expect(monitor.stats.lastLatencyMs).toBe(9_000 + 500 - 3_000);
    expect(monitor.stats.liveEdgeSec).toBe(3);
    expect(monitor.stats.bitrateKbps).toBe(2_500);
    player.media = { id: 'r480', bandwidth: 1_000_000 };
    player.dropped = 12;
    monitor.tick();
    player.dropped = 20;
    monitor.tick();
    expect(monitor.stats.window).toMatchObject({ renditionSwitches: 1, droppedFrames: 20 });
    expect(monitor.stats.window.latencyMs).toHaveLength(3);
    monitor.stop();
  });

  it('records errors with the player code', () => {
    const monitor = make().start();
    player.emit('playing');
    player.emit('error');
    expect(monitor.stats).toMatchObject({ errorCode: 'MEDIA_ERR_2' });
    expect(monitor.stats.window.errors).toBe(1);
    monitor.stop();
    expect(sent.at(-1)).toMatchObject({ kind: 'end', errors: 1, errorCode: 'MEDIA_ERR_2' });
  });

  it('sends end once on pagehide and detaches', () => {
    make().start();
    player.emit('playing');
    now = 4_000;
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    expect(sent.map((b) => b.kind)).toEqual(['start', 'end']);
    expect(sent[1].watchMs).toBe(3_000);
    expect(player.listenerCount()).toBe(0);
    jest.advanceTimersByTime(120_000);
    expect(sent).toHaveLength(2);
  });

  it('sends nothing when the viewer never saw a frame', () => {
    const monitor = make().start();
    jest.advanceTimersByTime(60_000);
    monitor.stop();
    expect(sent).toEqual([]);
  });

  it('never carries a user id; the viewer key is random per monitor', () => {
    make().start();
    player.emit('playing');
    const keys = Object.keys(sent[0]);
    expect(keys).not.toEqual(expect.arrayContaining(['userId']));
    const other = make();
    expect(other.stats.viewerKey).not.toBe(sent[0].viewerKey);
  });

  it('exposes the stats on window.__liveQoe when asked', () => {
    const monitor = make({ expose: true }).start();
    expect((window as unknown as { __liveQoe?: unknown }).__liveQoe).toBe(monitor.stats);
    monitor.stop();
    const hidden = make().start();
    expect((window as unknown as { __liveQoe?: unknown }).__liveQoe).toBe(monitor.stats);
    hidden.stop();
  });
});
