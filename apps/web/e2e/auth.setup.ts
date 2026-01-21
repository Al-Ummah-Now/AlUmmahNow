import { chromium, FullConfig } from '@playwright/test';
import { ResendTestClient } from './test-utils/resend-client';
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

  // Verify required environment variables
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error(
      'RESEND_API_KEY environment variable is required for test user registration. ' +
      'Get your API key from https://resend.com/api-keys'
    );
  }

  const openAuthUrl = process.env.OPENAUTH_URL || 'http://localhost:3301';
  const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3001';
  const clientId = process.env.OPENAUTH_CLIENT_ID || 'alummah-web';

  // Log working directory for debugging path issues
  const cwd = process.cwd();
  const authDir = path.join(cwd, 'e2e/.auth');

  ciLogger.info('[Global Setup] Configuration', {
    openAuthUrl,
    webAppUrl,
    clientId,
    cwd,
    authDir
  });

  // Ensure auth directory exists
  if (!fs.existsSync(authDir)) {
    ciLogger.info(`[Global Setup] Creating auth directory: ${authDir}`);
    fs.mkdirSync(authDir, { recursive: true });
  }

  const resendClient = new ResendTestClient(resendApiKey);

  // Generate unique emails per test run to avoid conflicts
  const timestamp = Date.now();
  const testUsers: TestUser[] = [
    {
      email: `test-single-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword123!',
      name: 'Single Channel User',
      storageStatePath: path.join(authDir, 'user-single.json'),
    },
    {
      email: `test-multi-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword456!',
      name: 'Multi Channel User',
      storageStatePath: path.join(authDir, 'user-multi.json'),
    },
    {
      email: `test-none-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword789!',
      name: 'No Channels User',
      storageStatePath: path.join(authDir, 'user-none.json'),
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
    const page = await context.newPage();

    try {
      // Start with the OAuth authorize endpoint - this sets up proper session state
      const callbackUrl = `${webAppUrl}/api/callback`;
      const authorizeUrl = `${openAuthUrl}/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&client_id=${clientId}`;

      ciLogger.info(`[Setup] Starting OAuth flow for ${user.email}`);
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

      // Save authenticated state
      ciLogger.info(`[Setup] Saving authentication state for ${user.email} to ${user.storageStatePath}`);
      await context.storageState({ path: user.storageStatePath });

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
