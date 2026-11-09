/**
 * GET /api/auth/login starts the silent sign-in of the client probe and of
 * account switching (prompt=none), keeping the page to come back to.
 */
import type { NextRequest } from 'next/server';

type Recorded = { kind: 'redirect'; url: string; status?: number; set: Record<string, string>; deleted: string[]; headers: Map<string, string> };

jest.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: string, status?: number): Recorded => {
      const set: Record<string, string> = {};
      const deleted: string[] = [];
      const headers = new Map<string, string>();
      return {
        kind: 'redirect',
        url,
        status,
        set,
        deleted,
        headers: Object.assign(headers, { set: (k: string, v: string) => Map.prototype.set.call(headers, k, v) }),
        cookies: { set: (name: string, value: string) => (set[name] = value), delete: (name: string) => deleted.push(name) },
      } as unknown as Recorded;
    },
  },
}));
const authorize = jest.fn(async (redirectUri: string) => ({
  url: `https://auth.qa.alummahnow.net/authorize?client_id=c&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=s`,
}));
jest.mock('@/lib/auth/openauth-client', () => ({ getOpenAuthClient: () => ({ authorize }) }));
jest.mock('@/lib/i18n/utils', () => ({ isLocaleSupported: (l: string) => l === 'en' || l === 'ar' }));

import { GET } from '../route';

function request(url: string): NextRequest {
  return { url, headers: { get: (name: string) => (name === 'host' ? 'videos.qa.alummahnow.net' : null) } } as unknown as NextRequest;
}

describe('GET /api/auth/login', () => {
  it('prompt=none: authorize silently, remember the page and that the attempt is silent', async () => {
    const res = (await GET(request('https://videos.qa.alummahnow.net/api/auth/login?prompt=none&locale=ar&return=%2Far%2Fvideo%2Fx'))) as unknown as Recorded;
    const url = new URL(res.url);
    expect(url.origin + url.pathname).toBe('https://auth.qa.alummahnow.net/authorize');
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('lang')).toBe('ar');
    // redirect_uri stays exactly what /token is called with
    expect(url.searchParams.get('redirect_uri')).toBe('https://videos.qa.alummahnow.net/api/callback');
    const { auth_state: state, ...rest } = res.set;
    expect(rest).toEqual({ auth_locale: 'ar', auth_return: '/ar/video/x', auth_silent: '1' });
    // The callback only accepts a state equal to this browser's cookie
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get('state')).toBe(state);
  });

  it('prompt=login (add account) is not silent', async () => {
    const res = (await GET(request('https://videos.qa.alummahnow.net/api/auth/login?prompt=login&return=%2Fen'))) as unknown as Recorded;
    expect(new URL(res.url).searchParams.get('prompt')).toBe('login');
    expect(res.set.auth_silent).toBeUndefined();
    expect(res.deleted).toContain('auth_silent');
  });

  it('never forwards another prompt or an unsafe return path', async () => {
    const res = (await GET(
      request('https://videos.qa.alummahnow.net/api/auth/login?prompt=select_account&return=https%3A%2F%2Fevil.example'),
    )) as unknown as Recorded;
    expect(new URL(res.url).searchParams.get('prompt')).toBeNull();
    expect(res.set.auth_return).toBeUndefined();
    expect(res.deleted).toContain('auth_return');
    expect(res.set.auth_locale).toBe('en');
  });
});
