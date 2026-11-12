/**
 * Operations page (docs/admin/LIVE_OPS.md Part A): platform analytics from the
 * hourly collector's rollups through admin-api /api/ops (ops:read, admins only).
 * Local placement: on the local stack COSTS_DB starts empty, so the page shows
 * the "no data yet" notice and the charts' empty state; with data it must
 * match what admin-api reports.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';

interface Overview {
  workers: { requests: number };
  queues: { dlqMessages: number };
  cost: { capUsd: number };
}

test.describe('operations', () => {
  test.beforeEach(async () => {
    const probe = await adminApi('/api/ops/overview?env=qa');
    // A build without /api/ops answers with a plain 404: the page is not deployed there yet
    test.skip(probe.status === 404, 'admin-api on this target predates /api/ops');
  });

  test('OPS-01 the API needs an admin: invalid token 401, moderator 403', async () => {
    expect((await adminApi('/api/ops/overview', { token: 'invalid' })).status).toBe(401);
    expect((await adminApi('/api/ops/overview', { token: readTokens().moderator })).status).toBe(403);
  });

  test('OPS-02 page shows what admin-api reports, or says no data yet', async ({ page }) => {
    const envs = ['qa', 'stage', 'production'];
    let env = 'qa';
    let overview: { status: number; body: { result?: Overview; code?: unknown } } = await adminApi<Overview>(`/api/ops/overview?env=${env}`);
    for (const e of envs) {
      overview = await adminApi<Overview>(`/api/ops/overview?env=${e}`);
      env = e;
      if (overview.status === 200) break;
    }
    await page.goto(`/operations?env=${env}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Operations' })).toBeVisible();
    if (overview.status === 503) {
      await expect(page.getByTestId('ops-overview-error')).toBeVisible();
      return;
    }
    expect(overview.status).toBe(200);
    await expect(page.getByTestId('ops-tiles')).toBeVisible();
    await expect(page.getByTestId('ops-tile-dlq')).toHaveText(String(overview.body.result!.queues.dlqMessages));
    await expect(page.getByTestId('ops-cap-bar')).toHaveAttribute('aria-valuemax', String(overview.body.result!.cost.capUsd));
    await expect(page.getByTestId('ops-chart-requests')).toBeVisible();
  });

  test('OPS-03 tabs and periods are links that keep the other choices', async ({ page }) => {
    await page.goto('/operations?env=qa&range=7d');
    await page.getByTestId('ops-tab-queue').click();
    await expect(page).toHaveURL(/tab=queue/);
    await expect(page).toHaveURL(/range=7d/);
    await expect(page).toHaveURL(/env=qa/);
    await expect(page.getByTestId('ops-tab-queue')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('ops-chart-backlog_max').or(page.getByTestId('ops-chart-backlog_max-error'))).toBeVisible();
  });

  test('OPS-04 the Errors page links to Operations', async ({ page }) => {
    await page.goto('/errors');
    await page.getByTestId('errors-operations-link').click();
    await expect(page).toHaveURL(/\/operations/);
    await expect(page.getByRole('heading', { level: 1, name: 'Operations' })).toBeVisible();
  });
});
