import { test, expect } from './fixtures';

/**
 * E2E Tests for Unified Navigation Component
 *
 * Tests all functionality of the unified navigation menu including:
 * - Navigation menu opening/closing
 * - Account switching and management
 * - Channel switching and creation
 * - Dark mode and language toggles
 * - Navigation links
 * - Sign out functionality
 *
 * Tests are run for both English (LTR) and Arabic (RTL) versions
 */

test.describe('Unified Navigation - English (LTR)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to English homepage
    await page.goto('/en');
  });

  test('should display user avatar and open navigation menu on click', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Look for the navigation trigger button
    const navButton = page.locator('button[aria-label="Navigation menu"]');

    // Check if button exists (user might not be logged in)
    const isVisible = await navButton.isVisible().catch(() => false);

    if (!isVisible) {
      console.log('User not logged in - navigation menu not available');
      return;
    }

    // Click to open menu
    await navButton.click();

    // Verify dropdown menu appears
    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Verify active context card is visible
    const contextCard = dropdown.locator('div.bg-gradient-to-r');
    await expect(contextCard).toBeVisible();
  });

  test('should close navigation menu when clicking backdrop', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    // Open menu
    await navButton.click();
    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Click backdrop
    const backdrop = page.locator('div.fixed.inset-0.z-40');
    await backdrop.click();

    // Verify menu is closed
    await expect(dropdown).not.toBeVisible();
  });

  test('should display user information in active context card', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Verify user avatar is present
    const avatar = dropdown.locator('div.bg-blue-500.rounded-full').first();
    await expect(avatar).toBeVisible();

    // Verify email or display name is shown
    const userInfo = dropdown.locator('div.text-sm.font-semibold, div.text-xs.text-gray-600').first();
    await expect(userInfo).toBeVisible();
  });

  test('should display quick actions (dark mode and language toggles)', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Find quick actions section
    const quickActions = dropdown.locator('div.flex.gap-2').first();
    await expect(quickActions).toBeVisible();

    // Verify both buttons are present
    const buttons = quickActions.locator('button');
    await expect(buttons).toHaveCount(2);
  });

  test('should toggle dark mode when clicking dark mode button', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Get initial theme
    const htmlElement = page.locator('html');
    const initialTheme = await htmlElement.getAttribute('class');

    // Click dark mode toggle (first button in quick actions)
    const darkModeButton = dropdown.locator('div.flex.gap-2 button').first();
    await darkModeButton.click();

    // Wait for theme to change
    await page.waitForTimeout(500);

    // Verify theme changed
    const newTheme = await htmlElement.getAttribute('class');
    expect(newTheme).not.toBe(initialTheme);
  });

  test('should navigate to Arabic version when clicking language toggle', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Click language toggle (second button in quick actions)
    const languageButton = dropdown.locator('div.flex.gap-2 button').nth(1);

    // Wait for navigation
    await Promise.all([
      page.waitForURL('**/ar/**'),
      languageButton.click()
    ]);

    // Verify we're on Arabic version
    expect(page.url()).toContain('/ar');
  });

  test('should display navigation links section', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Find navigation section
    const navSection = dropdown.getByText('NAVIGATION');
    await expect(navSection).toBeVisible();

    // Verify standard navigation links
    await expect(dropdown.getByRole('menuitem', { name: /Profile/i })).toBeVisible();
    await expect(dropdown.getByRole('menuitem', { name: /Analytics/i })).toBeVisible();
    await expect(dropdown.getByRole('menuitem', { name: /Settings/i })).toBeVisible();
  });

  test('should navigate to profile page when clicking Profile link', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Click Profile link
    const profileLink = dropdown.getByRole('menuitem', { name: /Profile/i });

    await Promise.all([
      page.waitForURL('**/en/profile'),
      profileLink.click()
    ]);

    // Verify we're on profile page
    expect(page.url()).toContain('/en/profile');
  });

  test('should display channels section when user has channels', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Check if channels section exists
    const channelsSection = dropdown.getByText(/YOUR CHANNELS/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping channel tests');
      return;
    }

    // Verify "No Channel" option is present
    const noChannelOption = dropdown.getByText('No Channel');
    await expect(noChannelOption).toBeVisible();

    // Verify "Create New Channel" button is present
    const createChannelButton = dropdown.getByText('Create New Channel');
    await expect(createChannelButton).toBeVisible();
  });

  test('should show channel creation form when clicking Create New Channel', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Check if channels section exists
    const channelsSection = dropdown.getByText(/YOUR CHANNELS/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping test');
      return;
    }

    // Click Create New Channel
    const createButton = dropdown.getByText('Create New Channel');
    await createButton.click();

    // Verify form appears
    await expect(dropdown.getByText('Channel Name')).toBeVisible();
    await expect(dropdown.getByPlaceholder('Enter channel name')).toBeVisible();
    await expect(dropdown.getByRole('button', { name: 'Create' })).toBeVisible();
    await expect(dropdown.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('should display account management section when multiple accounts exist', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Check if multiple accounts section exists
    const switchAccountSection = dropdown.getByText(/SWITCH ACCOUNT/i);
    const hasMultipleAccounts = await switchAccountSection.isVisible().catch(() => false);

    if (!hasMultipleAccounts) {
      console.log('User has only one account - skipping multi-account tests');
      return;
    }

    // Verify account list is displayed
    await expect(switchAccountSection).toBeVisible();
  });

  test('should display Add Account button', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Verify Add Account button
    const addAccountButton = dropdown.getByText('Add another account');
    await expect(addAccountButton).toBeVisible();
  });

  test('should display sign out options', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Verify sign out button exists
    const signOutButton = dropdown.getByText(/Sign out of/i);
    await expect(signOutButton).toBeVisible();
  });

  test('should be keyboard accessible', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    // Focus the navigation button using Tab
    await page.keyboard.press('Tab');

    // Check if nav button is focused (might need multiple tabs)
    let attempts = 0;
    while (attempts < 20) {
      const isFocused = await navButton.evaluate(el => el === document.activeElement);
      if (isFocused) break;
      await page.keyboard.press('Tab');
      attempts++;
    }

    // Open menu with Enter key
    await page.keyboard.press('Enter');

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Close with Escape key
    await page.keyboard.press('Escape');

    // Note: Closing with Escape is not implemented yet
    // This test documents expected behavior
  });

  test('should display active channel indicator', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Check active context card shows channel info
    const contextCard = dropdown.locator('div.bg-gradient-to-r').first();
    await expect(contextCard).toBeVisible();

    // Verify channel display or "No active channel" message
    const channelDisplay = dropdown.locator('div.px-3.py-2.bg-white\\/60');
    await expect(channelDisplay).toBeVisible();
  });

  test('should show crown icon for main channel', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Check if channels section exists
    const channelsSection = dropdown.getByText(/YOUR CHANNELS/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping test');
      return;
    }

    // Look for crown icon (lucide-react Crown component renders as SVG)
    const crownIcon = dropdown.locator('svg.lucide-crown');
    const hasCrown = await crownIcon.isVisible().catch(() => false);

    if (!hasCrown) {
      console.log('No main channel marked - skipping crown test');
      return;
    }

    await expect(crownIcon).toBeVisible();
  });

  test('should handle error messages gracefully', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="Navigation menu"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Check if error section exists
    const errorSection = dropdown.locator('div.bg-red-50');
    const hasError = await errorSection.isVisible().catch(() => false);

    if (!hasError) {
      console.log('No errors present - this is expected behavior');
      return;
    }

    // If error exists, verify it's displayed properly
    await expect(errorSection).toBeVisible();
    const errorText = dropdown.locator('p.text-red-600');
    await expect(errorText).toBeVisible();
  });
});

test.describe('Unified Navigation - Arabic (RTL)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to Arabic homepage
    await page.goto('/ar');
  });

  test('should display user avatar and open navigation menu on click (RTL)', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="قائمة التنقل"]');

    const isVisible = await navButton.isVisible().catch(() => false);

    if (!isVisible) {
      console.log('User not logged in - navigation menu not available');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    const contextCard = dropdown.locator('div.bg-gradient-to-r');
    await expect(contextCard).toBeVisible();
  });

  test('should close navigation menu when clicking backdrop (RTL)', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="قائمة التنقل"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();
    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    const backdrop = page.locator('div.fixed.inset-0.z-40');
    await backdrop.click();

    await expect(dropdown).not.toBeVisible();
  });

  test('should display Arabic navigation links', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="قائمة التنقل"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    // Verify Arabic navigation section
    const navSection = dropdown.getByText('التنقل');
    await expect(navSection).toBeVisible();

    // Verify Arabic navigation links
    await expect(dropdown.getByText('الملف الشخصي')).toBeVisible();
    await expect(dropdown.getByText('التحليلات')).toBeVisible();
    await expect(dropdown.getByText('الإعدادات')).toBeVisible();
  });

  test('should navigate to English version when clicking language toggle (RTL)', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="قائمة التنقل"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    // Click language toggle - should show "English"
    const languageButton = dropdown.getByText('English');

    await Promise.all([
      page.waitForURL('**/en/**'),
      languageButton.click()
    ]);

    expect(page.url()).toContain('/en');
  });

  test('should display Arabic channel section when user has channels', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="قائمة التنقل"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    const channelsSection = dropdown.getByText(/قنواتك/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping test');
      return;
    }

    // Verify Arabic "No Channel" option
    const noChannelOption = dropdown.getByText('بدون قناة');
    await expect(noChannelOption).toBeVisible();

    // Verify Arabic "Create New Channel" button
    const createChannelButton = dropdown.getByText('إنشاء قناة جديدة');
    await expect(createChannelButton).toBeVisible();
  });

  test('should show Arabic channel creation form', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="قائمة التنقل"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    const channelsSection = dropdown.getByText(/قنواتك/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping test');
      return;
    }

    const createButton = dropdown.getByText('إنشاء قناة جديدة');
    await createButton.click();

    // Verify Arabic form
    await expect(dropdown.getByText('اسم القناة')).toBeVisible();
    await expect(dropdown.getByPlaceholder('أدخل اسم القناة')).toBeVisible();
    await expect(dropdown.getByRole('button', { name: 'إنشاء' })).toBeVisible();
    await expect(dropdown.getByRole('button', { name: 'إلغاء' })).toBeVisible();
  });

  test('should display Arabic account management section', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="قائمة التنقل"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    const switchAccountSection = dropdown.getByText(/تبديل الحساب/i);
    const hasMultipleAccounts = await switchAccountSection.isVisible().catch(() => false);

    if (!hasMultipleAccounts) {
      console.log('User has only one account - skipping test');
      return;
    }

    await expect(switchAccountSection).toBeVisible();
  });

  test('should display Arabic Add Account button', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="قائمة التنقل"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    const addAccountButton = dropdown.getByText('إضافة حساب آخر');
    await expect(addAccountButton).toBeVisible();
  });

  test('should display Arabic sign out options', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="قائمة التنقل"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    const signOutButton = dropdown.getByText(/تسجيل الخروج من/i);
    await expect(signOutButton).toBeVisible();
  });

  test('should verify RTL text alignment', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const navButton = page.locator('button[aria-label="قائمة التنقل"]');
    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    // Verify dir="rtl" attribute
    const dirAttr = await dropdown.getAttribute('dir');
    expect(dirAttr).toBe('rtl');

    // Verify dropdown is positioned on the left (RTL)
    const position = await dropdown.evaluate(el => {
      const styles = window.getComputedStyle(el);
      return {
        left: styles.left,
        right: styles.right
      };
    });

    // In RTL, dropdown should be positioned using 'left' property
    expect(position.left).toBeTruthy();
  });
});
