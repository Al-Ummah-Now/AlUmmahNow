/**
 * The add-account callback must never answer with raw JSON: an Error
 * serializes to {} (same incident as the sign-in callback, #188).
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
jest.mock('@al-ummah-now/openauth/error', () => ({ InvalidAccessTokenError: class extends Error {} }));
jest.mock('@/lib/actions', () => ({ getClient: async () => ({ exchange }) }));
jest.mock('@/lib/auth/session-manager', () => ({ SessionManager: { addAccount: jest.fn(), getActiveSession: jest.fn() } }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { GET } from '../route';

function request(url: string, cookies: Record<string, string> = {}): NextRequest {
  return {
    url,
    cookies: { get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined) },
  } as unknown as NextRequest;
}

describe('GET /api/callback/multi-account', () => {
  beforeEach(() => exchange.mockReset());

  it('sends an auth server error to the localized error page without exchanging', async () => {
    const res = await GET(request('https://videos.example/api/callback/multi-account?locale=en&error=access_denied'));
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/en/auth/error' });
    expect(exchange).not.toHaveBeenCalled();
  });

  it('uses the locale cookie when the callback has no locale (Arabic)', async () => {
    const res = await GET(request('https://videos.example/api/callback/multi-account?error=access_denied', { auth_locale: 'ar' }));
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/ar/auth/error' });
  });

  it('treats a callback without a code as an error', async () => {
    const res = await GET(request('https://videos.example/api/callback/multi-account?locale=en'));
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/en/auth/error' });
    expect(exchange).not.toHaveBeenCalled();
  });

  it('redirects to the error page (not {} JSON) when the code exchange fails', async () => {
    exchange.mockResolvedValue({ err: new Error('invalid_grant') });
    const res = await GET(request('https://videos.example/api/callback/multi-account?code=abc&locale=ar'));
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/ar/auth/error' });
    expect(exchange).toHaveBeenCalledWith('abc', 'https://videos.example/api/callback/multi-account');
  });
});
