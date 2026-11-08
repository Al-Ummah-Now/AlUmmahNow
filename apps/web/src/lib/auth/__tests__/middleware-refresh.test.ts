/**
 * @jest-environment node
 *
 * The middleware refreshes the active account's token ahead of expiry and puts
 * the rotated cookie on both the forwarded request and the response.
 */

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { refreshSessionCookie } from '../middleware-refresh';
import { __resetTokenRefreshStateForTests } from '../token-refresh';
import { DAY, MINUTE, fakeIssuer, jwt } from './token-fixtures';

const COOKIE = 'al_ummah_session';

function sessionCookie(accessToken: string, refreshToken: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    activeUserId: 'u1',
    activeChannelId: null,
    accounts: {
      u1: { userId: 'u1', email: 'u1@example.com', displayName: 'u1', accessToken, refreshToken, channels: [], activeChannelId: null, lastActivity: 1, ...extra },
    },
  });
}

function requestWith(cookieValue: string, path = '/en/studio') {
  return new NextRequest(`https://web.example${path}`, {
    headers: { cookie: `${COOKIE}=${encodeURIComponent(cookieValue)}; other=1` },
  });
}

const originalFetch = global.fetch;
const originalIssuer = process.env.Issuer;

beforeEach(() => {
  __resetTokenRefreshStateForTests();
  process.env.Issuer = 'https://auth.example';
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env.Issuer = originalIssuer;
});

describe('refreshSessionCookie', () => {
  it('leaves a token with time left alone (no /token call, no cookie)', async () => {
    const issuer = fakeIssuer({});
    const request = requestWith(sessionCookie(jwt('u1', Date.now() - MINUTE, 15 * MINUTE), 'r1'));

    expect(await refreshSessionCookie(request, { fetchImpl: issuer.fetchImpl })).toBeNull();
    expect(issuer.calls).toHaveLength(0);
  });

  it('refreshes a token about to expire and updates the forwarded request', async () => {
    const fresh = jwt('u1', Date.now(), 15 * MINUTE);
    const issuer = fakeIssuer({ r1: { access: fresh, refresh: 'r2' } });
    const request = requestWith(sessionCookie(jwt('u1', Date.now() - 14 * MINUTE, 15 * MINUTE), 'r1'));

    const value = await refreshSessionCookie(request, { fetchImpl: issuer.fetchImpl });

    expect(value).not.toBeNull();
    const stored = JSON.parse(value as string);
    expect(stored.accounts.u1).toMatchObject({ accessToken: fresh, refreshToken: 'r2' });
    expect(typeof stored.accounts.u1.expiresAt).toBe('number');
    // the render behind this request reads the new cookie
    expect(JSON.parse(request.cookies.get(COOKIE)!.value).accounts.u1.refreshToken).toBe('r2');
    expect(request.headers.get('cookie')).toContain('other=1');
  });

  it('marks the account needs-sign-in when the refresh token is rejected', async () => {
    const issuer = fakeIssuer({});
    const request = requestWith(sessionCookie(jwt('u1', Date.now() - DAY, 15 * MINUTE), 'dead'));

    const value = await refreshSessionCookie(request, { fetchImpl: issuer.fetchImpl });

    expect(JSON.parse(value as string).accounts.u1.needsSignIn).toBe(true);

    // The next request carries that cookie: no further /token calls
    const next = requestWith(value as string);
    expect(await refreshSessionCookie(next, { fetchImpl: issuer.fetchImpl })).toBeNull();
    expect(issuer.calls).toHaveLength(1);
  });

  it('ignores a missing or malformed cookie', async () => {
    expect(await refreshSessionCookie(new NextRequest('https://web.example/en'))).toBeNull();
    expect(await refreshSessionCookie(requestWith('{not json'))).toBeNull();
  });
});

describe('middleware', () => {
  it('sets the rotated cookie on the response with the session cookie options', async () => {
    const fresh = jwt('u1', Date.now(), 15 * MINUTE);
    global.fetch = fakeIssuer({ r1: { access: fresh, refresh: 'r2' } }).fetchImpl;
    const request = requestWith(sessionCookie(jwt('u1', Date.now() - 20 * MINUTE, 15 * MINUTE), 'r1'));

    const response = await middleware(request);

    const cookie = response.cookies.get(COOKIE);
    expect(cookie).toBeDefined();
    expect(JSON.parse(cookie!.value).accounts.u1.refreshToken).toBe('r2');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 });
    // and on the request forwarded to the render
    const forwarded = response.headers.get('x-middleware-request-cookie');
    expect(forwarded).toContain('r2');
  });

  it('does not touch the cookie when no refresh is needed', async () => {
    global.fetch = fakeIssuer({}).fetchImpl;
    const request = requestWith(sessionCookie(jwt('u1', Date.now(), 15 * MINUTE), 'r1'));

    const response = await middleware(request);

    expect(response.cookies.get(COOKIE)).toBeUndefined();
  });
});
