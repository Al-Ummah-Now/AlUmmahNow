import { resumePosition } from '../resume';

const p = (currentTime: number, duration = 600, completed = false) => ({ currentTime, duration, completed });

describe('resumePosition', () => {
  it('offers a position between 5% and 95%', () => {
    expect(resumePosition(p(30))).toBe(30); // exactly 5%
    expect(resumePosition(p(300))).toBe(300);
    expect(resumePosition(p(570))).toBe(570); // exactly 95%
  });

  it('does not offer near the start or the end', () => {
    expect(resumePosition(p(29))).toBeNull();
    expect(resumePosition(p(571))).toBeNull();
  });

  it('does not offer for completed, live, missing or corrupt progress', () => {
    expect(resumePosition(p(300, 600, true))).toBeNull();
    expect(resumePosition(p(300), true)).toBeNull();
    expect(resumePosition(null)).toBeNull();
    expect(resumePosition(p(300, 0))).toBeNull();
    expect(resumePosition(p(NaN))).toBeNull();
  });
});
