import { test, expect } from './support/fixtures';
import { adminApi, getReport, waitForReport } from './support/api';
import { E2E_DESCRIPTION_TAG, storageStatePath } from './support/env';
import type { Page } from '@playwright/test';

const ACTION_VALUES: Record<string, string> = {
  'Issue Warning': 'warning',
  'Remove Content': 'removed',
  'Ban Content': 'banned',
  'Dismiss Report': 'dismissed',
};

async function takeAction(page: Page, label: string, notes?: string) {
  const actions = page.getByTestId('report-actions');
  const confirm = page.getByTestId('confirm-action');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText('Select an action');
  const option = actions.locator(`button[data-action="${ACTION_VALUES[label]}"]`);
  await expect(option).toContainText(label);
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  if (notes) await page.getByLabel('Notes (optional)').fill(notes);
  await expect(confirm).toHaveText(`Confirm: ${label}`);
  await confirm.click();
  await expect(page).toHaveURL(/\/moderation$/, { timeout: 30_000 });
}

test.describe('report detail', () => {
  test('RPT-01 shows every report field', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'detail', entityType: 'comment', reason: 'misinformation' });
    await page.goto(`/moderation/reports/${report.id}`);
    const details = page.getByTestId('report-details');
    await expect(details.getByRole('heading', { name: 'Report Details' })).toBeVisible();
    await expect(details.getByTestId('status-chip')).toHaveText('Pending');
    await expect(page.getByTestId('report-id')).toHaveText(report.id);
    await expect(details).toContainText(report.entity_id);
    await expect(details).toContainText('Comment');
    await expect(details).toContainText('Misinformation');
    await expect(details).toContainText(report.reporter_id);
    await expect(page.getByTestId('report-actions')).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to Queue/ })).toHaveAttribute('href', '/moderation');
  });

  test('RPT-02 the reporter description reaches the moderator', async ({ makeReport, page }) => {
    const description = `${E2E_DESCRIPTION_TAG} description round trip ${Date.now()}`;
    const report = await makeReport({ label: 'desc', description });
    expect(report.description, 'api-videos must forward the description to D1').toBe(description);
    await page.goto(`/moderation/reports/${report.id}`);
    await expect(page.getByTestId('report-description')).toHaveText(description);
  });

  test('RPT-03 unknown report ids render the report not-found page', async ({ page }) => {
    const response = await page.goto('/moderation/reports/00000000-0000-0000-0000-000000000000');
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('report-not-found')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Report not found' })).toBeVisible();
    // Still inside the admin shell
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });
});

test.describe('moderation actions', () => {
  test('ACT-01 dismiss with notes closes the report and the decision sticks', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'dismiss' });
    await page.goto(`/moderation/reports/${report.id}`);
    const notes = `${E2E_DESCRIPTION_TAG} dismissed by UI test`;
    await takeAction(page, 'Dismiss Report', notes);

    await page.goto(`/moderation/reports/${report.id}`);
    await expect(page.getByTestId('status-chip')).toHaveText('Dismissed');
    await expect(page.getByTestId('moderator-notes')).toHaveText(notes);
    await expect(page.getByTestId('action-taken')).toHaveAttribute('data-action', 'dismissed');
    await expect(page.getByTestId('report-closed')).toContainText('Report Closed');
    await expect(page.getByTestId('report-actions')).toHaveCount(0);

    // The queue consumer mirrors the decision asynchronously; it used to flip
    // dismissals to "resolved" and wipe the notes a second later.
    await page.waitForTimeout(8_000);
    const after = await getReport(report.id);
    expect(after?.status).toBe('dismissed');
    expect(after?.moderator_notes).toBe(notes);
  });

  test('ACT-02 issuing a warning resolves the report', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'warn', entityType: 'video' });
    await page.goto(`/moderation/reports/${report.id}`);
    await takeAction(page, 'Issue Warning');
    const after = await waitForReport(report.id, (r) => r.status !== 'pending');
    expect(after.status).toBe('resolved');
    expect(after.action).toBe('warning');
    await page.goto(`/moderation/reports/${report.id}`);
    await expect(page.getByTestId('status-chip')).toHaveText('Resolved');
    await expect(page.getByTestId('action-taken')).toHaveText('Warning');
  });

  test('ACT-03 remove content (hide) resolves the report with action removed', async ({ page, makeReport }) => {
    // Fabricated entity id: the hide is attempted but no real content is touched
    const report = await makeReport({ label: 'hide', entityType: 'video' });
    await page.goto(`/moderation/reports/${report.id}`);
    await takeAction(page, 'Remove Content', `${E2E_DESCRIPTION_TAG} hide`);
    const after = await waitForReport(report.id, (r) => r.status !== 'pending');
    expect(after.status).toBe('resolved');
    expect(after.action).toBe('removed');
    await page.waitForTimeout(5_000);
    expect((await getReport(report.id))?.moderator_notes).toBe(`${E2E_DESCRIPTION_TAG} hide`);
  });

  test('ACT-04 ban content resolves the report with action banned', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'ban', entityType: 'channel' });
    await page.goto(`/moderation/reports/${report.id}`);
    await takeAction(page, 'Ban Content');
    const after = await waitForReport(report.id, (r) => r.status !== 'pending');
    expect(after.status).toBe('resolved');
    expect(after.action).toBe('banned');
  });

  test('ACT-05 a closed report cannot be actioned again', async ({ makeReport }) => {
    const report = await makeReport({ label: 'twice' });
    const first = await adminApi(`/api/moderation/reports/${report.id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: 'dismissed', notes: 'first decision' }),
    });
    expect(first.status).toBe(200);
    const second = await adminApi(`/api/moderation/reports/${report.id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: 'banned' }),
    });
    expect(second.status).toBe(409);
    const after = await getReport(report.id);
    expect(after?.action).toBe('dismissed');
    expect(after?.moderator_notes).toBe('first decision');
  });

  test('ACT-06 acting on a report closed in another tab shows an error', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'race' });
    await page.goto(`/moderation/reports/${report.id}`);
    // Someone else closes it while this page is open
    await adminApi(`/api/moderation/reports/${report.id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: 'dismissed' }),
    });
    await page.getByTestId('report-actions').locator('button[data-action="banned"]').click();
    await page.getByTestId('confirm-action').click();
    await expect(page.getByTestId('action-error')).toHaveText('This report has already been closed by another moderator.');
    await expect(page).toHaveURL(new RegExp(`/moderation/reports/${report.id}$`));
  });

  test('ACT-07 a failed action request keeps the page usable', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'fail' });
    await page.goto(`/moderation/reports/${report.id}`);
    await page.route(`**/moderation/reports/${report.id}`, (route) =>
      route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
    );
    await page.getByTestId('report-actions').locator('button[data-action="dismissed"]').click();
    await page.getByTestId('confirm-action').click();
    await expect(page.getByTestId('action-error')).toHaveText('Failed to take action');
    await expect(page.getByTestId('confirm-action')).toBeEnabled();
    expect((await getReport(report.id))?.status).toBe('pending');
  });

  test.describe('as moderator', () => {
    test.use({ storageState: storageStatePath('moderator') });

    test('ACT-08 moderators can dismiss reports', async ({ page, makeReport }) => {
      const report = await makeReport({ label: 'mod' });
      await page.goto(`/moderation/reports/${report.id}`);
      await takeAction(page, 'Dismiss Report', `${E2E_DESCRIPTION_TAG} moderator`);
      const after = await waitForReport(report.id, (r) => r.status !== 'pending');
      expect(after.status).toBe('dismissed');
    });
  });
});
