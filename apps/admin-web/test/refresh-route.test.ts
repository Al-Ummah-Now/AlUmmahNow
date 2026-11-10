/**
 * /api/auth/refresh: where a render with an expired session is sent (AW-1).
 * It refreshes, stores the rotated pair and returns to the page; a dead or
 * unreachable refresh goes to /login (never back to the page: no loop).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/auth/refresh/route';
import { SESSION_COOKIE_NAME, parseSessionCookie } from '../src/lib/session-cookie';

const originalFetch = globalThis.fetch;
const originalIssuer = process.env.Issuer;
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.Issuer = originalIssuer;
});

const cookie = JSON.stringify({ accessToken: 'old-access', refreshToken: 'old-refresh' });
const request = (next: string) => {
  const r = new NextRequest(`https://admin.test/api/auth/refresh?next=${encodeURIComponent(next)}`);
  r.cookies.set(SESSION_COOKIE_NAME, cookie);
  return r;
};

describe('GET /api/auth/refresh', () => {
  it('stores the rotated pair and returns to the page', async () => {
    process.env.Issuer = 'https://auth.test';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 900 }), { status: 200 })) as typeof fetch;
    const res = await GET(request('/moderation/reports?page=2'));
    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search, '/moderation/reports?page=2');
    const stored = parseSessionCookie(res.cookies.get(SESSION_COOKIE_NAME)!.value);
    assert.deepEqual(stored && { a: stored.accessToken, r: stored.refreshToken }, { a: 'new-access', r: 'new-refresh' });
  });

  it('a rejected refresh goes to sign-in and clears the session', async () => {
    process.env.Issuer = 'https://auth.test';
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as typeof fetch;
    const res = await GET(request('/dashboard'));
    assert.match(res.headers.get('location')!, /\/login\?return=%2Fdashboard$/);
    assert.equal(res.cookies.get(SESSION_COOKIE_NAME)?.value, '');
  });

  it('never redirects off-site', async () => {
    process.env.Issuer = 'https://auth.test';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 900 }), { status: 200 })) as typeof fetch;
    const res = await GET(request('//evil.example/x'));
    assert.equal(new URL(res.headers.get('location')!).host, 'admin.test');
  });
});
