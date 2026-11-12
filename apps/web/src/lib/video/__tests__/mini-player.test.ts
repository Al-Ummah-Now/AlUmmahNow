import { nextMini, MINI_ENTER_BELOW, MINI_LEAVE_ABOVE, MINI_MIN_VIEWPORT } from '../mini-player';

const base = { mini: false, ratio: 1, playing: true, dismissed: false, viewportWidth: 1280, touching: false };

describe('nextMini', () => {
  it('floats once less than a quarter shows while playing', () => {
    expect(nextMini({ ...base, ratio: MINI_ENTER_BELOW + 0.01 })).toBe(false);
    expect(nextMini({ ...base, ratio: MINI_ENTER_BELOW - 0.01 })).toBe(true);
  });

  it('has hysteresis: a floating player docks only above 60%', () => {
    for (const ratio of [0.1, 0.3, 0.5, MINI_LEAVE_ABOVE]) expect(nextMini({ ...base, mini: true, ratio })).toBe(true);
    expect(nextMini({ ...base, mini: true, ratio: MINI_LEAVE_ABOVE + 0.01 })).toBe(false);
  });

  it('never switches while a finger is on the player', () => {
    expect(nextMini({ ...base, ratio: 0, touching: true })).toBe(false);
    expect(nextMini({ ...base, mini: true, ratio: 1, touching: true })).toBe(true);
  });

  it('pausing keeps the mini player; a paused player never starts floating', () => {
    expect(nextMini({ ...base, mini: true, ratio: 0, playing: false })).toBe(true);
    expect(nextMini({ ...base, ratio: 0, playing: false })).toBe(false);
  });

  it('stays docked after the viewer closed it', () => {
    expect(nextMini({ ...base, ratio: 0, dismissed: true })).toBe(false);
  });

  it('phones never float the player', () => {
    expect(nextMini({ ...base, ratio: 0, viewportWidth: MINI_MIN_VIEWPORT - 1 })).toBe(false);
    expect(nextMini({ ...base, mini: true, ratio: 0, viewportWidth: MINI_MIN_VIEWPORT - 1 })).toBe(false);
  });
});
