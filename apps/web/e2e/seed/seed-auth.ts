import type { Browser, Page } from '@playwright/test';
import { seedLogger as log, maskSecret } from './seed-logger';
import { fillSecret } from '../release/secret-fill';

/**
 * Browser-driven OpenAuth login / registration for the QA seed.
 *
 * Flow (same as e2e/auth.setup.ts):
 *   GET {web}/api/auth/login (binds the OAuth state) → {issuer}/authorize?…&redirect_uri={web}/api/callback
 *   → /password/authorize form (email, password)          [login]
 *   → /password/register form (email, password, repeat)   [register]
 *     → emailed code form (code), code read via Resend API
 *   → /password/change (forgot password: email → code → new password)  [reset, seed accounts only]
 *   → {web}/api/callback sets the `al_ummah_session` cookie
 *     (URL-encoded JSON: { activeUserId, accounts: { [id]: { accessToken, … } } })
 */

export interface AuthConfig {
  issuerUrl: string;
  webUrl: string;
  clientId: string;
}

export interface SessionTokens {
  accessToken: string;
  /** User id as api-videos sees it (JWT properties.id, e.g. "usr_…"); also the profile id */
  userId: string;
  /** Decoded JWT payload (for role/claim diagnostics only; never logged whole) */
  claims: Record<string, unknown>;
}

export type LoginOutcome =
  | { ok: true; session: SessionTokens }
  | { ok: false; reason: 'invalid_credentials' | 'unknown'; message: string };

const SESSION_COOKIE = 'al_ummah_session';
const ALERT_SELECTOR = '[data-component="form-alert"] [data-slot="message"]';
const CODE_INPUT_SELECTOR = 'input[name="code"], input[placeholder*="Code"], input[placeholder*="code"]';

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new Error('Access token is not a JWT');
  const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

function directAuthorizeUrl(cfg: AuthConfig): string {
  const redirect = `${cfg.webUrl}/api/callback`;
  return `${cfg.issuerUrl}/authorize?client_id=${encodeURIComponent(cfg.clientId)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code`;
}

/**
 * Opens the sign-in form. It starts on the web app (/api/auth/login), which
 * binds the OAuth state to this browser (auth_state cookie) before sending it
 * to {issuer}/authorize: the callback refuses a direct authorize URL. Builds
 * without that route (404) still take the direct URL.
 */
export async function gotoSignIn(page: Page, cfg: AuthConfig): Promise<void> {
  const res = await page.goto(`${cfg.webUrl}/api/auth/login?locale=en`, { waitUntil: 'domcontentloaded' });
  if (res?.status() === 404) await page.goto(directAuthorizeUrl(cfg), { waitUntil: 'domcontentloaded' });
}

/** Submits the current OpenAuth form and waits for the resulting navigation. */
async function submitForm(page: Page): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }),
    page.click('button[data-component="button"]'),
  ]);
}

async function readAlert(page: Page): Promise<string> {
  const el = await page.$(ALERT_SELECTOR);
  return ((await el?.textContent()) || '').trim();
}

/**
 * Waits until the page either lands on the web origin (success) or the
 * OpenAuth form shows an alert / the next form step. Returns which happened.
 */
async function waitForAuthStep(page: Page, cfg: AuthConfig, timeoutMs = 45000): Promise<'web' | 'alert' | 'code'> {
  const webOrigin = new URL(cfg.webUrl).origin;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = page.url();
    if (current.startsWith(webOrigin)) return 'web';
    if (await page.$(CODE_INPUT_SELECTOR)) return 'code';
    if ((await readAlert(page)).length > 0) return 'alert';
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for OpenAuth step (url=${new URL(page.url()).pathname})`);
}

/**
 * Reads the web session cookie of a page's browser context and returns the
 * active account's access token. Waits up to 20s for the cookie to appear.
 */
export async function extractSession(page: Page, cfg: Pick<AuthConfig, 'webUrl'>): Promise<SessionTokens> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const cookies = await page.context().cookies(cfg.webUrl);
    const cookie = cookies.find((c) => c.name === SESSION_COOKIE);
    if (cookie) {
      let raw = cookie.value;
      try {
        raw = decodeURIComponent(raw);
      } catch {
        // value was not URI-encoded
      }
      const data = JSON.parse(raw) as { activeUserId?: string; accounts?: Record<string, { accessToken?: string }> };
      const accountId = data.activeUserId || Object.keys(data.accounts || {})[0];
      const accessToken = accountId ? data.accounts?.[accountId]?.accessToken : undefined;
      if (!accessToken) throw new Error(`${SESSION_COOKIE} cookie has no access token for the active account`);
      maskSecret(accessToken);
      const claims = decodeJwtPayload(accessToken);
      // api-videos identifies users by properties.id (e.g. "usr_…", also the
      // web session's account key); the JWT `sub` ("user:…") is a different value.
      const props = claims.properties as { id?: string } | undefined;
      const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
      const userId = props?.id || accountId || sub;
      if (!userId) throw new Error('Access token has no properties.id / sub');
      return { accessToken, userId, claims };
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Web app did not set the ${SESSION_COOKIE} cookie after the OAuth callback`);
}

/**
 * Password login on an existing page, leaving the page on the web app with
 * the session cookie set (so callers can keep or save the browser state).
 * Never registers.
 */
export async function loginOnPage(page: Page, cfg: AuthConfig, email: string, password: string): Promise<LoginOutcome> {
  await gotoSignIn(page, cfg);
  await page.waitForSelector('input[name="email"]', { timeout: 30000 });
  await page.fill('input[name="email"]', email);
  await fillSecret(page.locator('input[name="password"]'), password);
  await submitForm(page);
  const step = await waitForAuthStep(page, cfg);
  if (step === 'web') {
    return { ok: true, session: await extractSession(page, cfg) };
  }
  const message = step === 'alert' ? await readAlert(page) : 'unexpected code step during login';
  // OpenAuth's password provider reports "Password is incorrect." both for a
  // wrong password and for an email that has no account.
  const reason = /incorrect|invalid|not found/i.test(message) ? 'invalid_credentials' : 'unknown';
  return { ok: false, reason, message };
}

/** Password login in a throwaway browser context. Never registers. */
export async function loginWithPassword(browser: Browser, cfg: AuthConfig, email: string, password: string): Promise<LoginOutcome> {
  const context = await browser.newContext();
  try {
    return await loginOnPage(await context.newPage(), cfg, email, password);
  } finally {
    await context.close();
  }
}

/** auth's "There is already an account with this email." (en and ar). */
const EMAIL_TAKEN = /already an account|already taken|يوجد حساب/i;

/** Registration refused because the email already has an account (its password differs). */
export class EmailTakenError extends Error {
  constructor(readonly email: string) {
    super(`An account already exists for ${email}`);
    this.name = 'EmailTakenError';
  }
}

/**
 * Sets a new password on an EXISTING account through auth's forgot-password
 * flow (sign-in page → "Forgot password?" → email → emailed code → new
 * password twice). The account keeps its id, roles and data. The caller must
 * check passwordResetRefusal() first: this is for the seed's own accounts on
 * QA/stage only. Never logs the password or the code.
 */
export async function resetPassword(
  browser: Browser,
  cfg: AuthConfig,
  email: string,
  password: string,
  readCode: (email: string) => Promise<string | null>,
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await gotoSignIn(page, cfg);
    const forgot = await page.waitForSelector('a[href*="change"]', { timeout: 30000 });
    await forgot.click();
    await page.waitForSelector('input[name="email"]', { timeout: 30000 });
    await page.fill('input[name="email"]', email);
    await submitForm(page);
    for (let attempt = 1; ; attempt++) {
      await page.waitForSelector(CODE_INPUT_SELECTOR, { timeout: 30000 });
      log.info('Password reset requires an emailed code; reading it', { email, attempt });
      const code = await readCode(email);
      if (!code) throw new Error(`No password reset code received for ${email}`);
      maskSecret(code);
      await fillSecret(page.locator(CODE_INPUT_SELECTOR).first(), code);
      await submitForm(page);
      if (await page.locator('input[name="password"]').first().isVisible().catch(() => false)) break;
      if (attempt === 3) throw new Error(`Password reset code was not accepted for ${email}: ${await readAlert(page)}`);
      log.warn('Password reset code rejected, retrying with a fresh code lookup', { email });
      await page.waitForTimeout(5000);
    }
    await fillSecret(page.locator('input[name="password"]'), password);
    await fillSecret(page.locator('input[name="repeat"]'), password);
    await submitForm(page);
    const message = await readAlert(page);
    if (message) throw new Error(`Password reset rejected for ${email}: ${message}`);
  } finally {
    await context.close();
  }
}

/**
 * Registers a new account (email + password + emailed code). Throws if the
 * email is already registered, because that means the configured password
 * does not match the existing account.
 */
export async function registerAccount(
  browser: Browser,
  cfg: AuthConfig,
  email: string,
  password: string,
  readCode: (email: string) => Promise<string | null>,
): Promise<SessionTokens> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await gotoSignIn(page, cfg);
    const registerLink = await page.waitForSelector('a[href*="register"]', { timeout: 30000 });
    await registerLink.click();
    await page.waitForSelector('input[name="repeat"]', { timeout: 30000 });
    await page.fill('input[name="email"]', email);
    await fillSecret(page.locator('input[name="password"]'), password);
    await fillSecret(page.locator('input[name="repeat"]'), password);
    await submitForm(page);

    let step = await waitForAuthStep(page, cfg);
    if (step === 'alert') {
      const message = await readAlert(page);
      if (EMAIL_TAKEN.test(message)) throw new EmailTakenError(email);
      throw new Error(`Registration rejected for ${email}: ${message}`);
    }

    // Up to 3 attempts: the newest matching Resend email can briefly be one
    // from an earlier, abandoned attempt.
    for (let attempt = 1; step === 'code' && attempt <= 3; attempt++) {
      log.info('Registration requires an emailed code; reading it', { email, attempt });
      const code = await readCode(email);
      if (!code) throw new Error(`No verification code received for ${email}`);
      maskSecret(code);
      const input = await page.waitForSelector(CODE_INPUT_SELECTOR, { timeout: 10000 });
      await input.fill(code);
      await submitForm(page);
      step = await waitForAuthStep(page, cfg);
      if (step === 'alert') {
        const message = await readAlert(page);
        if (EMAIL_TAKEN.test(message)) throw new EmailTakenError(email);
        if (!/code/i.test(message) || attempt === 3) {
          throw new Error(`Verification failed for ${email}: ${message}`);
        }
        log.warn('Verification code rejected, retrying with a fresh code lookup', { email, message });
        await page.waitForTimeout(5000);
        step = 'code';
      }
    }

    if (step !== 'web') throw new Error(`Registration for ${email} did not reach the web callback`);
    return await extractSession(page, cfg);
  } finally {
    await context.close();
  }
}
