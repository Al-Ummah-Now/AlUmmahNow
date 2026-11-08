/**
 * @jest-environment node
 *
 * SessionManager with short-lived access tokens and rotating refresh tokens:
 * saving refreshed tokens, never restoring an older refresh token, and ending
 * a sign-in cleanly when the refresh token is rejected.
 */

const jar = new Map<string, string>();
let readOnly = false;

jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    set: (name: string, value: string) => {
      if (readOnly) throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
      jar.set(name, value);
    },
    delete: (name: string) => {
      if (readOnly) throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
      jar.delete(name);
    },
  }),
}));

const apiRequestServer = jest.fn();
jest.mock('../../api/api-client', () => ({
  apiRequestServer: (...args: unknown[]) => apiRequestServer(...args),
  buildApiUrl: (p: string) => `https://api.example${p}`,
  buildQueryParams: () => '',
}));
jest.mock('../openauth-client', () => ({ getOpenAuthClient: jest.fn() }));
jest.mock('../../auth', () => ({ subjects: {} }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
const revokeTokensOnSignOut = jest.fn(async () => undefined);
jest.mock('../revoke-on-sign-out', () => ({ revokeTokensOnSignOut: (...args: unknown[]) => revokeTokensOnSignOut(...(args as [])) }));

import { SessionManager, type SessionData, type UserSession } from '../session-manager';
import { __resetTokenRefreshStateForTests, latestRotation } from '../token-refresh';
import { DAY, MINUTE, fakeIssuer, jwt } from './token-fixtures';

const COOKIE = 'al_ummah_session';
const originalFetch = global.fetch;
const originalIssuer = process.env.Issuer;

function stored(): SessionData {
  return JSON.parse(jar.get(COOKIE) as string) as SessionData;
}

function writeAccount(tokens: Partial<UserSession>) {
  jar.set(COOKIE, JSON.stringify({
    activeUserId: 'u1',
    activeChannelId: null,
    accounts: {
      u1: { userId: 'u1', email: 'u1@example.com', displayName: 'u1', channels: [], activeChannelId: null, lastActivity: 1, ...tokens },
    },
  }));
}

function useIssuer(responses: Parameters<typeof fakeIssuer>[0]) {
  const issuer = fakeIssuer(responses);
  global.fetch = issuer.fetchImpl;
  return issuer;
}

beforeEach(() => {
  jar.clear();
  readOnly = false;
  apiRequestServer.mockReset();
  revokeTokensOnSignOut.mockClear();
  __resetTokenRefreshStateForTests();
  process.env.Issuer = 'https://auth.example';
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env.Issuer = originalIssuer;
});

describe('existing cookies on deploy (no expiresAt)', () => {
  it('keep working with their 30-day token: no refresh, no sign-out', async () => {
    const issuer = useIssuer({});
    const legacyToken = jwt('u1', Date.now() - 3 * DAY, 30 * DAY);
    writeAccount({ accessToken: legacyToken, refreshToken: 'r-legacy' });

    const session = await SessionManager.ensureFreshActiveSession();

    expect(session?.accessToken).toBe(legacyToken);
    expect(issuer.calls).toHaveLength(0);
  });

  it('refresh once the token nears expiry, and store expiresAt', async () => {
    const fresh = jwt('u1', Date.now(), 15 * MINUTE);
    const issuer = useIssuer({ 'r-legacy': { access: fresh, refresh: 'r2' } });
    writeAccount({ accessToken: jwt('u1', Date.now() - 30 * DAY + MINUTE, 30 * DAY), refreshToken: 'r-legacy' });

    const session = await SessionManager.ensureFreshActiveSession();

    expect(issuer.calls).toEqual([{ refreshToken: 'r-legacy' }]);
    expect(session?.accessToken).toBe(fresh);
    expect(stored().accounts.u1).toMatchObject({ accessToken: fresh, refreshToken: 'r2' });
    expect(stored().accounts.u1.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('addAccount', () => {
  it('stores expiresAt for a new sign-in', async () => {
    apiRequestServer.mockResolvedValue(null);
    const access = jwt('u1', Date.now(), 15 * MINUTE);
    await SessionManager.addAccount({ accessToken: access, refreshToken: 'r1', expiresIn: 900 }, { id: 'u1', email: 'u1@example.com', displayName: 'u1', createdAt: '', updatedAt: '' });
    expect(stored().accounts.u1.expiresAt).toBe(Math.floor((Date.now() + 15 * MINUTE) / 1000) * 1000);
  });

  it('a new sign-in clears needsSignIn even over a legacy token that expires later', async () => {
    apiRequestServer.mockResolvedValue(null);
    writeAccount({ accessToken: jwt('u1', Date.now() - DAY, 30 * DAY), refreshToken: 'r-dead', needsSignIn: true });
    const access = jwt('u1', Date.now(), 15 * MINUTE);

    await SessionManager.addAccount({ accessToken: access, refreshToken: 'r-new' }, { id: 'u1', email: 'u1@example.com', displayName: 'u1', createdAt: '', updatedAt: '' });

    expect(stored().accounts.u1).toMatchObject({ accessToken: access, refreshToken: 'r-new' });
    expect(stored().accounts.u1.needsSignIn).toBeUndefined();
    expect((await SessionManager.getActiveSession())?.accessToken).toBe(access);
  });
});

describe('concurrent writes (race: channel load overlapping a refresh)', () => {
  it('loadUserChannels does not write back the old refresh token', async () => {
    const fresh = jwt('u1', Date.now(), 15 * MINUTE);
    useIssuer({ r1: { access: fresh, refresh: 'r2' } });
    writeAccount({ accessToken: jwt('u1', Date.now() - 14 * MINUTE, 15 * MINUTE), refreshToken: 'r1' });

    // While the channel list loads, another code path refreshes the tokens
    apiRequestServer.mockImplementation(async () => {
      await SessionManager.refreshAccount('u1');
      return { data: [{ id: 'ch1', userId: 'u1', name: 'One', isMain: true }], cursor: '', limit: 50 };
    });

    await SessionManager.loadUserChannels('u1');

    expect(stored().accounts.u1.refreshToken).toBe('r2');
    expect(stored().accounts.u1.accessToken).toBe(fresh);
    expect(stored().accounts.u1.channels.map((c) => c.id)).toEqual(['ch1']);
  });
});

describe('refreshAfterUnauthorized (the 401 retry)', () => {
  it('refreshes and returns the new token', async () => {
    const fresh = jwt('u1', Date.now(), 15 * MINUTE);
    const issuer = useIssuer({ r1: { access: fresh, refresh: 'r2' } });
    const stale = jwt('u1', Date.now() - 5 * MINUTE, 15 * MINUTE); // not near expiry, but the API said 401
    writeAccount({ accessToken: stale, refreshToken: 'r1' });

    expect(await SessionManager.refreshAfterUnauthorized('u1', stale)).toBe(fresh);
    expect(issuer.calls).toHaveLength(1);
  });

  it('uses a token another request already renewed instead of refreshing again', async () => {
    const issuer = useIssuer({});
    const current = jwt('u1', Date.now(), 15 * MINUTE);
    writeAccount({ accessToken: current, refreshToken: 'r2' });

    expect(await SessionManager.refreshAfterUnauthorized('u1', 'the-old-token')).toBe(current);
    expect(issuer.calls).toHaveLength(0);
  });

  it('on invalid_grant, takes the newer refresh token that is now in the cookie', async () => {
    const stale = jwt('u1', Date.now() - 14 * MINUTE, 15 * MINUTE);
    const rotated = jwt('u1', Date.now(), 15 * MINUTE);
    writeAccount({ accessToken: stale, refreshToken: 'r1' });
    // Another request rotated r1 -> r2 and saved it just before our /token call
    global.fetch = jest.fn(async () => {
      writeAccount({ accessToken: rotated, refreshToken: 'r2', expiresAt: Date.now() + 15 * MINUTE });
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }) as unknown as typeof fetch;

    expect(await SessionManager.refreshAfterUnauthorized('u1', stale)).toBe(rotated);
    expect(stored().accounts.u1).toMatchObject({ accessToken: rotated, refreshToken: 'r2' });
    expect(stored().accounts.u1.needsSignIn).toBeUndefined();
  });

  it('a definitive failure marks the account needs-sign-in, signs it out, and stops there', async () => {
    const issuer = useIssuer({});
    const stale = jwt('u1', Date.now() - 20 * MINUTE, 15 * MINUTE);
    writeAccount({ accessToken: stale, refreshToken: 'r-dead' });

    expect(await SessionManager.refreshAfterUnauthorized('u1', stale)).toBeNull();
    expect(stored().accounts.u1.needsSignIn).toBe(true);

    // signed out: the dead token is never handed out again
    expect(await SessionManager.getActiveSession()).toBeNull();
    expect(await SessionManager.ensureFreshActiveSession()).toBeNull();
    expect(await SessionManager.getValidAccessToken('u1')).toBeNull();
    expect(await SessionManager.refreshAfterUnauthorized('u1', stale)).toBeNull();
    // ...and the issuer was asked only once (no loop)
    expect(issuer.calls).toHaveLength(1);
    expect((await SessionManager.getAllSessions())[0].needsSignIn).toBe(true);
  });

  it('does not spend the refresh token where cookies are read-only', async () => {
    const issuer = useIssuer({ r1: { access: jwt('u1', Date.now(), 15 * MINUTE), refresh: 'r2' } });
    const stale = jwt('u1', Date.now() - 20 * MINUTE, 15 * MINUTE);
    writeAccount({ accessToken: stale, refreshToken: 'r1' });
    readOnly = true;

    expect(await SessionManager.refreshAfterUnauthorized('u1', stale)).toBeNull();
    expect(issuer.calls).toHaveLength(0);
    expect(stored().accounts.u1.refreshToken).toBe('r1');
  });
});

describe('sign-out', () => {
  it('passes the tokens to the revocation hook', async () => {
    writeAccount({ accessToken: jwt('u1', Date.now(), 15 * MINUTE), refreshToken: 'r1' });
    await SessionManager.clearAllSessions();
    expect(revokeTokensOnSignOut).toHaveBeenCalledWith([expect.objectContaining({ userId: 'u1', refreshToken: 'r1' })]);
    expect(jar.has(COOKIE)).toBe(false);
  });

  it('forgets remembered rotations so an old refresh token gets nothing afterwards', async () => {
    useIssuer({ r1: { access: jwt('u1', Date.now(), 15 * MINUTE), refresh: 'r2' } });
    writeAccount({ accessToken: jwt('u1', Date.now() - 20 * MINUTE, 15 * MINUTE), refreshToken: 'r1' });
    await SessionManager.ensureFreshActiveSession();
    expect(latestRotation('u1', 'r1')?.refreshToken).toBe('r2');

    await SessionManager.removeAccount('u1');

    expect(latestRotation('u1', 'r1')).toBeNull();
    // a cookie replayed with the old token is not upgraded
    writeAccount({ accessToken: jwt('u1', Date.now() - 20 * MINUTE, 15 * MINUTE), refreshToken: 'r1' });
    expect((await SessionManager.getSessionForUser('u1'))?.refreshToken).toBe('r1');
  });

  it('clearAllSessions forgets every account\'s rotations', async () => {
    useIssuer({ r1: { access: jwt('u1', Date.now(), 15 * MINUTE), refresh: 'r2' } });
    writeAccount({ accessToken: jwt('u1', Date.now() - 20 * MINUTE, 15 * MINUTE), refreshToken: 'r1' });
    await SessionManager.ensureFreshActiveSession();

    await SessionManager.clearAllSessions();

    expect(latestRotation('u1', 'r1')).toBeNull();
  });
});
