/**
 * Release regression: every key page has exactly one level-1 heading, and it
 * is the page's own heading, in English and Arabic.
 *
 * Seen on QA (2026-11-09): admin-web's Arabic not-found check read
 * "Al Ummah Now" instead of the page title. A site title or brand rendered as
 * an <h1> in a shared header would give every page two h1s and break both
 * screen-reader navigation and every heading-based test. The brand belongs in
 * a link or plain text; the h1 belongs to the page.
 *
 * Counts headings by role, as assistive technology sees them (an h1 hidden
 * at this viewport is not counted). Web pages need no user; the admin pages
 * use a promoted sink admin and skip without TEST_PROMOTE_SECRET.
 */
import { test, expect, type Page } from '@playwright/test';
import { promoteToAdmin } from './sink';
import { sinkEmail, target, TEST_PASSWORD } from './targets';
import { completeRegistration } from './web-session';
import { fillSecret } from './secret-fill';
import { watchUrl } from './videos';

// Signs in through the auth server: a retained trace would hold the password and code
test.use({ trace: 'off' });

type Locale = 'en' | 'ar';
const LOCALES: Locale[] = ['en', 'ar'];

async function firstPublicId(path: string): Promise<string> {
  const res = await fetch(`${target().api}${path}`);
  expect(res.ok, `GET ${path} answered ${res.status}`).toBe(true);
  const id = ((await res.json()) as { data?: Array<{ id?: string }> }).data?.find((row) => row.id)?.id;
  expect(id, `GET ${path} listed nothing`).toBeTruthy();
  return id!;
}

/** Asserts the page shows exactly one h1 (soft, so one run lists every offender). */
async function expectSingleH1(page: Page, name: string): Promise<void> {
  const h1 = page.getByRole('heading', { level: 1 });
  // Client-rendered pages add their heading after hydration
  await expect(h1.first(), `${name}: no h1`).toBeVisible({ timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const texts = (await h1.allTextContents()).map((t) => t.trim());
  expect.soft(texts, `${name}: exactly one h1 (found ${JSON.stringify(texts)})`).toHaveLength(1);
}

test.describe('Release: one h1 per page', () => {
  test('videos site pages (en, ar)', async ({ page }) => {
    test.setTimeout(300000);
    const web = target().web;
    const [videoId, channelId] = await Promise.all([firstPublicId('/api/videos?limit=1'), firstPublicId('/api/channels?limit=1')]);
    for (const locale of LOCALES) {
      const pages: Array<[string, string]> = [
        ['home', `${web}/${locale}`],
        ['explore', `${web}/${locale}/explore`],
        ['channels', `${web}/${locale}/channels`],
        ['channel', `${web}/${locale}/channels/${encodeURIComponent(channelId)}`],
        ['watch', watchUrl(videoId, locale)],
        ['videos', `${web}/${locale}/videos`],
        ['live', `${web}/${locale}/live`],
        ['community guidelines', `${web}/${locale}/community-guidelines`],
        ['not found', `${web}/${locale}/no-such-page-${Date.now()}`],
      ];
      for (const [name, url] of pages) {
        await page.goto(url, { waitUntil: 'load' });
        await expectSingleH1(page, `${name} (${locale})`);
      }
    }
  });

  test('admin pages (en, ar)', async ({ page, context }) => {
    test.skip(!process.env.TEST_PROMOTE_SECRET, 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    test.setTimeout(300000);
    const { adminWeb, auth } = target();
    const email = sinkEmail('rel-admin-h1');

    await page.goto(`${adminWeb}/login`);
    await expect(page).toHaveURL(new RegExp(`^${auth}`), { timeout: 30000 });
    await completeRegistration(page, email);
    await expect(page).toHaveURL(`${adminWeb}/access-denied`, { timeout: 30000 });
    // The non-admin's view of the admin app
    await expectSingleH1(page, 'access denied');

    await promoteToAdmin(email);
    await context.clearCookies();
    await page.goto(`${adminWeb}/login`);
    await expect(page).toHaveURL(new RegExp(`^${auth}`), { timeout: 30000 });
    await page.fill('input[name="email"]', email);
    await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
    await page.click('button[data-component="button"]');
    await expect(page).toHaveURL(`${adminWeb}/dashboard`, { timeout: 30000 });

    const host = new URL(adminWeb).hostname;
    for (const locale of LOCALES) {
      await context.addCookies([{ name: 'admin_locale', value: locale, domain: host, path: '/' }]);
      for (const path of ['/dashboard', '/moderation', '/moderation/ai', '/translations', '/indices', '/site-theme', `/no-such-page-${Date.now()}`]) {
        await page.goto(`${adminWeb}${path}`, { waitUntil: 'load' });
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expectSingleH1(page, `admin ${path} (${locale})`);
      }
    }
  });
});
