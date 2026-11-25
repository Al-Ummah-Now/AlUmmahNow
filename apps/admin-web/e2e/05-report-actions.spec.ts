import { test, expect } from './support/fixtures';
import { adminApi, getReport, waitForReport } from './support/api';
import { createReportedVideo } from './support/reported-video';
import { E2E_DESCRIPTION_TAG, storageStatePath } from './support/env';
import type { Page } from '@playwright/test';
import { openMainNav } from './support/ui';

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
    await openMainNav(page);
  });
});

/** MEASURE ONLY */
function watch(page: Page, tag: string) {
  const say = (t: string) => process.stdout.write(`ACT ${Date.now()} ${tag} ${t}\n`);
  page.on('console', (m) => { if (/RSC|Falling back|browser navigation|Failed to fetch/i.test(m.text())) say(`console ${m.type()} ${m.text().slice(0, 220)}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (r.isNavigationRequest() || r.headers()['rsc']) say(`request ${r.method()} ${u.pathname} doc=${r.isNavigationRequest()}`); });
  page.on('requestfailed', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/moderation')) say(`failed ${r.method()} ${u.pathname} doc=${r.isNavigationRequest()} ${r.failure()?.errorText}`); });
  return say;
}

test.describe('moderation actions', () => {
  test('ACT-01 probe candidate: verify in a fresh tab', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'dismiss-b' });
    await page.goto(`/moderation/reports/${report.id}`);
    const notes = `${E2E_DESCRIPTION_TAG} dismissed by UI test`;
    await takeAction(page, 'Dismiss Report', notes);
    const check = await page.context().newPage();
    await check.goto(`/moderation/reports/${report.id}`);
    await expect(check.getByTestId('status-chip')).toHaveText('Dismissed');
    await expect(check.getByTestId('moderator-notes')).toHaveText(notes);
  });
  test('ACT-01 dismiss with notes closes the report and the decision sticks', async ({ page, makeReport }) => {
    const say = watch(page, `w${test.info().repeatEachIndex}`);
    const report = await makeReport({ label: 'dismiss' });
    await page.goto(`/moderation/reports/${report.id}`);
    const notes = `${E2E_DESCRIPTION_TAG} dismissed by UI test`;
    await takeAction(page, 'Dismiss Report', notes);

    say('goto detail');
    await page.goto(`/moderation/reports/${report.id}`).catch((e: Error) => { say(`goto error ${e.message.split('\n')[0].replace(/[0-9a-f-]{36}/g, 'ID')}`); throw e; });
    await expect(page.getByTestId('status-chip')).toHaveText('Dismissed');
    await expect(page.getByTestId('moderator-notes')).toHaveText(notes);
    await expect(page.getByTestId('action-taken')).toHaveAttribute('data-action', 'dismissed');
    await expect(page.getByTestId('report-closed')).toContainText('Report Closed');
    await expect(page.getByTestId('report-actions')).toHaveCount(0);

    // The queue consumer mirrors the decision asynchronously; it used to flip
    // dismissals to "resolved" and wipe the notes a second later.
    const after = await getReport(report.id);
    expect(after?.status).toBe('dismissed');
    expect(after?.moderator_notes).toBe(notes);
  });

  test('ACT-02 a warning really marks the video and resolves the report', async ({ page, makeReport }) => {
    const video = await createReportedVideo();
    try {
      const warned = await makeReport({ label: 'warn', entityType: 'video', entityId: video.id });
      await page.goto(`/moderation/reports/${warned.id}`);
      await takeAction(page, 'Issue Warning');
      const afterWarning = await waitForReport(warned.id, (r) => r.status !== 'pending');
      expect(afterWarning.status).toBe('resolved');
      expect(afterWarning.action).toBe('warning');
      await page.goto(`/moderation/reports/${warned.id}`);
      await expect(page.getByTestId('status-chip')).toHaveText('Resolved');
      await expect(page.getByTestId('action-taken')).toHaveText('Warning');
    } finally {
      await video.remove();
    }
  });

  test('ACT-03 remove content (hide) hides the video and resolves the report with action removed', async ({ page, makeReport }) => {
    const video = await createReportedVideo();
    try {
      const report = await makeReport({ label: 'hide', entityType: 'video', entityId: video.id });
      await page.goto(`/moderation/reports/${report.id}`);
      await takeAction(page, 'Remove Content', `${E2E_DESCRIPTION_TAG} hide`);
      const after = await waitForReport(report.id, (r) => r.status !== 'pending');
      expect(after.status).toBe('resolved');
      expect(after.action).toBe('removed');
      expect((await video.read()).isHidden).toBe(true);
      await page.waitForTimeout(5_000);
      expect((await getReport(report.id))?.moderator_notes).toBe(`${E2E_DESCRIPTION_TAG} hide`);
    } finally {
      await video.remove();
    }
  });

  test('ACT-04 an item that is gone can only be dismissed, and its report stays open until then', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'gone', entityType: 'video' });
    await page.goto(`/moderation/reports/${report.id}`);
    const actions = page.getByTestId('report-actions');
    for (const action of ['warning', 'removed', 'banned', 'deleted']) {
      const option = actions.locator(`button[data-action="${action}"]`);
      await expect(option).toBeDisabled();
      await expect(option).toContainText('The item is not there any more. Dismiss the report');
      // The server refuses it too, and leaves the report as it was
      const refused = await adminApi(`/api/moderation/reports/${report.id}/action`, { method: 'POST', body: JSON.stringify({ action }) });
      expect([403, 409]).toContain(refused.status);
      expect((await getReport(report.id))?.status).toBe('pending');
    }
    await actions.locator('button[data-action="dismissed"]').click();
    await page.getByTestId('confirm-action').click();
    await expect(page).toHaveURL(/\/moderation$/, { timeout: 30_000 });
  });

  test('ACT-09 a comment report offers only what can be done to a comment, and says why', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'comment', entityType: 'comment' });
    await page.goto(`/moderation/reports/${report.id}`);
    const option = (action: string) => page.getByTestId('report-actions').locator(`button[data-action="${action}"]`);
    await expect(option('warning')).toBeDisabled();
    await expect(option('warning')).toContainText('Not available for this kind of item');
    await expect(option('removed')).toBeDisabled();
    await expect(option('removed')).toContainText('The item is not there any more');
    await expect(option('dismissed')).toBeEnabled();
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
    await page.getByTestId('report-actions').locator('button[data-action="dismissed"]').click();
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
