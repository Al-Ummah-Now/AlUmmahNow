import { PlayedTimeAccumulator, watchTimeReports } from '../watch-time';

/** Simulates timeupdate every 250 ms of wall time at the given playback rate. */
function play(acc: PlayedTimeAccumulator, from: { media: number; wall: number }, seconds: number, rate = 1) {
  let { media, wall } = from;
  for (let i = 0; i < seconds * 4; i++) {
    media += 0.25 * rate;
    wall += 250;
    acc.tick(media, wall);
  }
  return { media, wall };
}

describe('PlayedTimeAccumulator (#235)', () => {
  it('counts wall-clock seconds of normal playback', () => {
    const acc = new PlayedTimeAccumulator();
    acc.tick(0, 0);
    play(acc, { media: 0, wall: 0 }, 30);
    expect(acc.pending).toBeCloseTo(30, 5);
  });

  it('counts real time, not media time, at 2x speed', () => {
    const acc = new PlayedTimeAccumulator();
    acc.tick(0, 0);
    play(acc, { media: 0, wall: 0 }, 10, 2);
    expect(acc.pending).toBeCloseTo(10, 5);
  });

  it('adds nothing for a seek jump, a backwards seek, or a stalled/background gap', () => {
    const acc = new PlayedTimeAccumulator();
    acc.tick(10, 0);
    acc.tick(200, 250); // forward seek
    acc.tick(5, 500); // backward seek
    acc.tick(5.25, 30_500); // 30 s gap (tab in background)
    acc.tick(5.25, 30_750); // no media progress
    expect(acc.pending).toBe(0);
  });

  it('starts a new run after break()', () => {
    const acc = new PlayedTimeAccumulator();
    acc.tick(0, 0);
    let at = play(acc, { media: 0, wall: 0 }, 5);
    acc.break();
    at = { media: at.media, wall: at.wall + 60_000 }; // paused for a minute
    acc.tick(at.media, at.wall);
    play(acc, at, 5);
    expect(acc.pending).toBeCloseTo(10, 5);
  });

  it('drains in chunks of at most 60 s and keeps under a second for later', () => {
    const acc = new PlayedTimeAccumulator();
    acc.tick(0, 0);
    play(acc, { media: 0, wall: 0 }, 130.5);
    expect(acc.drain()).toEqual([60, 60, 10.5]);
    expect(acc.pending).toBe(0);

    const short = new PlayedTimeAccumulator();
    short.tick(0, 0);
    play(short, { media: 0, wall: 0 }, 0.75);
    expect(short.drain()).toEqual([]);
    expect(short.pending).toBeCloseTo(0.75, 5);
  });
});

describe('watchTimeReports', () => {
  it('keeps valid watch_time events only', () => {
    expect(
      watchTimeReports([
        { eventType: 'watch_time', videoId: 'v1', sessionId: 's1', data: { seconds: 30 } },
        { eventType: 'watch_time', videoId: 'v1', sessionId: 's1', data: { seconds: 61 } },
        { eventType: 'watch_time', videoId: 'v1', sessionId: 's1', data: { seconds: 0 } },
        { eventType: 'watch_time', videoId: 'v1', data: { seconds: 5 } },
        { eventType: 'ready', videoId: 'v1', sessionId: 's1' },
      ])
    ).toEqual([{ videoId: 'v1', sessionId: 's1', seconds: 30 }]);
  });
});
