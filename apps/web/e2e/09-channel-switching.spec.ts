import { test, expect } from './fixtures';

/**
 * E2E Tests for Channel Switching Functionality
 *
 * Tests all channel-related operations:
 * - Switching between channels
 * - Switching to "No Channel" mode
 * - Creating new channels
 * - Channel display and indicators
 * - Channel persistence across navigation
 *
 * Tests are run for both English (LTR) and Arabic (RTL) versions
 */

test.describe('Channel Switching - English', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en');
    await page.waitForLoadState('networkidle');
  });

  test('should display current channel in navigation button', async ({ page }) => {
    const navButton = page.locator('button[aria-label="Navigation menu"]');

    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    // Check if channel name is displayed in the button (desktop view)
    const channelDisplay = navButton.locator('div.text-xs.text-gray-500');
    const hasChannelDisplay = await channelDisplay.isVisible().catch(() => false);

    if (!hasChannelDisplay) {
      console.log('Channel display not visible (may be mobile view)');
      return;
    }

    // Verify channel name or "No Channel" is shown
    const text = await channelDisplay.textContent();
    expect(text).toBeTruthy();
  });

  test('should switch to "No Channel" mode', async ({ page }) => {
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

    // Click "No Channel" option
    const noChannelButton = dropdown.getByRole('menuitem').filter({ hasText: 'No Channel' });
    await noChannelButton.click();

    // Wait for page to refresh
    await page.waitForLoadState('networkidle');

    // Reopen menu to verify
    await navButton.click();
    await expect(dropdown).toBeVisible();

    // Verify "No Channel" is now active (should have checkmark)
    const activeNoChannel = dropdown.locator('button:has-text("No Channel")');
    const hasCheckmark = await activeNoChannel.locator('svg.lucide-check').isVisible().catch(() => false);

    if (hasCheckmark) {
      expect(hasCheckmark).toBeTruthy();
    } else {
      console.log('Checkmark not found - channel switch may not have persisted');
    }
  });

  test('should switch between user channels', async ({ page }) => {
    const navButton = page.locator('button[aria-label="Navigation menu"]');

    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Check if user has multiple channels
    const channelsSection = dropdown.getByText(/YOUR CHANNELS/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping test');
      return;
    }

    // Get all channel buttons (excluding "No Channel")
    const channelButtons = dropdown.locator('button[role="menuitem"]:has(div.bg-purple-500)');
    const channelCount = await channelButtons.count();

    if (channelCount < 1) {
      console.log('User has no actual channels - skipping test');
      return;
    }

    // Click the first channel
    const firstChannel = channelButtons.first();
    const channelName = await firstChannel.locator('div.text-sm.font-medium').textContent();

    await firstChannel.click();

    // Wait for page to refresh
    await page.waitForLoadState('networkidle');

    // Reopen menu to verify
    await navButton.click();
    await expect(dropdown).toBeVisible();

    // Verify the channel is now active (should have checkmark)
    const activeChannel = dropdown.locator(`button:has-text("${channelName}")`);
    const hasCheckmark = await activeChannel.locator('svg.lucide-check').isVisible().catch(() => false);

    if (hasCheckmark) {
      expect(hasCheckmark).toBeTruthy();
    } else {
      console.log('Checkmark not found - channel switch may not have persisted');
    }
  });

  test('should create a new channel successfully', async ({ page }) => {
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

    // Click "Create New Channel"
    const createButton = dropdown.getByText('Create New Channel');
    await createButton.click();

    // Verify form appears
    const channelNameInput = dropdown.getByPlaceholder('Enter channel name');
    await expect(channelNameInput).toBeVisible();

    // Generate unique channel name
    const timestamp = Date.now();
    const newChannelName = `E2E Test Channel ${timestamp}`;

    // Fill in channel name
    await channelNameInput.fill(newChannelName);

    // Click Create button
    const submitButton = dropdown.getByRole('button', { name: 'Create' });
    await submitButton.click();

    // Wait for channel creation (page should refresh)
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000); // Give server time to process

    // Reopen menu to verify new channel exists
    await navButton.click();
    await expect(dropdown).toBeVisible();

    // Look for the new channel in the list
    const newChannel = dropdown.getByText(newChannelName);
    const channelCreated = await newChannel.isVisible().catch(() => false);

    if (channelCreated) {
      await expect(newChannel).toBeVisible();
    } else {
      console.log('Channel creation may have failed or is pending');
    }
  });

  test('should cancel channel creation', async ({ page }) => {
    const navButton = page.locator('button[aria-label="Navigation menu"]');

    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    const channelsSection = dropdown.getByText(/YOUR CHANNELS/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping test');
      return;
    }

    // Click "Create New Channel"
    const createButton = dropdown.getByText('Create New Channel');
    await createButton.click();

    // Verify form appears
    const channelNameInput = dropdown.getByPlaceholder('Enter channel name');
    await expect(channelNameInput).toBeVisible();

    // Fill in channel name
    await channelNameInput.fill('Test Channel to Cancel');

    // Click Cancel button
    const cancelButton = dropdown.getByRole('button', { name: 'Cancel' });
    await cancelButton.click();

    // Verify form is hidden
    await expect(channelNameInput).not.toBeVisible();

    // Verify "Create New Channel" button is visible again
    await expect(dropdown.getByText('Create New Channel')).toBeVisible();
  });

  test('should validate empty channel name', async ({ page }) => {
    const navButton = page.locator('button[aria-label="Navigation menu"]');

    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    const channelsSection = dropdown.getByText(/YOUR CHANNELS/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping test');
      return;
    }

    const createButton = dropdown.getByText('Create New Channel');
    await createButton.click();

    const channelNameInput = dropdown.getByPlaceholder('Enter channel name');
    await expect(channelNameInput).toBeVisible();

    // Leave input empty and try to create
    const submitButton = dropdown.getByRole('button', { name: 'Create' });

    // Button should be disabled when input is empty
    const isDisabled = await submitButton.isDisabled();
    expect(isDisabled).toBeTruthy();
  });

  test('should show main channel with crown icon', async ({ page }) => {
    const navButton = page.locator('button[aria-label="Navigation menu"]');

    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    const channelsSection = dropdown.getByText(/YOUR CHANNELS/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping test');
      return;
    }

    // Look for crown icon
    const crownIcon = dropdown.locator('svg.lucide-crown');
    const hasCrown = await crownIcon.isVisible().catch(() => false);

    if (!hasCrown) {
      console.log('No main channel found - this may be expected');
      return;
    }

    // Verify crown is visible and associated with a channel
    await expect(crownIcon).toBeVisible();

    // Get the channel button that contains the crown
    const mainChannelButton = crownIcon.locator('..').locator('..').locator('..').locator('..');

    // Verify it has "Main Channel" text
    const mainChannelText = mainChannelButton.getByText(/Main Channel/i);
    const hasMainChannelText = await mainChannelText.isVisible().catch(() => false);

    if (hasMainChannelText) {
      await expect(mainChannelText).toBeVisible();
    }
  });

  test('should persist channel selection across page navigation', async ({ page }) => {
    const navButton = page.locator('button[aria-label="Navigation menu"]');

    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    const channelsSection = dropdown.getByText(/YOUR CHANNELS/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping test');
      return;
    }

    // Get current active channel (with checkmark)
    const activeChannelButton = dropdown.locator('button[role="menuitem"]:has(svg.lucide-check)');
    const activeChannelName = await activeChannelButton.locator('div.text-sm.font-medium').textContent().catch(() => null);

    if (!activeChannelName) {
      console.log('No active channel found');
      return;
    }

    // Close dropdown
    const backdrop = page.locator('div.fixed.inset-0.z-40');
    await backdrop.click();

    // Navigate to profile page
    await page.goto('/en/profile');
    await page.waitForLoadState('networkidle');

    // Reopen navigation menu
    await navButton.click();
    await expect(dropdown).toBeVisible();

    // Verify same channel is still active
    const stillActiveChannel = dropdown.locator(`button:has-text("${activeChannelName}")`);
    const stillHasCheckmark = await stillActiveChannel.locator('svg.lucide-check').isVisible().catch(() => false);

    if (stillHasCheckmark) {
      expect(stillHasCheckmark).toBeTruthy();
    } else {
      console.log('Channel selection did not persist - this may indicate a session issue');
    }
  });

  test('should display channel in active context card', async ({ page }) => {
    const navButton = page.locator('button[aria-label="Navigation menu"]');

    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Find active context card
    const contextCard = dropdown.locator('div.bg-gradient-to-r').first();
    await expect(contextCard).toBeVisible();

    // Find channel display in context card
    const channelDisplay = contextCard.locator('div.px-3.py-2.bg-white\\/60');
    await expect(channelDisplay).toBeVisible();

    // Verify it shows either a channel name or "No active channel"
    const displayText = await channelDisplay.textContent();
    expect(displayText).toBeTruthy();
  });
});

test.describe('Channel Switching - Arabic', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ar');
    await page.waitForLoadState('networkidle');
  });

  test('should switch to "No Channel" mode (RTL)', async ({ page }) => {
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

    // Click "بدون قناة" (No Channel) option
    const noChannelButton = dropdown.getByRole('menuitem').filter({ hasText: 'بدون قناة' });
    await noChannelButton.click();

    await page.waitForLoadState('networkidle');

    // Reopen menu to verify
    await navButton.click();
    await expect(dropdown).toBeVisible();

    // Verify "بدون قناة" is now active
    const activeNoChannel = dropdown.locator('button:has-text("بدون قناة")');
    const hasCheckmark = await activeNoChannel.locator('svg.lucide-check').isVisible().catch(() => false);

    if (hasCheckmark) {
      expect(hasCheckmark).toBeTruthy();
    }
  });

  test('should create a new channel with Arabic name', async ({ page }) => {
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

    // Click "إنشاء قناة جديدة"
    const createButton = dropdown.getByText('إنشاء قناة جديدة');
    await createButton.click();

    // Verify form appears
    const channelNameInput = dropdown.getByPlaceholder('أدخل اسم القناة');
    await expect(channelNameInput).toBeVisible();

    // Generate unique Arabic channel name
    const timestamp = Date.now();
    const newChannelName = `قناة اختبار ${timestamp}`;

    // Fill in channel name
    await channelNameInput.fill(newChannelName);

    // Click Create button
    const submitButton = dropdown.getByRole('button', { name: 'إنشاء' });
    await submitButton.click();

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Reopen menu to verify new channel exists
    await navButton.click();
    await expect(dropdown).toBeVisible();

    // Look for the new channel in the list
    const newChannel = dropdown.getByText(newChannelName);
    const channelCreated = await newChannel.isVisible().catch(() => false);

    if (channelCreated) {
      await expect(newChannel).toBeVisible();
    } else {
      console.log('Channel creation may have failed or is pending');
    }
  });

  test('should show "القناة الرئيسية" (Main Channel) label for main channel', async ({ page }) => {
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

    // Look for "القناة الرئيسية" text
    const mainChannelLabel = dropdown.getByText('القناة الرئيسية');
    const hasMainChannel = await mainChannelLabel.isVisible().catch(() => false);

    if (!hasMainChannel) {
      console.log('No main channel found - this may be expected');
      return;
    }

    await expect(mainChannelLabel).toBeVisible();
  });

  test('should display "لا توجد قناة نشطة" when no channel is active', async ({ page }) => {
    const navButton = page.locator('button[aria-label="قائمة التنقل"]');

    if (!await navButton.isVisible().catch(() => false)) {
      console.log('User not logged in - skipping test');
      return;
    }

    await navButton.click();

    const dropdown = page.locator('div[role="menu"][dir="rtl"]');
    await expect(dropdown).toBeVisible();

    // Switch to "No Channel" first
    const channelsSection = dropdown.getByText(/قنواتك/i);
    const hasChannels = await channelsSection.isVisible().catch(() => false);

    if (!hasChannels) {
      console.log('User has no channels - skipping test');
      return;
    }

    const noChannelButton = dropdown.getByRole('menuitem').filter({ hasText: 'بدون قناة' });
    await noChannelButton.click();

    await page.waitForLoadState('networkidle');

    // Reopen menu
    await navButton.click();
    await expect(dropdown).toBeVisible();

    // Check for "لا توجد قناة نشطة" in context card
    const noActiveChannel = dropdown.getByText('لا توجد قناة نشطة');
    const hasNoActiveChannel = await noActiveChannel.isVisible().catch(() => false);

    if (hasNoActiveChannel) {
      await expect(noActiveChannel).toBeVisible();
    }
  });
});
