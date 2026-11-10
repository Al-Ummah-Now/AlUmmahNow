/**
 * @jest-environment node
 *
 * Short-lived access tokens (~15 min) with rotating refresh tokens: the
 * refresh rules in token-refresh.ts.
 */

import {
  LEGACY_TOKEN_ISSUED_BEFORE_MS,
  REFRESH_AHEAD_MS,
  isLegacyLongLivedToken,
  __resetTokenRefreshStateForTests,
  accountExpiresAt,
  ROTATION_MEMORY_MS,
  applyKnownRotations,
  computeExpiresAt,
  forgetRotations,
  latestRotation,
  rememberRotation,
  isNewerTokenSet,
  mergeSessionTokens,
  refreshAccountInSession,
  refreshTokensOnce,
  requestTokenRefresh,
  shouldRefresh,
} from '../token-refresh';
import type { SessionData, UserSession } from '../session-manager';
import { DAY, MINUTE, fakeIssuer, jwt } from './token-fixtures';

const ISSUER = 'https://auth.example';
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

function account(userId: string, tokens: Partial<UserSession>): UserSession {
  return {
    userId,
    email: `${userId}@example.com`,
    displayName: userId,
    accessToken: 'unset',
    refreshToken: 'unset',
    channels: [],
    activeChannelId: null,
    lastActivity: 1,
    ...tokens,
  };
}

function sessionWith(...accounts: UserSession[]): SessionData {
  return {
    activeUserId: accounts[0].userId,
    activeChannelId: null,
    accounts: Object.fromEntries(accounts.map((a) => [a.userId, a])),
  };
}

beforeEach(() => __resetTokenRefreshStateForTests());

describe('expiry', () => {
  it('refreshes ahead of expiry, not before', () => {
    const issuedAt = NOW - 10 * MINUTE;
    const acc = account('u1', { accessToken: jwt('u1', issuedAt, 15 * MINUTE), refreshToken: 'r1', expiresAt: issuedAt + 15 * MINUTE });

    // 5 minutes left: fine
    expect(shouldRefresh(acc, NOW)).toBe(false);
    // inside the 2-minute window
    expect(shouldRefresh(acc, issuedAt + 15 * MINUTE - REFRESH_AHEAD_MS + 1000)).toBe(true);
    // already expired
    expect(shouldRefresh(acc, issuedAt + 20 * MINUTE)).toBe(true);
  });

  it('reads the JWT exp for a legacy cookie without expiresAt (30-day token on deploy)', () => {
    const issuedAt = NOW - 2 * DAY;
    const legacy = account('u1', { accessToken: jwt('u1', issuedAt, 30 * DAY), refreshToken: 'r1' });
    expect(legacy.expiresAt).toBeUndefined();

    expect(accountExpiresAt(legacy)).toBe(Math.floor((issuedAt + 30 * DAY) / 1000) * 1000);
    // Refreshed now, not used for the rest of its 30 days: its roles are frozen
    // at issue (a revoked Admin would keep working)
    expect(shouldRefresh(legacy, NOW)).toBe(true);
    expect(shouldRefresh(legacy, issuedAt + 30 * DAY - MINUTE)).toBe(true);
  });

  it('a token issued for longer than 15 minutes before the cutoff is due for refresh', () => {
    const issuedAt = NOW - 10 * MINUTE;
    const long = account('u1', { accessToken: jwt('u1', issuedAt, 15 * MINUTE + 1000), refreshToken: 'r1' });
    expect(isLegacyLongLivedToken(long.accessToken)).toBe(true);
    expect(shouldRefresh(long, NOW)).toBe(true);
    // exactly 15 minutes: the normal rule (5 minutes left, no refresh)
    const short = account('u1', { accessToken: jwt('u1', issuedAt, 15 * MINUTE), refreshToken: 'r1' });
    expect(isLegacyLongLivedToken(short.accessToken)).toBe(false);
    expect(shouldRefresh(short, NOW)).toBe(false);
  });

  it('a long-lived token issued after the cutoff (local issuer without ACCESS_TOKEN_TTL) is not refreshed on every request', () => {
    const issuedAt = LEGACY_TOKEN_ISSUED_BEFORE_MS + DAY;
    const dev = account('u1', { accessToken: jwt('u1', issuedAt, 30 * DAY), refreshToken: 'r1' });
    expect(isLegacyLongLivedToken(dev.accessToken)).toBe(false);
    expect(shouldRefresh(dev, issuedAt + MINUTE)).toBe(false);
  });

  it('a legacy token is still left alone when the account must sign in again', () => {
    const legacy = jwt('u1', NOW - 2 * DAY, 30 * DAY);
    expect(shouldRefresh(account('u1', { accessToken: legacy, refreshToken: 'r1', needsSignIn: true }), NOW)).toBe(false);
    expect(shouldRefresh(account('u1', { accessToken: legacy, refreshToken: '' }), NOW)).toBe(false);
    expect(isLegacyLongLivedToken('opaque-token')).toBe(false);
  });

  it('never refreshes an account that must sign in again, or one without a refresh token', () => {
    const expired = jwt('u1', NOW - DAY, 15 * MINUTE);
    expect(shouldRefresh(account('u1', { accessToken: expired, refreshToken: 'r1', needsSignIn: true }), NOW)).toBe(false);
    expect(shouldRefresh(account('u1', { accessToken: expired, refreshToken: '' }), NOW)).toBe(false);
  });

  it('takes expiresAt from the JWT, falling back to expires_in', () => {
    const token = jwt('u1', NOW, 15 * MINUTE);
    expect(computeExpiresAt(token, 60, NOW)).toBe(Math.floor((NOW + 15 * MINUTE) / 1000) * 1000);
    expect(computeExpiresAt('opaque-token', 900, NOW)).toBe(NOW + 900 * 1000);
    expect(computeExpiresAt('opaque-token', undefined, NOW)).toBeUndefined();
  });
});

describe('concurrent merge rule', () => {
  it('never lets an older refresh token overwrite a newer one', () => {
    const older = { accessToken: jwt('u1', NOW - 14 * MINUTE, 15 * MINUTE), refreshToken: 'r-old' };
    const newer = { accessToken: jwt('u1', NOW, 15 * MINUTE), refreshToken: 'r-new', expiresAt: NOW + 15 * MINUTE };

    // The cookie now holds the newer pair (a refresh happened meanwhile); this
    // request read the session before that and changed the channels
    const latest = sessionWith(account('u1', newer));
    const mine = sessionWith(account('u1', { ...older, channels: [{ id: 'ch1' } as never] }));

    const merged = mergeSessionTokens(latest, mine);

    expect(merged.accounts.u1.refreshToken).toBe('r-new');
    expect(merged.accounts.u1.accessToken).toBe(newer.accessToken);
    expect(merged.accounts.u1.expiresAt).toBe(newer.expiresAt);
    // its own changes survive
    expect(merged.accounts.u1.channels).toEqual([{ id: 'ch1' }]);
  });

  it('keeps its own pair when it is the newer one', () => {
    const older = { accessToken: jwt('u1', NOW - 14 * MINUTE, 15 * MINUTE), refreshToken: 'r-old' };
    const newer = { accessToken: jwt('u1', NOW, 15 * MINUTE), refreshToken: 'r-new' };
    const merged = mergeSessionTokens(sessionWith(account('u1', older)), sessionWith(account('u1', newer)));
    expect(merged.accounts.u1.refreshToken).toBe('r-new');
  });

  it('judges by issue time, so a fresh 15-minute token beats a legacy 30-day one', () => {
    const legacy = account('u1', { accessToken: jwt('u1', NOW - DAY, 30 * DAY), refreshToken: 'r-legacy' });
    const fresh = account('u1', { accessToken: jwt('u1', NOW, 15 * MINUTE), refreshToken: 'r-fresh' });
    expect(isNewerTokenSet(fresh, legacy)).toBe(true);
    expect(isNewerTokenSet(legacy, fresh)).toBe(false);
  });

  it('does not resurrect a removed account or touch other fields', () => {
    const latest = sessionWith(
      account('u1', { accessToken: jwt('u1', NOW, 15 * MINUTE), refreshToken: 'r1' }),
      account('u2', { accessToken: jwt('u2', NOW, 15 * MINUTE), refreshToken: 'r2' }),
    );
    const mine = sessionWith(account('u1', { accessToken: jwt('u1', NOW - MINUTE, 15 * MINUTE), refreshToken: 'r1-old', displayName: 'Renamed' }));
    const merged = mergeSessionTokens(latest, mine);
    expect(Object.keys(merged.accounts)).toEqual(['u1']);
    expect(merged.accounts.u1.displayName).toBe('Renamed');
    expect(merged.accounts.u1.refreshToken).toBe('r1');
  });
});

describe('talking to the issuer', () => {
  it('posts the refresh grant and stores expiresAt from the new JWT', async () => {
    const access = jwt('u1', NOW, 15 * MINUTE);
    const issuer = fakeIssuer({ r1: { access, refresh: 'r2' } });

    const outcome = await requestTokenRefresh('r1', { issuer: ISSUER, fetchImpl: issuer.fetchImpl, now: () => NOW });

    expect(outcome).toEqual({ ok: true, tokens: { accessToken: access, refreshToken: 'r2', expiresAt: Math.floor((NOW + 15 * MINUTE) / 1000) * 1000 } });
    expect(issuer.mock).toHaveBeenCalledWith(`${ISSUER}/token`, expect.objectContaining({ method: 'POST' }));
    expect(issuer.calls).toEqual([{ refreshToken: 'r1' }]);
  });

  it('tells a rejected refresh token (definitive) from a server error or network failure', async () => {
    const issuer = fakeIssuer({ r500: { status: 503, error: 'unavailable' } });
    expect(await requestTokenRefresh('dead', { issuer: ISSUER, fetchImpl: issuer.fetchImpl })).toEqual({ ok: false, definitive: true, reason: 'invalid_grant' });
    expect(await requestTokenRefresh('r500', { issuer: ISSUER, fetchImpl: issuer.fetchImpl })).toMatchObject({ ok: false, definitive: false });

    const offline = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await requestTokenRefresh('r1', { issuer: ISSUER, fetchImpl: offline })).toMatchObject({ ok: false, definitive: false });
  });

  it('spends a refresh token once for concurrent callers (single-flight)', async () => {
    const issuer = fakeIssuer({ r1: { access: jwt('u1', NOW, 15 * MINUTE), refresh: 'r2' } });
    const options = { issuer: ISSUER, fetchImpl: issuer.fetchImpl, now: () => NOW };

    const [a, b, c] = await Promise.all([refreshTokensOnce('u1', 'r1', options), refreshTokensOnce('u1', 'r1', options), refreshTokensOnce('u1', 'r1', options)]);

    expect(issuer.calls).toHaveLength(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);

    // A request still holding r1 afterwards gets r2 without a second /token call
    expect(await refreshTokensOnce('u1', 'r1', options)).toEqual(a);
    expect(issuer.calls).toHaveLength(1);
  });

  it('lets a stale cookie pick up a rotation this isolate already made', async () => {
    const access = jwt('u1', NOW, 15 * MINUTE);
    const issuer = fakeIssuer({ r1: { access, refresh: 'r2' } });
    await refreshTokensOnce('u1', 'r1', { issuer: ISSUER, fetchImpl: issuer.fetchImpl, now: () => NOW });

    const stale = sessionWith(account('u1', { accessToken: jwt('u1', NOW - 14 * MINUTE, 15 * MINUTE), refreshToken: 'r1' }));
    expect(applyKnownRotations(stale, NOW + 1000)).toBe(true);
    expect(stale.accounts.u1.refreshToken).toBe('r2');
    expect(stale.accounts.u1.accessToken).toBe(access);
  });
});

describe('refreshAccountInSession', () => {
  const expiring = () => account('u1', { accessToken: jwt('u1', NOW - 14 * MINUTE, 15 * MINUTE), refreshToken: 'r1' });

  it('puts the rotated pair in the session', async () => {
    const access = jwt('u1', NOW, 15 * MINUTE);
    const issuer = fakeIssuer({ r1: { access, refresh: 'r2' } });
    const data = sessionWith(expiring());

    const result = await refreshAccountInSession(data, 'u1', { issuer: ISSUER, fetchImpl: issuer.fetchImpl, now: () => NOW });

    expect(result).toBe('refreshed');
    expect(data.accounts.u1).toMatchObject({ accessToken: access, refreshToken: 'r2' });
    expect(data.accounts.u1.needsSignIn).toBeUndefined();
  });

  it('on invalid_grant, adopts the newer pair another request stored instead of signing out', async () => {
    const issuer = fakeIssuer({}); // r1 was already spent elsewhere: invalid_grant
    const data = sessionWith(expiring());
    const rotatedElsewhere = { accessToken: jwt('u1', NOW, 15 * MINUTE), refreshToken: 'r2', expiresAt: NOW + 15 * MINUTE };

    const result = await refreshAccountInSession(data, 'u1', {
      issuer: ISSUER,
      fetchImpl: issuer.fetchImpl,
      now: () => NOW,
      reread: () => sessionWith(account('u1', rotatedElsewhere)),
    });

    expect(result).toBe('refreshed');
    expect(data.accounts.u1).toMatchObject(rotatedElsewhere);
    expect(data.accounts.u1.needsSignIn).toBeUndefined();
  });

  it('on a definitive failure with nothing newer, marks the account needs-sign-in', async () => {
    const issuer = fakeIssuer({});
    const data = sessionWith(expiring());

    const result = await refreshAccountInSession(data, 'u1', {
      issuer: ISSUER,
      fetchImpl: issuer.fetchImpl,
      now: () => NOW,
      reread: () => sessionWith(expiring()), // same dead token
    });

    expect(result).toBe('needs-sign-in');
    expect(data.accounts.u1.needsSignIn).toBe(true);
    // and it is never refreshed again (no loop)
    expect(shouldRefresh(data.accounts.u1, NOW)).toBe(false);
    expect(issuer.calls).toHaveLength(1);
  });

  it('keeps the current token on a temporary failure', async () => {
    const issuer = fakeIssuer({ r1: { status: 502 } });
    const data = sessionWith(expiring());
    const before = { ...data.accounts.u1 };

    expect(await refreshAccountInSession(data, 'u1', { issuer: ISSUER, fetchImpl: issuer.fetchImpl, now: () => NOW })).toBe('failed');
    expect(data.accounts.u1).toEqual(before);
  });
});

describe('remembered rotations (security)', () => {
  const rotated = () => ({ accessToken: jwt('u1', NOW, 15 * MINUTE), refreshToken: 'r2', expiresAt: NOW + 15 * MINUTE });
  const holding = (userId: string, refreshToken: string) =>
    sessionWith(account(userId, { accessToken: jwt(userId, NOW - 14 * MINUTE, 15 * MINUTE), refreshToken }));

  it("applies only to the account it was made for, never to another user's cookie with the same old token", () => {
    rememberRotation('u1', 'r1', rotated(), NOW);

    const other = holding('u2', 'r1');
    expect(applyKnownRotations(other, NOW + 1000)).toBe(false);
    expect(other.accounts.u2.refreshToken).toBe('r1');
    expect(latestRotation('u2', 'r1', NOW + 1000)).toBeNull();

    // an account entry whose stored userId disagrees with its key gets nothing either
    const mislabeled = holding('u1', 'r1');
    mislabeled.accounts.u1.userId = 'u2';
    expect(applyKnownRotations(mislabeled, NOW + 1000)).toBe(false);

    const own = holding('u1', 'r1');
    expect(applyKnownRotations(own, NOW + 1000)).toBe(true);
    expect(own.accounts.u1.refreshToken).toBe('r2');
  });

  it("is kept no longer than the issuer's 60 s reuse window", () => {
    expect(ROTATION_MEMORY_MS).toBe(60 * 1000);
    rememberRotation('u1', 'r1', rotated(), NOW);

    expect(latestRotation('u1', 'r1', NOW + 59 * 1000)).not.toBeNull();
    const late = holding('u1', 'r1');
    expect(applyKnownRotations(late, NOW + 61 * 1000)).toBe(false);
    expect(late.accounts.u1.refreshToken).toBe('r1');
    // and the expired entry is gone for good
    expect(latestRotation('u1', 'r1', NOW + 1000)).toBeNull();
  });

  it('is forgotten when the account signs out (forgetRotations), leaving other accounts alone', () => {
    rememberRotation('u1', 'r1', rotated(), NOW);
    rememberRotation('u2', 'q1', { accessToken: jwt('u2', NOW, 15 * MINUTE), refreshToken: 'q2' }, NOW);

    forgetRotations('u1');

    expect(latestRotation('u1', 'r1', NOW + 1000)).toBeNull();
    expect(latestRotation('u2', 'q1', NOW + 1000)?.refreshToken).toBe('q2');
  });

  it('is forgotten when the account\'s refresh definitively fails', async () => {
    // r0 was rotated into r1 earlier; now r1 is rejected
    rememberRotation('u1', 'r0', { accessToken: jwt('u1', NOW - 14 * MINUTE, 15 * MINUTE), refreshToken: 'r1' }, NOW - 10 * 1000);
    const issuer = fakeIssuer({});
    const data = holding('u1', 'r1');

    expect(await refreshAccountInSession(data, 'u1', { issuer: ISSUER, fetchImpl: issuer.fetchImpl, now: () => NOW })).toBe('needs-sign-in');

    // a cookie still holding r0 no longer gets anything from memory
    expect(latestRotation('u1', 'r0', NOW)).toBeNull();
    expect(applyKnownRotations(holding('u1', 'r0'), NOW)).toBe(false);
  });
});
