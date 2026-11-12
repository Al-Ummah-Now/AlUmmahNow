import {
  THEATRE_STORAGE_KEY,
  enableWatchPageFeatures,
  onAutoplayNextChange,
  setAutoplayNext,
  getPlayerUi,
  readTheatrePreference,
  resetPlayerUi,
  setTheatre,
  subscribePlayerUi,
  updatePlayerUi,
  writeTheatrePreference,
} from '../player-ui';

beforeEach(() => {
  resetPlayerUi();
  window.localStorage.clear();
});

describe('player-ui store', () => {
  it('starts with every page feature off (embeds and previews)', () => {
    expect(getPlayerUi()).toEqual({ theatreAvailable: false, theatre: false, miniPlayerAvailable: false, upNext: null, replayList: null, suggestions: [], autoplayNext: true, reportProblem: null, chapters: [] });
  });

  it('notifies only on a real change', () => {
    const listener = jest.fn();
    const off = subscribePlayerUi(listener);
    updatePlayerUi({ theatre: false });
    expect(listener).not.toHaveBeenCalled();
    updatePlayerUi({ miniPlayerAvailable: true });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    updatePlayerUi({ miniPlayerAvailable: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores theatre where the page has no theatre layout', () => {
    setTheatre(true);
    expect(getPlayerUi().theatre).toBe(false);
  });

  it('turns the watch page features on, restores the remembered theatre choice, and cleans up', () => {
    window.localStorage.setItem(THEATRE_STORAGE_KEY, '1');
    const cleanup = enableWatchPageFeatures();
    expect(getPlayerUi()).toMatchObject({ theatreAvailable: true, miniPlayerAvailable: true, theatre: true });
    setTheatre(false);
    expect(window.localStorage.getItem(THEATRE_STORAGE_KEY)).toBe('0');
    updatePlayerUi({ upNext: { title: 'Next', channel: 'C', go: jest.fn() } });
    cleanup();
    expect(getPlayerUi()).toEqual({ theatreAvailable: false, theatre: false, miniPlayerAvailable: false, upNext: null, replayList: null, suggestions: [], autoplayNext: true, reportProblem: null, chapters: [] });
  });

  it('survives storage that throws (private mode, blocked site data)', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readTheatrePreference(throwing)).toBe(false);
    expect(() => writeTheatrePreference(true, throwing)).not.toThrow();
    expect(readTheatrePreference(undefined)).toBe(false);
  });
});

describe('Autoplay next', () => {
  it('is saved on this device and announced to listeners (the account sync)', () => {
    window.localStorage.clear();
    const seen: boolean[] = [];
    const off = onAutoplayNextChange((on) => seen.push(on));
    setAutoplayNext(false);
    expect(getPlayerUi().autoplayNext).toBe(false);
    expect(window.localStorage.getItem('aun.player.autoplayNext')).toBe('0');
    setAutoplayNext(true);
    off();
    setAutoplayNext(false);
    expect(seen).toEqual([false, true]);
  });
});
