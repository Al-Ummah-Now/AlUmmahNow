/**
 * Issue #291: the header's "Sign out" only removed the local account, so the
 * auth server's shared sign-in (`__session`) signed the user straight back in
 * on the next "Sign In". Removing the last account (and "Sign out of all")
 * must end the shared sign-in too: the actions return the auth server's
 * single sign-out URL and the client navigates there.
 */

const removeAccount = jest.fn();
const getActiveSession = jest.fn();
const getAllSessions = jest.fn();
const clearAllSessions = jest.fn();

jest.mock('../../auth/session-manager', () => ({
  SessionManager: {
    getActiveSession: () => getActiveSession(),
    removeAccount: (id: string) => removeAccount(id),
    getAllSessions: () => getAllSessions(),
    clearAllSessions: () => clearAllSessions(),
  },
}));
jest.mock('next/headers', () => ({
  headers: async () => new Map([['host', 'videos.qa.alummahnow.net']]),
  cookies: async () => ({ get: () => undefined, set: jest.fn(), delete: jest.fn() }),
}));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('../../auth/openauth-client', () => ({ getOpenAuthClient: jest.fn() }));
jest.mock('../../api/channels', () => ({ createChannel: jest.fn() }));
jest.mock('../../auth', () => ({ subjects: {} }));
jest.mock('../../profile-helpers', () => ({ shouldRedirectToProfileCreation: jest.fn() }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { logoutAllAccounts, logoutCurrentAccount } from '../multi-account';

const ISSUER = 'https://auth.qa.alummahnow.net';

function expectSingleSignOut(url: string | null, returnTo: string) {
  expect(url).not.toBeNull();
  const parsed = new URL(url!);
  expect(parsed.origin + parsed.pathname).toBe(`${ISSUER}/logout`);
  expect(parsed.searchParams.get('return')).toBe(returnTo);
}

describe('sign-out actions (#291)', () => {
  const env = process.env.Issuer;
  beforeAll(() => {
    process.env.Issuer = ISSUER;
  });
  afterAll(() => {
    process.env.Issuer = env;
  });
  beforeEach(() => jest.clearAllMocks());

  it('the last account out ends the shared sign-in and returns home in the page locale', async () => {
    getActiveSession.mockResolvedValue({ userId: 'usr_1' });
    getAllSessions.mockResolvedValue([]);

    const { signOutUrl } = await logoutCurrentAccount('ar');

    expect(removeAccount).toHaveBeenCalledWith('usr_1');
    expectSingleSignOut(signOutUrl, 'https://videos.qa.alummahnow.net/ar');
  });

  it('keeps the shared sign-in while other accounts are still signed in here', async () => {
    getActiveSession.mockResolvedValue({ userId: 'usr_1' });
    getAllSessions.mockResolvedValue([{ userId: 'usr_2' }]);

    expect(await logoutCurrentAccount('en')).toEqual({ signOutUrl: null });
  });

  it('signs out everywhere when the local clean-up fails (fail closed)', async () => {
    getActiveSession.mockRejectedValue(new Error('cookie store unavailable'));

    const { signOutUrl } = await logoutCurrentAccount('en');

    expectSingleSignOut(signOutUrl, 'https://videos.qa.alummahnow.net/en');
  });

  it('"Sign out of all" clears every account and ends the shared sign-in', async () => {
    const { signOutUrl } = await logoutAllAccounts('en');

    expect(clearAllSessions).toHaveBeenCalled();
    expectSingleSignOut(signOutUrl, 'https://videos.qa.alummahnow.net/en');
  });

  it('never puts an unknown locale into the return URL', async () => {
    const { signOutUrl } = await logoutAllAccounts('https://evil.example');
    expectSingleSignOut(signOutUrl, 'https://videos.qa.alummahnow.net/en');
  });
});
