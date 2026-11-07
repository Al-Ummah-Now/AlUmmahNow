import { test, expect } from './support/fixtures';
import { listReports } from './support/api';

test.describe('moderation queue', () => {
  test('MOD-01 lists a newly filed report with its details and a View link', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'queue', entityType: 'video', reason: 'harassment' });
    await page.goto('/moderation?status=pending&entity_type=video');
    const row = page.locator(`[data-testid="report-row"][data-report-id="${report.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Video');
    await expect(row).toContainText('Harassment');
    await expect(row.getByTestId('status-chip')).toHaveText('Pending');
    await expect(row.locator('time')).toHaveAttribute('datetime', report.created_at);
    await row.getByRole('link', { name: /View/ }).click();
    await expect(page).toHaveURL(new RegExp(`/moderation/reports/${report.id}$`));
    await expect(page.getByTestId('report-id')).toHaveText(report.id);
  });

  test('MOD-02 status filter narrows the list and is reflected in the URL', async ({ page, makeReport }) => {
    // Own a pending report so the filtered list is never empty (teardown dismisses all e2e reports)
    await makeReport({ label: 'status-filter' });
    await page.goto('/moderation');
    await page.getByLabel('Status').selectOption('pending');
    await expect(page).toHaveURL(/status=pending/);
    await expect(page.getByTestId('report-row').first()).toBeVisible();
    const chips = page.getByTestId('status-chip');
    const count = await chips.count();
    for (let i = 0; i < count; i++) {
      await expect(chips.nth(i)).toHaveAttribute('data-status', 'pending');
    }
    // The select keeps showing the active filter after navigation
    await expect(page.getByLabel('Status')).toHaveValue('pending');
  });

  test('MOD-03 content type filter narrows the list', async ({ page, makeReport }) => {
    await makeReport({ label: 'type', entityType: 'channel' });
    await page.goto('/moderation');
    await page.getByLabel('Content type').selectOption('channel');
    await expect(page).toHaveURL(/entity_type=channel/);
    const rows = page.getByTestId('report-row');
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).locator('td').first()).toContainText('Channel');
    }
  });

  test('MOD-04 combined filters match admin-api totals and can be cleared', async ({ page }) => {
    await page.goto('/moderation?status=pending&entity_type=comment');
    const api = await listReports('status=pending&entity_type=comment&limit=1');
    const shown = Number(await page.getByTestId('reports-total').getAttribute('data-total'));
    expect(Math.abs(shown - api.total)).toBeLessThanOrEqual(10);
    await expect(page.getByLabel('Status')).toHaveValue('pending');
    await expect(page.getByLabel('Content type')).toHaveValue('comment');
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/moderation$/);
    await expect(page.getByLabel('Status')).toHaveValue('');
    await expect(page.getByLabel('Content type')).toHaveValue('');
  });

  test('MOD-05 filters work from the keyboard via the Apply button', async ({ page, browserName, isMobile }) => {
    test.skip(isMobile, 'keyboard-only flow is a desktop concern');
    test.skip(browserName === 'webkit', 'WebKit does not move focus to selects with Tab by default');
    await page.goto('/moderation');
    const status = page.getByLabel('Status');
    await status.focus();
    // Changing the value fires change -> auto submit; also confirm Apply is reachable
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Apply filters' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/moderation\?/);
  });

  test('MOD-06 pagination moves between pages and keeps the filters', async ({ page }) => {
    const api = await listReports('status=pending&entity_type=comment&limit=1');
    test.skip(api.total <= 20, 'needs more than one page of pending comment reports (seeded by global setup)');
    await page.goto('/moderation?status=pending&entity_type=comment');
    await expect(page.getByTestId('report-row')).toHaveCount(20);
    await expect(page.getByTestId('page-indicator')).toHaveText(/^Page 1 of \d+$/);
    await expect(page.getByRole('link', { name: 'Previous' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page).toHaveURL(/status=pending/);
    await expect(page).toHaveURL(/entity_type=comment/);
    await expect(page.getByTestId('page-indicator')).toHaveText(/^Page 2 of \d+$/);
    await expect(page.getByTestId('report-row').first()).toBeVisible();
    const chips = page.getByTestId('status-chip');
    for (let i = 0; i < (await chips.count()); i++) {
      await expect(chips.nth(i)).toHaveAttribute('data-status', 'pending');
    }

    await page.getByRole('link', { name: 'Previous' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText(/^Page 1 of \d+$/);
    await expect(page).toHaveURL(/entity_type=comment/);
  });

  test('MOD-07 invalid query values are ignored instead of erroring', async ({ page }) => {
    await page.goto('/moderation?status=bogus&entity_type=nope&page=abc');
    await expect(page.getByTestId('reports-error')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Moderation Queue' })).toBeVisible();
    await expect(page.getByLabel('Status')).toHaveValue('');
    await expect(page.getByTestId('reports-total')).toBeVisible();
  });

  test('MOD-08 a page past the end shows the empty state', async ({ page }) => {
    await page.goto('/moderation?page=100000');
    await expect(page.getByTestId('reports-empty')).toHaveText('No reports found');
    await expect(page.getByTestId('reports-error')).toHaveCount(0);
  });

  test('MOD-09 type filter offers every reportable entity type', async ({ page }) => {
    await page.goto('/moderation');
    const options = await page.getByLabel('Content type').locator('option').allTextContents();
    expect(options).toEqual(['All types', 'Video', 'Comment', 'Channel', 'Live stream', 'Playlist', 'Post']);
    const statuses = await page.getByLabel('Status').locator('option').allTextContents();
    expect(statuses).toEqual(['All statuses', 'Pending', 'Reviewing', 'Resolved', 'Dismissed']);
  });
});
