/**
 * Scheduled videos page (/[locale]/scheduled-videos): list and calendar views.
 *
 * Runs as the single-channel E2E user, whose seed set includes a private video
 * scheduled ~10 days ahead (re-scheduled by the seed helper whenever it gets
 * close), so there is always a real event to find in the list and calendar.
 */

import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { AUTH_STATE } from './test-utils/auth-state';
import { SEED_TITLES, ensureSeedVideos, type E2EVideo } from './test-utils/e2e-videos';

test.use({ storageState: AUTH_STATE.single });

const HIJRI_MONTHS_EN = [
  'Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Awwal', 'Jumada al-Thani',
  'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhul-Qadah', 'Dhul-Hijjah',
];

let scheduled: E2EVideo;

test.beforeAll(async () => {
  test.setTimeout(180000);
  const seed = await ensureSeedVideos('single');
  scheduled = seed[SEED_TITLES.singleScheduled];
});

async function openPage(page: Page, query = '', locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/scheduled-videos${query}`);
  await expect(page.getByTestId('scheduled-videos-page')).toBeVisible();
}

async function openCalendar(page: Page, calendarView: 'month' | 'week' | 'day' = 'month', locale: 'en' | 'ar' = 'en') {
  await openPage(page, `?view=calendar&calendarView=${calendarView}`, locale);
  await expect(page.getByTestId('scheduled-calendar')).toHaveAttribute('data-view', calendarView);
}

const header = (page: Page) => page.getByTestId('calendar-header');

/** Moves the month view to the month containing the seed video's publish date */
async function goToScheduledMonth(page: Page) {
  const target = new Date(scheduled.scheduledPublishDate!);
  const now = new Date();
  const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  for (let i = 0; i < months; i++) {
    const before = await header(page).textContent();
    await page.getByTestId('calendar-next').click();
    await expect(header(page)).not.toHaveText(before || '');
  }
}

test.describe('Scheduled Videos Calendar - View Switching', () => {
  test('should switch from list to calendar view', async ({ page }) => {
    await openPage(page);
    await expect(page.getByTestId('view-switch-list')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('view-switch-calendar').click();
    await expect(page.getByTestId('scheduled-calendar')).toBeVisible();
    await expect(page.getByTestId('view-switch-calendar')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/view=calendar/);
  });

  test('should switch from calendar to list view', async ({ page }) => {
    await openCalendar(page);

    await page.getByTestId('view-switch-list').click();
    await expect(page.getByTestId('scheduled-calendar')).toHaveCount(0);
    await expect(page.locator(`[data-testid="scheduled-video-item"][data-video-id="${scheduled.id}"]`)).toBeVisible();
    await expect(page).toHaveURL(/view=list/);
  });

  test('should restore the view and calendar type from the URL', async ({ page }) => {
    await openCalendar(page, 'week');
    await expect(page.getByTestId('calendar-view-week')).toHaveAttribute('aria-pressed', 'true');
  });

  test('should keep the view across a reload', async ({ page }) => {
    await openPage(page);
    await page.getByTestId('view-switch-calendar').click();
    await page.getByTestId('calendar-view-day').click();
    await expect(page).toHaveURL(/calendarView=day/);

    await page.reload();
    await expect(page.getByTestId('scheduled-calendar')).toHaveAttribute('data-view', 'day');
  });
});

test.describe('Scheduled Videos Calendar - Calendar Navigation', () => {
  test('should navigate to next and previous month', async ({ page }) => {
    await openCalendar(page);
    const current = await header(page).textContent();

    await page.getByTestId('calendar-next').click();
    await expect(header(page)).not.toHaveText(current || '');
    await page.getByTestId('calendar-previous').click();
    await expect(header(page)).toHaveText(current || '');
  });

  test('should navigate back to today', async ({ page }) => {
    await openCalendar(page);
    const current = await header(page).textContent();

    await page.getByTestId('calendar-previous').click();
    await page.getByTestId('calendar-previous').click();
    await expect(header(page)).not.toHaveText(current || '');
    await page.getByTestId('calendar-today').click();
    await expect(header(page)).toHaveText(current || '');
  });

  for (const view of ['week', 'day'] as const) {
    test(`should switch to ${view} view and navigate`, async ({ page }) => {
      await openCalendar(page);
      await page.getByTestId(`calendar-view-${view}`).click();
      await expect(page.getByTestId('scheduled-calendar')).toHaveAttribute('data-view', view);
      const current = await header(page).textContent();

      await page.getByTestId('calendar-next').click();
      await expect(header(page)).not.toHaveText(current || '');
      await page.getByTestId('calendar-previous').click();
      await expect(header(page)).toHaveText(current || '');
    });
  }
});

test.describe('Scheduled Videos Calendar - Dual Calendar Display', () => {
  test('should show Gregorian and Hijri months in the header', async ({ page }) => {
    await openCalendar(page);

    const text = (await header(page).textContent()) || '';
    const [gregorian, hijri] = text.split(' / ');
    const month = new Date().toLocaleString('en-US', { month: 'long' });
    expect(gregorian).toContain(month);
    expect(HIJRI_MONTHS_EN.some((m) => hijri?.includes(m))).toBe(true);
  });

  test('should show both day numbers in month view cells', async ({ page }) => {
    await openCalendar(page);

    const cell = page.locator('.rbc-date-cell').first();
    await expect(cell).toBeVisible();
    expect((await cell.innerText()).trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
  });

  test('should show dual dates in week view headers', async ({ page }) => {
    await openCalendar(page, 'week');

    const dayHeader = page.locator('.rbc-header').first();
    await expect(dayHeader).toBeVisible();
    // weekday, Gregorian day, Hijri day
    expect((await dayHeader.innerText()).trim().split(/\s+/).length).toBeGreaterThanOrEqual(3);
  });

  test('should show a dual date header in day view', async ({ page }) => {
    await openCalendar(page, 'day');

    const text = (await header(page).textContent()) || '';
    expect(text).toContain(' / ');
    expect(text).toContain(String(new Date().getFullYear()));
  });
});

test.describe('Scheduled Videos Calendar - Event Interaction', () => {
  test('should show the scheduled video as a calendar event', async ({ page }) => {
    await openCalendar(page);
    await goToScheduledMonth(page);

    await expect(page.locator(`[data-testid="calendar-event"][data-video-id="${scheduled.id}"]`).first()).toBeVisible();
  });

  test('should open the edit page when an event is clicked', async ({ page }) => {
    await openCalendar(page);
    await goToScheduledMonth(page);

    await page.locator(`[data-testid="calendar-event"][data-video-id="${scheduled.id}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/en/video/${scheduled.id}/edit`));
  });

  test('should open the edit page from the keyboard', async ({ page }) => {
    await openCalendar(page);
    await goToScheduledMonth(page);

    const event = page.locator(`[data-testid="calendar-event"][data-video-id="${scheduled.id}"]`).first();
    await event.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/en/video/${scheduled.id}/edit`));
  });

  test('should label events with the title and status', async ({ page }) => {
    await openCalendar(page);
    await goToScheduledMonth(page);

    const event = page.locator(`[data-testid="calendar-event"][data-video-id="${scheduled.id}"]`).first();
    await expect(event).toHaveAccessibleName(new RegExp(SEED_TITLES.singleScheduled));
  });
});

test.describe('Scheduled Videos - List', () => {
  test('should list the scheduled video with its status', async ({ page }) => {
    await openPage(page);

    const item = page.locator(`[data-testid="scheduled-video-item"][data-video-id="${scheduled.id}"]`);
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('data-status', 'scheduled');
    await expect(item).toContainText(SEED_TITLES.singleScheduled);
  });

  test('should filter the list by status', async ({ page }) => {
    await openPage(page);
    const item = page.locator(`[data-testid="scheduled-video-item"][data-video-id="${scheduled.id}"]`);
    await expect(item).toBeVisible();

    await page.getByTestId('scheduled-status-filter').selectOption('scheduled');
    await expect(item).toBeVisible();

    await page.getByTestId('scheduled-status-filter').selectOption('cancelled');
    await expect(item).toHaveCount(0);
  });
});

test.describe('Scheduled Videos Calendar - Responsive Behavior', () => {
  for (const viewport of [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1920, height: 1080 },
  ]) {
    test(`should work on a ${viewport.name} viewport`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openCalendar(page);

      await expect(page.getByTestId('calendar-next')).toBeVisible();
      const box = await page.getByTestId('scheduled-calendar').boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(viewport.width);
    });
  }
});

test.describe('Scheduled Videos Calendar - Localization', () => {
  test('should render Arabic right-to-left with Arabic-Indic numerals', async ({ page }) => {
    await openCalendar(page, 'month', 'ar');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.calendar-container')).toHaveAttribute('dir', 'rtl');
    expect(/[٠-٩]/.test((await header(page).textContent()) || '')).toBe(true);
  });

  test('should show Arabic weekday names in Arabic', async ({ page }) => {
    await openCalendar(page, 'month', 'ar');

    const weekday = (await page.locator('.rbc-header').first().textContent()) || '';
    expect(/[؀-ۿ]/.test(weekday)).toBe(true);
  });

  test('should render English left-to-right with Western numerals', async ({ page }) => {
    await openCalendar(page);

    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.calendar-container')).toHaveAttribute('dir', 'ltr');
    const text = (await header(page).textContent()) || '';
    expect(/[0-9]/.test(text)).toBe(true);
    expect(/[٠-٩]/.test(text)).toBe(false);
    expect(/(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/.test((await page.locator('.rbc-header').first().textContent()) || '')).toBe(true);
  });

  test('should point the navigation arrows in the reading direction', async ({ page }) => {
    await openCalendar(page, 'month', 'ar');
    const prev = await page.getByTestId('calendar-previous').locator('svg').getAttribute('class');
    expect(prev).toContain('chevron-right');
  });
});

test.describe('Scheduled Videos - Empty and Access States', () => {
  test('should show the empty state when no video matches the filter', async ({ page }) => {
    await openPage(page);
    await expect(page.locator(`[data-testid="scheduled-video-item"][data-video-id="${scheduled.id}"]`)).toBeVisible();

    await page.getByTestId('scheduled-status-filter').selectOption('failed');
    // Only an empty state remains unless some other video failed to publish
    await expect(page.locator(`[data-testid="scheduled-video-item"][data-video-id="${scheduled.id}"]`)).toHaveCount(0);
    await expect(page.getByTestId('scheduled-videos-empty').or(page.getByTestId('scheduled-videos-list'))).toBeVisible();
  });

  test.describe('no channels', () => {
    test.use({ storageState: AUTH_STATE.none });

    test('should send a user without channels to the home page', async ({ page }) => {
      await page.goto('/en/scheduled-videos');
      await expect(page).toHaveURL(/\/en\/?$/);
    });
  });
});
