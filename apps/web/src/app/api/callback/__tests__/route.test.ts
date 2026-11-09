/**
 * The OAuth callback must never answer with raw JSON: an Error serializes to
 * {} and users saw an empty JSON viewer after a failed password reset
 * (?error=server_error&error_description=Incorrect+email+or+password).
 */
import type { NextRequest } from 'next/server';

const exchange = jest.fn();

// jsdom has no fetch Response for NextResponse; record what the route returns
jest.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: string) => ({ kind: 'redirect', url }),
    json: (body: unknown, init?: { status?: number }) => ({ kind: 'json', body, status: init?.status ?? 200 }),
  },
}));
jest.mock('@/lib/actions', () => ({ getClient: async () => ({ exchange }) }));
jest.mock('@/lib/auth', () => ({ setTokens: jest.fn() }));
jest.mock('@/lib/profile-helpers', () => ({ getProfileCreationPath: (l: string) => `/${l}/profile/create` }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { GET } from '../route';

function request(url: string, cookies: Record<string, string> = {}): NextRequest {
  return {
    url,
    cookies: { get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined) },
  } as unknown as NextRequest;
}

describe('GET /api/callback', () => {
  beforeEach(() => exchange.mockReset());

  it('sends an auth server error to the localized error page without exchanging', async () => {
    const res = await GET(
      request('https://videos.example/api/callback?locale=en&error=server_error&error_description=Incorrect+email+or+password'),
    );
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/en/auth/error' });
    expect(exchange).not.toHaveBeenCalled();
  });

  it('uses the locale cookie when the callback has no locale (Arabic)', async () => {
    const res = await GET(request('https://videos.example/api/callback?error=access_denied', { auth_locale: 'ar' }));
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/ar/auth/error' });
  });

  it('keeps the Arabic locale from the query', async () => {
    const res = await GET(request('https://videos.example/api/callback?locale=ar&error=access_denied'));
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/ar/auth/error' });
  });

  it('treats a callback without a code as an error', async () => {
    const res = await GET(request('https://videos.example/api/callback?locale=en'));
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/en/auth/error' });
    expect(exchange).not.toHaveBeenCalled();
  });

  it('redirects to the error page (not {} JSON) when the code exchange fails', async () => {
    exchange.mockResolvedValue({ err: new Error('invalid_grant') });
    const res = await GET(request('https://videos.example/api/callback?code=abc&locale=en'));
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/en/auth/error' });
    // An authorize from an older build carried ?locale= in redirect_uri (#209)
    expect(exchange).toHaveBeenCalledWith('abc', 'https://videos.example/api/callback?locale=en');
  });

  it('exchanges with the exact redirect_uri used at authorize (bare callback; locale is in a cookie)', async () => {
    exchange.mockResolvedValue({ err: new Error('invalid_grant') });
    await GET(request('https://videos.example/api/callback?code=abc', { auth_locale: 'ar' }));
    expect(exchange).toHaveBeenCalledWith('abc', 'https://videos.example/api/callback');
  });

  describe('silent sign-in (prompt=none from the client probe or an account switch)', () => {
    it('login_required goes back to the page, anonymous, without an error page', async () => {
      const res = await GET(
        request('https://videos.example/api/callback?error=login_required&state=s', {
          auth_locale: 'en',
          auth_silent: '1',
          auth_return: '/en/video/abc?t=10',
        }),
      );
      expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/en/video/abc?t=10' });
      expect(exchange).not.toHaveBeenCalled();
    });

    it('any other error of a silent attempt goes back too (locale home without a return path)', async () => {
      const res = await GET(request('https://videos.example/api/callback?error=server_error', { auth_locale: 'ar', auth_silent: '1' }));
      expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/ar' });
    });

    it('a failed code exchange of a silent attempt goes back to the page too', async () => {
      exchange.mockResolvedValue({ err: new Error('invalid_grant') });
      const res = await GET(
        request('https://videos.example/api/callback?code=abc', { auth_locale: 'en', auth_silent: '1', auth_return: '/en/explore' }),
      );
      expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/en/explore' });
    });

    it('never follows an unsafe return path', async () => {
      const res = await GET(
        request('https://videos.example/api/callback?error=login_required', { auth_silent: '1', auth_return: '//evil.example/x' }),
      );
      expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/en' });
    });
  });
});
