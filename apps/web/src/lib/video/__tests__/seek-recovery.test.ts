import { isBuffered, recoverStuckSeeks, SEEK_MAX_RETRIES, SEEK_STUCK_AFTER_MS } from '../seek-recovery';

function ranges(...spans: Array<[number, number]>): TimeRanges {
  return { length: spans.length, start: (i: number) => spans[i][0], end: (i: number) => spans[i][1] } as TimeRanges;
}

/** A Video.js-like player whose seeks only finish when the test says so */
function fakePlayer() {
  const handlers: Record<string, Array<() => void>> = {};
  const state = { time: 0, seeking: false, buffered: ranges(), disposed: false, seeks: [] as number[] };
  const emit = (e: string) => (handlers[e] ?? []).slice().forEach((h) => h());
  const player = {
    on: (e: string, h: () => void) => void (handlers[e] = [...(handlers[e] ?? []), h]),
    off: (e: string, h: () => void) => void (handlers[e] = (handlers[e] ?? []).filter((x) => x !== h)),
    seeking: () => state.seeking,
    buffered: () => state.buffered,
    isDisposed: () => state.disposed,
    currentTime: ((t?: number) => {
      if (t === undefined) return state.time;
      state.time = t;
      state.seeking = true;
      state.seeks.push(t);
      emit('seeking');
      return undefined;
    }) as never,
  };
  return { player, state, finishSeek: () => { state.seeking = false; emit('seeked'); }, emit };
}

describe('recoverStuckSeeks', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('leaves a seek that finishes alone', () => {
    const { player, state, finishSeek } = fakePlayer();
    recoverStuckSeeks(player);
    player.currentTime(61);
    finishSeek();
    jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS * 3);
    expect(state.seeks).toEqual([61]);
  });

  it('seeks again when the target is buffered but the seek never finishes, up to the limit', () => {
    const { player, state } = fakePlayer();
    const onRetry = jest.fn();
    recoverStuckSeeks(player, { onRetry });
    state.buffered = ranges([40, 90]);
    player.currentTime(61);
    jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS);
    expect(state.seeks).toEqual([61, 61]);
    expect(onRetry).toHaveBeenCalledWith(61, 1);
    jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS * 5);
    expect(state.seeks).toHaveLength(1 + SEEK_MAX_RETRIES);
  });

  it('seeks again when nothing is downloading (the loader stopped)', () => {
    const { player, state } = fakePlayer();
    // The byte count never moves: nothing is downloading
    recoverStuckSeeks(player, { progress: () => 1000 });
    player.currentTime(61); // not buffered
    jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS);
    expect(state.seeks).toEqual([61, 61]);
  });

  it('waits while the data is still arriving (a slow connection), however long it takes', () => {
    const { player, state } = fakePlayer();
    let bytes = 0;
    recoverStuckSeeks(player, { progress: () => bytes });
    player.currentTime(61);
    for (let i = 0; i < 5; i++) {
      bytes += 50_000;
      jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS);
    }
    expect(state.seeks).toEqual([61]);
  });

  it('without a progress signal (native HLS) only a buffered target counts as stuck', () => {
    const { player, state } = fakePlayer();
    recoverStuckSeeks(player);
    player.currentTime(61);
    jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS * 3);
    expect(state.seeks).toEqual([61]);
    state.buffered = ranges([60, 70]);
    jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS);
    expect(state.seeks).toEqual([61, 61]);
  });

  it('a new seek by the viewer starts over at its own target', () => {
    const { player, state } = fakePlayer();
    recoverStuckSeeks(player);
    state.buffered = ranges([0, 90]);
    player.currentTime(61);
    jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS - 1);
    player.currentTime(20);
    jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS);
    expect(state.seeks).toEqual([61, 20, 20]);
  });

  it('stops after dispose or cleanup', () => {
    const { player, state, emit } = fakePlayer();
    const stop = recoverStuckSeeks(player);
    state.buffered = ranges([0, 90]);
    player.currentTime(61);
    emit('dispose');
    jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS * 2);
    expect(state.seeks).toEqual([61]);
    stop();
    player.currentTime(30);
    jest.advanceTimersByTime(SEEK_STUCK_AFTER_MS * 2);
    expect(state.seeks).toEqual([61, 30]);
  });

  it('isBuffered reads every range', () => {
    expect(isBuffered(ranges([0, 10], [50, 70]), 61)).toBe(true);
    expect(isBuffered(ranges([0, 10]), 61)).toBe(false);
  });
});
