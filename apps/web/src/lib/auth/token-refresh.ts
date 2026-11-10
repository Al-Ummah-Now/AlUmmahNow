/**
 * Access-token refresh for the session cookie.
 *
 * Access tokens are short-lived (~15 min); refresh tokens last ~1 year but the
 * issuer ROTATES them on every use: the previous refresh token keeps working
 * only for a 60 s reuse window, then fails with `invalid_grant`. So:
 *
 * - refresh shortly before expiry (REFRESH_AHEAD_MS), in one place per request
 *   (the middleware for pages and Server Actions, /api/auth/token for the
 *   browser, SessionManager.refreshAccount for the rest);
 * - never let an older token pair overwrite a newer one when the cookie is
 *   written back (mergeSessionTokens);
 * - spend a given refresh token once per isolate (refreshTokensOnce) and
 *   remember what it was rotated into, so a request still holding the old one
 *   picks up the new pair instead of failing. That memory is keyed by userId
 *   plus the old refresh token, applies only to that same account, lasts no
 *   longer than the issuer's own 60 s reuse window, and is dropped when the
 *   account signs out or its refresh definitively fails;
 * - when the issuer definitively rejects the refresh token, mark the account
 *   `needsSignIn` instead of sending a dead token forever.
 *
 * Across isolates (SCALABILITY-AUDIT WEB-1) the in-memory single-flight and
 * rotation memory above do not help: a page request, its RSC requests and
 * /api/auth/token often land in different isolates, each refreshes the same
 * refresh token and writes its own Set-Cookie. That is correct because of an
 * issuer invariant, not because of this module: every use of a refresh token
 * within the reuse window returns the SAME successor refresh token (the
 * issuer reserves `nextToken` when it stores a token), so whichever cookie the
 * browser keeps holds the live refresh token. Checked against the real
 * @al-ummah-now/openauth issuer in apps/admin-web/test/issuer-rotation.test.ts
 * and for this module across simulated isolates in
 * __tests__/token-refresh-isolates.test.ts. The in-memory maps only save
 * issuer calls within one isolate.
 *
 * No `next/headers` and no Node-only imports: the middleware uses this module.
 */

import type { SessionData, UserSession } from './session-manager';

/** Refresh when the access token expires within this window. */
export const REFRESH_AHEAD_MS = 2 * 60 * 1000;

/**
 * How long this isolate remembers that a refresh token was rotated: the
 * issuer's reuse window. Within it, the issuer would hand out new tokens for
 * the old refresh token anyway; remembering longer would widen that exposure.
 */
export const ROTATION_MEMORY_MS = 60 * 1000;
const ROTATION_MEMORY_MAX = 500;
const ROTATION_CHAIN_MAX = 5;
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

/** Token fields of an account in the session cookie. */
export type AccountTokens = Pick<UserSession, 'accessToken' | 'refreshToken' | 'expiresAt' | 'needsSignIn'>;

export interface RotatedTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms; undefined when neither the JWT nor the issuer said. */
  expiresAt?: number;
}

export type RefreshOutcome =
  | { ok: true; tokens: RotatedTokens }
  /** definitive: the issuer rejected the refresh token (invalid_grant & co.). */
  | { ok: false; definitive: boolean; reason: string };

export interface RefreshOptions {
  issuer?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

export function decodeJwtPayload(token: string | undefined | null): Record<string, unknown> | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function numericClaimMs(payload: Record<string, unknown> | null, claim: 'exp' | 'iat'): number | null {
  const value = payload?.[claim];
  return typeof value === 'number' && Number.isFinite(value) ? value * 1000 : null;
}

/** Expiry of an access token from its `exp` claim, in epoch ms. */
export function accessTokenExpiresAt(token: string | undefined | null): number | null {
  return numericClaimMs(decodeJwtPayload(token), 'exp');
}

/** expiresAt for a newly issued token: the JWT `exp`, else `expires_in`. */
export function computeExpiresAt(accessToken: string, expiresIn?: number, now: number = Date.now()): number | undefined {
  const fromJwt = accessTokenExpiresAt(accessToken);
  if (fromJwt !== null) return fromJwt;
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) return now + expiresIn * 1000;
  return undefined;
}

/**
 * When the account's access token expires. Cookies written before expiresAt
 * existed (users holding a 30-day token on deploy) fall back to the JWT `exp`.
 */
export function accountExpiresAt(account: Pick<AccountTokens, 'accessToken' | 'expiresAt'>): number | null {
  if (typeof account.expiresAt === 'number' && Number.isFinite(account.expiresAt)) return account.expiresAt;
  return accessTokenExpiresAt(account.accessToken);
}

/** True when the account should be refreshed now (expired or about to). */
export function shouldRefresh(account: AccountTokens | undefined, now: number = Date.now(), aheadMs: number = REFRESH_AHEAD_MS): boolean {
  if (!account || account.needsSignIn || !account.refreshToken) return false;
  const expiresAt = accountExpiresAt(account);
  // Unknown expiry (not a JWT): leave it to the 401 retry
  if (expiresAt === null) return false;
  return expiresAt - now <= aheadMs;
}

/**
 * True when `a` holds a newer token pair than `b`. Newer = issued later (`iat`);
 * a later expiry decides when `iat` is missing or equal. Comparing expiry alone
 * would let a legacy 30-day token beat a fresh 15-minute one.
 */
export function isNewerTokenSet(a: AccountTokens, b: AccountTokens): boolean {
  if (a.refreshToken === b.refreshToken && a.accessToken === b.accessToken) return false;
  const iatA = numericClaimMs(decodeJwtPayload(a.accessToken), 'iat');
  const iatB = numericClaimMs(decodeJwtPayload(b.accessToken), 'iat');
  if (iatA !== null && iatB !== null && iatA !== iatB) return iatA > iatB;
  const expA = accountExpiresAt(a);
  const expB = accountExpiresAt(b);
  if (expA !== null && expB !== null) return expA > expB;
  return false;
}

function applyTokens<T extends AccountTokens>(account: T, tokens: AccountTokens): T {
  account.accessToken = tokens.accessToken;
  account.refreshToken = tokens.refreshToken;
  if (tokens.expiresAt === undefined) delete account.expiresAt;
  else account.expiresAt = tokens.expiresAt;
  if (tokens.needsSignIn) account.needsSignIn = true;
  else delete account.needsSignIn;
  return account;
}

// ---------------------------------------------------------------------------
// Merging before a cookie write
// ---------------------------------------------------------------------------

/**
 * Before writing `mine` back, take the token fields of every account from
 * `latest` (the cookie as it is now) when they are newer. Code that read the
 * session, awaited something (an API call during which the tokens were
 * refreshed), then wrote its copy back restored the old refresh token, which
 * died 60 s later. Everything else (channels, profile, which accounts exist)
 * stays as `mine` has it. Mutates and returns `mine`.
 */
export function mergeSessionTokens(latest: SessionData | null | undefined, mine: SessionData): SessionData {
  if (!latest?.accounts) return mine;
  for (const [userId, account] of Object.entries(mine.accounts)) {
    const current = latest.accounts[userId];
    if (current && isNewerTokenSet(current, account)) applyTokens(account, current);
  }
  return mine;
}

// ---------------------------------------------------------------------------
// In-isolate rotation memory and single-flight
// ---------------------------------------------------------------------------

const rotations = new Map<string, { userId: string; tokens: RotatedTokens; at: number }>();
const inflight = new Map<string, Promise<RefreshOutcome>>();

function rotationKey(userId: string, refreshToken: string): string {
  return `${userId}\u0000${refreshToken}`;
}

export function rememberRotation(userId: string, oldRefreshToken: string, tokens: RotatedTokens, now: number = Date.now()): void {
  if (rotations.size >= ROTATION_MEMORY_MAX) {
    // Maps iterate in insertion order: drop the oldest half
    for (const key of rotations.keys()) {
      if (rotations.size < ROTATION_MEMORY_MAX / 2) break;
      rotations.delete(key);
    }
  }
  rotations.set(rotationKey(userId, oldRefreshToken), { userId, tokens, at: now });
}

/**
 * The newest pair this isolate rotated `refreshToken` of `userId` into, if it
 * did so within the issuer's reuse window. Never another account's tokens.
 */
export function latestRotation(userId: string, refreshToken: string, now: number = Date.now()): RotatedTokens | null {
  let found: RotatedTokens | null = null;
  let token = refreshToken;
  for (let hop = 0; hop < ROTATION_CHAIN_MAX; hop++) {
    const key = rotationKey(userId, token);
    const entry = rotations.get(key);
    if (!entry) break;
    if (now - entry.at > ROTATION_MEMORY_MS) {
      rotations.delete(key);
      break;
    }
    found = entry.tokens;
    token = entry.tokens.refreshToken;
  }
  return found;
}

/** Forget every remembered rotation of `userId` (sign-out, rejected refresh). */
export function forgetRotations(userId: string): void {
  for (const [key, entry] of rotations) {
    if (entry.userId === userId) rotations.delete(key);
  }
}

/**
 * Swap in the newer pair for any account whose refresh token this isolate
 * already rotated (another request did it). Each account only ever receives
 * its own rotation. Returns true when anything changed.
 */
export function applyKnownRotations(data: SessionData, now: number = Date.now()): boolean {
  let changed = false;
  for (const [userId, account] of Object.entries(data.accounts ?? {})) {
    if (!account?.refreshToken || account.needsSignIn) continue;
    if (account.userId && account.userId !== userId) continue;
    const rotated = latestRotation(userId, account.refreshToken, now);
    if (rotated) {
      applyTokens(account, rotated);
      changed = true;
    }
  }
  return changed;
}

/** Tests only. */
export function __resetTokenRefreshStateForTests(): void {
  rotations.clear();
  inflight.clear();
}

// ---------------------------------------------------------------------------
// Talking to the issuer
// ---------------------------------------------------------------------------

/** Status codes for which the issuer has rejected the refresh token for good. */
function isDefinitiveRejection(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

/** POST {issuer}/token with grant_type=refresh_token. Never throws. */
export async function requestTokenRefresh(refreshToken: string, options: RefreshOptions = {}): Promise<RefreshOutcome> {
  const issuer = options.issuer ?? process.env.Issuer;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  if (!issuer) return { ok: false, definitive: false, reason: 'issuer not configured' };

  let response: Response;
  try {
    response = await fetchImpl(`${issuer.replace(/\/+$/, '')}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, definitive: false, reason: `network: ${error instanceof Error ? error.message : String(error)}` };
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body; the status decides
  }

  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : `http_${response.status}`;
    return { ok: false, definitive: isDefinitiveRejection(response.status), reason: code };
  }

  const accessToken = body.access_token;
  const newRefreshToken = body.refresh_token;
  if (typeof accessToken !== 'string' || typeof newRefreshToken !== 'string' || !accessToken || !newRefreshToken) {
    return { ok: false, definitive: false, reason: 'malformed token response' };
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : undefined;
  return {
    ok: true,
    tokens: { accessToken, refreshToken: newRefreshToken, expiresAt: computeExpiresAt(accessToken, expiresIn, now()) },
  };
}

/**
 * Spend `refreshToken` at most once per isolate: concurrent callers share one
 * request, and a token this isolate rotated recently resolves to its successor
 * without asking the issuer again.
 */
export function refreshTokensOnce(userId: string, refreshToken: string, options: RefreshOptions = {}): Promise<RefreshOutcome> {
  const now = options.now ?? Date.now;
  const known = latestRotation(userId, refreshToken, now());
  if (known) return Promise.resolve({ ok: true, tokens: known });

  const key = rotationKey(userId, refreshToken);
  const running = inflight.get(key);
  if (running) return running;

  const request = requestTokenRefresh(refreshToken, options)
    .then((outcome) => {
      if (outcome.ok) rememberRotation(userId, refreshToken, outcome.tokens, now());
      return outcome;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

export type AccountRefreshResult =
  /** New tokens are in the session object (refreshed, or adopted from a newer cookie). */
  | 'refreshed'
  /** The refresh token is dead and nothing newer exists: account.needsSignIn is set. */
  | 'needs-sign-in'
  /** Temporary failure (network, 5xx): the session object is unchanged. */
  | 'failed'
  /** No such account. */
  | 'missing';

export interface AccountRefreshOptions extends RefreshOptions {
  /**
   * Reads the session as currently stored (it may have been rotated by another
   * code path since `data` was read). Used to recover from `invalid_grant`.
   */
  reread?: () => Promise<SessionData | null> | SessionData | null;
}

/**
 * Refresh one account inside `data` (mutated in place; the caller persists it).
 *
 * On `invalid_grant`, another request may have rotated the token first: if the
 * stored session (or this isolate's rotation memory) holds a different, newer
 * pair, adopt it instead of signing the user out.
 */
export async function refreshAccountInSession(
  data: SessionData,
  userId: string,
  options: AccountRefreshOptions = {},
): Promise<AccountRefreshResult> {
  const account = data.accounts?.[userId];
  if (!account) return 'missing';
  const now = options.now ?? Date.now;
  const spent = account.refreshToken;

  const outcome = await refreshTokensOnce(userId, spent, options);
  if (outcome.ok) {
    applyTokens(account, outcome.tokens);
    return 'refreshed';
  }
  if (!outcome.definitive) return 'failed';

  const rotated = latestRotation(userId, spent, now());
  if (rotated) {
    applyTokens(account, rotated);
    return 'refreshed';
  }

  let latest: SessionData | null = null;
  try {
    latest = (await options.reread?.()) ?? null;
  } catch {
    latest = null;
  }
  const stored = latest?.accounts?.[userId];
  if (stored && !stored.needsSignIn && stored.refreshToken && stored.refreshToken !== spent && isNewerTokenSet(stored, account)) {
    applyTokens(account, stored);
    return 'refreshed';
  }

  account.needsSignIn = true;
  forgetRotations(userId);
  return 'needs-sign-in';
}
