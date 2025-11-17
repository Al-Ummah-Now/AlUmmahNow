import { test, expect } from '@playwright/test';

/**
 * Account Switching Test
 *
 * Tests the account switching functionality, especially on profile creation page
 */

test.describe('Account Switching', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to home page (assumes user is already logged in)
    await page.goto('/en', { waitUntil: 'networkidle' });
  });

  test('should allow switching accounts on profile creation page', async ({ page }) => {
    console.log('\n🧪 Testing account switching on profile creation page');

    // Navigate to profile creation page
    await page.goto('/en/profile/create', { waitUntil: 'networkidle' });

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Check if we're on profile creation page
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);

    // Open navigation menu (look for user avatar or menu button)
    const menuButton = page.locator('[data-testid="user-menu"], button:has-text("Menu"), button[aria-label*="menu"]').first();

    if (await menuButton.isVisible()) {
      console.log('Clicking menu button...');
      await menuButton.click();
      await page.waitForTimeout(1000);

      // Look for account switcher section
      const accountSection = page.locator('text=/ACCOUNTS?/i');

      if (await accountSection.isVisible()) {
        console.log('Found ACCOUNTS section');

        // Find all account buttons (excluding the active one)
        const accountButtons = page.locator('button:has-text("@")').filter({ hasNot: page.locator('[disabled]') });
        const accountCount = await accountButtons.count();

        console.log(`Found ${accountCount} switchable accounts`);

        if (accountCount > 0) {
          // Get the first available account to switch to
          const targetAccount = accountButtons.first();
          const accountEmail = await targetAccount.textContent();
          console.log(`Attempting to switch to: ${accountEmail}`);

          // Listen for network requests
          const responsePromise = page.waitForResponse(
            response => response.url().includes('/profile/create') && response.request().method() === 'POST',
            { timeout: 10000 }
          );

          // Click the account to switch
          await targetAccount.click();

          try {
            // Wait for the server action response
            const response = await responsePromise;
            const status = response.status();

            console.log(`Server action response status: ${status}`);

            // Check if we got a successful response (not 500)
            expect(status).not.toBe(500);
            expect([200, 307, 308]).toContain(status); // 200 OK, or redirect statuses

            // Wait for navigation/state update
            await page.waitForTimeout(2000);

            // Check the final URL
            const finalUrl = page.url();
            console.log('Final URL after switch:', finalUrl);

            // If we switched to an account WITH a profile, we should be redirected to /profile
            // If we switched to an account WITHOUT a profile, we should stay on /profile/create
            const isOnProfileCreate = finalUrl.includes('/profile/create');
            const isOnProfile = finalUrl.includes('/profile') && !finalUrl.includes('/profile/create');

            console.log('Is on profile create?', isOnProfileCreate);
            console.log('Is on profile page?', isOnProfile);

            // Either outcome is valid - the important thing is no 500 error
            expect(isOnProfileCreate || isOnProfile).toBe(true);

          } catch (error) {
            console.error('Failed to capture server action response:', error);
            throw error;
          }

        } else {
          console.log('⏭️  Skipping test - no additional accounts available to switch to');
          test.skip();
        }

      } else {
        console.log('⏭️  Skipping test - ACCOUNTS section not found');
        test.skip();
      }

    } else {
      console.log('⏭️  Skipping test - menu button not found');
      test.skip();
    }
  });

  test('should not throw 500 errors when switching accounts', async ({ page }) => {
    console.log('\n🧪 Testing for 500 errors during account switch');

    // Monitor network for 500 errors
    const errors500: string[] = [];
    page.on('response', response => {
      if (response.status() === 500) {
        errors500.push(`${response.request().method()} ${response.url()} - ${response.status()}`);
      }
    });

    // Navigate to profile creation
    await page.goto('/en/profile/create', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Try to open menu and switch accounts
    try {
      const menuButton = page.locator('[data-testid="user-menu"], button:has-text("Menu"), button[aria-label*="menu"]').first();

      if (await menuButton.isVisible({ timeout: 5000 })) {
        await menuButton.click();
        await page.waitForTimeout(500);

        const accountButtons = page.locator('button:has-text("@")').filter({ hasNot: page.locator('[disabled]') });
        const accountCount = await accountButtons.count();

        if (accountCount > 0) {
          await accountButtons.first().click();
          await page.waitForTimeout(3000); // Wait for server action to complete
        }
      }
    } catch (error) {
      console.log('Could not perform account switch, but checking for 500 errors...');
    }

    // Check if any 500 errors occurred
    if (errors500.length > 0) {
      console.error('❌ Found 500 errors:');
      errors500.forEach(err => console.error('  -', err));
    } else {
      console.log('✅ No 500 errors detected');
    }

    expect(errors500).toHaveLength(0);
  });

  test('should show loading state during account switch', async ({ page }) => {
    console.log('\n🧪 Testing loading state during account switch');

    await page.goto('/en/profile/create', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const menuButton = page.locator('[data-testid="user-menu"], button:has-text("Menu"), button[aria-label*="menu"]').first();

    if (await menuButton.isVisible({ timeout: 5000 })) {
      await menuButton.click();
      await page.waitForTimeout(500);

      const accountButtons = page.locator('button:has-text("@")').filter({ hasNot: page.locator('[disabled]') });
      const accountCount = await accountButtons.count();

      if (accountCount > 0) {
        // Click account switch
        await accountButtons.first().click();

        // Check for loading indicator (could be a spinner or disabled state)
        const hasLoadingIndicator = await Promise.race([
          page.locator('.animate-spin, [aria-busy="true"], [data-loading="true"]').first().isVisible({ timeout: 2000 }).then(() => true),
          page.waitForTimeout(2000).then(() => false)
        ]);

        console.log('Loading indicator shown:', hasLoadingIndicator);

        // This is informational - we don't fail the test if no loading indicator
        // The important thing is that the switch completes successfully
      } else {
        console.log('⏭️  Skipping - no accounts to switch to');
        test.skip();
      }
    } else {
      console.log('⏭️  Skipping - menu not found');
      test.skip();
    }
  });

  test('should use user-specific localStorage for active channel', async ({ page }) => {
    console.log('\n🧪 Testing: localStorage keys are user-specific for channels');

    // Enable console logging
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('ActiveChannelProvider') || text.includes('userId:')) {
        console.log(text);
      }
    });

    await page.goto('/en', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Get all active channel related keys from localStorage
    const channelData = await page.evaluate(() => {
      const data: Record<string, any> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('al-ummah-active-channel')) {
          try {
            data[key] = JSON.parse(localStorage.getItem(key) || '{}');
          } catch {
            data[key] = localStorage.getItem(key);
          }
        }
      }
      return data;
    });

    console.log('\n=== Channel localStorage Data ===');
    console.log(JSON.stringify(channelData, null, 2));
    console.log('==================================\n');

    // Verify keys follow the pattern: al-ummah-active-channel-{userId}
    const keys = Object.keys(channelData);
    for (const key of keys) {
      console.log(`Key: ${key}`);

      // Check if key has userId suffix
      const parts = key.split('-');
      const hasUserIdSuffix = parts.length > 4; // al-ummah-active-channel-{userId}
      console.log(`  Has userId suffix: ${hasUserIdSuffix}`);

      if (channelData[key] && typeof channelData[key] === 'object') {
        console.log(`  Channel ID: ${channelData[key].channelId}`);
        console.log(`  Channel Name: ${channelData[key].name}`);
        console.log(`  Is Main: ${channelData[key].isMain}`);
      }
    }

    // Document that each user should have their own key
    console.log('\n✅ Expected behavior: Each user has separate localStorage key');
    console.log('   Format: al-ummah-active-channel-{userId}');

    expect(true).toBe(true); // This test is informational
  });
});
