/**
 * /api/auth/refresh: where a render with an expired session is sent (AW-1).
 * It refreshes, stores the rotated pair and returns to the page; a dead or
 * unreachable refresh goes to /login (never back to the page: no loop).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { handleRefresh } from '../src/lib/refresh-handler';
import { SESSION_COOKIE_NAME, parseSessionCookie } from '../src/lib/session-cookie';
import type { VerifyOutcome } from '../src/lib/session-state';
import { refreshVerified } from '../src/lib/verified-refresh';

const originalIssuer = process.env.Issuer;
afterEach(() => {
  process.env.Issuer = originalIssuer;
});

const cookie = JSON.stringify({ accessToken: 'old-access', refreshToken: 'old-refresh' });
const as = (...roles: string[]): VerifyOutcome => ({ subject: { properties: { id: 'u1', email: 'admin@example.com', roles } } });

async function get(next: string, opts: { answer?: Response; verified?: VerifyOutcome } = {}) {
  process.env.Issuer = 'https://auth.test';
  const request = new NextRequest(`https://admin.test/api/auth/refresh?next=${encodeURIComponent(next)}`);
  request.cookies.set(SESSION_COOKIE_NAME, cookie);
  const checked: string[] = [];
  const res = await handleRefresh(request, (issuer, token) =>
    refreshVerified(issuer, token, {
      fetch: (async () => opts.answer ?? Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 900 })) as typeof fetch,
      verify: async (accessToken) => {
        checked.push(accessToken);
        return opts.verified ?? as('Super Admin');
      },
    }),
  );
  const to = new URL(res.headers.get('location')!);
  const set = res.cookies.get(SESSION_COOKIE_NAME)?.value;
  return { status: res.status, host: to.host, to: to.pathname + to.search, set, stored: set ? parseSessionCookie(set) : null, checked };
}

describe('GET /api/auth/refresh', () => {
  it('stores the rotated pair and returns to the page', async () => {
    const r = await get('/moderation/reports?page=2');
    assert.deepEqual([r.status, r.to, r.checked], [303, '/moderation/reports?page=2', ['new-access']]);
    assert.deepEqual(r.stored, { accessToken: 'new-access', refreshToken: 'new-refresh' });
  });

  it('a rejected refresh goes to sign-in and clears the session', async () => {
    const r = await get('/dashboard', { answer: Response.json({ error: 'invalid_grant' }, { status: 400 }) });
    assert.deepEqual([r.to, r.set, r.checked], ['/login?return=%2Fdashboard', '', []]);
  });

  it('checks the new token like a sign-in: its signature, then its roles', async () => {
    const bad = await get('/dashboard', { verified: { err: { name: 'InvalidAccessTokenError' } } });
    assert.deepEqual([bad.to, bad.set], ['/login?return=%2Fdashboard', '']);
    const lost = await get('/dashboard', { verified: as('User') });
    assert.deepEqual([lost.to, lost.set], ['/access-denied', '']);
    assert.ok((await get('/moderation/review', { verified: as('Content Reviewer') })).stored, 'a reviewer keeps the session');
  });

  it('never redirects off-site', async () => {
    assert.equal((await get('//evil.example/x')).host, 'admin.test');
  });
});
