/**
 * Costs page (COST-1): admin-api /api/costs behind admins (ops:read), with connections and alert
 * settings for super admins (ops:manage).
 *
 * Local placement: the stack's COSTS_DB starts empty and its collector has no token, so the page
 * shows the "Set a Cloudflare token" banner over all-zero figures. The super admin opts into the
 * weekly digest and back out, changes the budget and puts it back (both checked after a reload),
 * and sees every connection "Not set". No key is ever saved: the client-side check refuses a
 * malformed one, and Remove stays disabled while nothing is set. The super admin adds a fixed cost
 * (COST-GAPS), changes it and removes it, each checked in the budget and the audit log. An admin
 * without ops:manage sees neither the connections nor the settings, and reads the fixed costs only.
 *
 * The alert settings and the fixed costs are global, so the spec runs in the shared-state project
 * and leaves them exactly as it found them (its fixed cost and that cost's audit rows are deleted), including the row's author on the local stack; the subscription is
 * the run's own super admin's and goes back to what it was.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { LOCAL_STACK, storageStatePath } from './support/env';
import { expectDirection, expectNoAxeViolations, horizontalOverflow, pickOption, setPreferences } from './support/ui';
import { stackSql } from './support/local-stack';

interface Settings { budgetUsd: number | null; budgetLevels: number[]; [k: string]: unknown }
interface FixedItem { id: string; name: string; amountUsd: number; period: string }
interface Dashboard {
  canManage: boolean;
  fixed: { items: FixedItem[]; mtd: number; projected: number };
  budget: { parts: { fixed: { projected: number } } };
  settings: Settings;
  collector: { tokenSource: string };
  connections: { provider: string; set: boolean }[];
  me: { kinds: string[]; locale: 'en' | 'ar' };
}

const COSTS_DB = 'al-ummah-now-costs';
const REPORTS_DB = 'al-ummah-now-reports';
/** The fixed cost this run adds: its name carries the run, so a failed run's item is found and removed. */
const FIXED_NAME = `E2E Apple Developer ${process.env.E2E_RUN_ID ?? Date.now()}`;
const superToken = () => readTokens().superadmin;

async function dashboard(token = superToken()): Promise<{ status: number; result?: Dashboard; code?: unknown }> {
  const res = await adminApi<Dashboard>('/api/costs', { token });
  return { status: res.status, result: res.body.result, code: res.body.code };
}

const usd = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

async function skipUnlessReady() {
  const probe = await dashboard();
  // A build without /api/costs answers with a plain 404; 503 means COSTS_DB is not bound or migrated there
  test.skip(probe.status === 404, 'admin-api on this target predates /api/costs');
  test.skip(probe.status === 503, `costs are not available on this target (${String(probe.code)})`);
  expect(probe.status, 'GET /api/costs').toBe(200);
  return probe.result!;
}

test.describe('costs (super admin)', () => {
  test.use({ storageState: storageStatePath('superadmin') });
  test.describe.configure({ mode: 'serial' });

  let original: Dashboard | null = null;
  let settingsRow: { updated_by: string; updated_at: string }[] | null = null;
  const fixedIds: string[] = [];

  test.beforeAll(async () => {
    const probe = await dashboard();
    if (probe.status !== 200) return;
    original = probe.result!;
    if (LOCAL_STACK) settingsRow = await stackSql<{ updated_by: string; updated_at: string }>(COSTS_DB, "SELECT updated_by, updated_at FROM cost_settings WHERE key = 'alerts'");
  });

  test.afterAll(async () => {
    if (!original) return;
    // This run's fixed cost, if a test failed before removing it, and every audit row it left
    const mineLeft = ((await dashboard()).result?.fixed.items ?? []).filter((i) => i.name === FIXED_NAME);
    for (const item of mineLeft) expect((await adminApi(`/api/costs/fixed/${item.id}`, { method: 'DELETE', token: superToken() })).status, 'fixed cost removed').toBe(200);
    if (LOCAL_STACK && fixedIds.length) await stackSql(REPORTS_DB, `DELETE FROM site_settings_log WHERE key IN (${fixedIds.map((id) => `'costs:fixed:${id}'`).join(', ')})`);
    const settings = await adminApi('/api/costs/settings', { method: 'PUT', token: superToken(), body: JSON.stringify(original.settings) });
    expect(settings.status, 'alert settings restored').toBe(200);
    const mine = await adminApi('/api/costs/subscriptions/me', { method: 'PUT', token: superToken(), body: JSON.stringify({ kinds: original.me.kinds, locale: original.me.locale }) });
    expect(mine.status, 'own alert emails restored').toBe(200);
    if (LOCAL_STACK && settingsRow) {
      // The restore above names the run's super admin as the row's author: give it back to whoever had it
      const before = settingsRow[0];
      if (!before) await stackSql(COSTS_DB, "DELETE FROM cost_settings WHERE key = 'alerts'");
      else {
        const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
        await stackSql(COSTS_DB, `UPDATE cost_settings SET updated_by = ${q(before.updated_by)}, updated_at = ${q(before.updated_at)} WHERE key = 'alerts'`);
      }
    }
  });

  test('COSTS-01 the API needs an admin; changes need a super admin', async () => {
    await skipUnlessReady();
    expect((await adminApi('/api/costs', { token: 'invalid' })).status).toBe(401);
    expect((await adminApi('/api/costs', { token: readTokens().moderator })).status).toBe(403);
    const asAdmin = await dashboard(readTokens().admin);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.result!.canManage).toBe(false);
    expect((await adminApi('/api/costs/settings', { method: 'PUT', token: readTokens().admin, body: JSON.stringify({ budgetUsd: 400 }) })).status).toBe(403);
    expect((await adminApi('/api/costs/credentials', { token: readTokens().admin })).status).toBe(403);
  });

  test('COSTS-02 with no token the page asks for one and every connection shows its state', async ({ page }) => {
    const d = await skipUnlessReady();
    await page.goto('/costs');
    await expect(page.getByRole('heading', { level: 1, name: 'Costs' })).toBeVisible();
    if (d.settings.budgetUsd !== null) {
      await expect(page.getByTestId('costs-budget-meter')).toHaveAttribute('aria-valuemax', String(d.settings.budgetUsd));
    } else {
      await expect(page.getByTestId('costs-budget-banner')).toHaveAttribute('data-kind', 'unset');
      await expect(page.getByTestId('costs-budget-unset')).toBeVisible();
    }
    const cloudflare = d.connections.find((c) => c.provider === 'cloudflare');
    const missing = ['none', 'unknown'].includes(d.collector.tokenSource) && !cloudflare?.set;
    if (missing) {
      const banner = page.getByTestId('costs-token-banner');
      await expect(banner).toHaveAttribute('data-kind', 'missing');
      await expect(banner).toContainText('Set a Cloudflare token to start collecting costs');
      await page.getByTestId('costs-token-action').click();
      await expect(page).toHaveURL(/#connections$/);
    }
    await expect(page.getByTestId('costs-connections')).toBeVisible();
    for (const c of d.connections) {
      const card = page.getByTestId(`costs-connection-${c.provider}`);
      await expect(card).toHaveAttribute('data-state', c.set ? /^(set|unreadable)$/ : 'unset');
      if (!c.set) {
        // Cloudflare with no key here still reads data when the collector uses the shared release token
        const viaRelease = c.provider === 'cloudflare' && d.collector.tokenSource === 'release';
        await expect(page.getByTestId(`costs-connection-${c.provider}-status`)).toHaveText(viaRelease ? 'Not set here: the collector uses the shared release token' : 'Not set');
        // Nothing to test or remove until a key is added
        await expect(page.getByTestId(`costs-connection-${c.provider}-remove`)).toHaveCount(0);
        await expect(page.getByTestId(`costs-connection-${c.provider}-test`)).toHaveCount(0);
      }
    }
    // A key field is never pre-filled and never remembered by the browser
    const input = page.getByTestId('costs-connection-cloudflare-input');
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveAttribute('autocomplete', 'off');
    await expect(input).toHaveValue('');
  });

  test('COSTS-03 a malformed key is refused before anything is sent', async ({ page }) => {
    await skipUnlessReady();
    await page.goto('/costs#connections');
    // Watch for the typed keys themselves, in any request's URL or body. Not for "a POST to /costs":
    // every server action on the page posts there, and the layout's live Contact badge re-reads its
    // count that way whenever a contact message changes (28-contact-inbox runs beside this spec)
    const resendKey = 'not-a-resend-key-but-long-enough';
    const bunnyKey = 'short-bunny';
    const sent: string[] = [];
    page.on('request', (r) => {
      const carried = `${r.url()}\n${r.postData() ?? ''}`;
      if (carried.includes(resendKey) || carried.includes(bunnyKey)) sent.push(`${r.method()} ${r.url()}`);
    });
    await page.getByTestId('costs-connection-resend-input').fill(resendKey);
    await page.getByTestId('costs-connection-resend-save').click();
    await expect(page.getByTestId('costs-connection-resend-key-error')).toHaveText('Resend keys start with re_.');
    await page.getByTestId('costs-connection-bunny-input').fill(bunnyKey);
    await page.getByTestId('costs-connection-bunny-save').click();
    await expect(page.getByTestId('costs-connection-bunny-key-error')).toContainText('20 to 400 characters');
    expect(sent, 'no malformed key left the browser').toEqual([]);
    const after = await dashboard();
    expect(after.result!.connections.find((c) => c.provider === 'resend')?.set).toBe(original!.connections.find((c) => c.provider === 'resend')?.set);
  });

  test('COSTS-04 opt into the weekly digest and back out, kept after a reload', async ({ page }) => {
    await skipUnlessReady();
    await page.goto('/costs');
    const digest = page.getByTestId('costs-kind-digest');
    if (await digest.isChecked()) {
      await digest.uncheck();
      await page.getByTestId('costs-alerts-save').click();
      await expect(page.getByTestId('costs-alerts-feedback-ok')).toBeVisible();
    }
    await digest.check();
    await page.getByTestId('costs-alerts-save').click();
    await expect(page.getByTestId('costs-alerts-feedback-ok')).toHaveText('Your alert emails are saved.');
    await expect(page.getByTestId('costs-alerts-email')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('costs-kind-digest')).toBeChecked();
    expect((await dashboard()).result!.me.kinds).toContain('digest');

    await page.getByTestId('costs-kind-digest').uncheck();
    await page.getByTestId('costs-alerts-save').click();
    await expect(page.getByTestId('costs-alerts-feedback-ok')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('costs-kind-digest')).not.toBeChecked();
    expect((await dashboard()).result!.me.kinds).not.toContain('digest');
  });

  test('COSTS-05 change the budget and put it back, kept after a reload; out-of-range values are refused', async ({ page }) => {
    const d = await skipUnlessReady();
    const before = d.settings.budgetUsd;
    const beforeInput = before === null ? '' : String(before);
    const changed = before === 637 ? 638 : 637;
    await page.goto('/costs');
    const budget = page.getByTestId('costs-threshold-budgetUsd');
    await expect(budget).toHaveValue(beforeInput);

    await budget.fill('0');
    await page.getByTestId('costs-thresholds-save').click();
    await expect(page.getByTestId('costs-threshold-budgetUsd-error')).toHaveText('Enter a number from 50 to 5,000.');
    expect((await dashboard()).result!.settings.budgetUsd).toBe(before);

    await budget.fill(String(changed));
    await page.getByTestId('costs-thresholds-save').click();
    await expect(page.getByTestId('costs-thresholds-feedback-ok')).toHaveText('Alert settings saved.');
    await page.reload();
    await expect(page.getByTestId('costs-threshold-budgetUsd')).toHaveValue(String(changed));
    await expect(page.getByTestId('costs-budget-cap')).toContainText(usd(changed));
    expect((await dashboard()).result!.settings.budgetUsd).toBe(changed);

    await page.getByTestId('costs-threshold-budgetUsd').fill(beforeInput);
    await page.getByTestId('costs-thresholds-save').click();
    await expect(page.getByTestId('costs-thresholds-feedback-ok')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('costs-threshold-budgetUsd')).toHaveValue(beforeInput);
    expect((await dashboard()).result!.settings.budgetUsd).toBe(before);
  });

  test('COSTS-09 a super admin adds a fixed cost, changes it and removes it; the budget and the audit log follow', async ({ page }) => {
    const d = await skipUnlessReady();
    const baseProjected = d.fixed.projected;
    await page.goto('/costs#fixed-costs');
    const section = page.getByTestId('costs-fixed');
    await expect(section.getByRole('heading', { level: 2, name: 'Fixed and other costs' })).toBeVisible();
    const form = page.getByTestId('costs-fixed-form');
    await expect(form).toHaveAttribute('data-mode', 'add');

    // Refused before anything is sent: no name, then no amount
    await page.getByTestId('costs-fixed-save').click();
    await expect(page.getByTestId('costs-fixed-name-error')).toHaveText('Enter a name of up to 80 characters.');
    await page.getByTestId('costs-fixed-name').fill(FIXED_NAME);
    await page.getByTestId('costs-fixed-amount-input').fill('0');
    await page.getByTestId('costs-fixed-save').click();
    await expect(page.getByTestId('costs-fixed-amountUsd-error')).toHaveText('Enter an amount above zero, up to $100,000.00.');
    expect((await dashboard()).result!.fixed.items.some((i) => i.name === FIXED_NAME)).toBe(false);

    // $99 a year from January: a twelfth, $8.25, in every whole month
    await page.getByTestId('costs-fixed-amount-input').fill('99');
    await pickOption(page.getByTestId('costs-fixed-period'), 'yearly');
    const start = page.getByTestId('costs-fixed-start-input');
    await start.fill('2026-01-10');
    await start.press('Tab');
    await page.getByTestId('costs-fixed-note').fill('App Store and TestFlight');
    await page.getByTestId('costs-fixed-save').click();
    await expect(page.getByTestId('costs-fixed-feedback-ok')).toHaveText(`${FIXED_NAME} added.`);
    const row = page.getByTestId('costs-fixed-row').filter({ hasText: FIXED_NAME });
    await expect(row.getByTestId('costs-fixed-amount')).toHaveText('$99.00 a year');
    await expect(row.getByTestId('costs-fixed-share')).toHaveText('$8.25 this month');
    const added = (await dashboard()).result!;
    const item = added.fixed.items.find((i) => i.name === FIXED_NAME)!;
    expect(item).toMatchObject({ amountUsd: 99, period: 'yearly' });
    fixedIds.push(item.id);
    expect(added.fixed.projected).toBeCloseTo(baseProjected + 8.25, 2);
    expect(added.budget.parts.fixed.projected).toBeCloseTo(added.fixed.projected, 2);

    // Edit: the form takes the item, $120 a year is $10 a month
    await row.getByTestId('costs-fixed-edit').click();
    await expect(form).toHaveAttribute('data-mode', 'edit');
    await expect(page.getByTestId('costs-fixed-name')).toHaveValue(FIXED_NAME);
    await page.getByTestId('costs-fixed-amount-input').fill('120');
    await page.getByTestId('costs-fixed-save').click();
    await expect(page.getByTestId('costs-fixed-feedback-ok')).toHaveText(`${FIXED_NAME} saved.`);
    await expect(row.getByTestId('costs-fixed-share')).toHaveText('$10.00 this month');
    await page.reload();
    await expect(page.getByTestId('costs-fixed-row').filter({ hasText: FIXED_NAME }).getByTestId('costs-fixed-amount')).toHaveText('$120.00 a year');

    // Remove asks first (Cancel keeps it), then it is gone and out of the budget
    await page.getByTestId('costs-fixed-row').filter({ hasText: FIXED_NAME }).getByTestId('costs-fixed-remove').click();
    const dialog = page.getByTestId('costs-fixed-remove-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('costs-fixed-row').filter({ hasText: FIXED_NAME })).toHaveCount(1);
    await page.getByTestId('costs-fixed-row').filter({ hasText: FIXED_NAME }).getByTestId('costs-fixed-remove').click();
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('costs-fixed-feedback-ok')).toHaveText(`${FIXED_NAME} removed.`);
    await expect(page.getByTestId('costs-fixed-row').filter({ hasText: FIXED_NAME })).toHaveCount(0);
    const after = (await dashboard()).result!;
    expect(after.fixed.items.some((i) => i.id === item.id)).toBe(false);
    expect(after.fixed.projected).toBeCloseTo(baseProjected, 2);

    if (LOCAL_STACK) {
      // Every change audited: added (no before), changed (before and after), removed
      const audit = await stackSql<{ old_value: string | null; new_value: string }>(REPORTS_DB, `SELECT old_value, new_value FROM site_settings_log WHERE key = 'costs:fixed:${item.id}' ORDER BY created_at, rowid`);
      expect(audit.map((a) => [a.old_value === null, JSON.parse(a.new_value).amountUsd ?? JSON.parse(a.new_value).removed])).toEqual([
        [true, 99],
        [false, 120],
        [false, true],
      ]);
    }
  });

  test('COSTS-10 a token Cloudflare refuses names Account Analytics Read and offers Check again, not $0 as real', async ({ page }) => {
    test.skip(!LOCAL_STACK, 'seeds the local stack COSTS_DB directly');
    await skipUnlessReady();
    // The collector borrowing the shared token, and its latest hourly run refused (a start time
    // ahead of every real run, so it is the latest); both put back afterwards
    const before = await stackSql<{ value: string; updated_at: string }>(COSTS_DB, "SELECT value, updated_at FROM cost_settings WHERE key = 'collector'");
    const runId = `e2e-refused-${process.env.E2E_RUN_ID ?? Date.now()}`;
    const ahead = new Date(Date.now() + 86_400_000).toISOString();
    const now = new Date().toISOString();
    try {
      await stackSql(COSTS_DB, `INSERT INTO cost_settings (key, value, updated_at) VALUES ('collector', '{"tokenSource":"release"}', '${now}') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
      await stackSql(COSTS_DB, `INSERT INTO collector_runs (id, kind, started_at, finished_at, status, detail) VALUES ('${runId}', 'hourly', '${ahead}', '${ahead}', 'failed', '{"token":"release","error":"Cloudflare GraphQL returned no data: not authorized for that account"}')`);
      const d = await dashboard();
      test.skip(d.result?.connections.some((c) => c.provider === 'cloudflare' && c.set) ?? false, 'a Cloudflare token is set on this stack');
      await page.goto('/costs');
      const banner = page.getByTestId('costs-token-banner');
      await expect(banner).toHaveAttribute('data-kind', 'refused');
      await expect(banner).toContainText('missing, not zero');
      await expect(page.getByTestId('costs-token-permission')).toContainText(/Account\sAnalytics\sRead/);
      await page.getByTestId('costs-token-check').click();
      await expect(page.getByTestId('costs-token-check-feedback-ok')).toContainText('A collection is queued');

      await setPreferences(page, { locale: 'ar' });
      await page.goto('/costs');
      await expect(page.getByTestId('costs-token-banner')).toHaveAttribute('data-kind', 'refused');
      await expect(page.getByTestId('costs-token-permission')).toContainText(/Account\sAnalytics\sRead/);
      await expect(page.getByTestId('costs-token-check')).toHaveText('افحص مجددًا');
    } finally {
      await setPreferences(page, { locale: 'en' }).catch(() => undefined);
      await stackSql(COSTS_DB, `DELETE FROM collector_runs WHERE id = '${runId}'`);
      if (!before.length) await stackSql(COSTS_DB, "DELETE FROM cost_settings WHERE key = 'collector'");
      else await stackSql(COSTS_DB, `UPDATE cost_settings SET value = '${before[0]!.value.replace(/'/g, "''")}', updated_at = '${before[0]!.updated_at}' WHERE key = 'collector'`);
    }
  });

  test('COSTS-06 Arabic is right to left, and the page fits a phone without sideways scrolling', async ({ page }) => {
    await skipUnlessReady();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/costs');
    await setPreferences(page, { locale: 'ar' });
    await page.goto('/costs');
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'التكاليف' })).toBeVisible();
    await expect(page.getByTestId('costs-connections').getByRole('heading', { level: 2 })).toHaveText('الاتصالات');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page, '/costs (ar)');
    await setPreferences(page, { locale: 'en' });
    await page.goto('/costs');
    await expectDirection(page, 'en');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('COSTS-07 accessibility (axe) in English', async ({ page }) => {
    await skipUnlessReady();
    await page.goto('/costs');
    await expect(page.getByTestId('costs-budget')).toBeVisible();
    await expectNoAxeViolations(page, '/costs');
  });

  test('COSTS-09 Fawanees street plate never covers the header subtitle or pill inside cost-hero', async ({ page }) => {
    await skipUnlessReady();
    await page.goto('/costs');
    await expect(page.getByTestId('costs-header')).toBeVisible();
    // Force Fawanees + dark + --fanous-street-on: 1 so startStreet's MutationObserver keeps
    // html.fanous-street active even when the target environment is not on Fawanees.
    await page.evaluate(async () => {
      const html = document.documentElement;
      html.style.setProperty('--fanous-street-on', '1');
      html.dataset.theme = 'fawanees';
      html.classList.add('dark', 'fanous-street');
      await new Promise((r) => requestAnimationFrame(r));
    });
    const issues = await page.evaluate(() => {
      const html = document.documentElement;
      const problems: string[] = [];
      if (!html.classList.contains('fanous-street')) {
        problems.push('html.fanous-street was stripped before measurement');
      }
      const main = document.getElementById('main-content');
      if (!main) {
        problems.push('#main-content missing');
      } else {
        // Control heading directly under #main-content (outside .cost-hero) proves the admin
        // street-plate rule is live, so the assertion below cannot pass vacuously.
        const probe = document.createElement('h1');
        probe.textContent = 'Street plate probe';
        main.appendChild(probe);
        try {
          const probeHost = getComputedStyle(probe);
          const probeBefore = getComputedStyle(probe, '::before');
          if (probeHost.boxShadow !== 'none') problems.push(`control h1 host has box-shadow: ${probeHost.boxShadow}`);
          if (probeBefore.zIndex !== '-1' || probeBefore.boxShadow === 'none') {
            problems.push(`control h1::before missing street plate (zIndex=${probeBefore.zIndex}, boxShadow=${probeBefore.boxShadow})`);
          }
        } finally {
          probe.remove();
        }
      }
      const header = document.querySelector('[data-testid="costs-header"]');
      if (!header) return [...problems, 'costs-header missing'];
      for (const el of header.querySelectorAll('h1, p, span')) {
        const cs = getComputedStyle(el);
        const before = getComputedStyle(el, '::before');
        const tag = `${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') || el.className.toString().slice(0, 30)}]`;
        if (cs.boxShadow !== 'none') problems.push(`${tag} has box-shadow: ${cs.boxShadow}`);
        if (before.content !== 'none' && before.boxShadow !== 'none') problems.push(`${tag}::before paints street-plate shadow inside .cost-hero`);
      }
      return problems;
    });
    expect(issues, issues.join('; ')).toEqual([]);
  });
});

test.describe('costs (admin without ops:manage)', () => {
  test.use({ storageState: storageStatePath('admin') });

  test('COSTS-08 an admin sees the figures and their own alert emails, not connections or settings', async ({ page }) => {
    const probe = await dashboard(readTokens().admin);
    test.skip(probe.status === 404, 'admin-api on this target predates /api/costs');
    test.skip(probe.status === 503, 'costs are not available on this target');
    await page.goto('/costs');
    await expect(page.getByRole('heading', { level: 1, name: 'Costs' })).toBeVisible();
    await expect(page.getByTestId('costs-budget')).toBeVisible();
    await expect(page.getByTestId('costs-my-alerts')).toBeVisible();
    await expect(page.getByTestId('costs-connections')).toHaveCount(0);
    await expect(page.getByTestId('costs-thresholds')).toHaveCount(0);
    // Fixed costs: read only, and the API refuses a change
    await expect(page.getByTestId('costs-fixed')).toBeVisible();
    await expect(page.getByTestId('costs-fixed-form')).toHaveCount(0);
    await expect(page.getByTestId('costs-fixed-edit')).toHaveCount(0);
    expect((await adminApi('/api/costs/fixed', { method: 'POST', token: readTokens().admin, body: JSON.stringify({ name: 'Not allowed', amountUsd: 1, period: 'monthly', startDate: '2026-11-01' }) })).status).toBe(403);
    // Cloudflare at list price against billed, with the shared-account note
    await expect(page.getByTestId('costs-cloudflare')).toBeVisible();
    await expect(page.getByTestId('costs-cf-shared')).toContainText('shared with other projects');
    const d = probe.result!;
    const cloudflare = d.connections.find((c) => c.provider === 'cloudflare');
    if (['none', 'unknown'].includes(d.collector.tokenSource) && !cloudflare?.set) {
      await expect(page.getByTestId('costs-token-banner')).toContainText('A super admin has to set one');
      await expect(page.getByTestId('costs-token-action')).toHaveCount(0);
    }
    await expectNoAxeViolations(page, '/costs (admin)');
  });
});
