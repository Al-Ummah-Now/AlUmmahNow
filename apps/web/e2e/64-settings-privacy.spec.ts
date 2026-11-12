import { test, expect } from './fixtures';
import type { BrowserContext } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { clickAndWaitForURL } from './test-utils/qa-content';

/**
 * Settings index (/settings) and Privacy & data (/settings/privacy).
 * "Delete your data" is never confirmed here: it would erase the shared E2E
 * user. Only the guard (confirm word) is exercised.
 */

async function consentValue(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === 'aun_consent')?.value ?? '';
}

test.describe('Settings - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('SET-001 asks anonymous visitors to sign in', async ({ page }) => {
    await page.goto('/en/settings');
    await expect(page).toHaveURL(/\/en\/settings$/);
    const prompt = page.getByTestId('sign-in-prompt');
    await expect(prompt.getByRole('heading', { level: 1, name: 'Sign in to manage your settings' })).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('SET-002 Arabic sign-in prompt', async ({ page }) => {
    await page.goto('/ar/settings');
    await expect(page.getByTestId('sign-in-prompt').getByRole('heading', { name: 'سجّل الدخول لإدارة إعداداتك' })).toBeVisible();
  });
});

test.describe('Settings - channel owner', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('SET-010 lists the user\'s own sections; no channel settings', async ({ page }) => {
    await page.goto('/en/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    const sections = page.getByTestId('settings-section');
    await expect(sections).toHaveCount(4);
    await expect(sections.filter({ hasText: 'Upload Defaults' })).toHaveAttribute('href', '/en/settings/upload-defaults');
    await expect(sections.filter({ hasText: 'Profile Settings' })).toHaveAttribute('href', '/en/profile?from=settings');
    await expect(sections.filter({ hasText: 'Privacy & data' })).toHaveAttribute('href', '/en/settings/privacy');
    // Channel settings belong to the channel (opened from it), not to the user's Settings
    await expect(sections.filter({ hasText: 'Channel Settings' })).toHaveCount(0);
    await expect(page.locator('a[href*="/settings/channel/"]')).toHaveCount(0);
  });

  test('SET-011 section links navigate', async ({ page }) => {
    await page.goto('/en/settings');
    await clickAndWaitForURL(page, page.getByTestId('settings-section').filter({ hasText: 'Privacy & data' }), /\/en\/settings\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy & data' })).toBeVisible();
  });

  test('SET-012 Arabic settings are translated and RTL', async ({ page }) => {
    await page.goto('/ar/settings');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'الإعدادات' })).toBeVisible();
    await expect(page.getByText('إدارة حسابك وتفضيلاتك')).toBeVisible();
    for (const title of ['إعدادات الرفع الافتراضية', 'إعدادات الملف الشخصي', 'الخصوصية والبيانات']) {
      await expect(page.getByTestId('settings-section').filter({ hasText: title })).toHaveAttribute('data-available', 'true');
    }
  });
});

test.describe('Settings - no channel', () => {
  test.use({ storageState: AUTH_STATE.none });

  test('SET-020 a user without a channel sees the same sections, none of them about channels', async ({ page }) => {
    await page.goto('/en/settings');
    await expect(page.getByTestId('settings-section')).toHaveCount(4);
    await expect(page.getByTestId('settings-section').filter({ hasText: 'Channel Settings' })).toHaveCount(0);
    await expect(page.getByText('Not available - requires an active channel')).toHaveCount(0);
  });
});

test.describe('Settings - dark theme', () => {
  test.use({ storageState: AUTH_STATE.single, colorScheme: 'dark' });

  test('SET-030 settings cards use the dark palette', async ({ page }) => {
    await page.goto('/en/settings');
    const card = page.getByTestId('settings-section').first();
    await expect(card).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    // The site theme paints the card with its material (--m-card, a gradient over the theme's
    // surface tokens) or, without one, with dark:bg-gray-800, which the bridge maps to
    // --fanous-color-surface. Either way it is drawn from the active theme's dark surface
    // colours, whichever theme the site runs.
    const paint = await card.evaluate((el) => {
      const resolve = (token: string) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = `var(${token})`;
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      };
      const style = getComputedStyle(el);
      return {
        color: style.backgroundColor,
        image: style.backgroundImage,
        surfaces: [resolve('--fanous-color-surface'), resolve('--fanous-color-surface-raised')],
      };
    });
    const painted = `${paint.color} ${paint.image}`;
    expect(
      paint.surfaces.some((surface) => painted.includes(surface)),
      `card paint "${painted}" uses a dark surface token (${paint.surfaces.join(', ')})`,
    ).toBe(true);
  });
});

test.describe('Privacy settings - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('PRIV-001 consent and device sections; export/delete need an account', async ({ page }) => {
    await page.goto('/en/settings/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy & data' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tracking consent' })).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(3);
    await expect(page.getByText('Always on')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Download your data' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Delete your data' })).toHaveCount(0);
    await expect(page.getByText('Sign in to download or delete the data stored in your account.')).toBeVisible();
  });

  test('PRIV-002 saving consent choices writes the cookie and survives reload', async ({ page, context }) => {
    await page.goto('/en/settings/privacy');
    const analytics = page.getByRole('switch', { name: /Viewing analytics/ });
    const performance = page.getByRole('switch', { name: /Performance measurement/ });
    // The fixture pre-rejects everything
    await expect(analytics).not.toBeChecked();
    await analytics.check();
    await performance.check();
    await page.getByRole('button', { name: 'Save choices' }).click();
    // Scoped: the header search has its own (empty) live status region
    await expect(page.getByRole('region', { name: 'Tracking consent' }).getByRole('status')).toHaveText('Your choices have been saved.');
    expect(await consentValue(context)).toMatch(/^v1\.a1\.e0\.p1\.\d+$/);

    await page.reload();
    await expect(page.getByRole('switch', { name: /Viewing analytics/ })).toBeChecked();
    await expect(page.getByRole('switch', { name: /Feature experiments/ })).not.toBeChecked();

    // Withdraw again
    await page.getByRole('switch', { name: /Viewing analytics/ }).uncheck();
    await page.getByRole('switch', { name: /Performance measurement/ }).uncheck();
    await page.getByRole('button', { name: 'Save choices' }).click();
    expect(await consentValue(context)).toMatch(/^v1\.a0\.e0\.p0\.\d+$/);
  });

  test('PRIV-003 clearing device data removes stored personal data', async ({ page }) => {
    await page.goto('/en/settings/privacy');
    await page.evaluate(() => localStorage.setItem('pendingVideoAnalytics', '[1]'));
    await page.getByRole('button', { name: 'Clear data on this device' }).click();
    await page.getByTestId('clear-device-dialog-confirm').click();
    await expect(page.getByRole('region', { name: 'Data on this device' }).getByRole('status')).toHaveText('Data on this device has been cleared.');
    expect(await page.evaluate(() => localStorage.getItem('pendingVideoAnalytics'))).toBeNull();
  });

  test('PRIV-004 Arabic privacy page is RTL and translated', async ({ page }) => {
    await page.goto('/ar/settings/privacy');
    const root = page.locator('div[dir="rtl"]').filter({ has: page.getByRole('heading', { level: 1 }) }).last();
    await expect(root).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'الخصوصية والبيانات' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'حفظ الاختيارات' })).toBeVisible();
    await expect(page.getByRole('switch', { name: /تجارب الميزات/ })).toBeVisible();
  });
});

test.describe('Privacy settings - signed in', () => {
  test.use({ storageState: AUTH_STATE.none });

  test('PRIV-010 offers export, delete and account management', async ({ page }) => {
    await page.goto('/en/settings/privacy');
    await expect(page.getByRole('heading', { name: 'Download your data' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Delete your data' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open account settings' })).toHaveAttribute('href', /^https:\/\/profile\.auth\./);
  });

  test('PRIV-011 delete stays disabled until the confirm word is typed exactly', async ({ page }) => {
    await page.goto('/en/settings/privacy');
    const confirm = page.locator('#privacy-delete-confirm');
    const del = page.getByRole('button', { name: 'Delete my data' });
    await expect(del).toBeDisabled();
    await confirm.fill('delete');
    await expect(del).toBeDisabled();
    await expect(page.locator('label[for="privacy-delete-confirm"]')).toHaveText('Type DELETE to confirm');
    await confirm.fill('DELETE');
    await expect(del).toBeEnabled();
    // Not clicked: it would erase the shared E2E account's data
    await confirm.fill('');
    await expect(del).toBeDisabled();
  });

  test('PRIV-012 exports the account data as a JSON download', async ({ page }) => {
    // The export scans every shared R2 object in resumable passes, so a full export grows
    // with all of QA's data (issue #184: ~2 min in Nov 2026, now past 5 min). This test
    // checks the flow, not export speed: the first pass goes to the real API (auth,
    // status, attachment header, JSON body), then is marked complete so the page builds
    // and downloads the file. Following resume tokens is covered by privacy.service.test.ts.
    test.setTimeout(150_000);
    let firstPass: { status: number; disposition: string } | undefined;
    await page.route(/\/api\/privacy\/export(\?|$)/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch({ timeout: 90_000 });
      firstPass = { status: response.status(), disposition: response.headers()['content-disposition'] ?? '' };
      if (!response.ok()) return route.fulfill({ response });
      const body = (await response.json()) as Record<string, unknown>;
      delete body.resumeToken;
      await route.fulfill({ response, json: { ...body, complete: true } });
    });
    await page.goto('/en/settings/privacy');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 100_000 }),
      page.getByRole('button', { name: 'Download my data' }).click(),
    ]);
    expect(firstPass?.status, 'first export pass status').toBe(200);
    expect(firstPass?.disposition).toMatch(/attachment; filename="al-ummah-now-data-\d{4}-\d{2}-\d{2}\.json"/);
    expect(download.suggestedFilename()).toMatch(/^al-ummah-now-data-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(page.getByRole('region', { name: 'Download your data' }).getByRole('status')).toBeVisible();
  });
});
