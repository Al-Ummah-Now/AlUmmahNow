import { test, expect } from './support/fixtures';
import { getStats } from './support/api';
import { storageStatePath } from './support/env';

async function statValue(page: import('@playwright/test').Page, key: string) {
  return Number(await page.getByTestId(`stat-${key}`).locator('dd').getAttribute('data-value'));
}

test.describe('dashboard', () => {
  test('DASH-01 shows report statistics that match admin-api', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: 'Admin Dashboard' })).toBeVisible();
    for (const [key, label] of [
      ['total', 'Total Reports'],
      ['pending', 'Pending'],
      ['resolved', 'Resolved'],
      ['dismissed', 'Dismissed'],
      ['last24h', 'Last 24 Hours'],
    ]) {
      await expect(page.getByTestId(`stat-${key}`).locator('dt')).toHaveText(label);
    }

    const ui = {
      total: await statValue(page, 'total'),
      pending: await statValue(page, 'pending'),
      resolved: await statValue(page, 'resolved'),
      dismissed: await statValue(page, 'dismissed'),
    };
    // Other workers and concurrent CI jobs file reports while this runs (each
    // job's setup files 21 at once), and the total only grows: the page's
    // total must lie between admin-api's before the page and after it, give or
    // take what the stats cache may lag. A burst between the reads gets one
    // more try.
    let inRange = false;
    let reading = '';
    for (let attempt = 0; attempt < 2 && !inRange; attempt++) {
      const before = (await getStats()).total;
      await page.reload();
      const shown = await statValue(page, 'total');
      const after = (await getStats()).total;
      inRange = shown >= before - 25 && shown <= after + 25;
      reading = `page ${shown}, admin-api ${before} before and ${after} after`;
    }
    expect(inRange, reading).toBe(true);
    // The first render must be internally consistent
    expect(ui.pending + ui.resolved + ui.dismissed).toBeLessThanOrEqual(ui.total);
    expect(ui.pending).toBeGreaterThanOrEqual(0);
  });

  test('DASH-02 a newly filed report is counted', async ({ page, makeReport }) => {
    await page.goto('/dashboard');
    const before = await statValue(page, 'total');
    await makeReport({ label: 'dash' });
    await expect
      .poll(async () => {
        await page.reload();
        return statValue(page, 'total');
      })
      .toBeGreaterThan(before);
    await expect(page.getByText(/\d+ pending/)).toBeVisible();
  });

  test('DASH-03 cards link to the moderation, translations and indices pages', async ({ page }) => {
    await page.goto('/dashboard');
    const main = page.locator('main');
    await main.getByRole('link', { name: /Moderation Queue/ }).click();
    await expect(page).toHaveURL(/\/moderation$/);
    await page.goBack();
    await main.getByRole('link', { name: /Translation Management/ }).click();
    await expect(page).toHaveURL(/\/translations$/);
    await page.goBack();
    await main.getByRole('link', { name: /Video Indices/ }).click();
    await expect(page).toHaveURL(/\/indices$/);
  });

  test.describe('as moderator', () => {
    test.use({ storageState: storageStatePath('moderator') });

    test('DASH-04 moderators see the same dashboard', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1, name: 'Admin Dashboard' })).toBeVisible();
      await expect(page.getByTestId('stat-total')).toBeVisible();
      await expect(page.getByTestId('stats-error')).toHaveCount(0);
    });
  });
});
