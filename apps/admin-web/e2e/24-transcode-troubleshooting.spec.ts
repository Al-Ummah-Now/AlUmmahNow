/**
 * Transcode troubleshooting on Delivery (owner 2026-11-15: "why the logs are not on admin to
 * troubleshoot?"), on the local stack:
 * - no Cloudflare token: the panel says so in plain words, the run's own queued job still shows with
 *   its reason in words, log lines say they need the token, and nothing fails;
 * - a super admin sets a token (the stack's fake Cloudflare API, fake-external.ts): the test lists
 *   every permission, the containers and queues show, and the log lines of the run's video load
 *   (the transcoder start crash of the incident), filtered by its id;
 * - removing the token asks in the in-app dialog and the panel goes back to "not set".
 * axe (WCAG 2.2 AA) on the token-set state in en and ar; the no-token state is in 10-accessibility.
 *
 * The token is one global setting, so the spec runs in the shared-state project and removes it
 * afterwards. Its media_jobs row is its own (a run-tagged video id) and deleted afterwards.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { stackSql } from './support/local-stack';
import { setPreferences } from './support/ui';
import { ADMIN_WEB_URL, LOCAL_STACK, RUN_TAG, STACK_CONTROL_URL, storageStatePath } from './support/env';

const SEARCH_D1 = 'al-ummah-now-search';
/** A video id of this run only (letters, digits, dashes; the leftover check finds the run tag) */
const VIDEO = `e2e-${RUN_TAG.replace(/[^A-Za-z0-9-]/g, '-')}-transcode`.slice(0, 64);
const TOKEN = `e2e-fake-cloudflare-token-${RUN_TAG.replace(/[^A-Za-z0-9-]/g, '')}-abcd`;
const superToken = () => readTokens().superadmin;

async function removeToken() {
  const { status } = await adminApi('/api/media/troubleshoot/token', { method: 'DELETE', token: superToken() });
  expect([200, 404], 'DELETE the troubleshoot token').toContain(status);
}

async function fakeCloudflare(method: 'PUT' | 'DELETE', logVideo?: string) {
  const res = await fetch(`${STACK_CONTROL_URL}/__fake/cloudflare`, { method, headers: { 'content-type': 'application/json' }, body: logVideo ? JSON.stringify({ logVideo }) : undefined });
  expect(res.ok, `fake Cloudflare ${method}`).toBe(true);
}

async function expectAxeClean(page: import('@playwright/test').Page, context: string) {
  const results = await new AxeBuilder({ page }).include('#transcode-troubleshooting').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `axe ${context}`).toEqual([]);
}

test.use({ storageState: storageStatePath('superadmin'), contextOptions: { reducedMotion: 'reduce' } });

test.describe('transcode troubleshooting', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!LOCAL_STACK || !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(ADMIN_WEB_URL), 'local stack only: the token is a global setting and the Cloudflare API is the stack fake');
    await removeToken();
    await fakeCloudflare('PUT', VIDEO);
    const queued = new Date(Date.now() - 40 * 60_000).toISOString();
    await stackSql(
      SEARCH_D1,
      `INSERT OR REPLACE INTO media_jobs (video_id, job_id, status, access, attempts, queued_at, error, updated_at)
       VALUES ('${VIDEO}', '${VIDEO}-job', 'queued', 'pub', 3, '${queued}', 'container start failed', '${queued}')`,
    );
  });

  test.afterAll(async () => {
    if (!LOCAL_STACK) return;
    await removeToken();
    await fakeCloudflare('DELETE');
    await stackSql(SEARCH_D1, `DELETE FROM media_jobs WHERE video_id = '${VIDEO}'`);
  });

  test('without a token the panel says so and still shows the job', async ({ page }) => {
    await setPreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto(`/delivery?video=${VIDEO}`);
    const panel = page.getByTestId('transcode-troubleshooting');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId('troubleshoot-status-note')).toHaveAttribute('data-note', 'transcodeTroubleshoot.noToken');
    await expect(panel.getByTestId('troubleshoot-status-note')).toContainText('No Cloudflare token is set');

    const row = panel.locator(`[data-testid="troubleshoot-job"][data-video-id="${VIDEO}"]`);
    await expect(row).toBeVisible();
    await expect(panel.getByTestId('troubleshoot-job').first(), 'the ?video= job comes first').toHaveAttribute('data-video-id', VIDEO);
    await expect(row.getByTestId('troubleshoot-job-state')).toHaveText('Queued');
    await expect(row.getByTestId('troubleshoot-job-reason')).toHaveAttribute('data-reason', 'container_start_failed');
    await expect(row.getByTestId('troubleshoot-job-reason')).toContainText('The container could not start');
    await expect(row.getByTestId('troubleshoot-retry-now')).toBeVisible();
    await expect(row.getByTestId('troubleshoot-cancel')).toBeVisible();

    await expect(panel.getByTestId('troubleshoot-logs-need-token')).toBeVisible();
    await expect(panel.getByTestId('troubleshoot-logs-filter'), '?video= fills the logs filter').toHaveValue(VIDEO);
    await expect(panel.getByTestId('troubleshoot-logs-load')).toBeDisabled();
    await expect(panel.getByTestId('troubleshoot-token-state')).toHaveText('Not set.');
  });

  test('a super admin sets a token; containers, queues and the job logs show', async ({ page }) => {
    await setPreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto(`/delivery?video=${VIDEO}`);
    const panel = page.getByTestId('transcode-troubleshooting');
    await expect(panel).toBeVisible({ timeout: 30_000 });

    await panel.getByTestId('troubleshoot-token-input').fill(TOKEN);
    await panel.getByTestId('troubleshoot-token-save').click();
    await expect(panel.getByTestId('troubleshoot-token-notice')).toHaveText('Token saved and tested.');
    await expect(panel.getByTestId('troubleshoot-token-state')).toHaveText('Set, ending in abcd.');
    for (const check of ['observability', 'containers', 'queues', 'analytics']) {
      await expect(panel.locator(`[data-check="${check}"]`)).toHaveAttribute('data-ok', 'true');
    }
    await expect(panel.getByTestId('troubleshoot-token-input'), 'the token is never shown again').toHaveValue('');
    expect(await page.content(), 'the token is not in the page').not.toContain(TOKEN);

    await expect(panel.getByTestId('troubleshoot-status-note')).toHaveCount(0);
    await expect(panel.getByTestId('troubleshoot-in-use')).toHaveText('1 of 2');
    await expect(panel.getByTestId('troubleshoot-queue')).toHaveText('2 messages');
    await expect(panel.getByTestId('troubleshoot-dlq')).toHaveText('0 messages');

    await panel.locator(`[data-testid="troubleshoot-job"][data-video-id="${VIDEO}"]`).getByTestId('troubleshoot-job-logs').click();
    const lines = panel.getByTestId('troubleshoot-log-lines');
    await expect(lines).toBeVisible();
    await expect(lines.locator('li[data-source="container"]')).toContainText('ERR_MODULE_NOT_FOUND');
    await expect(lines.locator('li[data-source="worker"]')).toContainText('transcode start failed');
    await expectAxeClean(page, 'token set, logs open, en/dark');

    // Only an id reaches the server
    await panel.getByTestId('troubleshoot-logs-filter').fill('$workers.scriptName');
    await expect(panel.getByTestId('troubleshoot-logs-load')).toBeDisabled();
    const refused = await adminApi(`/api/media/troubleshoot/logs?q=${encodeURIComponent('$workers.scriptName')}`, { token: superToken() });
    expect(refused.status, 'a raw filter is refused server-side').toBe(400);

    await setPreferences(page, { locale: 'ar', theme: 'dark' });
    await page.goto(`/delivery?video=${VIDEO}`);
    await expect(page.getByTestId('troubleshoot-token-state')).toHaveText('مضبوط، وينتهي بـ abcd.');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAxeClean(page, 'token set, ar/dark');
  });

  test('removing the token asks first and the panel goes back to not set', async ({ page }) => {
    await setPreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto('/delivery');
    const panel = page.getByTestId('transcode-troubleshooting');
    await expect(panel.getByTestId('troubleshoot-token-state')).toHaveText('Set, ending in abcd.', { timeout: 30_000 });
    await panel.getByTestId('troubleshoot-token-remove').click();
    const dialog = page.getByTestId('troubleshoot-token-remove-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('troubleshoot-token-remove-confirm').click();
    await expect(panel.getByTestId('troubleshoot-token-notice')).toHaveText('Token removed.');
    await expect(panel.getByTestId('troubleshoot-token-state')).toHaveText('Not set.');
    await expect(panel.getByTestId('troubleshoot-status-note')).toHaveAttribute('data-note', 'transcodeTroubleshoot.noToken');
  });
});
