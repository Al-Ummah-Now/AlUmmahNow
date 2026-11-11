import { chromium, type Browser, type BrowserContext, type FullConfig, type Page } from '@playwright/test';
import { runId } from './test-utils/run-users';
import { webRunUserEmail } from './test-utils/web-run-users';
import { readSinkCode, SINK_DOMAIN } from './test-utils/code-sink';
import { ApiClient } from './seed/seed-api';
import { extractSession, loginOnPage } from './seed/seed-auth';
import { signInWebSession } from './test-utils/session-login';
import { fillSecret } from './release/secret-fill';
import { e2eUserPassword } from './test-utils/user-password';
import { ensureChannels, ensureNoProfile, ensureProfile, purgeDisposableChannels, type UserChannelSpec } from './seed/seed-users';
import { consentCookie } from './test-utils/consent';
import { setCreatorTier } from './release/creator-tier';
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
  /** false: the user must have NO profile (the profile-create page's user) */
  profile?: false;
  /**
   * Leftover throwaway channels younger than this are kept (a concurrent local
   * run may still be using them). Default 0: delete every leftover.
   */
  disposableChannelGraceMs?: number;
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

  const profileCreated = user.profile === false
    ? !(await ensureNoProfile(api, session))
    : await ensureProfile(api, session, { email: user.email, displayName: user.name });
  // Throwaway channels left by a cancelled or crashed run would otherwise show
  // up in this user's menu, profile and active channel for every later run.
  const purged = await purgeDisposableChannels(api, session, {
    keep: user.channels.map((c) => c.name),
    minAgeMs: user.disposableChannelGraceMs ?? 0,
  });
  if (purged.length > 0) ciLogger.warn(`[Setup] Deleted leftover throwaway channels of ${user.email}`, { purged });
  // Creating channels and uploading are by invitation (creator tiers): users
  // that own channels get the Creator tier from an admin (the release suite's
  // promoted admin, or E2E_ADMIN_EMAIL); the no-channel user keeps no tier.
  if (user.channels.length > 0) {
    if (process.env.TEST_PROMOTE_SECRET || (process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD)) {
      await setCreatorTier({ email: user.email, accessToken: session.accessToken, userId: session.userId }, 'creator');
      ciLogger.info(`[Setup] ${user.email} has the Creator tier`);
    } else {
      ciLogger.warn(`[Setup] No admin to give ${user.email} the Creator tier (TEST_PROMOTE_SECRET or E2E_ADMIN_EMAIL/PASSWORD): creating its channels is refused unless it already has one`);
    }
  }
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
  return signInWebSession(browser, user, channels, cfg, ciLogger.info);
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
/** An Error's message and the top of its stack (JSON.stringify(Error) is `{}`, which hid every cause). */
function describeError(error: unknown): unknown {
  if (error instanceof Error) return { message: error.message, stack: error.stack?.split('\n').slice(0, 4).join('\n') };
  return error;
}

/** api-videos' "briefly unavailable" answers (503 with retryAfter), e.g. while its search index is rebuilt. */
function retryAfterMs(error: unknown): number | null {
  const e = error as { status?: number; body?: { retryAfter?: number } } | null;
  if (!e || e.status !== 503) return null;
  return Math.min(Math.max(Number(e.body?.retryAfter) || 10, 5), 30) * 1000;
}

async function globalSetup(_config: FullConfig) {
  // Set when a SKIP_AUTH_SETUP job finds some state files missing: only those users are redone,
  // and they are signed in first, as the earlier setup step may have registered them already
  let onlyMissing = false;
  // Skip auth setup if auth state files already exist (from centralized auth job)
  if (process.env.SKIP_AUTH_SETUP === 'true') {
    ciLogger.info('[Global Setup] SKIP_AUTH_SETUP=true, checking for existing auth state...');

    const authDir = path.join(process.cwd(), 'e2e/.auth');
    const requiredFiles = ['user-single.json', 'user-multi.json', 'user-none.json', 'user-scratch.json'];
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

    ciLogger.warn('[Global Setup] Auth files missing despite SKIP_AUTH_SETUP=true: redoing only the missing users');
    onlyMissing = true;
  }

  ciLogger.info('[Global Setup] Starting test user registration...');

  // New users are registered with auth server code-sink addresses
  // (@e2e.alummahnow.net): QA/stage store their verification codes instead of
  // emailing them, and E2E_CODE_SINK_SECRET reads them back (#185).
  // E2E_REUSE_USERS_TIMESTAMP=<n> logs in to the existing test-*-<n> users
  // instead of registering new ones (no E2E_CODE_SINK_SECRET needed).
  const reuseTimestamp = process.env.E2E_REUSE_USERS_TIMESTAMP;
  // E2E_USERS_TIMESTAMP=<n> pins a stable user set (e.g. one per CI project so
  // parallel jobs never share accounts): log in to test-*-<n>, registering only
  // the users that don't exist yet (needs E2E_CODE_SINK_SECRET the first time).
  const pinnedTimestamp = process.env.E2E_USERS_TIMESTAMP;
  // E2E_RUN_ID=<run id>-<attempt> (CI): this job registers its own users,
  // e2e+<run>-<attempt>-web-<project>-<role>@e2e.alummahnow.net, recorded in
  // E2E_RUN_USERS_FILE before registration and deleted by the workflow's
  // always() teardown, so concurrent runs never share accounts
  // (test-utils/run-users.ts).
  const runMode = runId() !== null;

  // Verify required environment variables
  const sinkSecret = process.env.E2E_CODE_SINK_SECRET;
  if (runMode && !sinkSecret) throw new Error('E2E_CODE_SINK_SECRET is required to register this run\'s users (E2E_RUN_ID is set)');
  if (!sinkSecret && !reuseTimestamp && !pinnedTimestamp) {
    throw new Error(
      'E2E_CODE_SINK_SECRET environment variable is required for test user registration ' +
      '(the auth server code sink; CI: secrets.E2E_CODE_SINK_SECRET_QA).'
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

  // Generate unique emails per test run to avoid conflicts
  const timestamp = reuseTimestamp ? Number(reuseTimestamp) : pinnedTimestamp ? Number(pinnedTimestamp) : Date.now();
  const emailFor = (role: string) => (runMode ? webRunUserEmail(role) : `test-${role}-${timestamp}@${SINK_DOMAIN}`);
  const testUsers: TestUser[] = [
    {
      email: emailFor('single'),
      password: e2eUserPassword(),
      name: 'Single Channel User',
      storageStatePath: path.join(authDir, 'user-single.json'),
      channels: [{ name: 'E2E Single Channel', description: 'E2E test channel (single-channel user)', isMain: true }],
    },
    {
      email: emailFor('multi'),
      password: e2eUserPassword(),
      name: 'Multi Channel User',
      storageStatePath: path.join(authDir, 'user-multi.json'),
      channels: [
        { name: 'E2E Multi Channel One', description: 'E2E test channel 1 (multi-channel user)', isMain: true },
        { name: 'E2E Multi Channel Two', description: 'E2E test channel 2 (multi-channel user)' },
      ],
    },
    {
      email: emailFor('none'),
      password: e2eUserPassword(),
      name: 'No Channels User',
      storageStatePath: path.join(authDir, 'user-none.json'),
      channels: [],
    },
    {
      // Owns the throwaway channels specs create and delete (channel create /
      // delete / handle flows), so the users above keep a fixed channel set.
      email: emailFor('scratch'),
      password: e2eUserPassword(),
      name: 'Scratch Channel User',
      storageStatePath: path.join(authDir, 'user-scratch.json'),
      channels: [{ name: 'E2E Scratch Channel', description: 'E2E test channel (throwaway-channel user)', isMain: true }],
      disposableChannelGraceMs: 30 * 60 * 1000,
    },
    {
      // Signed in without a profile, as a newly registered user is: the only
      // user ProfileGuard leaves on /profile/create. Specs must not create its
      // profile (setup deletes it again anyway). E2E_FRESH_EMAIL points it at
      // another existing account (local runs that cannot register users).
      email: process.env.E2E_FRESH_EMAIL || emailFor('fresh'),
      password: e2eUserPassword(),
      name: 'No Profile User',
      storageStatePath: path.join(authDir, 'user-fresh.json'),
      channels: [],
      profile: false,
    },
  ];

  const browser = await chromium.launch({
    headless: true, // Set to false for debugging
  });

  let successCount = 0;
  const errors: Array<{ email: string; error: unknown }> = [];

  // A re-run setup (SKIP_AUTH_SETUP with files missing) redoes only the users without state: before,
  // it re-registered all five, and the four that existed failed (PR #869, run 43116467775)
  const todo = onlyMissing ? testUsers.filter((u) => !fs.existsSync(u.storageStatePath)) : testUsers;
  for (const user of todo) {
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
      // Run users never exist yet: register straight away
      if ((!runMode && (reuseTimestamp || pinnedTimestamp)) || onlyMissing) {
        const login = await loginOnPage(page, { issuerUrl: openAuthUrl, webUrl: webAppUrl, clientId }, user.email, user.password);
        if (login.ok) {
          loggedIn = true;
        } else if (onlyMissing) {
          ciLogger.info(`[Setup] ${user.email} could not sign in (${login.message}); registering it`);
        } else if (reuseTimestamp) {
          throw new Error(`Login for existing user ${user.email} failed: ${login.message}`);
        } else {
          ciLogger.info(`[Setup] Pinned user ${user.email} not found (${login.message}); registering it`);
          if (!sinkSecret) throw new Error(`E2E_CODE_SINK_SECRET is required to register pinned user ${user.email}`);
        }
      }
      if (!loggedIn) {
        // Start on the web app, which binds the OAuth state to this browser
        // (the callback refuses a direct /authorize); older builds without
        // /api/auth/login (404) take the direct authorize URL
        const started = await page.goto(`${webAppUrl}/api/auth/login?locale=en`, { waitUntil: 'networkidle' });
        if (started?.status() === 404) await page.goto(authorizeUrl, { waitUntil: 'networkidle' });

        // Click the "Register" link to go to registration page
        const registerLink = await page.$('a[href*="register"], a:has-text("Register")');
        if (registerLink) {
          await registerLink.click();
          await page.waitForLoadState('networkidle');
        }

        ciLogger.info(`[Setup] Filling registration form for ${user.email}`);

        // Fill registration form - OpenAuth uses name attributes
        await page.fill('input[name="email"]', user.email);
        await fillSecret(page.locator('input[name="password"]'), user.password);
        await fillSecret(page.locator('input[name="repeat"]'), user.password); // Repeat password field
        await page.click('button[data-component="button"]');

        // Wait for verification code page or direct redirect
        ciLogger.info(`[Setup] Waiting for next step for ${user.email}`);

        // Wait a moment for the page to transition
        await page.waitForTimeout(2000);

        // Check if we're on a verification page by looking for "Code" placeholder
        const codeInput = await page.$('input[placeholder*="Code"], input[placeholder*="code"], input[name="code"]');

        if (codeInput) {
          ciLogger.info(`[Setup] Verification code required for ${user.email}`);

          // Read the verification code from the auth server's code sink
          if (!sinkSecret) throw new Error('E2E_CODE_SINK_SECRET is required to register users');
          const code = await readSinkCode(openAuthUrl, user.email, 30000);

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
      let refreshed: BrowserContext | undefined;
      for (let attempt = 1; !refreshed; attempt++) {
        try {
          refreshed = await provisionAndRefreshSession(browser, page, user, { openAuthUrl, webAppUrl, clientId, apiUrl });
        } catch (error) {
          const wait = retryAfterMs(error);
          if (wait === null || attempt >= 3) throw error;
          ciLogger.warn(`[Setup] Provisioning ${user.email} is briefly unavailable; retrying in ${wait / 1000}s`, describeError(error));
          await page.waitForTimeout(wait);
        }
      }

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
      ciLogger.error(`[Setup] ❌ Failed to register ${user.email}`, { error: describeError(error) });
      errors.push({ email: user.email, error: describeError(error) });

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
    total: todo.length,
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
