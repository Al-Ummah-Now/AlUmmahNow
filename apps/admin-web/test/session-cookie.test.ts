/**
 * The session cookie is Secure in production builds except over plain http on localhost (the local
 * E2E stack), like the sign-in state cookie: WebKit and Firefox drop Secure cookies set over
 * http://localhost, so the admin session never stuck there (#1020).
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionCookieOptions } from '../src/lib/session-cookie';

const env = process.env as Record<string, string | undefined>;
const original = env.NODE_ENV;
afterEach(() => {
  env.NODE_ENV = original;
});

describe('sessionCookieOptions', () => {
  it('production: Secure on deployed hosts (and when the host is unknown)', () => {
    env.NODE_ENV = 'production';
    assert.equal(sessionCookieOptions('admin.alummahnow.net').secure, true);
    assert.equal(sessionCookieOptions('admin.qa.alummahnow.net').secure, true);
    assert.equal(sessionCookieOptions(undefined).secure, true);
    assert.equal(sessionCookieOptions(null).secure, true);
  });

  it('production build on localhost (the local stack): not Secure', () => {
    env.NODE_ENV = 'production';
    assert.equal(sessionCookieOptions('localhost:3091').secure, false);
  });

  it('never Secure outside production builds; the other options stay', () => {
    env.NODE_ENV = 'development';
    const options = sessionCookieOptions('admin.alummahnow.net');
    assert.equal(options.secure, false);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.path, '/');
  });
});
