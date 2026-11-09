import {
  formatResumeTime,
  hasWatchedEnough,
  playbackStep,
  resumePosition,
  startOverStillRelevant,
  START_OVER_GRACE_SECONDS,
} from '../resume';

const p = (currentTime: number, duration = 600, completed = false) => ({ currentTime, duration, completed });

describe('resumePosition', () => {
  it('resumes from 10 s in up to 95% and 10 s before the end', () => {
    expect(resumePosition(p(10))).toBe(10);
    expect(resumePosition(p(300))).toBe(300);
    expect(resumePosition(p(570))).toBe(570); // exactly 95% of 600
    // Long lecture: a few minutes in is worth resuming (no 5% floor any more)
    expect(resumePosition(p(120, 7200))).toBe(120);
  });

  it('starts from the beginning for a position near 0', () => {
    expect(resumePosition(p(0))).toBeNull();
    expect(resumePosition(p(9.9))).toBeNull();
  });

  it('starts from the beginning when the video is essentially finished', () => {
    expect(resumePosition(p(571))).toBeNull(); // > 95%
    // 95% of a 100 s video is 95 s, but that is within the final 10 s
    expect(resumePosition(p(91, 100))).toBeNull();
    expect(resumePosition(p(89, 100))).toBe(89);
  });

  it('never resumes shorts (60 s or less)', () => {
    expect(resumePosition(p(30, 60))).toBeNull();
    expect(resumePosition(p(30, 61))).toBe(30);
  });

  it('does not resume completed, live, missing or corrupt progress', () => {
    expect(resumePosition(p(300, 600, true))).toBeNull();
    expect(resumePosition(p(300), true)).toBeNull();
    expect(resumePosition(null)).toBeNull();
    expect(resumePosition(p(300, 0))).toBeNull();
    expect(resumePosition(p(NaN))).toBeNull();
  });
});

describe('playbackStep / hasWatchedEnough', () => {
  it('counts normal forward playback steps', () => {
    expect(playbackStep(10, 10.25)).toBeCloseTo(0.25);
    expect(playbackStep(10, 11)).toBe(1); // 4x speed
  });

  it('ignores the first sample, seeks, rewinds and stalls', () => {
    expect(playbackStep(null, 5)).toBe(0);
    expect(playbackStep(0, 300)).toBe(0); // seek / resume jump
    expect(playbackStep(300, 0)).toBe(0); // start over
    expect(playbackStep(5, 5)).toBe(0);
    expect(playbackStep(5, NaN)).toBe(0);
  });

  it('needs 10 s of real playback, not 10 s of position', () => {
    let watched = 0;
    let last: number | null = null;
    // A seek to 5 min then 9.75 s of playback: still not enough
    for (const t of [0, 300, ...Array.from({ length: 40 }, (_, i) => 300 + (i + 1) * 0.25)]) {
      watched += playbackStep(last, t);
      last = t;
    }
    expect(watched).toBeCloseTo(10);
    expect(hasWatchedEnough(9.99)).toBe(false);
    expect(hasWatchedEnough(watched)).toBe(true);
  });
});

describe('startOverStillRelevant', () => {
  it('stays while near the resume point and goes once well past it', () => {
    expect(startOverStillRelevant(222, 222)).toBe(true);
    expect(startOverStillRelevant(222, 100)).toBe(true); // sought back a bit
    expect(startOverStillRelevant(222, 222 + START_OVER_GRACE_SECONDS - 0.1)).toBe(true);
    expect(startOverStillRelevant(222, 222 + START_OVER_GRACE_SECONDS)).toBe(false);
  });

  it('goes once back at the beginning', () => {
    expect(startOverStillRelevant(222, 0)).toBe(false);
    expect(startOverStillRelevant(222, 0.5)).toBe(false);
  });
});

describe('formatResumeTime', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatResumeTime(222)).toBe('3:42');
    expect(formatResumeTime(5)).toBe('0:05');
    expect(formatResumeTime(3725)).toBe('1:02:05');
    expect(formatResumeTime(NaN)).toBe('0:00');
  });
});
