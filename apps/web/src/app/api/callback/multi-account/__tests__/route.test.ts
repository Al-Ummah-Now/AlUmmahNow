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
const addAccount = jest.fn();
jest.mock('@/lib/auth/session-manager', () => ({
  SessionManager: { addAccount: (...a: unknown[]) => addAccount(...a), getActiveSession: jest.fn() },
}));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { GET } from '../route';

function request(url: string, cookies: Record<string, string> = {}): NextRequest {
  return {
    url,
    cookies: { get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined) },
  } as unknown as NextRequest;
}

const NONCE = 'f'.repeat(64);

describe('GET /api/callback/multi-account', () => {
  beforeEach(() => {
    exchange.mockReset();
    addAccount.mockReset();
  });

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
    const res = await GET(request(`https://videos.example/api/callback/multi-account?code=abc&locale=ar&state=${NONCE}`, { auth_state: NONCE }));
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/ar/auth/error' });
    expect(exchange).toHaveBeenCalledWith('abc', 'https://videos.example/api/callback/multi-account', undefined);
  });

  it('refuses an add-account callback this browser did not start: no exchange, no account added', async () => {
    exchange.mockResolvedValue({ err: false, tokens: { access: 'a.b.c', refresh: 'r' } });
    for (const [url, cookies] of [
      ['https://videos.example/api/callback/multi-account?code=attacker&locale=en', { auth_state: NONCE }],
      [`https://videos.example/api/callback/multi-account?code=attacker&locale=en&state=${NONCE}`, {}],
      [`https://videos.example/api/callback/multi-account?code=attacker&locale=en&state=${'e'.repeat(64)}`, { auth_state: NONCE }],
    ] as Array<[string, Record<string, string>]>) {
      expect(await GET(request(url, cookies))).toEqual({ kind: 'redirect', url: 'https://videos.example/en/auth/error' });
    }
    expect(exchange).not.toHaveBeenCalled();
    expect(addAccount).not.toHaveBeenCalled();
  });
});
