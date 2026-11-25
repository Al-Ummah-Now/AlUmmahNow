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
  cost: { capUsd: number | null };
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
    // One budget (Costs → Alert settings, #1427): the overview cap and the spend meter agree
    const costs = await adminApi<{ budget: { capUsd: number | null } }>('/api/ops/costs?env=all');
    if (costs.status === 200) {
      expect(costs.body.result!.budget.capUsd).toBe(overview.body.result!.cost.capUsd);
      if (overview.body.result!.cost.capUsd !== null) {
        await expect(page.getByTestId('ops-budget-meter')).toHaveAttribute('aria-valuemax', String(overview.body.result!.cost.capUsd));
      } else {
        await expect(page.getByTestId('ops-budget-unset')).toBeVisible();
      }
    }
    await expect(page.getByTestId('ops-chart-requests')).toBeVisible();
  });

  test('OPS-03 tabs and periods are links that keep the other choices', async ({ page }) => {
    await page.goto('/operations?env=qa&range=7d');
    // One row of tabs (#1669): on a phone Queues may be under "More". While the row measures its
    // tabs it is hidden, so wait for it before looking
    await expect(page.getByTestId('ops-tabs')).toBeVisible();
    await expect(page.getByTestId('ops-tabs')).not.toHaveAttribute('data-measuring', /.*/);
    if (await page.getByTestId('ops-tab-queue').isVisible()) await page.getByTestId('ops-tab-queue').click();
    else {
      await page.getByTestId('ops-tabs-more').click();
      await page.getByTestId('ops-tabs-menu-queue').click();
    }
    // The tab is a link and the click a navigation: the URL changes once the server has rendered the
    // page it goes to (/operations reads admin-api several times), which took over 15 s on a loaded
    // stack (#1941). waitForURL takes the navigation budget (45 s, playwright.config.ts), not the
    // 15 s of an assertion; a click that did nothing still fails here.
    await page.waitForURL(/tab=queue/);
    await expect(page).toHaveURL(/range=7d/);
    await expect(page).toHaveURL(/env=qa/);
    await expect(page.getByTestId('ops-tab-queue')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('ops-chart-backlog_max').or(page.getByTestId('ops-chart-backlog_max-error'))).toBeVisible();
  });

  // The same click when the server is slow: the page's data request (Next's `_rsc` fetch) is held
  // back for 17 s, longer than an assertion waits. The link must still end on the tab it names,
  // keeping the period and the environment.
  test('OPS-05 a tab link click ends on its tab when the server takes longer than an assertion timeout', async ({ page }) => {
    await page.goto('/operations?env=qa&range=7d');
    await expect(page.getByTestId('ops-tabs')).toBeVisible();
    await expect(page.getByTestId('ops-tabs')).not.toHaveAttribute('data-measuring', /.*/);
    let held = false;
    await page.route(
      (url) => url.searchParams.has('_rsc') && url.searchParams.get('tab') === 'queue',
      async (route) => {
        held = true;
        await new Promise((resolve) => setTimeout(resolve, 17_000));
        await route.fallback();
      },
    );
    const queue = page.getByTestId('ops-tab-queue');
    if (await queue.isVisible()) await queue.click();
    else {
      await page.getByTestId('ops-tabs-more').click();
      await page.getByTestId('ops-tabs-menu-queue').click();
    }
    await page.waitForURL(/tab=queue/);
    // The hydrated link took the page's data over the held request (it was not a plain page load)
    expect(held).toBe(true);
    await expect(page).toHaveURL(/range=7d/);
    await expect(page.getByTestId('ops-tab-queue')).toHaveAttribute('aria-current', 'page');
  });

  test('OPS-04 the Errors page links to Operations', async ({ page }) => {
    await page.goto('/errors');
    await page.getByTestId('errors-operations-link').click();
    await expect(page).toHaveURL(/\/operations/);
    await expect(page.getByRole('heading', { level: 1, name: 'Operations' })).toBeVisible();
  });
});
