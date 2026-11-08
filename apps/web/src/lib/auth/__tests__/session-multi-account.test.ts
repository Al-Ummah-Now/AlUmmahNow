/**
 * "Only shows one user while I am signed in with two" (2026-11-08).
 *
 * Two accounts did not fit in one cookie: each account holds a ~700 character
 * access token plus its channels, and Next URL-encodes the JSON (`"` -> `%22`,
 * ...), so two accounts came to ~4.4 KB on the wire (QA: 3333 bytes of JSON,
 * 4367 encoded). Browsers silently drop a cookie over 4096 bytes, so the
 * callback's Set-Cookie with both accounts was ignored and the old one-account
 * cookie stayed. The size guard measured the unencoded JSON and never fired.
 */

type Jar = Map<string, string>;
const jar: Jar = new Map();

jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
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
jest.mock('../revoke-on-sign-out', () => ({ revokeTokensOnSignOut: jest.fn(async () => undefined) }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { SessionManager } from '../session-manager';
import { BROWSER_COOKIE_LIMIT, SESSION_COOKIE_NAME } from '../session-cookie';

/** A token shaped like the issuer's: a ~700 character JWT. */
function jwt(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = {
    mode: 'access', type: 'user', properties: { id: sub, email: `${sub}@delivered.resend.dev`, roles: ['user'] },
    aud: 'e0de3c30-0304-4ac4-86d6-1e185dec0439', iss: 'https://auth.qa.alummahnow.net', sub: `user:${sub}`,
    exp: Math.floor(Date.now() / 1000) + 900, iat: Math.floor(Date.now() / 1000), jti: 'x'.repeat(36), tenant: 'default',
  };
  return `${b64({ alg: 'ES256', kid: 'k'.repeat(36), typ: 'JWT' })}.${b64(payload)}.${'s'.repeat(86)}`;
}

function channels(userId: string) {
  return [1, 2].map((n) => ({
    id: `ch_${userId}_${n}`, userId, name: `Al Ummah Now QA — Channel ${n}`, nameLocalized: { en: `Channel ${n}`, ar: `القناة ${n}` },
    avatarUrl: `https://cdn.qa.alummahnow.net/avatars/${userId}/${n}.webp`, isMain: n === 1, isVerified: false, isPrivate: false,
    subscribersCount: 0, videosCount: 3, dateCreated: '2026-11-01T10:00:00.000Z', dateModified: '2026-11-08T10:00:00.000Z',
  }));
}

function serveApi() {
  apiRequestServer.mockImplementation(async (opts: { url: string }, getAuth: () => Promise<{ userId: string }>) => {
    const { userId } = await getAuth();
    if (opts.url.endsWith('/api/profile')) {
      return { profile: { displayName: `Display name of ${userId}`, avatarUrl: `https://cdn.qa.alummahnow.net/p/${userId}.webp` } };
    }
    return { data: channels(userId), cursor: '', limit: 50 };
  });
}

function signIn(id: string) {
  return SessionManager.addAccount(
    { accessToken: jwt(id), refreshToken: `${id}:${'r'.repeat(50)}`, expiresIn: 900 },
    { id, email: `${id}@delivered.resend.dev`, displayName: id, createdAt: '', updatedAt: '' },
  );
}

/** What the browser enforces: `name=value` with the value as Next encodes it. */
function wireSizes(): Record<string, number> {
  return Object.fromEntries([...jar].map(([name, value]) => [name, `${name}=${encodeURIComponent(value)}`.length]));
}

beforeEach(() => {
  jar.clear();
  apiRequestServer.mockReset();
  serveApi();
});

describe('session cookie with several accounts', () => {
  it('stores a second account in cookies the browser accepts, and lists both', async () => {
    await signIn('usr_a');
    await signIn('usr_b');

    for (const [name, size] of Object.entries(wireSizes())) {
      expect({ name, fits: size <= BROWSER_COOKIE_LIMIT }).toEqual({ name, fits: true });
    }

    const accounts = await SessionManager.getAllSessions();
    expect(accounts.map((a) => a.userId).sort()).toEqual(['usr_a', 'usr_b']);
    expect(accounts.find((a) => a.isActive)?.userId).toBe('usr_b');
  });

  it('keeps every account up to the limit of 10', async () => {
    for (let i = 0; i < 10; i++) await signIn(`usr_${i}`);

    expect(Math.max(...Object.values(wireSizes()))).toBeLessThanOrEqual(BROWSER_COOKIE_LIMIT);
    expect((await SessionManager.getAllSessions()).length).toBe(10);
  });

  it('keeps a single account in the one cookie it always used', async () => {
    await signIn('usr_a');

    expect([...jar.keys()]).toEqual([SESSION_COOKIE_NAME]);
  });

  it('switching accounts works, and signing out of one keeps the other', async () => {
    await signIn('usr_a');
    await signIn('usr_b');

    await SessionManager.setActiveAccount('usr_a');
    expect((await SessionManager.getActiveSession())?.userId).toBe('usr_a');

    await SessionManager.removeAccount('usr_a');
    const left = await SessionManager.getAllSessions();
    expect(left.map((a) => a.userId)).toEqual(['usr_b']);
    expect(left[0].isActive).toBe(true);
    // Back to one cookie: the extra chunks are gone
    expect([...jar.keys()]).toEqual([SESSION_COOKIE_NAME]);
  });

  it('signing out of every account clears every chunk', async () => {
    await signIn('usr_a');
    await signIn('usr_b');

    await SessionManager.clearAllSessions();

    expect(jar.size).toBe(0);
  });
});
