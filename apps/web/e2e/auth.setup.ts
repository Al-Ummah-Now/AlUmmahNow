import { chromium, type Browser, type BrowserContext, type FullConfig, type Page } from '@playwright/test';
import { ResendTestClient } from './test-utils/resend-client';
import { ApiClient } from './seed/seed-api';
import { extractSession, loginOnPage } from './seed/seed-auth';
import { ensureChannels, ensureProfile, type UserChannelSpec } from './seed/seed-users';
import { consentCookie } from './test-utils/consent';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CI-friendly logger that always outputs to console.
 * The @/lib/logger-client filters out 'info' level in production,
 * which makes debugging CI failures impossible.
 */
const ciLogger = {
  info: (message: string, data?: unknown) => {
    console.log(`[INFO] ${message}`, data !== undefined ? JSON.stringify(data) : '');
  },
  warn: (message: string, data?: unknown) => {
    console.warn(`[WARN] ${message}`, data !== undefined ? JSON.stringify(data) : '');
  },
  error: (message: string, data?: unknown) => {
    console.error(`[ERROR] ${message}`, data !== undefined ? JSON.stringify(data) : '');
  },
  debug: (message: string, data?: unknown) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${message}`, data !== undefined ? JSON.stringify(data) : '');
    }
  },
};

export interface TestUser {
  email: string;
  password: string;
  name: string;
  storageStatePath: string;
  /** Channels the user must own; [] means profile only (no channels) */
  channels: UserChannelSpec[];
}

interface SessionCookieChannel {
  id: string;
  isMain?: boolean;
}

interface SessionCookieData {
  activeUserId: string;
  activeChannelId: string | null;
  accounts: Record<string, { channels?: SessionCookieChannel[]; activeChannelId?: string | null }>;
}

const SESSION_COOKIE = 'al_ummah_session';

function parseSessionCookie(value: string): SessionCookieData {
  let raw = value;
  try {
    raw = decodeURIComponent(value);
  } catch {
    // not URI-encoded
  }
  return JSON.parse(raw) as SessionCookieData;
}

/**
 * Provisions the user's profile and channels through api-videos, then logs in
 * again in a fresh browser context so the web callback (SessionManager.addAccount
 * -> loadUserChannels) caches the channels in the al_ummah_session cookie.
 * Returns the context holding the refreshed session; the caller saves and closes it.
 */
async function provisionAndRefreshSession(
  browser: Browser,
  page: Page,
  user: TestUser,
  cfg: { openAuthUrl: string; webAppUrl: string; clientId: string; apiUrl: string },
): Promise<BrowserContext> {
  const api = new ApiClient(cfg.apiUrl);
  const session = await extractSession(page, { webUrl: cfg.webAppUrl });

  const profileCreated = await ensureProfile(api, session, { email: user.email, displayName: user.name });
  const { channels, created, extra } = await ensureChannels(api, session, user.channels);
  ciLogger.info(`[Setup] Provisioned ${user.email}`, {
    userId: session.userId,
    profileCreated,
    channelsExpected: user.channels.length,
    channelsCreated: created,
  });
  if (extra.length > 0) {
    ciLogger.warn(`[Setup] ${user.email} owns channels beyond the expected set (left untouched)`, { extra });
  }

  // Fresh context: the callback's addAccount() loads profile + channels into the cookie.
  const refreshed = await browser.newContext({ baseURL: cfg.webAppUrl });
  await refreshed.addCookies([consentCookie(cfg.webAppUrl)]);
  const refreshPage = await refreshed.newPage();
  const login = await loginOnPage(
    refreshPage,
    { issuerUrl: cfg.openAuthUrl, webUrl: cfg.webAppUrl, clientId: cfg.clientId },
    user.email,
    user.password,
  );
  if (!login.ok) {
    await refreshed.close();
    throw new Error(`Re-login to refresh the web session failed for ${user.email}: ${login.message}`);
  }
  await refreshPage.waitForLoadState('networkidle').catch(() => undefined);

  // Verify the cookie caches the channels. SessionManager.loadUserChannels calls
  // GET /api/channels with the default page size, which can miss the user's
  // channels once the environment has many channels; in that case patch the
  // cookie with the channels we just verified via the API.
  const cookies = await refreshed.cookies(cfg.webAppUrl);
  const cookie = cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) {
    await refreshed.close();
    throw new Error(`Refreshed session for ${user.email} has no ${SESSION_COOKIE} cookie`);
  }
  const data = parseSessionCookie(cookie.value);
  const account = data.accounts[data.activeUserId];
  const cachedIds = new Set((account?.channels || []).map((c) => c.id));
  const missing = channels.filter((c) => !cachedIds.has(c.id));
  if (account && missing.length > 0) {
    ciLogger.warn(`[Setup] Web session for ${user.email} is missing ${missing.length} channel(s); patching the cookie`, {
      cached: cachedIds.size,
      expected: channels.length,
    });
    account.channels = [...(account.channels || []), ...missing];
    const main = account.channels.find((c) => c.isMain) || account.channels[0];
    account.activeChannelId = account.activeChannelId || main?.id || null;
    data.activeChannelId = data.activeChannelId || account.activeChannelId || null;
    await refreshed.addCookies([{ ...cookie, value: encodeURIComponent(JSON.stringify(data)) }]);
  }
  ciLogger.info(`[Setup] Web session for ${user.email} caches ${account?.channels?.length ?? 0} channel(s)`);
  return refreshed;
}

/**
 * Playwright global setup hook
 *
 * Registers test users via OpenAuth UI and saves authentication state
 * for reuse across all tests.
 *
 * This eliminates the need for manual user registration or .env credentials.
 *
 * Set SKIP_AUTH_SETUP=true to skip registration (when auth state is pre-loaded from artifacts).
 */
async function globalSetup(_config: FullConfig) {
  // Skip auth setup if auth state files already exist (from centralized auth job)
  if (process.env.SKIP_AUTH_SETUP === 'true') {
    ciLogger.info('[Global Setup] SKIP_AUTH_SETUP=true, checking for existing auth state...');

    const authDir = path.join(process.cwd(), 'e2e/.auth');
    const requiredFiles = ['user-single.json', 'user-multi.json', 'user-none.json'];
    const allExist = requiredFiles.every(file => {
      const filePath = path.join(authDir, file);
      const exists = fs.existsSync(filePath);
      if (!exists) {
        ciLogger.warn(`[Global Setup] Missing auth file: ${filePath}`);
      }
      return exists;
    });

    if (allExist) {
      ciLogger.info('[Global Setup] ✅ Auth state files found, skipping registration');
      return;
    }

    ciLogger.warn('[Global Setup] Auth files missing despite SKIP_AUTH_SETUP=true, proceeding with registration');
  }

  ciLogger.info('[Global Setup] Starting test user registration...');

  // E2E_REUSE_USERS_TIMESTAMP=<n> logs in to the existing test-*-<n> users
  // instead of registering new ones (no RESEND_API_KEY needed).
  const reuseTimestamp = process.env.E2E_REUSE_USERS_TIMESTAMP;
  // E2E_USERS_TIMESTAMP=<n> pins a stable user set (e.g. one per CI project so
  // parallel jobs never share accounts): log in to test-*-<n>, registering only
  // the users that don't exist yet (needs RESEND_API_KEY the first time).
  const pinnedTimestamp = process.env.E2E_USERS_TIMESTAMP;

  // Verify required environment variables
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey && !reuseTimestamp && !pinnedTimestamp) {
    throw new Error(
      'RESEND_API_KEY environment variable is required for test user registration. ' +
      'Get your API key from https://resend.com/api-keys'
    );
  }

  const openAuthUrl = process.env.OPENAUTH_URL || 'http://localhost:3301';
  const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3001';
  // Must be the web app's registered client id (QA: e0de3c30-…); the web
  // callback exchanges the code with its own ClientId.
  const clientId = process.env.OPENAUTH_CLIENT_ID || 'e0de3c30-0304-4ac4-86d6-1e185dec0439';
  const apiUrl = (process.env.API_URL || (webAppUrl.startsWith('https://videos.qa.')
    ? 'https://videos.api.qa.alummahnow.net'
    : 'http://127.0.0.1:3086')).replace(/\/$/, '');

  // Log working directory for debugging path issues
  const cwd = process.cwd();
  const authDir = path.join(cwd, 'e2e/.auth');

  ciLogger.info('[Global Setup] Configuration', {
    openAuthUrl,
    webAppUrl,
    clientId,
    apiUrl,
    reuseTimestamp: reuseTimestamp || null,
    cwd,
    authDir
  });

  // Ensure auth directory exists
  if (!fs.existsSync(authDir)) {
    ciLogger.info(`[Global Setup] Creating auth directory: ${authDir}`);
    fs.mkdirSync(authDir, { recursive: true });
  }

  const resendClient = resendApiKey ? new ResendTestClient(resendApiKey) : null;

  // Generate unique emails per test run to avoid conflicts
  const timestamp = reuseTimestamp ? Number(reuseTimestamp) : pinnedTimestamp ? Number(pinnedTimestamp) : Date.now();
  const testUsers: TestUser[] = [
    {
      email: `test-single-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword123!',
      name: 'Single Channel User',
      storageStatePath: path.join(authDir, 'user-single.json'),
      channels: [{ name: 'E2E Single Channel', description: 'E2E test channel (single-channel user)', isMain: true }],
    },
    {
      email: `test-multi-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword456!',
      name: 'Multi Channel User',
      storageStatePath: path.join(authDir, 'user-multi.json'),
      channels: [
        { name: 'E2E Multi Channel One', description: 'E2E test channel 1 (multi-channel user)', isMain: true },
        { name: 'E2E Multi Channel Two', description: 'E2E test channel 2 (multi-channel user)' },
      ],
    },
    {
      email: `test-none-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword789!',
      name: 'No Channels User',
      storageStatePath: path.join(authDir, 'user-none.json'),
      channels: [],
    },
  ];

  const browser = await chromium.launch({
    headless: true, // Set to false for debugging
  });

  let successCount = 0;
  const errors: Array<{ email: string; error: unknown }> = [];

  for (const user of testUsers) {
    ciLogger.info(`[Setup] Registering user: ${user.email}`);

    const context = await browser.newContext({
      baseURL: webAppUrl,
    });
    await context.addCookies([consentCookie(webAppUrl)]);
    const page = await context.newPage();

    try {
      // Start with the OAuth authorize endpoint - this sets up proper session state
      const callbackUrl = `${webAppUrl}/api/callback`;
      const authorizeUrl = `${openAuthUrl}/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&client_id=${clientId}`;

      ciLogger.info(`[Setup] Starting OAuth flow for ${user.email}`);
      let loggedIn = false;
      if (reuseTimestamp || pinnedTimestamp) {
        const login = await loginOnPage(page, { issuerUrl: openAuthUrl, webUrl: webAppUrl, clientId }, user.email, user.password);
        if (login.ok) {
          loggedIn = true;
        } else if (reuseTimestamp) {
          throw new Error(`Login for existing user ${user.email} failed: ${login.message}`);
        } else {
          ciLogger.info(`[Setup] Pinned user ${user.email} not found (${login.message}); registering it`);
          if (!resendClient) throw new Error(`RESEND_API_KEY is required to register pinned user ${user.email}`);
        }
      }
      if (!loggedIn) {
        await page.goto(authorizeUrl, { waitUntil: 'networkidle' });

        // Click the "Register" link to go to registration page
        const registerLink = await page.$('a[href*="register"], a:has-text("Register")');
        if (registerLink) {
          await registerLink.click();
          await page.waitForLoadState('networkidle');
        }

        ciLogger.info(`[Setup] Filling registration form for ${user.email}`);

        // Fill registration form - OpenAuth uses name attributes
        await page.fill('input[name="email"]', user.email);
        await page.fill('input[name="password"]', user.password);
        await page.fill('input[name="repeat"]', user.password); // Repeat password field
        await page.click('button[data-component="button"]');

        // Wait for verification code page or direct redirect
        ciLogger.info(`[Setup] Waiting for next step for ${user.email}`);

        // Wait a moment for the page to transition
        await page.waitForTimeout(2000);

        // Check if we're on a verification page by looking for "Code" placeholder
        const codeInput = await page.$('input[placeholder*="Code"], input[placeholder*="code"], input[name="code"]');

        if (codeInput) {
          ciLogger.info(`[Setup] Verification code required for ${user.email}`);

          // Get verification code from Resend
          if (!resendClient) throw new Error('RESEND_API_KEY is required to register users');
          const emailHtml = await resendClient.getVerificationEmail(user.email);

          if (!emailHtml) {
            throw new Error('No verification email received within timeout period');
          }

          const code = resendClient.extractVerificationCode(emailHtml);

          if (!code) {
            throw new Error('Failed to extract verification code from email');
          }

          ciLogger.info(`[Setup] Entering verification code for ${user.email}`);

          // Enter verification code
          await codeInput.fill(code);
          await page.click('button[data-component="button"]');
        }

        // Wait for successful authentication - callback URL or home page
        ciLogger.info(`[Setup] Waiting for authentication to complete for ${user.email}`);

        // Wait for callback URL and then navigate to verify auth
        try {
          await page.waitForURL('**/api/callback**', { timeout: 20000 });

          // Give time for cookies to be set
          await page.waitForTimeout(1000);

          // Navigate to home page to verify authentication worked
          await page.goto(`${webAppUrl}/en`, { waitUntil: 'networkidle' });
        } catch {
          // Already on home page or elsewhere - continue
          ciLogger.debug(`[Setup] Current URL after auth: ${page.url()}`);
        }
      }

      // Fail fast if the web app did not establish a session (e.g. wrong client id)
      const webCookies = await context.cookies(webAppUrl);
      if (!webCookies.some((c) => c.name === "al_ummah_session" || c.name === "access_token")) {
        throw new Error("Web session cookie not set after OAuth callback");
      }

      // Ensure profile + channels exist and refresh the web session so the
      // al_ummah_session cookie caches them (new users otherwise get sent to
      // /profile/create and have no channels for upload specs).
      const refreshed = await provisionAndRefreshSession(browser, page, user, { openAuthUrl, webAppUrl, clientId, apiUrl });

      // Save authenticated state
      ciLogger.info(`[Setup] Saving authentication state for ${user.email} to ${user.storageStatePath}`);
      await refreshed.storageState({ path: user.storageStatePath });
      await refreshed.close();

      // Verify file was created
      if (fs.existsSync(user.storageStatePath)) {
        const stats = fs.statSync(user.storageStatePath);
        ciLogger.info(`[Setup] ✅ Successfully registered and saved state: ${user.email} (${stats.size} bytes)`);
        successCount++;
      } else {
        throw new Error(`Auth state file was not created at ${user.storageStatePath}`);
      }

      await context.close();

      // Small delay between registrations to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      ciLogger.error(`[Setup] ❌ Failed to register ${user.email}`, { error });
      errors.push({ email: user.email, error });

      // Take screenshot for debugging
      try {
        const screenshotPath = path.join(authDir, `error-${user.name.replace(/\s+/g, '-')}-${timestamp}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        ciLogger.info(`[Setup] Screenshot saved to ${screenshotPath}`);
      } catch (screenshotError) {
        ciLogger.error('[Setup] Failed to save screenshot', { screenshotError });
      }

      await context.close();

      // Don't throw immediately - try to register other users
      continue;
    }
  }

  await browser.close();

  // Summary
  ciLogger.info('[Global Setup] Registration Summary', {
    total: testUsers.length,
    success: successCount,
    failed: errors.length
  });

  // List files in auth directory for debugging
  try {
    const files = fs.readdirSync(authDir);
    ciLogger.info('[Global Setup] Files in auth directory:', { authDir, files });
  } catch (listError) {
    ciLogger.error('[Global Setup] Failed to list auth directory:', { listError });
  }

  if (errors.length > 0) {
    ciLogger.error('[Global Setup] Failed registrations:', errors);
    throw new Error(
      `Failed to register ${errors.length} test user(s). See logs for details.`
    );
  }

  ciLogger.info('[Global Setup] ✅ All test users registered successfully!');
}

export default globalSetup;
