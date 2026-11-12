import { QoeTracker, type QoePlayer, type QoeReport } from '../qoe';

function fakePlayer() {
  const handlers = new Map<string, Set<() => void>>();
  let bandwidth: number | undefined;
  const player: QoePlayer & { emit(e: string): void; setBandwidth(b: number): void; count(): number } = {
    on: (e, fn) => { if (!handlers.has(e)) handlers.set(e, new Set()); handlers.get(e)!.add(fn); },
    off: (e, fn) => handlers.get(e)?.delete(fn),
    paused: () => false,
    bandwidth: () => bandwidth,
    emit: (e) => handlers.get(e)?.forEach((fn) => fn()),
    setBandwidth: (b) => { bandwidth = b; },
    count: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
  };
  return player;
}

function setup(source: 'bunny' | 'r2' = 'r2') {
  let t = 0;
  const sent: QoeReport[] = [];
  const player = fakePlayer();
  const tracker = new QoeTracker(player, { sessionId: 'session-1', source, device: 'desktop', send: (r) => sent.push(r), now: () => t });
  return { player, tracker, sent, at: (ms: number) => { t = ms; } };
}

describe('QoeTracker', () => {
  it('measures startup, rebuffers after the first frame, watch time and time-weighted bitrate', () => {
    const { player, tracker, sent, at } = setup();
    at(0); player.emit('play');
    at(100); player.emit('waiting'); // before the first frame: startup, not a rebuffer
    player.setBandwidth(1_000_000);
    at(800); player.emit('playing');
    at(10_800); player.emit('waiting');
    at(11_300); player.emit('playing');
    player.setBandwidth(3_000_000);
    at(21_300); player.emit('timeupdate'); // switch: 10 s more at 1000 kbps closed
    at(31_300); player.emit('pause');
    tracker.flush();
    tracker.flush();
    expect(sent).toHaveLength(1);
    const r = sent[0];
    expect(r).toMatchObject({ sessionId: 'session-1', source: 'r2', started: true, startupMs: 800, rebuffers: 1, rebufferMs: 500, switches: 1, errors: 0, fallback: false, peakKbps: 3000 });
    expect(r.watchMs).toBe(30_000);
    // 20 s at 1000 + 10 s at 3000 → 1667 average
    expect(r.avgKbps).toBe(1667);
  });

  it('does not count seek buffering as a rebuffer', () => {
    const { player, tracker, sent, at } = setup();
    at(0); player.emit('play'); at(200); player.emit('playing');
    at(1000); player.emit('seeking'); player.emit('waiting');
    at(1500); player.emit('playing');
    at(2000); tracker.flush();
    expect(sent[0].rebuffers).toBe(0);
    expect(sent[0].rebufferMs).toBe(0);
    expect(sent[0].watchMs).toBe(1300);
  });

  it('keeps a fallback session on R2 with the fallback flag and counts errors', () => {
    const { player, tracker, sent, at } = setup('r2');
    at(0); player.emit('play'); player.emit('error');
    tracker.markFallback();
    at(900); player.emit('playing');
    at(1900); tracker.flush();
    expect(sent[0]).toMatchObject({ source: 'r2', fallback: true, errors: 1, started: true });
  });

  it('sends nothing for a player nobody pressed play on, and detaches its listeners', () => {
    const { player, tracker, sent } = setup('bunny');
    tracker.flush();
    expect(sent).toHaveLength(0);
    tracker.detach();
    expect(player.count()).toBe(0);
  });

  describe('live heartbeats', () => {
    function live(source: 'bunny' | 'r2' = 'r2') {
      let t = 0;
      let paused = false;
      const sent: QoeReport[] = [];
      const beats: QoeReport[] = [];
      const player = fakePlayer();
      player.paused = () => paused;
      const tracker = new QoeTracker(player, { sessionId: 'session-1', source, device: 'desktop', send: (r) => sent.push(r), beat: (r) => beats.push(r), now: () => t });
      return { player, tracker, sent, beats, at: (ms: number) => { t = ms; }, pause: (p: boolean) => { paused = p; } };
    }

    it('reports the first frame at once, then only deltas; the final report carries the rest', () => {
      const { player, tracker, sent, beats, at } = live();
      at(0); player.emit('play');
      player.setBandwidth(2_000_000);
      at(600); player.emit('playing');
      expect(beats).toHaveLength(1);
      expect(beats[0]).toMatchObject({ kind: 'heartbeat', serving: 'r2', playing: true, live: { attempt: true, started: true, startupMs: 600, watchMs: 0 } });
      at(30_600); tracker.heartbeat();
      expect(beats[1].live).toEqual({ watchMs: 30_000, rebufferMs: 0, rebuffers: 0, avgKbps: 2000 });
      at(40_600); tracker.flush();
      expect(sent[0]).toMatchObject({ watchMs: 40_000, serving: 'r2', live: { watchMs: 10_000, rebufferMs: 0, rebuffers: 0, avgKbps: 2000 } });
      expect(sent[0].kind).toBeUndefined();
      tracker.heartbeat();
      expect(beats).toHaveLength(2);
    });

    it('a fallback and the first error are reported at once; the session is then served by Bunny', () => {
      const { player, tracker, beats, at } = live('r2');
      at(0); player.emit('play'); player.emit('error');
      expect(beats[0].live).toMatchObject({ attempt: true, errored: true });
      tracker.markFallback();
      expect(beats[1]).toMatchObject({ source: 'r2', serving: 'bunny', live: { fallback: true } });
      player.emit('error');
      expect(beats).toHaveLength(2);
    });

    it('a paused player with nothing new sends nothing after saying it stopped', () => {
      const { player, tracker, beats, at, pause } = live('bunny');
      at(0); player.emit('play'); at(500); player.emit('playing');
      at(10_000); pause(true); player.emit('pause');
      tracker.heartbeat();
      expect(beats[beats.length - 1]).toMatchObject({ playing: false });
      const n = beats.length;
      at(40_000); tracker.heartbeat();
      expect(beats).toHaveLength(n);
    });

    it('nothing before play is asked for', () => {
      const { tracker, beats } = live();
      tracker.heartbeat();
      expect(beats).toHaveLength(0);
    });
  });
});
