import { test, expect } from '@playwright/test';

/**
 * ProfileGuard Debug Test
 *
 * This test captures all console logs to debug the ProfileGuard redirect issue
 */

test.describe('ProfileGuard Debug', () => {
  let consoleLogs: string[] = [];
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    // Capture all console messages
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(`[${msg.type()}] ${text}`);

      if (text.includes('[ProfileGuard]') || text.includes('[checkProfileExists]') || text.includes('[MultiAccountProvider]')) {
        console.log(`CAPTURED: ${text}`);
      }
    });

    page.on('pageerror', error => {
      const errorText = `PAGE ERROR: ${error.message}`;
      consoleErrors.push(errorText);
      console.error(errorText);
    });

    consoleLogs = [];
    consoleErrors = [];
  });

  test.afterEach(async () => {
    console.log('\n========== ALL CONSOLE LOGS ==========');
    consoleLogs.forEach(log => console.log(log));

    if (consoleErrors.length > 0) {
      console.log('\n========== PAGE ERRORS ==========');
      consoleErrors.forEach(error => console.error(error));
    }
    console.log('========================================\n');
  });

  test('should capture ProfileGuard behavior on English homepage', async ({ page }) => {
    console.log('\n🧪 Testing ProfileGuard on English homepage');

    // Go to English homepage
    await page.goto('/en', { waitUntil: 'networkidle' });

    // Wait a bit for ProfileGuard to do its check
    await page.waitForTimeout(3000);

    // Check current URL
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);

    // Check if we're on profile creation page (redirect happened)
    const isOnProfileCreate = currentUrl.includes('/profile/create');
    console.log('Redirected to profile create?', isOnProfileCreate);

    // Print all ProfileGuard-related logs
    const profileGuardLogs = consoleLogs.filter(log =>
      log.includes('[ProfileGuard]') ||
      log.includes('[checkProfileExists]') ||
      log.includes('[MultiAccountProvider]')
    );

    console.log('\n========== PROFILEGUARD LOGS ==========');
    profileGuardLogs.forEach(log => console.log(log));
    console.log('=======================================\n');

    // Take screenshot for debugging
    await page.screenshot({ path: 'test-results/profile-guard-debug.png', fullPage: true });

    // The test passes regardless - we just want to capture logs
    expect(true).toBe(true);
  });

  test('should show what checkProfileExists returns', async ({ page }) => {
    console.log('\n🧪 Testing checkProfileExists response');

    await page.goto('/en', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Find the specific log about checkProfileExists result
    const checkExistsLogs = consoleLogs.filter(log =>
      log.includes('checkProfileExists') &&
      (log.includes('returned') || log.includes('Result:'))
    );

    console.log('\n========== checkProfileExists RESULT ==========');
    if (checkExistsLogs.length > 0) {
      checkExistsLogs.forEach(log => console.log(log));
    } else {
      console.log('❌ No checkProfileExists result found in logs');
    }
    console.log('===============================================\n');

    expect(true).toBe(true);
  });

  test('should show getProfileCurrent response', async ({ page }) => {
    console.log('\n🧪 Testing getProfileCurrent response');

    await page.goto('/en', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Find logs about getProfileCurrent
    const profileCurrentLogs = consoleLogs.filter(log =>
      log.includes('getProfileCurrent')
    );

    console.log('\n========== getProfileCurrent LOGS ==========');
    if (profileCurrentLogs.length > 0) {
      profileCurrentLogs.forEach(log => console.log(log));
    } else {
      console.log('❌ No getProfileCurrent logs found');
    }
    console.log('==========================================\n');

    expect(true).toBe(true);
  });
});
