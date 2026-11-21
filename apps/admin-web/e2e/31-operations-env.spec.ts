/**
 * Operations: the environment switch (owner 2026-11-21, "the env buttons don't work").
 *
 * Operations is platform usage and health of one environment, and everything on it follows the
 * switch; spend is on Costs only (a one-line pointer stays). The spec seeds one Worker per env in
 * the local stack's COSTS_DB (ops_hourly for the tiles, ops_daily for the env list and the
 * resources table) with a different request count each, switches Production → Stage → QA with
 * the pills, and checks the URL, aria-current, the requests tile and the resources table each
 * time. Its rows carry the `e2e-envswitch` prefix and are deleted afterwards.
 *
 * Local only (it writes the stack's D1 directly) and in the shared-state project: the rows are
 * read by every page that sums the collector's tables (Costs too).
 */
import { test, expect } from './support/fixtures';
import { LOCAL_STACK, storageStatePath } from './support/env';
import { stackSql } from './support/local-stack';

const COSTS_DB = 'al-ummah-now-costs';
const PREFIX = 'e2e-envswitch';
/** Requests in the last 24 h per env, and how the tile writes them (compact from 1,000). */
const SEED = [
  { env: 'production', label: 'Production', requests: 4200, tile: '4.2K' },
  { env: 'stage', label: 'Stage', requests: 1300, tile: '1.3K' },
  { env: 'qa', label: 'QA', requests: 7, tile: '7' },
] as const;

const cleanup = () =>
  Promise.all([
    stackSql(COSTS_DB, `DELETE FROM ops_hourly WHERE resource_id LIKE 'worker:${PREFIX}-%'`),
    stackSql(COSTS_DB, `DELETE FROM ops_daily WHERE resource_id LIKE 'worker:${PREFIX}-%'`),
  ]);

test.describe('operations environment switch', () => {
  test.use({ storageState: storageStatePath('superadmin') });
  test.skip(!LOCAL_STACK, 'seeds the local stack COSTS_DB directly');

  test.beforeAll(async () => {
    await cleanup();
    const now = new Date();
    // Two hours back: inside the tiles' last 24 h whatever minute the run starts at
    const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 - 2 * 3_600_000).toISOString().replace('.000Z', 'Z');
    const day = now.toISOString().slice(0, 10);
    const stamp = now.toISOString();
    for (const s of SEED) {
      const id = `worker:${PREFIX}-${s.env}`;
      const name = `${PREFIX}-${s.env}`;
      await stackSql(
        COSTS_DB,
        `INSERT INTO ops_hourly (hour, resource_id, kind, env, name, requests, errors, cpu_p99, updated_at) VALUES ('${hour}', '${id}', 'worker', '${s.env}', '${name}', ${s.requests}, 0, 1500, '${stamp}')`,
      );
      await stackSql(
        COSTS_DB,
        `INSERT INTO ops_daily (day, resource_id, kind, env, name, requests, errors, cpu_p99, cost_usd, updated_at) VALUES ('${day}', '${id}', 'worker', '${s.env}', '${name}', ${s.requests}, 0, 1500, 0, '${stamp}')`,
      );
    }
  });

  test.afterAll(async () => {
    await cleanup();
    const left = await stackSql<{ n: number }>(COSTS_DB, `SELECT (SELECT COUNT(*) FROM ops_hourly WHERE resource_id LIKE 'worker:${PREFIX}-%') + (SELECT COUNT(*) FROM ops_daily WHERE resource_id LIKE 'worker:${PREFIX}-%') AS n`);
    expect(left[0]?.n ?? 0, 'seeded rows removed').toBe(0);
  });

  test('OPS-ENV-01 each pill switches every figure on the page, and marks itself current', async ({ page }) => {
    await page.goto('/operations?env=production');
    const nav = page.getByTestId('ops-env');
    for (const s of SEED) await expect(nav.getByRole('link', { name: s.label })).toBeVisible();

    // Production (the page as opened), then each pill in turn and back to Production
    const steps = [SEED[0], SEED[1], SEED[2], SEED[0]];
    for (const [i, s] of steps.entries()) {
      if (i > 0) await nav.getByRole('link', { name: s.label }).click();
      await expect(page).toHaveURL(new RegExp(`env=${s.env}`));
      await expect(nav.getByRole('link', { name: s.label })).toHaveAttribute('aria-current', 'page');
      for (const other of SEED.filter((o) => o !== s)) await expect(nav.getByRole('link', { name: other.label })).not.toHaveAttribute('aria-current', /.*/);
      await expect(page.getByTestId('ops-tile-requests')).toHaveText(s.tile);
      const rows = page.getByTestId('ops-resource-row');
      await expect(rows.filter({ hasText: `${PREFIX}-${s.env}` })).toHaveCount(1);
      for (const other of SEED.filter((o) => o !== s)) await expect(rows.filter({ hasText: `${PREFIX}-${other.env}` })).toHaveCount(0);
    }
  });

  test('OPS-ENV-02 spend is on Costs: Operations keeps only the one-line pointer', async ({ page }) => {
    await page.goto('/operations?env=stage');
    await expect(page.getByTestId('ops-tiles')).toBeVisible();
    for (const id of ['ops-spend', 'ops-budget-meter', 'ops-idle', 'ops-drivers', 'ops-spend-trend']) await expect(page.getByTestId(id)).toHaveCount(0);
    const line = page.getByTestId('ops-spend-link');
    await expect(line).toContainText('All environments this month: $');
    await line.getByRole('link', { name: 'See Costs' }).click();
    await expect(page).toHaveURL(/\/costs$/);
    await expect(page.getByTestId('costs-drivers')).toBeVisible();
    await expect(page.getByTestId('costs-idle')).toBeVisible();
  });
});
