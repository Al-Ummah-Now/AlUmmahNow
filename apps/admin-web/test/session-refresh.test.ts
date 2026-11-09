import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { decodeJwtExp, refreshTokens, shouldRefresh } from '../src/lib/token-refresh';
import { parseSessionCookie, withRotatedTokens } from '../src/lib/session-cookie';
import { refreshSessionMiddleware } from '../src/lib/session-middleware';
import { config } from '../src/middleware';

const ISSUER = 'https://auth.qa.alummahnow.net';
const APP = 'https://admin.qa.alummahnow.net';
const NOW = 1_800_000_000; // seconds

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function jwt(exp: number | undefined, extra: Record<string, unknown> = {}): string {
  return `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url({ mode: 'access', ...extra, ...(exp === undefined ? {} : { exp }) })}.sig`;
}

const silent = { info: () => {}, warn: () => {} };

interface FetchCall { url: string; body: string }

function mockFetch(respond: () => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') });
    return respond();
  }) as typeof fetch;
  return { impl, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function request(path: string, cookies: Record<string, string>): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  return new NextRequest(`${APP}${path}`, { headers: cookie ? { cookie } : {} });
}

function sessionCookie(accessToken: string, refreshToken = 'user:r0'): string {
  return JSON.stringify({ user: { id: 'u1', email: 'admin@example.com', role: 'admin' }, accessToken, refreshToken });
}

/** The admin_session value the middleware handed to the browser, if any. */
function setSession(response: Response): { value: string; maxAge?: string } | null {
  const header = response.headers.getSetCookie().find((c) => c.startsWith('admin_session='));
  if (!header) return null;
  const value = decodeURIComponent(header.split(';')[0].slice('admin_session='.length));
  const maxAge = /Max-Age=(\d+)/i.exec(header)?.[1];
  return { value, maxAge };
}

describe('decodeJwtExp / shouldRefresh', () => {
  it('reads exp from a JWT payload', () => {
    assert.equal(decodeJwtExp(jwt(NOW + 900)), NOW + 900);
  });

  it('returns null for anything that is not a readable JWT with exp', () => {
    for (const token of ['', 'abc', 'a.b', 'a.!!!.c', jwt(undefined), `${b64url({})}.${b64url({ exp: 'soon' })}.s`]) {
      assert.equal(decodeJwtExp(token), null, token);
    }
  });

  it('refreshes within two minutes of expiry, and after it', () => {
    assert.equal(shouldRefresh(jwt(NOW + 119), NOW), true);
    assert.equal(shouldRefresh(jwt(NOW + 120), NOW), true);
    assert.equal(shouldRefresh(jwt(NOW - 60), NOW), true);
  });

  it('leaves a token with time to spare alone (15-minute and legacy 30-day tokens)', () => {
    assert.equal(shouldRefresh(jwt(NOW + 900), NOW), false);
    assert.equal(shouldRefresh(jwt(NOW + 30 * 24 * 3600), NOW), false);
  });

  it('leaves an unreadable token to signature verification', () => {
    assert.equal(shouldRefresh('garbage', NOW), false);
  });
});

describe('refreshTokens', () => {
  it('posts a refresh_token grant to the issuer and returns the rotated pair', async () => {
    const { impl, calls } = mockFetch(() => json(200, { access_token: 'a1', refresh_token: 'user:r1', expires_in: 900 }));
    const result = await refreshTokens(ISSUER, 'user:r0', impl);
    assert.deepEqual(result, { kind: 'refreshed', tokens: { accessToken: 'a1', refreshToken: 'user:r1' } });
    assert.equal(calls[0].url, `${ISSUER}/token`);
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'user:r0');
  });

  it('reports invalid_grant as definitive', async () => {
    const { impl } = mockFetch(() => json(400, { error: 'invalid_grant', error_description: 'Refresh token has been used or expired' }));
    assert.deepEqual(await refreshTokens(ISSUER, 'user:r0', impl), {
      kind: 'invalid_grant',
      description: 'Refresh token has been used or expired',
    });
  });

  it('treats server errors, other 4xx, bad bodies and network failures as transient', async () => {
    const cases: Array<() => Response | Promise<Response>> = [
      () => json(500, { error: 'server_error' }),
      () => new Response('<html>Bad gateway</html>', { status: 502 }),
      () => json(400, { error: 'invalid_request' }),
      () => json(200, { access_token: 'a1' }),
      () => Promise.reject(new Error('connect ECONNREFUSED')),
    ];
    for (const respond of cases) {
      const { impl } = mockFetch(respond);
      const result = await refreshTokens(ISSUER, 'user:r0', impl);
      assert.equal(result.kind, 'transient');
    }
  });
});

describe('session cookie format', () => {
  it('rotating tokens keeps every other field', () => {
    const rotated = JSON.parse(withRotatedTokens(sessionCookie('a0'), { accessToken: 'a1', refreshToken: 'user:r1' }));
    assert.deepEqual(rotated, {
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
      accessToken: 'a1',
      refreshToken: 'user:r1',
    });
    assert.deepEqual(parseSessionCookie(JSON.stringify(rotated)), { accessToken: 'a1', refreshToken: 'user:r1' });
  });
});

describe('session refresh middleware', () => {
  const deps = (fetchImpl: typeof fetch) => ({ issuer: ISSUER, fetch: fetchImpl, now: () => NOW * 1000, log: silent });

  it('without a session goes straight to /login, keeping the page to come back to', async () => {
    const { impl, calls } = mockFetch(() => json(500, {}));
    const response = await refreshSessionMiddleware(request('/moderation/ai?status=pending', {}), deps(impl));
    assert.equal(calls.length, 0);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `${APP}/login?return=%2Fmoderation%2Fai%3Fstatus%3Dpending`);
    assert.equal(setSession(response), null);
  });

  it('without a session on the root goes to a plain /login (no "Please log in" page)', async () => {
    const { impl } = mockFetch(() => json(500, {}));
    const response = await refreshSessionMiddleware(request('/', {}), deps(impl));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `${APP}/login`);
  });

  it('a server action without a session is redirected with 303 (no re-POST)', async () => {
    const { impl } = mockFetch(() => json(500, {}));
    const req = new NextRequest(`${APP}/moderation`, { method: 'POST' });
    const response = await refreshSessionMiddleware(req, deps(impl));
    assert.equal(response.status, 303);
  });

  it('tells the render which path it is rendering (for a sign-in redirect back to it)', async () => {
    const { impl } = mockFetch(() => json(500, {}));
    const req = request('/indices?tab=2', { admin_session: sessionCookie(jwt(NOW + 900)) });
    const response = await refreshSessionMiddleware(req, deps(impl));
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.match(response.headers.get('x-middleware-override-headers') ?? '', /x-admin-path/);
    assert.equal(response.headers.get('x-middleware-request-x-admin-path'), '/indices?tab=2');
  });

  it('does not touch a legacy cookie holding a 30-day token', async () => {
    const { impl, calls } = mockFetch(() => json(500, {}));
    const req = request('/dashboard', { admin_session: sessionCookie(jwt(NOW + 30 * 24 * 3600)) });
    const response = await refreshSessionMiddleware(req, deps(impl));
    assert.equal(calls.length, 0);
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(setSession(response), null);
  });

  it('refreshes ahead of expiry and sets the rotated cookie on the request and the response', async () => {
    const fresh = jwt(NOW + 900);
    const { impl, calls } = mockFetch(() => json(200, { access_token: fresh, refresh_token: 'user:r1', expires_in: 900 }));
    const req = request('/moderation', { admin_session: sessionCookie(jwt(NOW + 60), 'user:r0') });
    const response = await refreshSessionMiddleware(req, deps(impl));

    assert.equal(calls.length, 1);
    assert.equal(new URLSearchParams(calls[0].body).get('refresh_token'), 'user:r0');

    const written = setSession(response);
    assert.ok(written, 'admin_session is set on the response');
    assert.equal(written.maxAge, String(7 * 24 * 60 * 60));
    const value = JSON.parse(written.value);
    assert.equal(value.accessToken, fresh);
    assert.equal(value.refreshToken, 'user:r1');
    assert.equal(value.user.email, 'admin@example.com');

    // The render of this same request sees the new tokens.
    assert.deepEqual(parseSessionCookie(req.cookies.get('admin_session')!.value), {
      accessToken: fresh,
      refreshToken: 'user:r1',
    });
    assert.match(response.headers.get('x-middleware-override-headers') ?? '', /cookie/);
    assert.match(decodeURIComponent(response.headers.get('x-middleware-request-cookie') ?? ''), /user:r1/);
  });

  it('refreshes an already expired token too', async () => {
    const { impl, calls } = mockFetch(() => json(200, { access_token: jwt(NOW + 900), refresh_token: 'user:r1' }));
    const response = await refreshSessionMiddleware(
      request('/translations', { admin_session: sessionCookie(jwt(NOW - 3600)) }),
      deps(impl),
    );
    assert.equal(calls.length, 1);
    assert.ok(setSession(response));
  });

  it('migrates the legacy access_token/refresh_token pair into admin_session', async () => {
    const { impl } = mockFetch(() => json(200, { access_token: jwt(NOW + 900), refresh_token: 'user:r1' }));
    const response = await refreshSessionMiddleware(
      request('/dashboard', { access_token: jwt(NOW + 10), refresh_token: 'user:r0' }),
      deps(impl),
    );
    assert.equal(JSON.parse(setSession(response)!.value).refreshToken, 'user:r1');
    const cleared = response.headers.getSetCookie().filter((c) => /^(access_token|refresh_token)=;/.test(c));
    assert.equal(cleared.length, 2);
  });

  it('on invalid_grant clears the cookie and signs in again via /login (silent when auth still has a session)', async () => {
    const { impl } = mockFetch(() => json(400, { error: 'invalid_grant' }));
    const response = await refreshSessionMiddleware(
      request('/dashboard', { admin_session: sessionCookie(jwt(NOW - 10)) }),
      deps(impl),
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `${APP}/login?return=%2Fdashboard`);
    const cleared = response.headers.getSetCookie().find((c) => c.startsWith('admin_session='));
    assert.ok(cleared && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cleared), cleared);
  });

  it('keeps the session on a transient failure', async () => {
    const { impl } = mockFetch(() => json(503, { error: 'temporarily_unavailable' }));
    const response = await refreshSessionMiddleware(
      request('/dashboard', { admin_session: sessionCookie(jwt(NOW + 30)) }),
      deps(impl),
    );
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(response.headers.getSetCookie().length, 0);
  });

  it('never runs on /login or the auth routes, so a sign-out redirect cannot loop', () => {
    const matches = (path: string) =>
      config.matcher.some((pattern) => {
        if (pattern === '/') return path === '/';
        const base = pattern.replace('/:path*', '');
        return path === base || path.startsWith(`${base}/`);
      });
    for (const path of ['/login', '/access-denied', '/api/callback', '/api/logout', '/api/auth/logout']) {
      assert.equal(matches(path), false, path);
    }
    for (const path of ['/', '/dashboard', '/moderation/reports', '/translations', '/indices']) {
      assert.equal(matches(path), true, path);
    }
  });
});
