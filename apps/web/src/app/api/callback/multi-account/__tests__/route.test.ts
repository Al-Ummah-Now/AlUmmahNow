/**
 * The add-account callback: exchanges with the authorize redirect_uri (locale
 * included) and never answers with raw JSON (an Error serializes to {}).
 */
import type { NextRequest } from 'next/server';

const exchange = jest.fn();
const addAccount = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: string) => ({ kind: 'redirect', url }),
    json: (body: unknown, init?: { status?: number }) => ({ kind: 'json', body, status: init?.status ?? 200 }),
  },
}));
jest.mock('@/lib/actions', () => ({ getClient: async () => ({ exchange }) }));
// ESM-only package; the route only needs the error class
jest.mock('@al-ummah-now/openauth/error', () => ({ InvalidAccessTokenError: class InvalidAccessTokenError extends Error {} }), { virtual: true });
jest.mock('@/lib/auth/session-manager', () => ({
  SessionManager: { addAccount: (...args: unknown[]) => addAccount(...args), getActiveSession: async () => ({ email: 'a@b.c', availableAccounts: [1, 2] }) },
}));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { GET } from '../route';

const request = (url: string) => ({ url }) as unknown as NextRequest;
const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload))}.s`;

describe('GET /api/callback/multi-account', () => {
  beforeEach(() => {
    exchange.mockReset();
    addAccount.mockReset();
  });

  it('exchanges with the authorize redirect_uri, locale included', async () => {
    exchange.mockResolvedValue({ err: false, tokens: { access: jwt({ type: 'user', properties: { id: 'u1', email: 'a@b.c' } }), refresh: 'r' } });
    const res = await GET(request('https://videos.example/api/callback/multi-account?locale=ar&code=abc&state=s'));
    expect(exchange).toHaveBeenCalledWith('abc', 'https://videos.example/api/callback/multi-account?locale=ar');
    expect(addAccount).toHaveBeenCalled();
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/ar/profile?session_updated=true' });
  });

  it('redirects to the error page (not {} JSON) when the exchange fails', async () => {
    exchange.mockResolvedValue({ err: new Error('invalid_grant') });
    const res = await GET(request('https://videos.example/api/callback/multi-account?locale=en&code=abc'));
    expect(res).toEqual({ kind: 'redirect', url: 'https://videos.example/en/auth/error' });
  });

  it('does not exchange when the auth server returned an error or no code', async () => {
    for (const url of ['https://videos.example/api/callback/multi-account?locale=en&error=access_denied', 'https://videos.example/api/callback/multi-account?locale=en']) {
      expect(await GET(request(url))).toEqual({ kind: 'redirect', url: 'https://videos.example/en/auth/error' });
    }
    expect(exchange).not.toHaveBeenCalled();
  });
});
