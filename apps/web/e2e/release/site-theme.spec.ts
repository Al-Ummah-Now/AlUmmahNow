/**
 * Release regression: an admin switches the site theme in admin-web (#492)
 * and the videos site renders it (#525 picks html[data-theme] at runtime from
 * admin-api /public/site-theme). The original theme is put back afterwards.
 *
 * The theme is one setting for the whole environment. Pull-request runs share
 * QA with each other, so two of them switching at once would see each other's
 * theme and could restore the wrong one: this spec runs on stage (one release
 * at a time) and in manual QA runs, not on pull requests.
 */
import { test, expect, type Page } from '@playwright/test';
import { promoteToAdmin } from './sink';
import { sinkEmail, target, TEST_PASSWORD } from './targets';
import { completeRegistration } from './web-session';
import { fillSecret } from './secret-fill';

// Signs in through the auth server: the trace would hold the password and code
test.use({ trace: 'off' });

const THEMES = ['lantern', 'zujaj', 'nahas', 'fawanees'] as const;
type Theme = (typeof THEMES)[number];
// admin-api caches /public/site-theme for 30s and the web app revalidates it every 30s
const PROPAGATION_MS = 120000;

async function publicTheme(): Promise<string | undefined> {
  const res = await fetch(`${target().adminApi}/public/site-theme`, { cache: 'no-store' });
  expect(res.status, 'GET /public/site-theme').toBe(200);
  return ((await res.json()) as { theme?: string }).theme;
}

/** The theme in the first HTML of a fresh visit (server-rendered, so no client state). */
async function renderedTheme(): Promise<string | undefined> {
  const html = await (await fetch(`${target().web}/en?theme-check=${Date.now()}`, { cache: 'no-store' })).text();
  return /<html[^>]*data-theme="(\w+)"/.exec(html)?.[1];
}

async function signInAsAdmin(page: Page): Promise<void> {
  const email = sinkEmail('rel-theme');
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await completeRegistration(page, email);
  await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });
  await promoteToAdmin(email);
  // New tokens carry the role: drop every session and sign in from scratch
  await page.context().clearCookies();
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await page.fill('input[name="email"]', email);
  await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
  await page.click('button[data-component="button"]');
  await expect(page).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });
}

/** Applies a theme on the admin page and waits until the page shows it as current. */
async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.getByTestId(`site-theme-apply-${theme}`).click();
  await expect(page.getByTestId(`site-theme-${theme}`)).toHaveAttribute('aria-current', 'true', { timeout: 15000 });
  await expect(page.getByTestId('site-theme-failed')).toHaveCount(0);
}

test.describe('Release: site theme from admin-web', () => {
  test('an admin switches the theme and the videos site renders it', async ({ page, browser }) => {
    test.skip(!process.env.TEST_PROMOTE_SECRET, 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    test.skip(
      process.env.GITHUB_EVENT_NAME === 'pull_request',
      'pull-request runs share QA: switching the one site theme would race other runs (runs on stage and in manual QA runs)',
    );
    test.setTimeout(6 * 60000);

    await signInAsAdmin(page);
    await page.goto(`${target().adminWeb}/site-theme`);
    await expect(page.getByTestId('site-theme-options')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('site-theme-admin-only')).toHaveCount(0);
    await expect(page.getByTestId('site-theme-error')).toHaveCount(0);
    await expect(page.locator('[data-testid^="site-theme-"][aria-current="true"]')).toHaveCount(1);

    // Every theme has a card; the current one is the public one
    for (const theme of THEMES) await expect(page.getByTestId(`site-theme-${theme}`)).toBeVisible();
    const currentId = (await page.locator('[data-testid^="site-theme-"][aria-current="true"]').getAttribute('data-testid'))!;
    const original = currentId.replace('site-theme-', '') as Theme;
    expect(THEMES).toContain(original);
    await expect.poll(publicTheme, { timeout: 60000 }).toBe(original);

    const next = THEMES[(THEMES.indexOf(original) + 1) % THEMES.length];
    try {
      await applyTheme(page, next);
      await expect.poll(publicTheme, { message: `/public/site-theme never answered ${next}`, timeout: PROPAGATION_MS, intervals: [5000] }).toBe(next);
      await expect.poll(renderedTheme, { message: `the videos site never rendered ${next}`, timeout: PROPAGATION_MS, intervals: [5000] }).toBe(next);

      // A visitor's browser gets the new theme on the html element, and the frame follows it
      const visitor = await browser.newContext();
      const site = await visitor.newPage();
      await site.goto(`${target().web}/en`);
      await expect(site.locator('html')).toHaveAttribute('data-theme', next);
      await expect(site.locator('header.ah')).toBeVisible();
      await visitor.close();
    } finally {
      // Put the environment back however the test went
      await page.goto(`${target().adminWeb}/site-theme`);
      await applyTheme(page, original);
    }
    await expect.poll(publicTheme, { timeout: PROPAGATION_MS, intervals: [5000] }).toBe(original);
    await expect.poll(renderedTheme, { timeout: PROPAGATION_MS, intervals: [5000] }).toBe(original);
  });
});
