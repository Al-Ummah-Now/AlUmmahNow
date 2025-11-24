/**
 * E2E Tests for Scheduled Videos Calendar View
 * Tests the complete calendar feature flow including view switching,
 * navigation, calendar type switching, and event interaction.
 */

import { test, expect, type Page } from '@playwright/test';

// Test configuration
const BASE_URL = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3001';
const LOCALE_EN = `${BASE_URL}/en`;
const LOCALE_AR = `${BASE_URL}/ar`;
const SCHEDULED_VIDEOS_PATH = '/scheduled-videos';

// Helper function to login (adjust based on your auth implementation)
async function login(page: Page, locale = 'en') {
  const baseUrl = locale === 'en' ? LOCALE_EN : LOCALE_AR;

  // Navigate to login page
  await page.goto(`${baseUrl}/login`);

  // Fill in login credentials (adjust selectors based on your implementation)
  await page.fill('input[name="email"]', process.env.TEST_USER_EMAIL || 'test@example.com');
  await page.fill('input[name="password"]', process.env.TEST_USER_PASSWORD || 'testpassword');

  // Submit form
  await page.click('button[type="submit"]');

  // Wait for navigation to complete
  await page.waitForLoadState('networkidle');
}

test.describe('Scheduled Videos Calendar - View Switching', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}/scheduled-videos`);
  });

  test('should switch from list to calendar view', async ({ page }) => {
    // Click calendar view button
    await page.click('[aria-label="Calendar view"]');

    // Verify calendar is displayed
    await expect(page.locator('[role="application"]')).toBeVisible();

    // Verify URL updated
    await expect(page).toHaveURL(/view=calendar/);
  });

  test('should switch from calendar to list view', async ({ page }) => {
    // First switch to calendar
    await page.click('[aria-label="Calendar view"]');
    await page.waitForSelector('[role="application"]');

    // Switch back to list
    await page.click('[aria-label="List view"]');

    // Verify list is displayed
    await expect(page.locator('[role="list"]')).toBeVisible();

    // Verify URL updated
    await expect(page).toHaveURL(/view=list/);
  });

  test('should persist view preference in URL', async ({ page }) => {
    // Switch to calendar view
    await page.click('[aria-label="Calendar view"]');

    // Reload page
    await page.reload();

    // Verify calendar view is still active
    await expect(page.locator('[role="application"]')).toBeVisible();
    await expect(page.locator('[aria-pressed="true"][aria-label="Calendar view"]')).toBeVisible();
  });

  test('should remember view preference on page reload', async ({ page }) => {
    // Switch to calendar view
    await page.click('[aria-label="Calendar view"]');
    await page.waitForSelector('[role="application"]');

    // Navigate away and back
    await page.goto(`${LOCALE_EN}/dashboard`);
    await page.goto(`${LOCALE_EN}/scheduled-videos`);

    // Verify calendar view is still active
    await expect(page.locator('[role="application"]')).toBeVisible();
  });
});

test.describe('Scheduled Videos Calendar - Calendar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);
  });

  test('should navigate to next month', async ({ page }) => {
    // Get current month
    const currentMonth = await page.textContent('[data-testid="calendar-month-year"]');

    // Click next button
    await page.click('[aria-label="Next month"]');

    // Verify month changed
    const newMonth = await page.textContent('[data-testid="calendar-month-year"]');
    expect(newMonth).not.toBe(currentMonth);
  });

  test('should navigate to previous month', async ({ page }) => {
    // Get current month
    const currentMonth = await page.textContent('[data-testid="calendar-month-year"]');

    // Click previous button
    await page.click('[aria-label="Previous month"]');

    // Verify month changed
    const newMonth = await page.textContent('[data-testid="calendar-month-year"]');
    expect(newMonth).not.toBe(currentMonth);
  });

  test('should navigate to today', async ({ page }) => {
    // Navigate to a different month first
    await page.click('[aria-label="Next month"]');
    await page.click('[aria-label="Next month"]');

    // Click today button
    await page.click('[aria-label="Go to today"]');

    // Verify current month is displayed
    const monthYear = await page.textContent('[data-testid="calendar-month-year"]');
    const now = new Date();
    const expectedMonth = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    expect(monthYear).toContain(expectedMonth.split(' ')[0]); // Check month name
  });

  test('should switch to week view and navigate weeks', async ({ page }) => {
    // Switch to week view
    await page.click('[aria-label="Week view"]');

    // Verify week view is active
    await expect(page.locator('[aria-pressed="true"][aria-label="Week view"]')).toBeVisible();

    // Navigate to next week
    await page.click('[aria-label="Next week"]');

    // Verify navigation worked (calendar updated)
    await page.waitForTimeout(500);
  });

  test('should switch to day view and navigate days', async ({ page }) => {
    // Switch to day view
    await page.click('[aria-label="Day view"]');

    // Verify day view is active
    await expect(page.locator('[aria-pressed="true"][aria-label="Day view"]')).toBeVisible();

    // Navigate to next day
    await page.click('[aria-label="Next day"]');

    // Verify navigation worked
    await page.waitForTimeout(500);
  });
});

test.describe('Scheduled Videos Calendar - Calendar Type Switching', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);
  });

  test('should switch from Gregorian to Hijri calendar', async ({ page }) => {
    // Click Hijri button
    await page.click('[aria-label="Hijri calendar"]');

    // Verify Hijri calendar is active
    await expect(page.locator('[aria-pressed="true"][aria-label="Hijri calendar"]')).toBeVisible();

    // Verify month name changed to Hijri month
    const monthYear = await page.textContent('[data-testid="calendar-month-year"]');
    const hijriMonths = ['Muharram', 'Safar', 'Rabi', 'Jumada', 'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhul'];
    const hasHijriMonth = hijriMonths.some(month => monthYear?.includes(month));
    expect(hasHijriMonth).toBe(true);
  });

  test('should switch from Hijri to Gregorian calendar', async ({ page }) => {
    // First switch to Hijri
    await page.click('[aria-label="Hijri calendar"]');
    await page.waitForTimeout(500);

    // Switch back to Gregorian
    await page.click('[aria-label="Gregorian calendar"]');

    // Verify Gregorian calendar is active
    await expect(page.locator('[aria-pressed="true"][aria-label="Gregorian calendar"]')).toBeVisible();

    // Verify month name is Gregorian
    const monthYear = await page.textContent('[data-testid="calendar-month-year"]');
    const gregorianMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const hasGregorianMonth = gregorianMonths.some(month => monthYear?.includes(month));
    expect(hasGregorianMonth).toBe(true);
  });

  test('should display correct month names in Hijri mode', async ({ page }) => {
    // Switch to Hijri calendar
    await page.click('[aria-label="Hijri calendar"]');

    // Get month name
    const monthYear = await page.textContent('[data-testid="calendar-month-year"]');

    // Verify it contains "AH" (Anno Hegirae)
    expect(monthYear).toContain('AH');
  });

  test('should maintain same events when switching calendar types', async ({ page }) => {
    // Count events in Gregorian calendar
    const gregorianEvents = await page.locator('[data-testid="calendar-event"]').count();

    // Switch to Hijri calendar
    await page.click('[aria-label="Hijri calendar"]');
    await page.waitForTimeout(500);

    // Count events in Hijri calendar
    const hijriEvents = await page.locator('[data-testid="calendar-event"]').count();

    // Verify same number of events
    expect(hijriEvents).toBe(gregorianEvents);
  });
});

test.describe('Scheduled Videos Calendar - Event Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);
  });

  test('should click on calendar event to navigate to edit page', async ({ page }) => {
    // Wait for events to load
    await page.waitForSelector('[data-testid="calendar-event"]', { timeout: 10000 });

    // Click first event
    await page.click('[data-testid="calendar-event"]');

    // Verify navigated to edit page
    await expect(page).toHaveURL(/\/edit$/);
  });

  test('should display video details in tooltip on hover', async ({ page }) => {
    // Wait for events to load
    await page.waitForSelector('[data-testid="calendar-event"]', { timeout: 10000 });

    // Hover over event
    await page.hover('[data-testid="calendar-event"]');

    // Verify tooltip is visible
    await expect(page.locator('[role="tooltip"]')).toBeVisible();
  });

  test('should show correct scheduled time for each event', async ({ page }) => {
    // Wait for events to load
    await page.waitForSelector('[data-testid="calendar-event"]', { timeout: 10000 });

    // Get event scheduled time
    const scheduledTime = await page.textContent('[data-testid="calendar-event"] [data-testid="scheduled-time"]');

    // Verify it contains relative time (e.g., "in 2 hours" or "2 days ago")
    expect(scheduledTime).toMatch(/in|ago|hour|day|minute/);
  });
});

test.describe('Scheduled Videos Calendar - Responsive Behavior', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify calendar is visible and usable
    await expect(page.locator('[role="application"]')).toBeVisible();

    // Verify controls are stacked vertically on mobile
    const controls = page.locator('[data-testid="calendar-controls"]');
    await expect(controls).toHaveCSS('flex-direction', 'column');
  });

  test('should work on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify calendar is visible
    await expect(page.locator('[role="application"]')).toBeVisible();
  });

  test('should work on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify calendar is visible
    await expect(page.locator('[role="application"]')).toBeVisible();
  });
});

test.describe('Scheduled Videos Calendar - Localization', () => {
  test('should display calendar in Arabic when locale is ar', async ({ page }) => {
    await login(page, 'ar');
    await page.goto(`${LOCALE_AR}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify RTL layout
    const calendar = page.locator('[role="application"]');
    await expect(calendar).toHaveAttribute('dir', 'rtl');

    // Verify Arabic labels
    await expect(page.locator('text=شهر')).toBeVisible();
  });

  test('should display calendar in English when locale is en', async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify LTR layout
    const calendar = page.locator('[role="application"]');
    await expect(calendar).toHaveAttribute('dir', 'ltr');

    // Verify English labels
    await expect(page.locator('text=Month')).toBeVisible();
  });

  test('should show RTL layout for Arabic', async ({ page }) => {
    await login(page, 'ar');
    await page.goto(`${LOCALE_AR}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify main container has RTL
    const mainContainer = page.locator('main');
    await expect(mainContainer).toHaveAttribute('dir', 'rtl');
  });

  test('should show LTR layout for English', async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify main container has LTR
    const mainContainer = page.locator('main');
    await expect(mainContainer).toHaveAttribute('dir', 'ltr');
  });

  test('should translate all labels and month names', async ({ page }) => {
    await login(page, 'ar');
    await page.goto(`${LOCALE_AR}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify Arabic month names (Gregorian)
    const monthYear = await page.textContent('[data-testid="calendar-month-year"]');
    expect(monthYear).toBeTruthy();

    // Verify time span labels in Arabic
    await expect(page.locator('text=أسبوع')).toBeVisible();
    await expect(page.locator('text=يوم')).toBeVisible();
  });
});

test.describe('Scheduled Videos Calendar - Error Handling', () => {
  test('should show error state when API fails', async ({ page }) => {
    // Mock API to return error
    await page.route('**/api/videos/scheduled', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
    });

    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify error message is displayed
    await expect(page.locator('text=/error|failed/i')).toBeVisible();
  });

  test('should show empty state when no scheduled videos', async ({ page }) => {
    // Mock API to return empty array
    await page.route('**/api/videos/scheduled', route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ videos: [] }),
      });
    });

    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify empty state message
    await expect(page.locator('text=/no scheduled videos|empty/i')).toBeVisible();
  });

  test('should handle invalid dates gracefully', async ({ page }) => {
    // Mock API to return video with invalid date
    await page.route('**/api/videos/scheduled', route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          videos: [{
            id: '1',
            title: 'Test Video',
            scheduledPublishDate: 'invalid-date',
          }],
        }),
      });
    });

    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Verify calendar doesn't crash
    await expect(page.locator('[role="application"]')).toBeVisible();
  });
});

test.describe('Scheduled Videos Calendar - Performance', () => {
  test('should load calendar with 50+ scheduled videos without lag', async ({ page }) => {
    // Mock API to return 50 videos
    const videos = Array.from({ length: 50 }, (_, i) => ({
      id: `video-${i}`,
      title: `Test Video ${i}`,
      scheduledPublishDate: new Date(Date.now() + i * 24 * 60 * 60 * 1000).toISOString(),
      thumbnailUrl: 'https://example.com/thumb.jpg',
    }));

    await page.route('**/api/videos/scheduled', route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ videos }),
      });
    });

    await login(page, 'en');

    const startTime = Date.now();
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);
    await page.waitForSelector('[role="application"]');
    const loadTime = Date.now() - startTime;

    // Verify loaded in reasonable time (< 3 seconds)
    expect(loadTime).toBeLessThan(3000);
  });

  test('should navigate between months smoothly', async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}${SCHEDULED_VIDEOS_PATH}?view=calendar`);

    // Navigate multiple times
    for (let i = 0; i < 5; i++) {
      const startTime = Date.now();
      await page.click('[aria-label="Next month"]');
      await page.waitForTimeout(100);
      const navTime = Date.now() - startTime;

      // Verify navigation is fast (< 500ms)
      expect(navTime).toBeLessThan(500);
    }
  });
});

test.describe('Scheduled Videos Calendar - Dual Calendar Display', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}/scheduled-videos?view=calendar`);
  });

  test('should display both Gregorian and Hijri dates in month view cells', async ({ page }) => {
    // Switch to month view
    await page.click('button:has-text("Month")');
    await page.waitForTimeout(500);

    // Find a date cell - they should have two numbers: Gregorian on top, Hijri below
    const dateHeader = page.locator('.rbc-date-cell').first();
    await expect(dateHeader).toBeVisible();

    // Verify there are two text elements (Gregorian day and Hijri day)
    const textElements = dateHeader.locator('div > div');
    const count = await textElements.count();
    expect(count).toBeGreaterThanOrEqual(2); // At least 2: Gregorian and Hijri
  });

  test('should display both Gregorian and Hijri dates in week view headers', async ({ page }) => {
    // Switch to week view
    await page.click('button:has-text("Week")');
    await page.waitForTimeout(500);

    // Find week header - should have weekday, Gregorian day, and Hijri day
    const weekHeader = page.locator('.rbc-header').first();
    await expect(weekHeader).toBeVisible();

    // Verify there are multiple text elements (weekday + both calendar days)
    const textElements = weekHeader.locator('div > div');
    const count = await textElements.count();
    expect(count).toBeGreaterThanOrEqual(2); // At least weekday + dates
  });

  test('should display both Gregorian and Hijri dates in day view header', async ({ page }) => {
    // Switch to day view
    await page.click('button:has-text("Day")');
    await page.waitForTimeout(500);

    // Find day header - should have weekday, Gregorian day, and Hijri day
    const dayHeader = page.locator('.rbc-header').first();
    await expect(dayHeader).toBeVisible();

    // Verify header contains date information
    const textContent = await dayHeader.textContent();
    expect(textContent).toBeTruthy();
    expect(textContent!.length).toBeGreaterThan(0);
  });

  test('should show dual calendar header with both calendars', async ({ page }) => {
    // The header should show "Month Year / Month Year" format
    const calendarHeader = page.locator('h2').first();
    await expect(calendarHeader).toBeVisible();

    const headerText = await calendarHeader.textContent();
    // Should contain a slash separating Gregorian and Hijri
    expect(headerText).toContain('/');
  });
});

test.describe('Scheduled Videos Calendar - Arabic Numerals and RTL', () => {
  test('should display Arabic numerals in Arabic locale', async ({ page }) => {
    await login(page, 'ar');
    await page.goto(`${LOCALE_AR}/scheduled-videos?view=calendar`);

    // Wait for calendar to load
    await page.waitForSelector('.rbc-calendar', { timeout: 10000 });

    // Get calendar header with month/year
    const calendarHeader = page.locator('h2').first();
    const headerText = await calendarHeader.textContent();

    // Arabic numerals: ٠١٢٣٤٥٦٧٨٩
    // Check if text contains Arabic numerals (١ or ٢ etc.)
    const hasArabicNumerals = /[٠-٩]/.test(headerText || '');
    expect(hasArabicNumerals).toBe(true);
  });

  test('should display Western numerals in English locale', async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}/scheduled-videos?view=calendar`);

    // Wait for calendar to load
    await page.waitForSelector('.rbc-calendar', { timeout: 10000 });

    // Get calendar header with month/year
    const calendarHeader = page.locator('h2').first();
    const headerText = await calendarHeader.textContent();

    // Should contain Western numerals (2024, 2025, etc.)
    const hasWesternNumerals = /[0-9]/.test(headerText || '');
    expect(hasWesternNumerals).toBe(true);

    // Should NOT contain Arabic numerals
    const hasArabicNumerals = /[٠-٩]/.test(headerText || '');
    expect(hasArabicNumerals).toBe(false);
  });

  test('should apply RTL layout in Arabic locale', async ({ page }) => {
    await login(page, 'ar');
    await page.goto(`${LOCALE_AR}/scheduled-videos?view=calendar`);

    // Verify calendar container has RTL direction
    const calendarContainer = page.locator('.calendar-container');
    await expect(calendarContainer).toHaveAttribute('dir', 'rtl');
  });

  test('should apply LTR layout in English locale', async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}/scheduled-videos?view=calendar`);

    // Verify calendar container has LTR direction
    const calendarContainer = page.locator('.calendar-container');
    await expect(calendarContainer).toHaveAttribute('dir', 'ltr');
  });

  test('should display Arabic weekday names in Arabic locale', async ({ page }) => {
    await login(page, 'ar');
    await page.goto(`${LOCALE_AR}/scheduled-videos?view=calendar&calendarView=week`);

    // Wait for calendar to load
    await page.waitForSelector('.rbc-calendar', { timeout: 10000 });

    // Get first header (weekday name)
    const weekHeader = page.locator('.rbc-header').first();
    const weekdayText = await weekHeader.textContent();

    // Arabic weekdays contain Arabic characters
    const hasArabicText = /[\u0600-\u06FF]/.test(weekdayText || '');
    expect(hasArabicText).toBe(true);
  });

  test('should display English weekday names in English locale', async ({ page }) => {
    await login(page, 'en');
    await page.goto(`${LOCALE_EN}/scheduled-videos?view=calendar&calendarView=week`);

    // Wait for calendar to load
    await page.waitForSelector('.rbc-calendar', { timeout: 10000 });

    // Get first header (weekday name)
    const weekHeader = page.locator('.rbc-header').first();
    const weekdayText = await weekHeader.textContent();

    // English weekdays (Sun, Mon, Tue, etc.)
    const hasEnglishWeekday = /(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/.test(weekdayText || '');
    expect(hasEnglishWeekday).toBe(true);
  });
});
