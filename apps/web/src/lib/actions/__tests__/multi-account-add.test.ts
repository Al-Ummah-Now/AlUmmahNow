/**
 * "Add another account" signed the current account in again: the auth
 * server's shared sign-in (`__session`) answers a plain /authorize with a code
 * for the account already signed in, without showing a form (QA, 2026-11-08:
 * /authorize -> /api/callback/multi-account straight away, same account). The
 * add-account authorize must ask for credentials: OIDC prompt=login.
 */

const redirect = jest.fn();
const authorize = jest.fn(async (redirectUri: string) => ({
  url: `https://auth.qa.alummahnow.net/authorize?client_id=c&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=s`,
}));

jest.mock('../../auth/session-manager', () => ({ SessionManager: {} }));
jest.mock('next/headers', () => ({
  headers: async () => new Map([['host', 'videos.qa.alummahnow.net']]),
  cookies: async () => ({ get: () => undefined, set: jest.fn(), delete: jest.fn() }),
}));
jest.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('../../auth/openauth-client', () => ({ getOpenAuthClient: async () => ({ authorize }) }));
jest.mock('../../api/channels', () => ({ createChannel: jest.fn() }));
jest.mock('../../auth', () => ({ subjects: {} }));
jest.mock('../../profile-helpers', () => ({ shouldRedirectToProfileCreation: jest.fn() }));
jest.mock('@/lib/i18n/utils', () => ({ isLocaleSupported: (l: string) => l === 'en' || l === 'ar' }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { addUserAccount } from '../multi-account';

beforeEach(() => redirect.mockClear());

describe('addUserAccount', () => {
  it('asks the auth server for a fresh sign-in (prompt=login), in the site language', async () => {
    await addUserAccount('ar');

    const url = new URL(redirect.mock.calls[0][0]);
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('lang')).toBe('ar');
    // redirect_uri must stay exactly what /token is called with
    expect(url.searchParams.get('redirect_uri')).toBe('https://videos.qa.alummahnow.net/api/callback/multi-account');
  });
});
