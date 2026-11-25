import { whenPlayableAgain, whenSourceAttached } from '../start-playback';

function player(readyState: number, disposed = false) {
  const once: Record<string, () => void> = {};
  return { once, one: (e: string, fn: () => void) => { once[e] = fn; }, readyState: () => readyState, isDisposed: () => disposed };
}

describe('whenSourceAttached', () => {
  it('runs now when the source has metadata', () => {
    const fn = jest.fn();
    whenSourceAttached(player(1), fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs once, at loadstart', () => {
    const fn = jest.fn();
    const p = player(0);
    whenSourceAttached(p, fn);
    expect(fn).not.toHaveBeenCalled();
    p.once.loadstart!();
    p.once.loadedmetadata!();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs at loadedmetadata when loadstart came before the player was ready', () => {
    const fn = jest.fn();
    const p = player(0);
    whenSourceAttached(p, fn);
    p.once.loadedmetadata!();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a player disposed meanwhile', () => {
    const fn = jest.fn();
    const p = player(0, true);
    whenSourceAttached(p, fn);
    p.once.loadstart!();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('whenPlayableAgain', () => {
  it('without metadata: at loadedmetadata, which comes while paused in every browser', () => {
    const p = player(0);
    whenPlayableAgain(p, jest.fn());
    expect(Object.keys(p.once)).toEqual(['loadedmetadata']);
  });

  it('with metadata (paused, not reloaded): at canplay', () => {
    const p = player(1);
    whenPlayableAgain(p, jest.fn());
    expect(Object.keys(p.once)).toEqual(['canplay']);
  });
});
