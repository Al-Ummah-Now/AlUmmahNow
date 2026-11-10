/**
 * Browser logging policy (docs/operations/logging.md): production hosts show
 * nothing below warn; data is redacted before it reaches the console.
 */
import { clientLogLevel, logger } from '../logger-client';

describe('clientLogLevel', () => {
  it('production host: warn, even when the build asks for debug', () => {
    expect(clientLogLevel('alummahnow.net', undefined, 'production')).toBe('warn');
    expect(clientLogLevel('videos.alummahnow.net', 'debug', 'production')).toBe('warn');
    expect(clientLogLevel('alummahnow.net', 'info', 'production')).toBe('warn');
    expect(clientLogLevel('alummahnow.net', 'error', 'production')).toBe('error');
  });

  it('QA / stage / preview hosts honour NEXT_PUBLIC_LOG_LEVEL (default warn)', () => {
    expect(clientLogLevel('qa.alummahnow.net', undefined, 'production')).toBe('warn');
    expect(clientLogLevel('qa.alummahnow.net', 'debug', 'production')).toBe('debug');
    expect(clientLogLevel('videos.stage.alummahnow.net', 'info', 'production')).toBe('info');
    expect(clientLogLevel('pr-12-web.mahmoud.workers.dev', 'debug', 'production')).toBe('debug');
  });

  it('next dev: debug', () => {
    expect(clientLogLevel('localhost', undefined, 'development')).toBe('debug');
  });
});

describe('client logger output', () => {
  const original = { debug: console.debug, warn: console.warn, error: console.error };
  afterEach(() => Object.assign(console, original));

  it('writes one line with a constant format and redacted data', () => {
    const error = jest.fn();
    console.error = error;
    logger.error('Sign-in failed for a@b.com', { accessToken: 'secret', userId: 'u1' });
    expect(error).toHaveBeenCalledWith('%s', '[ERROR] Sign-in failed for [email]', { accessToken: '[redacted]', userId: 'u1' });
  });
});
