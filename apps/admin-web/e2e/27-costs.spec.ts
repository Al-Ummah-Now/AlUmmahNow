/**
 * Costs page (COST-1): admin-api /api/costs behind admins (ops:read), with connections and alert
 * settings for super admins (ops:manage).
 *
 * Local placement: the stack's COSTS_DB starts empty and its collector has no token, so the page
 * shows the "Set a Cloudflare token" banner over all-zero figures. The super admin opts into the
 * weekly digest and back out, changes the budget and puts it back (both checked after a reload),
 * and sees every connection "Not set". No key is ever saved: the client-side check refuses a
 * malformed one, and Remove stays disabled while nothing is set. An admin without ops:manage sees
 * neither the connections nor the settings.
 *
 * The alert settings are global, so the spec runs in the shared-state project and leaves them
 * exactly as it found them, including the row's author on the local stack; the subscription is
 * the run's own super admin's and goes back to what it was.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { LOCAL_STACK, storageStatePath } from './support/env';
import { expectDirection, expectNoAxeViolations, horizontalOverflow, setPreferences } from './support/ui';
import { stackSql } from './support/local-stack';

interface Settings { budgetUsd: number | null; budgetLevels: number[]; [k: string]: unknown }
interface Dashboard {
  canManage: boolean;
  settings: Settings;
  collector: { tokenSource: string };
  connections: { provider: string; set: boolean }[];
  me: { kinds: string[]; locale: 'en' | 'ar' };
}

const COSTS_DB = 'al-ummah-now-costs';
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

  test.beforeAll(async () => {
    const probe = await dashboard();
    if (probe.status !== 200) return;
    original = probe.result!;
    if (LOCAL_STACK) settingsRow = await stackSql<{ updated_by: string; updated_at: string }>(COSTS_DB, "SELECT updated_by, updated_at FROM cost_settings WHERE key = 'alerts'");
  });

  test.afterAll(async () => {
    if (!original) return;
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
        await expect(page.getByTestId(`costs-connection-${c.provider}-status`)).toHaveText('Not set');
        await expect(page.getByTestId(`costs-connection-${c.provider}-remove`)).toBeDisabled();
        await expect(page.getByTestId(`costs-connection-${c.provider}-test`)).toBeDisabled();
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
    // Force Fawanees + dark + fanous-street to verify the header card excludes street plates even
    // when the active site theme is not Fawanees on this target.
    await page.evaluate(() => {
      const html = document.documentElement;
      html.dataset.theme = 'fawanees';
      html.classList.add('dark', 'fanous-street');
    });
    const issues = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="costs-header"]');
      if (!header) return ['costs-header missing'];
      const problems: string[] = [];
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
    const d = probe.result!;
    const cloudflare = d.connections.find((c) => c.provider === 'cloudflare');
    if (['none', 'unknown'].includes(d.collector.tokenSource) && !cloudflare?.set) {
      await expect(page.getByTestId('costs-token-banner')).toContainText('A super admin has to set one');
      await expect(page.getByTestId('costs-token-action')).toHaveCount(0);
    }
    await expectNoAxeViolations(page, '/costs (admin)');
  });
});
