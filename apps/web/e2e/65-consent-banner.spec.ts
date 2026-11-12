// The shared fixture pre-answers the consent banner; these tests need the
// first-visit state, so they use Playwright's base test.
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { ensureFreshSessions } from './test-utils/fresh-session';
import { ownPublicVideos } from './test-utils/own-public-video';


// The stored session must still be signed in (see test-utils/fresh-session.ts)
const test = base.extend<{ freshSessions: void }>({
  freshSessions: [
    async ({}, use) => {
      await ensureFreshSessions(['none']);
      await use();
    },
    { auto: true },
  ],
});

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

/** This file's own public video, so the home grid has a card of ours (no seed, no other run's uploads) */
const own = ownPublicVideos(test, 'consent');

/**
 * Cookie / tracking consent banner (GDPR): shown on a first visit without the
 * aun_consent cookie, one-click accept or reject, granular choices, and the
 * Privacy settings page reflecting (and changing) the decision.
 */

async function consentValue(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === 'aun_consent')?.value;
}

function banner(page: Page) {
  return page.getByTestId('consent-banner');
}

test.describe('Consent banner - first visit', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('CONS-001 shows on a first visit with equally prominent accept/reject', async ({ page, context }) => {
    await page.goto('/en');
    expect(await consentValue(context)).toBeUndefined();
    const dialog = banner(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog.getByRole('heading', { name: 'We respect your privacy' })).toBeVisible();
    const accept = dialog.getByRole('button', { name: 'Accept all' });
    const reject = dialog.getByRole('button', { name: 'Reject all' });
    await expect(accept).toBeVisible();
    await expect(reject).toBeVisible();
    // Same styling for both (reject is not hidden behind a weaker button)
    expect(await reject.getAttribute('class')).toBe(await accept.getAttribute('class'));
  });

  test('CONS-002 Reject all stores a deny-all decision and hides the banner for good', async ({ page, context }) => {
    await page.goto('/en');
    await banner(page).getByRole('button', { name: 'Reject all' }).click();
    await expect(banner(page)).toBeHidden();
    expect(await consentValue(context)).toMatch(/^v1\.a0\.e0\.p0\.\d+$/);
    await page.reload();
    await expect(own.card(page)).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });

  test('CONS-003 Accept all stores an allow-all decision', async ({ page, context }) => {
    await page.goto('/en/search');
    await banner(page).getByRole('button', { name: 'Accept all' }).click();
    await expect(banner(page)).toBeHidden();
    expect(await consentValue(context)).toMatch(/^v1\.a1\.e1\.p1\.\d+$/);
  });

  test('CONS-004 Customize offers granular switches (all off by default)', async ({ page, context }) => {
    await page.goto('/en');
    const dialog = banner(page);
    await dialog.getByRole('button', { name: 'Customize' }).click();
    await expect(dialog.getByRole('heading', { name: 'Privacy choices' })).toBeVisible();
    const switches = dialog.getByRole('switch');
    await expect(switches).toHaveCount(3);
    for (const s of await switches.all()) await expect(s).not.toBeChecked();

    await dialog.getByRole('switch', { name: /Feature experiments/ }).check();
    await dialog.getByRole('button', { name: 'Save choices' }).click();
    await expect(dialog).toBeHidden();
    expect(await consentValue(context)).toMatch(/^v1\.a0\.e1\.p0\.\d+$/);
  });

  test('CONS-005 the privacy page shows the saved decision and can change it', async ({ page, context }) => {
    await page.goto('/en/settings/privacy');
    await banner(page).getByRole('button', { name: 'Accept all' }).click();
    await page.reload();
    const analytics = page.getByRole('switch', { name: /Viewing analytics/ });
    await expect(analytics).toBeChecked();
    await analytics.uncheck();
    await page.getByRole('button', { name: 'Save choices' }).click();
    expect(await consentValue(context)).toMatch(/^v1\.a0\.e1\.p1\.\d+$/);
  });

  test('CONS-006 an expired or outdated cookie asks again', async ({ page, context, baseURL }) => {
    const sevenMonthsAgo = Date.now() - 210 * 24 * 60 * 60 * 1000;
    await context.addCookies([{ name: 'aun_consent', value: `v1.a1.e1.p1.${sevenMonthsAgo}`, url: baseURL!, sameSite: 'Lax' }]);
    await page.goto('/en');
    await expect(banner(page)).toBeVisible();

    await context.addCookies([{ name: 'aun_consent', value: `v0.a1.e1.p1.${Date.now()}`, url: baseURL!, sameSite: 'Lax' }]);
    await page.reload();
    await expect(banner(page)).toBeVisible();
  });

  test('CONS-007 banner does not hide the page behind a modal', async ({ page }) => {
    await page.goto('/en');
    await expect(banner(page)).toHaveAttribute('aria-modal', 'false');
    // The header stays usable while the banner is open
    await expect(page.getByTestId('nav-drawer-toggle')).toBeEnabled();
    const box = await banner(page).boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  });
});

test.describe('Consent banner - Arabic', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('CONS-010 Arabic banner is RTL and translated', async ({ page, context }) => {
    await page.goto('/ar');
    const dialog = banner(page);
    await expect(dialog).toHaveAttribute('dir', 'rtl');
    await expect(dialog.getByRole('heading', { name: 'نحترم خصوصيتك' })).toBeVisible();
    await dialog.getByRole('button', { name: 'تخصيص' }).click();
    await expect(dialog.getByRole('heading', { name: 'خيارات الخصوصية' })).toBeVisible();
    await dialog.getByRole('button', { name: 'رفض الكل' }).click();
    await expect(dialog).toBeHidden();
    expect(await consentValue(context)).toMatch(/^v1\.a0\.e0\.p0\./);
  });
});

test.describe('Consent banner - dark theme', () => {
  test.use({ storageState: ANONYMOUS_STATE, colorScheme: 'dark' });

  test('CONS-020 banner uses the dark palette', async ({ page }) => {
    await page.goto('/en');
    const panel = banner(page).locator('> div');
    await expect(panel).toBeVisible();
    const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(255, 255, 255)');
  });
});

test.describe('Consent banner - signed in', () => {
  test.use({ storageState: AUTH_STATE.none });

  test('CONS-030 signed-in users get the banner too and the decision is kept', async ({ page, context }) => {
    // The stored state has no consent cookie (the fixture adds it per test)
    await context.clearCookies({ name: 'aun_consent' });
    await page.goto('/en');
    await banner(page).getByRole('button', { name: 'Reject all' }).click();
    expect(await consentValue(context)).toMatch(/^v1\.a0\.e0\.p0\./);
    await page.goto('/en/settings/privacy');
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole('switch', { name: /Viewing analytics/ })).not.toBeChecked();
  });
});
