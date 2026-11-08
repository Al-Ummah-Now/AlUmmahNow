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
    expect(exchange).toHaveBeenCalledWith('abc', 'https://videos.example/api/callback');
  });

  it('exchanges with the exact redirect_uri used at authorize (bare callback; locale is in a cookie)', async () => {
    exchange.mockResolvedValue({ err: new Error('invalid_grant') });
    await GET(request('https://videos.example/api/callback?code=abc', { auth_locale: 'ar' }));
    expect(exchange).toHaveBeenCalledWith('abc', 'https://videos.example/api/callback');
  });
});
