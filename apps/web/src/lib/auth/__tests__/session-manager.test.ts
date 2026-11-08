/**
 * Issue #288: right after sign-in, pages rendered signed out for a few
 * refreshes and server-side API calls went out without Authorization.
 *
 * getActiveSession() saved its clean-up (a stale activeChannelId, channels of
 * another user) with cookies().set(), which throws while a Server Component
 * renders. authenticated() and getServerAuthContext() swallowed the error and
 * answered "signed out", until a Server Action happened to rewrite the cookie.
 * Sign-in produced exactly that state: addAccount() reset a re-added account's
 * channels but kept the session's activeChannelId, and loaded the profile and
 * the channels in parallel, each writing back its own stale copy.
 */

type Jar = Map<string, string>;
const jar: Jar = new Map();
let readOnly = false;

// Server Components get a read-only cookie store; Route Handlers and Server
// Actions may write. Mirrors Next's ReadonlyRequestCookiesError.
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

import { SessionManager, type SessionData } from '../session-manager';

const COOKIE = 'al_ummah_session';

function channel(id: string, userId: string, isMain = false) {
  return { id, userId, name: `Channel ${id}`, isMain };
}

function user(id: string) {
  return { id, email: `${id}@example.com`, displayName: id, createdAt: '', updatedAt: '' };
}

function session(): SessionData {
  return JSON.parse(jar.get(COOKIE) as string) as SessionData;
}

function writeSession(data: unknown) {
  jar.set(COOKIE, JSON.stringify(data));
}

/** The API: a profile per user, and each user's own channels (with a delay, to expose races). */
function serveApi(channelsByUser: Record<string, ReturnType<typeof channel>[]>, delays = { profile: 0, channels: 0 }) {
  apiRequestServer.mockImplementation(async (opts: { url: string }, getAuth: () => Promise<{ userId: string }>) => {
    const { userId } = await getAuth();
    if (opts.url.endsWith('/api/profile')) {
      await new Promise((r) => setTimeout(r, delays.profile));
      return { profile: { displayName: `Name of ${userId}`, avatarUrl: `https://img/${userId}.png` } };
    }
    await new Promise((r) => setTimeout(r, delays.channels));
    return { data: channelsByUser[userId] ?? [], cursor: '', limit: 50 };
  });
}

beforeEach(() => {
  jar.clear();
  readOnly = false;
  apiRequestServer.mockReset();
});

describe('SessionManager.getActiveSession during a Server Component render (#288)', () => {
  it('stays signed in when the session points at a channel the account no longer has', async () => {
    writeSession({
      activeUserId: 'u1',
      activeChannelId: 'ch_stale',
      accounts: {
        u1: { userId: 'u1', email: 'u1@example.com', displayName: 'u1', accessToken: 'tok-u1', refreshToken: 'r', channels: [], activeChannelId: null, lastActivity: 1 },
      },
    });
    readOnly = true;

    const active = await SessionManager.getActiveSession();

    expect(active?.accessToken).toBe('tok-u1');
    expect(active?.channelId).toBeUndefined();
  });

  it('stays signed in when the stored channels include another user\'s channel', async () => {
    writeSession({
      activeUserId: 'u1',
      activeChannelId: 'ch_mine',
      accounts: {
        u1: {
          userId: 'u1', email: 'u1@example.com', displayName: 'u1', accessToken: 'tok-u1', refreshToken: 'r',
          channels: [channel('ch_mine', 'u1', true), channel('ch_other', 'u2')], activeChannelId: 'ch_mine', lastActivity: 1,
        },
      },
    });
    readOnly = true;

    const active = await SessionManager.getActiveSession();

    expect(active?.accessToken).toBe('tok-u1');
    expect(active?.channelId).toBe('ch_mine');
    expect(active?.availableChannels.map((c) => c.id)).toEqual(['ch_mine']);
  });

  it('still saves the clean-up where cookies are writable', async () => {
    writeSession({
      activeUserId: 'u1',
      activeChannelId: 'ch_stale',
      accounts: {
        u1: { userId: 'u1', email: 'u1@example.com', displayName: 'u1', accessToken: 'tok-u1', refreshToken: 'r', channels: [], activeChannelId: null, lastActivity: 1 },
      },
    });

    await SessionManager.getActiveSession();

    expect(session().activeChannelId).toBeNull();
  });
});

describe('SessionManager.loadUserChannels (channel refresh)', () => {
  it('does not rewrite the cookie when the channels are unchanged', async () => {
    // A cookie set in a Server Action re-renders the whole route; the
    // background refresh did that on every page and stole the user's taps
    serveApi({ u1: [channel('ch_a', 'u1', true)] });
    await SessionManager.addAccount({ accessToken: 'tok', refreshToken: 'r' }, user('u1'));

    readOnly = true; // any write now throws
    await expect(SessionManager.loadUserChannels('u1')).resolves.toHaveLength(1);
  });

  it('writes the cookie when a channel changed', async () => {
    serveApi({ u1: [channel('ch_a', 'u1', true)] });
    await SessionManager.addAccount({ accessToken: 'tok', refreshToken: 'r' }, user('u1'));

    serveApi({ u1: [channel('ch_a', 'u1', true), channel('ch_new', 'u1')] });
    await SessionManager.loadUserChannels('u1');

    expect(session().accounts.u1.channels.map((c) => c.id)).toEqual(['ch_a', 'ch_new']);
  });
});

describe('SessionManager.addAccount at sign-in (#288)', () => {
  it('signing in again keeps a consistent session (profile and channels both kept)', async () => {
    // Already signed in on this browser, with a selected channel
    writeSession({
      activeUserId: 'u1',
      activeChannelId: 'ch_a',
      accounts: {
        u1: {
          userId: 'u1', email: 'u1@example.com', displayName: 'u1', accessToken: 'old', refreshToken: 'old-r',
          channels: [channel('ch_a', 'u1', true)], activeChannelId: 'ch_a', lastActivity: 1,
        },
      },
    });
    // The profile answers last: with parallel loads its stale write used to win
    serveApi({ u1: [channel('ch_a', 'u1', true), channel('ch_b', 'u1')] }, { profile: 20, channels: 0 });

    await SessionManager.addAccount({ accessToken: 'new', refreshToken: 'new-r' }, user('u1'));

    const data = session();
    expect(data.accounts.u1.accessToken).toBe('new');
    expect(data.accounts.u1.displayName).toBe('Name of u1');
    expect(data.accounts.u1.channels.map((c) => c.id)).toEqual(['ch_a', 'ch_b']);
    expect(data.activeChannelId).toBe('ch_a');

    // The very next page render (read-only cookies) is signed in, with the token
    readOnly = true;
    const active = await SessionManager.getActiveSession();
    expect(active?.accessToken).toBe('new');
    expect(active?.channelId).toBe('ch_a');
  });

  it('makes the account that just signed in the active one', async () => {
    writeSession({
      activeUserId: 'u1',
      activeChannelId: 'ch_a',
      accounts: {
        u1: {
          userId: 'u1', email: 'u1@example.com', displayName: 'u1', accessToken: 'tok-u1', refreshToken: 'r',
          channels: [channel('ch_a', 'u1', true)], activeChannelId: 'ch_a', lastActivity: 1,
        },
      },
    });
    serveApi({ u2: [channel('ch_u2', 'u2', true)] }, { profile: 0, channels: 10 });

    await SessionManager.addAccount({ accessToken: 'tok-u2', refreshToken: 'r2' }, user('u2'));

    readOnly = true;
    const active = await SessionManager.getActiveSession();
    expect(active?.userId).toBe('u2');
    expect(active?.accessToken).toBe('tok-u2');
    expect(active?.channelId).toBe('ch_u2');
    expect(active?.availableAccounts.map((a) => a.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('a first sign-in stores the profile and selects the main channel', async () => {
    serveApi({ u1: [channel('ch_x', 'u1'), channel('ch_main', 'u1', true)] }, { profile: 15, channels: 0 });

    await SessionManager.addAccount({ accessToken: 'tok', refreshToken: 'r' }, user('u1'));

    readOnly = true;
    const active = await SessionManager.getActiveSession();
    expect(active?.accessToken).toBe('tok');
    expect(active?.displayName).toBe('Name of u1');
    expect(active?.channelId).toBe('ch_main');
  });
});
