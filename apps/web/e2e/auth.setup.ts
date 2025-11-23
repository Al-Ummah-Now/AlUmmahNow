import { chromium, FullConfig } from '@playwright/test';
import { ResendTestClient } from './test-utils/resend-client';
import { logger } from '@/lib/logger-client';

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
 */
async function globalSetup(_config: FullConfig) {
  logger.info('[Global Setup] Starting test user registration...');

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

  logger.info('[Global Setup] Configuration', {
    openAuthUrl,
    webAppUrl
  });

  const resendClient = new ResendTestClient(resendApiKey);

  // Generate unique emails per test run to avoid conflicts
  const timestamp = Date.now();
  const testUsers: TestUser[] = [
    {
      email: `test-single-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword123!',
      name: 'Single Channel User',
      storageStatePath: 'e2e/.auth/user-single.json',
    },
    {
      email: `test-multi-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword456!',
      name: 'Multi Channel User',
      storageStatePath: 'e2e/.auth/user-multi.json',
    },
    {
      email: `test-none-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword789!',
      name: 'No Channels User',
      storageStatePath: 'e2e/.auth/user-none.json',
    },
  ];

  const browser = await chromium.launch({
    headless: true, // Set to false for debugging
  });

  let successCount = 0;
  const errors: Array<{ email: string; error: unknown }> = [];

  for (const user of testUsers) {
    logger.info(`[Setup] Registering user: ${user.email}`);

    const context = await browser.newContext({
      baseURL: webAppUrl,
    });
    const page = await context.newPage();

    try {
      // Navigate to OpenAuth signup
      await page.goto(`${openAuthUrl}/signup`, { waitUntil: 'networkidle' });

      logger.info(`[Setup] Filling registration form for ${user.email}`);

      // Fill registration form
      await page.fill('input[type="email"]', user.email);
      await page.fill('input[type="password"]', user.password);
      await page.click('button[type="submit"]');

      // Wait for verification code input to appear
      logger.info(`[Setup] Waiting for verification code input for ${user.email}`);
      await page.waitForSelector('text=/verification.*code/i', { timeout: 10000 });

      // Get verification code from Resend
      logger.info(`[Setup] Fetching verification email for ${user.email}`);
      const emailHtml = await resendClient.getVerificationEmail(user.email);

      if (!emailHtml) {
        throw new Error('No verification email received within timeout period');
      }

      const code = resendClient.extractVerificationCode(emailHtml);
      if (!code) {
        throw new Error('Failed to extract verification code from email');
      }

      logger.info(`[Setup] Verification code received for ${user.email}`);

      // Enter verification code
      await page.fill('input[type="text"], input[type="number"]', code);
      await page.click('button[type="submit"]');

      // Wait for successful authentication and redirect
      logger.info(`[Setup] Waiting for authentication callback for ${user.email}`);
      await page.waitForURL('**/api/callback?code=*', { timeout: 15000 });

      logger.info(`[Setup] Waiting for redirect to home page for ${user.email}`);
      await page.waitForURL('**/en', { timeout: 10000 });

      // Save authenticated state
      logger.info(`[Setup] Saving authentication state for ${user.email}`);
      await context.storageState({ path: user.storageStatePath });

      logger.info(`[Setup] ✅ Successfully registered and saved state: ${user.email}`);
      successCount++;

      await context.close();

      // Small delay between registrations to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      logger.error(`[Setup] ❌ Failed to register ${user.email}`, { error });
      errors.push({ email: user.email, error });

      // Take screenshot for debugging
      try {
        const screenshotPath = `e2e/.auth/error-${user.email}-${timestamp}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logger.info(`[Setup] Screenshot saved to ${screenshotPath}`);
      } catch (screenshotError) {
        logger.error('[Setup] Failed to save screenshot', { screenshotError });
      }

      await context.close();

      // Don't throw immediately - try to register other users
      continue;
    }
  }

  await browser.close();

  // Summary
  logger.info('[Global Setup] Registration Summary', {
    total: testUsers.length,
    success: successCount,
    failed: errors.length
  });

  if (errors.length > 0) {
    logger.error('[Global Setup] Failed registrations:', errors);
    throw new Error(
      `Failed to register ${errors.length} test user(s). See logs for details.`
    );
  }

  logger.info('[Global Setup] ✅ All test users registered successfully!');
}

export default globalSetup;
