import {
  createSkewRecovery,
  holdReload,
  isReloadHeld,
  isVersionSkewError,
  recoverFromVersionSkew,
  setActiveSkewRecovery,
  RELOAD_LOOP_WINDOW_MS,
  type SkewState,
} from '../recovery';

/** The exact text of the incident (Next 16, E715) */
const INCIDENT =
  'Server Action "78646d3443f3ead05cf55e694bd687a28c5d43ae66" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action';

function named(name: string, message: string) {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe('isVersionSkewError', () => {
  it.each([
    ['incident message', new Error(INCIDENT)],
    ['UnrecognizedActionError', named('UnrecognizedActionError', 'x')],
    ['ChunkLoadError', named('ChunkLoadError', 'Loading chunk 123 failed.')],
    ['webpack chunk message', new Error('Loading chunk app/[locale]/upload/page failed. (error: https://x/_next/static/chunks/1.js)')],
    ['css chunk', new Error('Loading CSS chunk 77 failed.')],
    ['chrome dynamic import', new TypeError('Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js')],
    ['firefox dynamic import', new TypeError('error loading dynamically imported module')],
    ['safari dynamic import', new TypeError('Importing a module script failed.')],
    ['string reason', INCIDENT],
  ])('matches %s', (_label, error) => {
    expect(isVersionSkewError(error)).toBe(true);
  });

  it.each([
    ['network error', new TypeError('Failed to fetch')],
    ['api error', new Error('Upload failed: 500')],
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['plain object', { message: 'nope' }],
  ])('ignores %s', (_label, error) => {
    expect(isVersionSkewError(error)).toBe(false);
  });
});

function setup(opts: { recentReloadAt?: number } = {}) {
  let now = 1_000_000;
  const store = new Map<string, string>();
  if (opts.recentReloadAt !== undefined) store.set('aun:version-skew-reload-at', String(opts.recentReloadAt));
  const states: SkewState[] = [];
  const reload = jest.fn();
  const report = jest.fn();
  const timers: (() => void)[] = [];
  const recovery = createSkewRecovery({
    reload,
    report,
    setState: (s) => states.push(s),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    now: () => now,
    schedule: (fn) => timers.push(fn),
  });
  const flush = () => timers.splice(0).forEach((fn) => fn());
  return { recovery, reload, report, states, store, flush, advance: (ms: number) => (now += ms) };
}

describe('createSkewRecovery', () => {
  it('ignores other errors', () => {
    const t = setup();
    expect(t.recovery.handle(new Error('boom'), 'test')).toBe(false);
    expect(t.report).not.toHaveBeenCalled();
    expect(t.states).toEqual([]);
  });

  it('reports, shows the notice, then reloads once', () => {
    const t = setup();
    expect(t.recovery.handle(new Error(INCIDENT), 'unhandledrejection')).toBe(true);
    expect(t.report).toHaveBeenCalledWith(expect.objectContaining({ source: 'unhandledrejection', deferred: false }));
    expect(t.states).toEqual(['reloading']);
    expect(t.reload).not.toHaveBeenCalled();
    t.flush();
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.store.get('aun:version-skew-reload-at')).toBe('1000000');
    // a second error in the same page does not start a second recovery
    expect(t.recovery.handle(named('ChunkLoadError', 'x'), 'error')).toBe(true);
    expect(t.report).toHaveBeenCalledTimes(1);
  });

  it('waits for uploads, then reloads when the last one finishes', () => {
    const t = setup();
    const a = holdReload();
    const b = holdReload();
    t.recovery.handle(new Error(INCIDENT), 'caught');
    expect(t.report).toHaveBeenCalledWith(expect.objectContaining({ deferred: true }));
    expect(t.states).toEqual(['waiting-for-uploads']);
    t.flush();
    expect(t.reload).not.toHaveBeenCalled();
    a();
    a(); // release is idempotent
    expect(isReloadHeld()).toBe(true);
    expect(t.states).toEqual(['waiting-for-uploads']);
    b();
    expect(isReloadHeld()).toBe(false);
    expect(t.states).toEqual(['waiting-for-uploads', 'reloading']);
    t.flush();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload if an upload starts while the notice shows', () => {
    const t = setup();
    t.recovery.handle(new Error(INCIDENT), 'caught');
    const release = holdReload();
    t.flush();
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.states).toEqual(['reloading', 'waiting-for-uploads']);
    release();
    t.flush();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('does not loop: a skew right after a skew reload asks the user instead', () => {
    const t = setup({ recentReloadAt: 1_000_000 - 5_000 });
    t.recovery.handle(new Error(INCIDENT), 'caught');
    expect(t.states).toEqual(['reload-blocked']);
    t.flush();
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.report).toHaveBeenCalledTimes(1);
  });

  it('reloads again once the loop window has passed', () => {
    const t = setup({ recentReloadAt: 1_000_000 - RELOAD_LOOP_WINDOW_MS - 1 });
    t.recovery.handle(new Error(INCIDENT), 'caught');
    expect(t.states).toEqual(['reloading']);
  });

  it('survives storage that throws', () => {
    const reload = jest.fn();
    const timers: (() => void)[] = [];
    const recovery = createSkewRecovery({
      reload,
      report: () => {},
      setState: () => {},
      storage: { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } },
      schedule: (fn) => timers.push(fn),
    });
    recovery.handle(new Error(INCIDENT), 'caught');
    timers.forEach((fn) => fn());
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('recoverFromVersionSkew', () => {
  afterEach(() => setActiveSkewRecovery(null));

  it('hands skew errors to the mounted recovery and leaves others alone', () => {
    const t = setup();
    setActiveSkewRecovery(t.recovery);
    expect(recoverFromVersionSkew(new Error('validation failed'))).toBe(false);
    expect(recoverFromVersionSkew(new Error(INCIDENT), 'boundary')).toBe(true);
    expect(t.report).toHaveBeenCalledWith(expect.objectContaining({ source: 'boundary' }));
  });
});
