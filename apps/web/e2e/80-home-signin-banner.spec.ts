import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';

/**
 * The sign-in banner at the top of the videos home page (components/home/SignInBanner.tsx):
 * signed-out visitors see it (en and ar), signed-in users never get it (not even in the
 * server HTML), the X hides it for 30 days in this browser without a flash on the next visit,
 * and "Sign in" starts the normal sign-in flow back to the home page.
 * Reads no videos, so it needs no data of its own.
 */

const STORAGE_KEY = 'aun:home-signin-banner:dismissed-at';

const banner = (page: Page) => page.getByTestId('signin-banner');

/** Layout shifts without recent input, summed from the first paint (as Lighthouse's CLS) */
async function watchLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!e.hadRecentInput) w.__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

const cls = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);

test.describe('Home sign-in banner - signed out', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('BANNER-001 is in the server HTML and shown as a labelled region at the top of the page (en)', async ({ page, request }) => {
    const html = await (await request.get('/en')).text();
    expect(html, 'the banner is rendered on the server (no flash, no shift)').toContain('data-testid="signin-banner"');

    await watchLayoutShift(page);
    await page.goto('/en');
    const region = page.getByRole('region', { name: 'Join Al Ummah Now' });
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute('dir', 'ltr');
    await expect(region.getByRole('heading', { name: 'Sign in to take part, create and share' })).toBeVisible();
    await expect(region.getByRole('list', { name: 'What you can do with an account' }).getByRole('listitem')).toHaveCount(6);
    await expect(region.getByRole('button', { name: 'Sign in' })).toBeVisible();
    // Above the featured video and the grid
    const top = await page.evaluate(() => {
      const b = document.querySelector('[data-testid=signin-banner]')!.getBoundingClientRect().top;
      const h1 = document.querySelector('main h1')!.getBoundingClientRect().top;
      return { b, h1 };
    });
    expect(top.b).toBeLessThan(top.h1);
    // No sideways scroll
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.waitForTimeout(1000);
    expect(await cls(page), 'cumulative layout shift').toBeLessThan(0.01);
  });

  test('BANNER-002 is right to left in Arabic, and keyboard reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ar');
    const region = page.getByRole('region', { name: 'انضم إلى الأمة الآن' });
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute('dir', 'rtl');
    // The close button sits in the end corner: the left in RTL
    const geo = await region.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = el.querySelector('[data-testid=signin-banner-dismiss]')!.getBoundingClientRect();
      return { left: x.left - r.left, right: r.right - x.right };
    });
    expect(geo.left).toBeLessThan(geo.right);
    // Both controls take keyboard focus
    const signIn = region.getByRole('button', { name: 'تسجيل الدخول' });
    await signIn.focus();
    await expect(signIn).toBeFocused();
    const close = region.getByRole('button', { name: 'إخفاء هذه الرسالة' });
    await close.focus();
    await expect(close).toBeFocused();
  });

  test('BANNER-003 the X hides it, and it stays hidden after a reload with no flash or shift', async ({ page }) => {
    await page.goto('/en');
    await expect(banner(page)).toBeVisible();
    await banner(page).getByRole('button', { name: 'Hide this message' }).focus();
    await page.keyboard.press('Enter');
    await expect(banner(page)).toHaveCount(0);
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(Number(stored)).toBeGreaterThan(Date.now() - 60_000);

    // Next visit: the server still sends the banner (it cannot read localStorage), the pre-paint
    // script hides it before the first paint, so it is never seen and nothing moves
    await watchLayoutShift(page);
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.querySelector('[data-testid=signin-banner]');
        (window as unknown as { __bannerAtLoad: string }).__bannerAtLoad = el ? getComputedStyle(el).display : 'absent';
      });
    });
    await page.reload();
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __bannerAtLoad: string }).__bannerAtLoad)).toMatch(/^(none|absent)$/);
    await expect(page.locator('html')).toHaveAttribute('data-signin-banner', 'hidden');
    await expect(banner(page)).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(await cls(page), 'cumulative layout shift').toBeLessThan(0.01);

    // Also on /ar, and after a dismissal older than 30 days it is back
    await page.goto('/ar');
    await expect(page.locator('main h1')).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    await page.evaluate((k) => localStorage.setItem(k, String(Date.now() - 31 * 24 * 60 * 60 * 1000)), STORAGE_KEY);
    await page.reload();
    await expect(banner(page)).toBeVisible();
  });

  test('BANNER-004 Sign in starts the normal sign-in flow, back to the home page', async ({ page, context }) => {
    await page.goto('/en');
    await banner(page).getByRole('button', { name: 'Sign in' }).click();
    // The issuer's sign-in form (the same flow as the header's Sign In)
    await page.waitForSelector('input[name="email"]', { timeout: 30000 });
    const ret = (await context.cookies()).find((c) => c.name === 'auth_return');
    if (ret) expect(decodeURIComponent(ret.value)).toMatch(/^\/en\/?$/);
  });
});

test.describe('Home sign-in banner - signed in', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('BANNER-005 a signed-in user never gets it, not even in the server HTML', async ({ page }) => {
    let html = '';
    page.on('response', async (res) => {
      if (res.request().resourceType() === 'document' && new URL(res.url()).pathname === '/en') html = await res.text().catch(() => '');
    });
    await page.goto('/en');
    await expect(page.locator('main h1')).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    expect(html).not.toBe('');
    expect(html).not.toContain('data-testid="signin-banner"');
    await page.goto('/ar');
    await expect(page.locator('main h1')).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });
});
