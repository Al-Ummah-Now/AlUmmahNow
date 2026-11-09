import { RetentionTracker, retentionReports } from '../retention';

const D = 100; // seconds, so one bucket is 5 s

/** Plays from..to in steps of `step` seconds at real time. */
function play(t: RetentionTracker, from: number, to: number, startMs = 0, step = 1): number {
  let wall = startMs;
  for (let time = from; time <= to; time += step) {
    t.tick(time, D, wall);
    wall += step * 1000;
  }
  return wall;
}

describe('RetentionTracker', () => {
  it('reaches each bucket the playback passes through', () => {
    const t = new RetentionTracker();
    play(t, 0, 12);
    expect(t.drain()).toEqual([0, 1, 2]);
  });

  it('reports a bucket once, also after watching it again', () => {
    const t = new RetentionTracker();
    let wall = play(t, 0, 6);
    expect(t.drain()).toEqual([0, 1]);
    t.break();
    wall = play(t, 0, 6, wall + 1000);
    expect(t.drain()).toEqual([]);
    expect(wall).toBeGreaterThan(0);
  });

  it('does not fill buckets skipped by a seek', () => {
    const t = new RetentionTracker();
    const wall = play(t, 0, 2);
    t.break();
    play(t, 50, 52, wall + 500);
    expect(t.drain()).toEqual([0, 10]);
  });

  it('treats a position jump with no seek event as a break', () => {
    const t = new RetentionTracker();
    t.tick(1, D, 0);
    t.tick(50, D, 1000);
    t.tick(51, D, 2000);
    expect(t.drain()).toEqual([0, 10]);
  });

  it('ignores a session that did not start at the beginning', () => {
    const t = new RetentionTracker();
    play(t, 40, 60);
    expect(t.drain()).toEqual([]);
  });

  it('fills every bucket of a very short video on one step', () => {
    const t = new RetentionTracker();
    t.tick(0, 2, 0);
    t.tick(0.5, 2, 500);
    expect(t.drain()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('puts the end of the video in the last bucket', () => {
    const t = new RetentionTracker();
    t.tick(0, D, 0);
    t.break();
    t.tick(99.5, D, 1000);
    t.tick(100, D, 1500);
    expect(t.drain()).toEqual([0, 19]);
  });

  it.each([0, NaN, Infinity, -1])('ignores a duration of %s', (duration) => {
    const t = new RetentionTracker();
    t.tick(0, duration, 0);
    t.tick(1, duration, 1000);
    expect(t.drain()).toEqual([]);
  });

  it('counts what is pending and empties on drain', () => {
    const t = new RetentionTracker();
    play(t, 0, 16);
    expect(t.pending).toBe(4);
    t.drain();
    expect(t.pending).toBe(0);
  });
});

describe('retentionReports', () => {
  const valid = { eventType: 'retention', videoId: 'v1', sessionId: 'session-1234', data: { buckets: [0, 1] } };

  it('keeps a valid report', () => {
    expect(retentionReports([valid])).toEqual([{ videoId: 'v1', sessionId: 'session-1234', buckets: [0, 1] }]);
  });

  it.each([
    [{ ...valid, eventType: 'play' }],
    [{ ...valid, videoId: '' }],
    [{ ...valid, sessionId: undefined }],
    [{ ...valid, data: { buckets: [] } }],
    [{ ...valid, data: { buckets: [20] } }],
    [{ ...valid, data: { buckets: 'x' } }],
    [{ ...valid, data: undefined }],
  ])('drops %j', (event) => {
    expect(retentionReports([event as never])).toEqual([]);
  });
});
