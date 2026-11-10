import { createLogger, resetLogging, resolveLogServiceUrl } from '../index.js';

/**
 * Deployed workers must not POST log lines to the local log-service: with
 * forceHttpLogging every log call used to fetch http://localhost:3089/log,
 * one failing subrequest per log line.
 */
describe('log-service shipping', () => {
  const env = process.env;
  let fetchMock: jest.Mock;
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realWarn = console.warn;
  const realInfo = console.info;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.LOG_SERVICE_URL;
    delete process.env.NODE_ENV;
    // info must pass the gate for these tests; the gate itself is tested in logger.test.ts
    process.env.LOG_LEVEL = 'info';
    resetLogging();
    fetchMock = jest.fn(() => Promise.resolve(new Response('ok')));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    console.log = jest.fn();
    console.warn = jest.fn();
    console.info = jest.fn();
  });
  afterEach(() => {
    process.env = env;
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.warn = realWarn;
    console.info = realInfo;
    resetLogging();
  });

  it('is off by default, even with forceHttpLogging', () => {
    const logger = createLogger('api', { forceHttpLogging: true });
    for (let i = 0; i < 10; i++) logger.info('hello', { i });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolveLogServiceUrl()).toBeNull();
  });

  it('ships to LOG_SERVICE_URL when set', () => {
    process.env.LOG_SERVICE_URL = 'http://127.0.0.1:4000';
    createLogger('api', { forceHttpLogging: true }).info('hello');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4000/log', expect.anything());
  });

  it('ships to localhost:3089 in development', () => {
    process.env.NODE_ENV = 'development';
    createLogger('api', { forceHttpLogging: true }).info('hello');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3089/log', expect.anything());
  });

  it('ships to an explicit logServiceUrl', () => {
    createLogger('api', { forceHttpLogging: true, logServiceUrl: 'http://logs.local' }).warn('x');
    expect(fetchMock).toHaveBeenCalledWith('http://logs.local/log', expect.anything());
  });
});
