/**
 * Site visits panel (D-SEO-9): cookieless daily site counters of the videos
 * site, read through admin-api GET /api/content/analytics/visits.
 *
 * Data: the counters are aggregates the whole stack shares, so this spec adds
 * its own increments for yesterday (inside every period, whatever the clock
 * does at midnight) with a referring host only this run and project use, and
 * takes exactly those increments back afterwards, pass or fail. They go
 * straight into the processor's analytics_daily through the local stack's SQL
 * fast path (the beacon path is covered by the web, processor and api-videos
 * unit tests; a beacon would also leave this run's host in the message
 * archive). Local stack only. Counts shared with other runs are only checked
 * as "at least ours".
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { LOCAL_STACK, RUN_TAG, adminProject } from './support/env';
import { stackSql } from './support/local-stack';

const DB = 'al-ummah-now-notifications';
const SEEDED = 3;
const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const host = `visits-${RUN_TAG}-${adminProject()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '.e2e.example';

/** Our increments: visits, a landing kind, the 'site' source (another website) and our referring host. */
const ROWS: [metric: string, dim: string][] = [
  ['visits', ''],
  ['landing', 'playlist'],
  ['source', 'site'],
  ['referrer_host', host],
];
const where = (metric: string, dim: string) =>
  `entity_type = 'site' AND entity_id = 'videos' AND day = '${day}' AND metric = '${metric}' AND dim = '${dim}'`;

interface Report {
  visits: number;
  referrers: { host: string; visits: number }[];
}

test.describe('site visits', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!LOCAL_STACK, 'seeds counters through the local stack SQL fast path');
  test.skip(!/^[a-z0-9.-]+$/.test(host), 'unexpected run tag for a host name');

  test.beforeAll(async () => {
    for (const [metric, dim] of ROWS) {
      await stackSql(
        DB,
        `INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value) VALUES ('site', 'videos', '${day}', '${metric}', '${dim}', ${SEEDED})
         ON CONFLICT (entity_type, entity_id, day, metric, dim) DO UPDATE SET value = value + excluded.value`,
      );
    }
  });

  test.afterAll(async () => {
    // Take back exactly what this spec added; a row left at zero goes
    for (const [metric, dim] of ROWS) {
      if (metric === 'referrer_host') await stackSql(DB, `DELETE FROM analytics_daily WHERE ${where(metric, dim)}`);
      else {
        await stackSql(DB, `UPDATE analytics_daily SET value = value - ${SEEDED} WHERE ${where(metric, dim)}`);
        await stackSql(DB, `DELETE FROM analytics_daily WHERE ${where(metric, dim)} AND value <= 0`);
      }
    }
    const left = await stackSql(DB, `SELECT dim FROM analytics_daily WHERE entity_type = 'site' AND dim = '${host}'`);
    expect(left).toHaveLength(0);
  });

  test('VISITS-01 the API needs an admin token', async () => {
    expect((await adminApi('/api/content/analytics/visits?days=7', { token: 'invalid' })).status).toBe(401);
    const ok = await adminApi<Report>('/api/content/analytics/visits?days=7', { token: readTokens().admin });
    expect(ok.status).toBe(200);
    expect(ok.body.result!.visits).toBeGreaterThanOrEqual(SEEDED);
    expect(ok.body.result!.referrers).toContainEqual({ host, visits: SEEDED });
  });

  test('VISITS-02 the panel shows the period total, sources, landing pages and our referring site', async ({ page }) => {
    await page.goto('/site-visits?days=7');
    await expect(page.getByRole('heading', { level: 1, name: 'Site visits' })).toBeVisible();
    await expect(page.getByTestId('site-visits-period-7')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('site-visits-panel')).toHaveAttribute('data-days', '7');
    const total = Number((await page.getByTestId('site-visits-total').textContent())?.replace(/\D/g, ''));
    expect(total).toBeGreaterThanOrEqual(SEEDED);
    await expect(page.getByTestId('site-visits-chart')).toBeVisible();
    await expect(page.getByTestId('site-visits-source-site')).toBeVisible();
    await expect(page.getByTestId('site-visits-landing-playlist')).toBeVisible();
    const ours = page.getByTestId('site-visits-referrer').filter({ hasText: host });
    await expect(ours).toHaveAttribute('data-visits', String(SEEDED));
    await expect(page.getByTestId('site-visits-privacy')).toContainText('without cookies');
  });

  test('VISITS-03 the period is a link that loads that period', async ({ page }) => {
    await page.goto('/site-visits');
    await expect(page.getByTestId('site-visits-period-30')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('site-visits-period-90').click();
    await expect(page).toHaveURL(/days=90/);
    await expect(page.getByTestId('site-visits-panel')).toHaveAttribute('data-days', '90');
    await expect(page.getByTestId('site-visits-referrer').filter({ hasText: host })).toHaveAttribute('data-visits', String(SEEDED));
  });
});
