/**
 * The session cookie is Secure in production except on a local host (#1020):
 * WebKit drops Secure cookies set over http://localhost, so the local E2E stack
 * (a production build) lost the session in WebKit. Deployed hosts are unchanged.
 */
import { isLocalHost, sessionCookieOptions } from '../session-cookie';

describe('isLocalHost', () => {
  it.each(['localhost', 'localhost:3001', '127.0.0.1:3001', '[::1]:3001', 'LOCALHOST:3001'])('%s is local', (host) => {
    expect(isLocalHost(host)).toBe(true);
  });
  it.each(['videos.alummahnow.net', 'qa.alummahnow.net:443', 'localhost.example.com', '10.0.0.5:3001', '', null, undefined])('%s is not local', (host) => {
    expect(isLocalHost(host)).toBe(false);
  });
});

describe('sessionCookieOptions', () => {
  const env = process.env as Record<string, string | undefined>;
  const original = env.NODE_ENV;
  afterEach(() => {
    env.NODE_ENV = original;
  });

  it('is Secure in production on a deployed host, and with no host', () => {
    env.NODE_ENV = 'production';
    expect(sessionCookieOptions('alummahnow.net').secure).toBe(true);
    expect(sessionCookieOptions().secure).toBe(true);
  });

  it('is not Secure in production on localhost', () => {
    env.NODE_ENV = 'production';
    expect(sessionCookieOptions('localhost:3001').secure).toBe(false);
  });

  it('is not Secure outside production', () => {
    env.NODE_ENV = 'test';
    expect(sessionCookieOptions('alummahnow.net').secure).toBe(false);
  });
});
