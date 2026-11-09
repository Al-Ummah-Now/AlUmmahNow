/**
 * "The website is not showing all accounts": the switcher lists every account
 * signed in to the browser (auth server /session/accounts), merged with the
 * sessions this site holds tokens for; switching and signing out follow the
 * auth server so every other app opens as the same account.
 */
import {
  decideAfterSignOut,
  decideFollow,
  fetchAuthAccounts,
  mergeAccounts,
  parseAuthAccounts,
  removeAuthAccount,
  switchAuthAccount,
  switchPlan,
  type AuthAccount,
  type LocalAccount,
} from '../auth-accounts';

const AUTH = 'https://auth.qa.alummahnow.net';

const local = (userId: string, isActive: boolean, extra: Partial<LocalAccount> = {}): LocalAccount => ({
  userId,
  email: `${userId}@x.test`,
  displayName: `Local ${userId}`,
  isActive,
  channelsCount: 2,
  ...extra,
});
const auth = (userId: string, isActive: boolean, name?: string): AuthAccount => ({ userId, email: `${userId}@x.test`, name, isActive });

function respond(status: number, body: unknown) {
  // jsdom has no fetch Response: the fields the helpers read
  return jest.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch & jest.Mock;
}

describe('mergeAccounts', () => {
  it('without the auth server (null) shows the local sessions only', () => {
    expect(mergeAccounts([local('a', true)], null)).toEqual([{ ...local('a', true), hasLocalSession: true }]);
  });

  it('lists every auth account; ones without local tokens still appear (email as name, never active)', () => {
    const merged = mergeAccounts([local('a', true)], [auth('b', true, 'Bee'), auth('a', false), auth('c', false)]);
    expect(merged.map((m) => [m.userId, m.isActive, m.hasLocalSession])).toEqual([
      ['b', false, false],
      ['a', true, true],
      ['c', false, false],
    ]);
    expect(merged[0]).toMatchObject({ displayName: 'Bee', email: 'b@x.test', channelsCount: 0 });
    expect(merged[2].displayName).toBe('c@x.test');
    // Local data (display name, channels) wins for accounts held here
    expect(merged[1]).toMatchObject({ displayName: 'Local a', channelsCount: 2 });
  });

  it('keeps a local account the auth server no longer lists (still usable here)', () => {
    const merged = mergeAccounts([local('a', true), local('z', false)], [auth('a', true)]);
    expect(merged.map((m) => m.userId)).toEqual(['a', 'z']);
  });

  it('an empty auth list (401) keeps the local accounts', () => {
    expect(mergeAccounts([local('a', true)], []).map((m) => m.userId)).toEqual(['a']);
  });
});

describe('switchPlan', () => {
  const accounts = mergeAccounts([local('a', true)], [auth('a', true), auth('b', false)]);
  it('switches locally when the site holds the tokens', () => {
    expect(switchPlan(accounts, 'a')).toBe('local');
  });
  it('signs in silently for an account the site has no tokens for', () => {
    expect(switchPlan(accounts, 'b')).toBe('silent-sign-in');
    expect(switchPlan(accounts, 'unknown')).toBe('silent-sign-in');
  });
});

describe('decideAfterSignOut (sign out of one account)', () => {
  it("uses the auth server's next active account: locally when held", () => {
    expect(decideAfterSignOut({ authAccounts: [auth('b', true)], localUserIds: ['b'], signOutUrl: null })).toEqual({
      kind: 'switch-local',
      userId: 'b',
    });
  });
  it('signs in silently when the next account is not held here (even if this was the last local one)', () => {
    expect(decideAfterSignOut({ authAccounts: [auth('c', true)], localUserIds: [], signOutUrl: 'https://auth/logout' })).toEqual({
      kind: 'silent-sign-in',
      userId: 'c',
    });
  });
  it('the last account out is single sign-out (#308)', () => {
    expect(decideAfterSignOut({ authAccounts: [], localUserIds: [], signOutUrl: 'https://auth/logout?x' })).toEqual({
      kind: 'single-sign-out',
      url: 'https://auth/logout?x',
    });
  });
  it('without the auth server, falls back to the server action answer', () => {
    expect(decideAfterSignOut({ authAccounts: null, localUserIds: [], signOutUrl: 'u' })).toEqual({ kind: 'single-sign-out', url: 'u' });
    expect(decideAfterSignOut({ authAccounts: null, localUserIds: ['b'], signOutUrl: null })).toEqual({ kind: 'refresh' });
  });
});

describe('decideFollow (a switch made in another app)', () => {
  const never = () => false;
  it('does nothing when the auth server agrees, or could not be asked', () => {
    expect(decideFollow({ authAccounts: [auth('a', true)], localActiveUserId: 'a', localUserIds: ['a'], alreadyFollowed: never })).toEqual({ kind: 'none' });
    expect(decideFollow({ authAccounts: null, localActiveUserId: 'a', localUserIds: ['a'], alreadyFollowed: never })).toEqual({ kind: 'none' });
    expect(decideFollow({ authAccounts: [], localActiveUserId: 'a', localUserIds: ['a'], alreadyFollowed: never })).toEqual({ kind: 'none' });
  });
  it('follows locally or silently', () => {
    expect(
      decideFollow({ authAccounts: [auth('a', false), auth('b', true)], localActiveUserId: 'a', localUserIds: ['a', 'b'], alreadyFollowed: never }),
    ).toEqual({ kind: 'switch-local', userId: 'b' });
    expect(decideFollow({ authAccounts: [auth('c', true)], localActiveUserId: 'a', localUserIds: ['a'], alreadyFollowed: never })).toEqual({
      kind: 'silent-sign-in',
      userId: 'c',
    });
  });
  it('only once per account per tab (no loop)', () => {
    expect(
      decideFollow({ authAccounts: [auth('c', true)], localActiveUserId: 'a', localUserIds: ['a'], alreadyFollowed: (id) => id === 'c' }),
    ).toEqual({ kind: 'none' });
  });
});

describe('auth server calls', () => {
  it('lists accounts with credentials; 401 = none; network/CORS failure = unknown', async () => {
    const ok = respond(200, { accounts: [{ userId: 'a', email: 'a@x', isActive: true, lastUsed: 1 }, { nope: 1 }] });
    expect(await fetchAuthAccounts(AUTH, ok)).toEqual([{ userId: 'a', email: 'a@x', name: undefined, isActive: true }]);
    expect(ok).toHaveBeenCalledWith(`${AUTH}/session/accounts`, expect.objectContaining({ credentials: 'include' }));
    expect(await fetchAuthAccounts(AUTH, respond(401, {}))).toEqual([]);
    expect(await fetchAuthAccounts(AUTH, respond(500, {}))).toBeNull();
    const blocked = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await fetchAuthAccounts(AUTH, blocked)).toBeNull();
    expect(await fetchAuthAccounts('', ok)).toBeNull();
  });

  it('switch POSTs the user id, sign-out DELETEs it, both with credentials', async () => {
    const impl = respond(200, { success: true });
    expect(await switchAuthAccount(AUTH, 'u1', impl)).toBe(true);
    expect(await removeAuthAccount(AUTH, 'u/1', impl)).toBe(true);
    expect(impl.mock.calls).toEqual([
      [`${AUTH}/session/switch`, expect.objectContaining({ method: 'POST', credentials: 'include', body: '{"userId":"u1"}' })],
      [`${AUTH}/session/accounts/u%2F1`, expect.objectContaining({ method: 'DELETE', credentials: 'include' })],
    ]);
  });

  it('parseAuthAccounts tolerates a malformed body', () => {
    expect(parseAuthAccounts(null)).toEqual([]);
    expect(parseAuthAccounts({ accounts: 'x' })).toEqual([]);
  });
});
