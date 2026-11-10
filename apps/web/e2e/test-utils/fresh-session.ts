import * as fs from 'fs';
import { chromium } from '@playwright/test';
import { AUTH_STATE, type AuthUser } from './auth-state';
import { signInWebSession, webAuthConfig, type ExpectedChannel } from './session-login';
import { e2eUserPassword } from './user-password';

/**
 * Keeps the stored E2E sessions (e2e/.auth/user-*.json) signed in for a whole run.
 *
 * Access tokens last ~15 minutes and the issuer rotates the refresh token on
 * every use: the old one keeps working for 60 s, then fails. Every test context
 * starts from the same stored file, so the first context that refreshed it
 * (the web app does so when the token is 2 minutes from expiry) silently signed
 * out every later test that loaded the same file, and readAccount()/userApi()
 * callers got an expired token.
 *
 * Before each test (fixtures.ts) and before the teardown, each stored session
 * whose access token expires within FRESH_MARGIN_MS is refreshed once at the
 * issuer, under a lock shared by every worker, and written back. A test then
 * always starts with more token life than its timeout plus the app's 2-minute
 * refresh window.
 *
 * A test can still spend the stored refresh token: after any API 401 the web
 * app refreshes at once (SessionManager.refreshAfterUnauthorized). When the
 * issuer then rejects the stored token, the user signs in again (the same
 * flow as global setup) and the stored session is replaced.
 */

/** Test timeout (3 min) + the app's refresh-ahead window (2 min) + slack. */
export const FRESH_MARGIN_MS = 7 * 60 * 1000;
// Longer than a sign-in with its retry, so a live holder is never taken for dead
const LOCK_STALE_MS = 150 * 1000;
const LOCK_WAIT_MS = 160 * 1000;
const SESSION_COOKIE = 'al_ummah_session';

interface StoredCookie {
  name: string;
  value: string;
}

interface StoredAccount {
  email?: string;
  channels?: ExpectedChannel[];
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  needsSignIn?: boolean;
}

function jwtExpiryMs(token: string | undefined): number | null {
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const exp = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function expiresAt(account: StoredAccount): number | null {
  return typeof account.expiresAt === 'number' ? account.expiresAt : jwtExpiryMs(account.accessToken);
}

interface ParsedState {
  state: { cookies: StoredCookie[] };
  cookie: StoredCookie;
  data: { activeUserId: string; accounts: Record<string, StoredAccount> };
  encoded: boolean;
}

function readState(file: string): ParsedState | null {
  const state = JSON.parse(fs.readFileSync(file, 'utf8')) as { cookies: StoredCookie[] };
  const cookie = state.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) return null;
  let raw = cookie.value;
  let encoded = false;
  try {
    const decoded = decodeURIComponent(raw);
    encoded = decoded !== raw;
    raw = decoded;
  } catch {
    // not URI-encoded
  }
  return { state, cookie, data: JSON.parse(raw), encoded };
}

function needsRefresh(parsed: ParsedState | null, now: number): boolean {
  const account = parsed?.data.accounts[parsed.data.activeUserId];
  if (!account?.refreshToken || account.needsSignIn) return false;
  const exp = expiresAt(account);
  return exp !== null && exp - now <= FRESH_MARGIN_MS;
}

async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // A worker that died while holding the lock must not block the run
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
      } catch {
        // released meanwhile
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lock}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** Replaces a stored session whose refresh token is dead with a new sign-in. */
async function signInAgain(file: string, account: StoredAccount): Promise<void> {
  if (!account.email) throw new Error(`The stored session ${file} has no email to sign in again with`);
  const browser = await chromium.launch();
  try {
    const user = { email: account.email, password: e2eUserPassword() };
    // One retry: the auth server's sign-in page is sometimes slow under a parallel run
    const context = await signInWebSession(browser, user, account.channels ?? [], webAuthConfig())
      .catch(() => signInWebSession(browser, user, account.channels ?? [], webAuthConfig()));
    const tmp = `${file}.${process.pid}.tmp`;
    await context.storageState({ path: tmp });
    await context.close();
    fs.renameSync(tmp, file);
  } finally {
    await browser.close();
  }
}

/** Refreshes one stored session if its access token is about to expire. */
export async function ensureFreshSession(file: string): Promise<void> {
  if (!fs.existsSync(file) || !needsRefresh(readState(file), Date.now())) return;

  await withLock(file, async () => {
    // Another worker may have refreshed it while this one waited
    const parsed = readState(file);
    if (!parsed || !needsRefresh(parsed, Date.now())) return;
    const account = parsed.data.accounts[parsed.data.activeUserId];

    const res = await fetch(`${webAuthConfig().openAuthUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: account.refreshToken as string }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; error?: unknown };
    if ([400, 401, 403].includes(res.status)) {
      // The refresh token was spent elsewhere (or revoked): sign in again
      await signInAgain(file, account);
      return;
    }
    if (!res.ok || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
      throw new Error(`Could not refresh the stored session ${file}: ${res.status} ${String(body.error ?? '')}`.trim());
    }

    account.accessToken = body.access_token;
    account.refreshToken = body.refresh_token;
    const exp = jwtExpiryMs(body.access_token);
    if (exp !== null) account.expiresAt = exp;
    else delete account.expiresAt;

    const json = JSON.stringify(parsed.data);
    parsed.cookie.value = parsed.encoded ? encodeURIComponent(json) : json;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(parsed.state, null, 2));
    fs.renameSync(tmp, file);
  });
}

/** Refreshes every stored E2E session that is about to expire. */
export async function ensureFreshSessions(users: AuthUser[] = Object.keys(AUTH_STATE) as AuthUser[]): Promise<void> {
  for (const user of users) await ensureFreshSession(AUTH_STATE[user]);
}
