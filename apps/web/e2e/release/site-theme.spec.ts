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
import { adminConfirm, confirmInApp } from './in-app-confirm';
import { target } from './targets';
import { signInAsAdmin } from './admin-session';
import { fetchRetry } from './net';

// Signs in through the auth server: the trace would hold the password and code
test.use({ trace: 'off' });

const THEMES = ['lantern', 'zujaj', 'nahas', 'fawanees'] as const;
type Theme = (typeof THEMES)[number];
// admin-api caches /public/site-theme for 30s and the web app revalidates it every 30s
const PROPAGATION_MS = 120000;

async function publicTheme(): Promise<string | undefined> {
  const res = await fetchRetry(`${target().adminApi}/public/site-theme`, { cache: 'no-store' });
  expect(res.status, 'GET /public/site-theme').toBe(200);
  return ((await res.json()) as { theme?: string }).theme;
}

/** The theme in the first HTML of a fresh visit (server-rendered, so no client state). */
async function renderedTheme(): Promise<string | undefined> {
  const html = await (await fetchRetry(`${target().web}/en?theme-check=${Date.now()}`, { cache: 'no-store' })).text();
  return /<html[^>]*data-theme="([a-z][a-z0-9-]*)"/.exec(html)?.[1];
}

/** Applies a theme on the admin page and waits until the page shows it as current. */
async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.getByTestId(`site-theme-apply-${theme}`).click();
  await expect(page.getByTestId(`site-theme-${theme}`)).toHaveAttribute('aria-current', 'true', { timeout: 15000 });
  await expect(page.getByTestId('site-theme-failed')).toHaveCount(0);
}

const canBeAdmin = () => !!process.env.TEST_PROMOTE_SECRET || !!(process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD);

// One site theme per environment: these tests change it in turn, never at once
test.describe.configure({ mode: 'serial' });

test.describe('Release: site theme from admin-web', () => {
  test('an admin switches the theme and the videos site renders it', async ({ page, browser }) => {
    test.skip(!canBeAdmin(), 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    test.skip(
      process.env.GITHUB_EVENT_NAME === 'pull_request',
      'pull-request runs share QA: switching the one site theme would race other runs (runs on stage and in manual QA runs)',
    );
    test.setTimeout(6 * 60000);

    await signInAsAdmin(page, 'rel-theme');
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

/** A small, safe SVG for the image the test puts into its package. */
const ORNAMENT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M20 2 24 16 38 20 24 24 20 38 16 24 2 20 16 16Z" fill="#f4ae3a" opacity=".5"/></svg>';
const SHEEN = '#fff2c8';

async function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

test.describe('Release: theme builder', () => {
  test('duplicate Fawanees, change a token and an image, publish, use it on the site, restore, delete', async ({ page, browser }) => {
    test.skip(!canBeAdmin(), 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    test.skip(
      process.env.GITHUB_EVENT_NAME === 'pull_request',
      'pull-request runs share QA: switching the one site theme would race other runs (runs on stage and in manual QA runs)',
    );
    test.setTimeout(8 * 60000);
    const id = `rel-theme-${Date.now().toString(36)}`;

    await signInAsAdmin(page, 'rel-theme');
    await page.goto(`${target().adminWeb}/site-theme`);
    await expect(page.getByTestId('theme-library')).toBeVisible({ timeout: 30000 });
    const currentId = (await page.locator('[data-testid^="site-theme-"][aria-current="true"]').getAttribute('data-testid'))!;
    const original = currentId.replace('site-theme-', '') as Theme;
    expect(THEMES, 'the run starts from a built-in theme').toContain(original);

    let created = false;
    let activated = false;
    try {
      // Duplicate the default theme as the starting point
      await page.getByTestId('theme-duplicate-fawanees').click();
      await page.getByTestId('theme-duplicate-id').fill(id);
      await page.getByTestId('theme-duplicate-name-en').fill('Release check');
      await page.getByTestId('theme-duplicate-name-ar').fill('فحص الإصدار');
      await page.getByTestId('theme-duplicate-create').click();
      await expect(page).toHaveURL(`${target().adminWeb}/site-theme/themes/${id}`, { timeout: 60000 });
      created = true;
      await expect(page.getByTestId('theme-editor')).toBeVisible();
      await expect(page.getByTestId('theme-issues')).toHaveAttribute('data-count', '0');
      // The preview renders the site's real components with the package
      const frame = page.frameLocator('[data-testid="theme-preview-frame"]');
      await expect(frame.locator('header.ah')).toBeVisible();

      // A token: the sheen of the primary colour, in both modes
      await page.getByTestId('section-colours').click();
      for (const mode of ['dark', 'light'] as const) {
        await page.getByTestId(`edit-mode-${mode}`).click();
        await page.getByTestId(`role-${mode}-primarySheen-text`).fill(SHEEN);
      }
      await expect(page.getByTestId('theme-editor-dirty')).toBeVisible();

      // An image: upload it into the package and paint it on the page background
      await page.getByTestId('section-imagery').click();
      await page.getByTestId('image-upload-ornament').click();
      await page.getByTestId('asset-file-input').setInputFiles({ name: 'rel-ornament.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(ORNAMENT) });
      await expect(page.getByTestId('image-slot-ornament').locator('img')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('section-components').click();
      await page.getByTestId('component-select').selectOption('page');
      const background = page.getByTestId('style-page-background-text');
      const before = await background.inputValue();
      await background.fill(`{asset:assets/rel-ornament.svg} top/48px repeat,${before}`);
      await expect(page.getByTestId('theme-issues')).toHaveAttribute('data-count', '0');
      await expect.poll(() => frame.locator('body').evaluate((b) => getComputedStyle(b).backgroundImage), { timeout: 10000 }).toContain('rel-ornament.svg');

      await page.getByTestId('theme-save').click();
      await expect(page.getByTestId('theme-editor-notice')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('theme-publish').click();
      await expect(page.getByTestId('theme-editor-status')).toContainText('1.0.0', { timeout: 60000 });
      await page.getByTestId('theme-activate').click();
      activated = true;
      await expect(page.getByTestId('theme-editor-active')).toContainText('1.0.0', { timeout: 30000 });

      await expect.poll(publicTheme, { message: `/public/site-theme never answered ${id}`, timeout: PROPAGATION_MS, intervals: [5000] }).toBe(id);
      await expect.poll(renderedTheme, { message: `the videos site never rendered ${id}`, timeout: PROPAGATION_MS, intervals: [5000] }).toBe(id);

      // A visitor gets the package: its token, its image, served from the site's own origin
      for (const colorScheme of ['dark', 'light'] as const) {
        const visitor = await browser.newContext({ colorScheme });
        const site = await visitor.newPage();
        await site.goto(`${target().web}/en`);
        await expect(site.locator('html')).toHaveAttribute('data-theme', id);
        await expect(site.locator('style#theme-package')).toHaveCount(1);
        await expect.poll(() => cssVar(site, '--fanous-color-primary-sheen')).toBe(SHEEN);
        const image = await site.locator('body').evaluate((b) => getComputedStyle(b).backgroundImage);
        expect(image).toContain(`/api/theme-packages/${id}/1.0.0/assets/rel-ornament.svg`);
        const asset = await site.request.get(`${target().web}/api/theme-packages/${id}/1.0.0/assets/rel-ornament.svg`);
        expect(asset.status()).toBe(200);
        expect(asset.headers()['content-type']).toContain('image/svg+xml');
        await expect(site.locator('header.ah')).toBeVisible();
        await visitor.close();
      }
    } finally {
      // Put the environment back however the test went, then remove the test theme
      if (activated) {
        await page.goto(`${target().adminWeb}/site-theme`);
        await applyTheme(page, original);
      }
      if (created) {
        await page.goto(`${target().adminWeb}/site-theme`);
        // Builds before the in-app dialog used window.confirm
        page.once('dialog', (dialog) => void dialog.accept());
        await page.getByTestId(`theme-delete-${id}`).click();
        await confirmInApp(page, adminConfirm('theme-delete-confirm'), id);
        await expect(page.getByTestId(`theme-row-${id}`)).toHaveCount(0, { timeout: 30000 });
      }
    }
    await expect.poll(publicTheme, { timeout: PROPAGATION_MS, intervals: [5000] }).toBe(original);
    await expect.poll(renderedTheme, { timeout: PROPAGATION_MS, intervals: [5000] }).toBe(original);
    const gone = await fetchRetry(`${target().adminApi}/public/themes/${id}/1.0.0/theme.css`);
    expect(gone.status, 'the deleted theme is no longer served').toBe(404);
  });
});
