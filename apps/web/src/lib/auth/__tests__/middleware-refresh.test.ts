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
import { BROWSER_COOKIE_LIMIT, readSessionValue, splitSessionValue } from '../session-cookie';

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

describe('a session split across several cookies (two or more accounts)', () => {
  /** Two accounts with enough channel data that the session needs more than one cookie. */
  function twoAccounts(activeToken: string, activeRefresh: string) {
    const channels = (userId: string) => Array.from({ length: 20 }, (_, i) => ({
      id: `ch_${userId}_${i}`, userId, name: `Channel number ${i} of ${userId}`, isMain: i === 0,
      avatarUrl: `https://cdn.example/avatars/${userId}/${i}.webp`,
    }));
    return JSON.stringify({
      activeUserId: 'u1',
      activeChannelId: null,
      accounts: {
        u1: { userId: 'u1', email: 'u1@example.com', displayName: 'u1', accessToken: activeToken, refreshToken: activeRefresh, channels: channels('u1'), activeChannelId: null, lastActivity: 1 },
        u2: { userId: 'u2', email: 'u2@example.com', displayName: 'u2', accessToken: jwt('u2', Date.now(), 15 * MINUTE), refreshToken: 'u2-r', channels: channels('u2'), activeChannelId: null, lastActivity: 1 },
      },
    });
  }

  function chunkedRequest(value: string) {
    const chunks = splitSessionValue(value);
    expect(chunks.length).toBeGreaterThan(1);
    const header = chunks.map((c, i) => `${i === 0 ? COOKIE : `${COOKIE}.${i}`}=${encodeURIComponent(c)}`).join('; ');
    return new NextRequest('https://web.example/en/studio', { headers: { cookie: `${header}; other=1` } });
  }

  it('refreshes the active account and writes every chunk back, each within the browser limit', async () => {
    const fresh = jwt('u1', Date.now(), 15 * MINUTE);
    global.fetch = fakeIssuer({ r1: { access: fresh, refresh: 'r2' } }).fetchImpl;
    const request = chunkedRequest(twoAccounts(jwt('u1', Date.now() - 20 * MINUTE, 15 * MINUTE), 'r1'));

    const response = await middleware(request);

    const stored = JSON.parse(readSessionValue(response.cookies) as string);
    expect(stored.accounts.u1).toMatchObject({ accessToken: fresh, refreshToken: 'r2' });
    // The other account is kept as it was
    expect(stored.accounts.u2.refreshToken).toBe('u2-r');
    for (const cookie of response.cookies.getAll()) {
      expect(`${cookie.name}=${encodeURIComponent(cookie.value)}`.length).toBeLessThanOrEqual(BROWSER_COOKIE_LIMIT);
    }
    // and the forwarded request holds the whole new session too
    expect(JSON.parse(readSessionValue(request.cookies) as string).accounts.u1.refreshToken).toBe('r2');
  });

  it('does not refresh or write anything for a fresh chunked session', async () => {
    const issuer = fakeIssuer({});
    const request = chunkedRequest(twoAccounts(jwt('u1', Date.now(), 15 * MINUTE), 'r1'));

    expect(await refreshSessionCookie(request, { fetchImpl: issuer.fetchImpl })).toBeNull();
    expect(issuer.calls).toHaveLength(0);
  });
});
