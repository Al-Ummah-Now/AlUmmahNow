import type { Browser, BrowserContext } from '@playwright/test';
import { loginOnPage } from '../seed/seed-auth';
import { consentCookie } from './consent';

/**
 * Signs a user in to the web app in a fresh browser context, so the callback
 * (SessionManager.addAccount -> loadUserChannels) writes a new al_ummah_session
 * cookie, and makes that cookie describe exactly `channels` with the main one
 * active. Used by global setup and, when a stored session's refresh token has
 * been spent, by test-utils/fresh-session.ts. The caller saves the returned
 * context's storage state and closes it.
 */

export interface WebAuthConfig {
  openAuthUrl: string;
  webAppUrl: string;
  clientId: string;
}

export interface ExpectedChannel {
  id: string;
  isMain?: boolean;
}

interface SessionCookieData {
  activeUserId: string;
  activeChannelId: string | null;
  accounts: Record<string, { channels?: ExpectedChannel[]; activeChannelId?: string | null }>;
}

export const SESSION_COOKIE = 'al_ummah_session';

export function parseSessionCookie(value: string): SessionCookieData {
  let raw = value;
  try {
    raw = decodeURIComponent(value);
  } catch {
    // not URI-encoded
  }
  return JSON.parse(raw) as SessionCookieData;
}

/** The web app, auth server and client id of this run (QA when WEB_APP_URL is QA) */
export function webAuthConfig(): WebAuthConfig {
  const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3001';
  const defaultIssuer = webAppUrl.startsWith('https://videos.qa.') ? 'https://auth.qa.alummahnow.net' : 'http://localhost:3301';
  return {
    webAppUrl,
    openAuthUrl: (process.env.OPENAUTH_URL || defaultIssuer).replace(/\/+$/, ''),
    clientId: process.env.OPENAUTH_CLIENT_ID || 'e0de3c30-0304-4ac4-86d6-1e185dec0439',
  };
}

export async function signInWebSession(
  browser: Browser,
  user: { email: string; password: string },
  channels: ExpectedChannel[],
  cfg: WebAuthConfig,
  log: (message: string, data?: unknown) => void = () => undefined,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: cfg.webAppUrl });
  await context.addCookies([consentCookie(cfg.webAppUrl)]);
  const page = await context.newPage();
  const login = await loginOnPage(page, { issuerUrl: cfg.openAuthUrl, webUrl: cfg.webAppUrl, clientId: cfg.clientId }, user.email, user.password);
  if (!login.ok) {
    await context.close();
    throw new Error(`Signing in to the web session failed for ${user.email}: ${login.message}`);
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // Verify the cookie caches the channels. SessionManager.loadUserChannels calls
  // GET /api/channels with the default page size, which can miss the user's
  // channels once the environment has many channels; in that case patch the
  // cookie with the channels the caller verified via the API.
  const cookie = (await context.cookies(cfg.webAppUrl)).find((c) => c.name === SESSION_COOKIE);
  if (!cookie) {
    await context.close();
    throw new Error(`Signed-in session for ${user.email} has no ${SESSION_COOKIE} cookie`);
  }
  const data = parseSessionCookie(cookie.value);
  const account = data.accounts[data.activeUserId];
  if (account) {
    // The stored session must describe exactly the user's fixed channels with
    // the main one active: specs read it (readSession/userApi) to know which
    // channel to use, and must not pick up a channel another run created.
    const cached = account.channels || [];
    const cachedIds = new Set(cached.map((c) => c.id));
    const expectedIds = new Set(channels.map((c) => c.id));
    const missing = channels.filter((c) => !cachedIds.has(c.id));
    const unexpected = cached.filter((c) => !expectedIds.has(c.id));
    if (missing.length > 0 || unexpected.length > 0) {
      log(`[Setup] Web session for ${user.email} does not match its channels; patching the cookie`, {
        cached: cachedIds.size,
        expected: channels.length,
        missing: missing.length,
        unexpected: unexpected.length,
      });
    }
    account.channels = [...cached.filter((c) => expectedIds.has(c.id)), ...missing];
    const main = account.channels.find((c) => c.isMain) || account.channels[0];
    const activeChannelId = main?.id ?? null;
    const changed = account.activeChannelId !== activeChannelId || data.activeChannelId !== activeChannelId;
    account.activeChannelId = activeChannelId;
    data.activeChannelId = activeChannelId;
    if (missing.length > 0 || unexpected.length > 0 || changed) {
      await context.addCookies([{ ...cookie, value: encodeURIComponent(JSON.stringify(data)) }]);
    }
  }
  log(`[Setup] Web session for ${user.email} caches ${account?.channels?.length ?? 0} channel(s)`);
  return context;
}
