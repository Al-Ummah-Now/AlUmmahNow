import { Logger, createLogger, configureLogging, getGlobalLogLevel, resetLogging, setLogSink, buildEntry, appLogger, withLogging } from '../index.js';

type Mocks = Record<'debug' | 'info' | 'warn' | 'error' | 'log', jest.Mock>;

describe('Logger', () => {
  const original = { debug: console.debug, info: console.info, warn: console.warn, error: console.error, log: console.log };
  const env = process.env;
  let c: Mocks;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.LOG_LEVEL;
    delete process.env.ENVIRONMENT;
    delete process.env.NEXTJS_ENV;
    resetLogging();
    c = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    Object.assign(console, c);
  });

  afterEach(() => {
    Object.assign(console, original);
    process.env = env;
    resetLogging();
  });

  const all = (logger: Logger) => {
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
  };
  const counts = () => ({ debug: c.debug.mock.calls.length, info: c.info.mock.calls.length, warn: c.warn.mock.calls.length, error: c.error.mock.calls.length });

  describe('level gating by environment', () => {
    it('production defaults to warn: no info, debug or trace', () => {
      configureLogging({ ENVIRONMENT: 'production' });
      all(createLogger('api', { fileLogging: false }));
      expect(counts()).toEqual({ debug: 0, info: 0, warn: 1, error: 1 });
    });

    it('stage defaults to info', () => {
      configureLogging({ ENVIRONMENT: 'stage' });
      all(createLogger('api', { fileLogging: false }));
      expect(counts()).toEqual({ debug: 0, info: 1, warn: 1, error: 1 });
    });

    it('qa defaults to debug (trace stays off)', () => {
      configureLogging({ ENVIRONMENT: 'qa' });
      all(createLogger('api', { fileLogging: false }));
      expect(counts()).toEqual({ debug: 1, info: 1, warn: 1, error: 1 });
    });

    it('LOG_LEVEL overrides the environment default', () => {
      configureLogging({ ENVIRONMENT: 'stage', LOG_LEVEL: 'error' });
      all(createLogger('api', { fileLogging: false }));
      expect(counts()).toEqual({ debug: 0, info: 0, warn: 0, error: 1 });
    });

    it('LOG_LEVEL=trace in QA emits trace too', () => {
      configureLogging({ ENVIRONMENT: 'qa', LOG_LEVEL: 'trace' });
      all(createLogger('api', { fileLogging: false }));
      expect(counts()).toEqual({ debug: 2, info: 1, warn: 1, error: 1 });
    });

    it('production never emits debug or trace, even with LOG_LEVEL=debug', () => {
      expect(configureLogging({ ENVIRONMENT: 'production', LOG_LEVEL: 'debug' })).toBe('info');
      all(createLogger('api', { fileLogging: false }));
      expect(counts()).toEqual({ debug: 0, info: 1, warn: 1, error: 1 });
    });

    it('NEXTJS_ENV is read when ENVIRONMENT is absent (web, admin-web)', () => {
      expect(configureLogging({ NEXTJS_ENV: 'production' })).toBe('warn');
      expect(configureLogging({ NEXTJS_ENV: 'stage' })).toBe('info');
    });

    it('reads process.env lazily when never configured', () => {
      process.env.ENVIRONMENT = 'stage';
      expect(getGlobalLogLevel()).toBe('info');
    });

    it('an explicit logLevel pins one logger', () => {
      configureLogging({ ENVIRONMENT: 'production' });
      all(new Logger({ logLevel: 'debug', fileLogging: false }));
      expect(counts()).toEqual({ debug: 1, info: 1, warn: 1, error: 1 });
    });

    it('a level change applies to loggers created earlier', () => {
      const logger = createLogger('api', { fileLogging: false });
      configureLogging({ ENVIRONMENT: 'production' });
      logger.info('dropped');
      configureLogging({ ENVIRONMENT: 'stage' });
      logger.info('kept');
      expect(c.info).toHaveBeenCalledTimes(1);
    });

    it('isEnabled reports the gate', () => {
      configureLogging({ ENVIRONMENT: 'production' });
      const logger = createLogger('api');
      expect(logger.isEnabled('info')).toBe(false);
      expect(logger.isEnabled('warn')).toBe(true);
    });
  });

  describe('output', () => {
    beforeEach(() => configureLogging({ ENVIRONMENT: 'qa' }));

    it('writes one structured object per call, data fields inline', () => {
      createLogger('api', { fileLogging: false }).info('Saved', { videoId: 'v1', count: 2 });
      expect(c.info).toHaveBeenCalledTimes(1);
      expect(c.info).toHaveBeenCalledWith({ level: 'info', app: 'api', msg: 'Saved', videoId: 'v1', count: 2 });
      expect(c.log).not.toHaveBeenCalled();
    });

    it('keeps an Error\'s name, message and stack', () => {
      const err = new Error('boom');
      createLogger('api', { fileLogging: false }).error('Failed', err);
      const entry = c.error.mock.calls[0][0];
      expect(entry.error).toMatchObject({ name: 'Error', message: 'boom' });
      expect(entry.error.stack).toContain('boom');
    });

    it('keeps nested Errors (JSON.stringify would drop them to {})', () => {
      createLogger('api', { fileLogging: false }).warn('Retrying', { videoId: 'v1', error: new TypeError('bad') });
      expect(c.warn.mock.calls[0][0].error).toMatchObject({ name: 'TypeError', message: 'bad' });
    });

    it('wraps primitive data', () => {
      createLogger('api', { fileLogging: false }).warn('Odd', 'text');
      expect(c.warn.mock.calls[0][0]).toEqual({ level: 'warn', app: 'api', msg: 'Odd', data: 'text' });
    });

    it('does not let data overwrite level/app/msg', () => {
      expect(buildEntry('warn', 'api', 'm', { level: 'x', msg: 'y' })).toEqual({ level: 'warn', app: 'api', msg: 'm', data_level: 'x', data_msg: 'y' });
    });

    it('can be silenced', () => {
      createLogger('api', { consoleLogging: false, fileLogging: false }).error('quiet');
      expect(c.error).not.toHaveBeenCalled();
    });
  });

  describe('request and job summaries', () => {
    it('healthy request is info: emitted at stage, dropped in production', () => {
      const logger = createLogger('api', { fileLogging: false });
      configureLogging({ ENVIRONMENT: 'production' });
      logger.request({ method: 'GET', route: '/videos/:id', status: 200, durationMs: 40 });
      expect(counts()).toEqual({ debug: 0, info: 0, warn: 0, error: 0 });
      configureLogging({ ENVIRONMENT: 'stage' });
      logger.request({ method: 'GET', route: '/videos/:id', status: 200, durationMs: 40, videoId: 'v1' });
      expect(c.info).toHaveBeenCalledWith(expect.objectContaining({ msg: 'request GET /videos/:id 200', status: 200, durationMs: 40, videoId: 'v1' }));
    });

    it('slow request warns in production', () => {
      configureLogging({ ENVIRONMENT: 'production' });
      createLogger('api', { fileLogging: false }).request({ method: 'GET', route: '/x', status: 200, durationMs: 2500 });
      expect(c.warn).toHaveBeenCalledWith(expect.objectContaining({ msg: 'slow request GET /x 200' }));
    });

    it('5xx and thrown errors are errors', () => {
      configureLogging({ ENVIRONMENT: 'production' });
      const logger = createLogger('api', { fileLogging: false });
      logger.request({ method: 'POST', route: '/x', status: 503, durationMs: 5 });
      logger.request({ method: 'POST', route: '/x', status: 500, durationMs: 5, error: new Error('db') });
      expect(c.error).toHaveBeenCalledTimes(2);
      expect(c.error.mock.calls[1][0].error).toMatchObject({ message: 'db' });
    });

    it('4xx is part of the info summary, not a warning', () => {
      configureLogging({ ENVIRONMENT: 'production' });
      createLogger('api', { fileLogging: false }).request({ method: 'GET', route: '/x', status: 404, durationMs: 5 });
      expect(counts()).toEqual({ debug: 0, info: 0, warn: 0, error: 0 });
    });

    it('jobs: ok is info, retry warns, failed is an error', () => {
      configureLogging({ ENVIRONMENT: 'production' });
      const logger = createLogger('processor', { fileLogging: false });
      logger.job({ job: 'encode', outcome: 'ok', durationMs: 10 });
      logger.job({ job: 'encode', outcome: 'retry', durationMs: 10 });
      logger.job({ job: 'encode', outcome: 'failed', durationMs: 10 });
      expect(counts()).toEqual({ debug: 0, info: 0, warn: 1, error: 1 });
    });
  });

  describe('sink', () => {
    it('receives emitted warn/error entries only, with the original data', () => {
      configureLogging({ ENVIRONMENT: 'stage' });
      const seen: unknown[] = [];
      setLogSink((entry, original) => seen.push([entry.level, original]));
      const err = new Error('x');
      const logger = createLogger('api', { fileLogging: false });
      logger.info('i');
      logger.warn('w');
      logger.error('e', err);
      expect(seen).toEqual([['warn', undefined], ['error', err]]);
    });

    it('a throwing sink never breaks the caller', () => {
      configureLogging({ ENVIRONMENT: 'stage' });
      setLogSink(() => {
        throw new Error('sink down');
      });
      expect(() => createLogger('api', { fileLogging: false }).error('e')).not.toThrow();
    });
  });

  describe('misc', () => {
    it('keeps the app name and file-logging flag', () => {
      const logger = createLogger('my-app', { fileLogging: false });
      expect(logger.getAppName()).toBe('my-app');
      expect(logger.isFileLoggingEnabled()).toBe(false);
      expect(new Logger().isFileLoggingEnabled()).toBe(true);
    });

    it('does not use HTTP logging in Node by default', () => {
      expect(new Logger({ fileLogging: false }).isHttpLoggingEnabled()).toBe(false);
    });

    it('setLogLevel pins and unpins', () => {
      configureLogging({ ENVIRONMENT: 'production' });
      const logger = createLogger('api', { fileLogging: false });
      logger.setLogLevel('info');
      expect(logger.getLogLevel()).toBe('info');
      logger.setLogLevel(null);
      expect(logger.getLogLevel()).toBe('warn');
    });
  });
});

describe('appLogger and withLogging', () => {
  const original = { info: console.info, warn: console.warn };
  afterEach(() => {
    Object.assign(console, original);
    resetLogging();
  });

  it('withLogging applies each invocation\'s env before the handler runs', async () => {
    const info = jest.fn();
    console.info = info;
    const log = appLogger('scheduler', { fileLogging: false });
    const worker = withLogging({
      async scheduled(_e: unknown, _env: unknown) {
        log.info('tick');
        return 'done';
      },
      name: 'x',
    });
    expect(worker.name).toBe('x');
    await worker.scheduled({}, { ENVIRONMENT: 'production' });
    expect(info).not.toHaveBeenCalled();
    await expect(worker.scheduled({}, { ENVIRONMENT: 'stage' })).resolves.toBe('done');
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('appLogger methods can be destructured', () => {
    const warn = jest.fn();
    console.warn = warn;
    configureLogging({ ENVIRONMENT: 'production' });
    const { warn: w } = appLogger('api', { fileLogging: false });
    w('x');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
