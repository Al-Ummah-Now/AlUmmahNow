import { test, expect } from './support/fixtures';
import { expectNoAxeViolations, setPreferences } from './support/ui';
import { storageStatePath } from './support/env';
import type { Locale, Theme } from '../src/i18n/config';
import type { Page } from '@playwright/test';

const VARIANTS: { locale: Locale; theme: Theme }[] = [
  { locale: 'en', theme: 'light' },
  { locale: 'en', theme: 'dark' },
  { locale: 'ar', theme: 'light' },
  { locale: 'ar', theme: 'dark' },
];

const AUTH_PAGES: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  { name: 'dashboard', path: '/dashboard', ready: async (p) => expect(p.getByTestId('stat-total')).toBeVisible() },
  { name: 'moderation', path: '/moderation', ready: async (p) => expect(p.getByTestId('reports-total')).toBeVisible() },
  { name: 'translations', path: '/translations', ready: async (p) => expect(p.getByTestId('translation-row').first()).toBeVisible({ timeout: 30_000 }) },
  { name: 'site-visits', path: '/site-visits', ready: async (p) => expect(p.getByTestId('site-visits-panel')).toBeVisible({ timeout: 30_000 }) },
  { name: 'delivery', path: '/delivery', ready: async (p) => expect(p.getByTestId('delivery-jobs-section')).toBeVisible({ timeout: 30_000 }) },
  { name: 'media-providers', path: '/media-providers', ready: async (p) => expect(p.getByTestId('providers-settings')).toBeVisible({ timeout: 30_000 }) },
  { name: 'indices', path: '/indices', ready: async (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'not-found', path: '/no-such-page', ready: async (p) => expect(p.getByTestId('not-found')).toBeVisible() },
];

// Scan settled colours, not mid-transition ones
test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.describe('axe - signed in pages', () => {
  for (const variant of VARIANTS) {
    for (const target of AUTH_PAGES) {
      test(`A11Y-01 ${target.name} [${variant.locale}/${variant.theme}]`, async ({ page }) => {
        await setPreferences(page, variant);
        await page.goto(target.path);
        await target.ready(page);
        await expectNoAxeViolations(page, `${target.path} ${variant.locale}/${variant.theme}`);
      });
    }

    test(`A11Y-02 report detail with actions [${variant.locale}/${variant.theme}]`, async ({ page, makeReport }) => {
      const report = await makeReport({ label: 'a11y' });
      await setPreferences(page, variant);
      await page.goto(`/moderation/reports/${report.id}`);
      await expect(page.getByTestId('report-actions')).toBeVisible();
      // Selected state, the outcomes that are not offered and the error alert are part of the scanned UI too
      await page.getByTestId('report-actions').locator('button[data-action="dismissed"]').click();
      await expectNoAxeViolations(page, `report ${variant.locale}/${variant.theme}`);
    });
  }

  for (const theme of ['dark', 'light'] as const) {
    test(`A11Y-05 BackLink keeps contrast and is never covered by heading plates under Fawanees [${theme}]`, async ({ page }) => {
      await setPreferences(page, { locale: 'en', theme });
      await page.goto('/users/invites/new');
      await expect(page.locator('#main-content a.street-plate').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#main-content h1').first()).toBeVisible();

      await page.evaluate(async (mode) => {
        const html = document.documentElement;
        html.style.setProperty('--fanous-street-on', '1');
        html.dataset.theme = 'fawanees';
        html.classList.toggle('dark', mode === 'dark');
        html.classList.toggle('light', mode === 'light');
        html.classList.add('fanous-street');
        await new Promise((r) => requestAnimationFrame(r));
      }, theme);

      const check = await page.evaluate(() => {
        const problems: string[] = [];
        const html = document.documentElement;
        if (!html.classList.contains('fanous-street')) {
          problems.push('html.fanous-street was stripped before measurement');
        }
        const backLink = document.querySelector<HTMLElement>('#main-content a.street-plate');
        const heading = document.querySelector<HTMLElement>('#main-content h1');
        if (!backLink) return { problems: ['BackLink (.street-plate) not found'], ratio: 0 };
        if (!heading) return { problems: ['page h1 not found'], ratio: 0 };

        // Heading plate must paint on ::before at z-index: -1, never on the host element over BackLink
        const h1Cs = getComputedStyle(heading);
        const h1Before = getComputedStyle(heading, '::before');
        if (h1Cs.boxShadow !== 'none') problems.push(`h1 host paints box-shadow: ${h1Cs.boxShadow}`);
        if (h1Cs.zIndex !== 'auto') problems.push(`h1 host creates stacking context: z-index ${h1Cs.zIndex}`);
        if (h1Before.zIndex !== '-1' || h1Before.boxShadow === 'none') {
          problems.push(`h1::before missing street plate (zIndex=${h1Before.zIndex}, boxShadow=${h1Before.boxShadow})`);
        }

        // BackLink plate paints on ::before at z-index: -1 behind its own text
        const linkCs = getComputedStyle(backLink);
        const linkBefore = getComputedStyle(backLink, '::before');
        if (linkCs.boxShadow !== 'none') problems.push(`BackLink host paints box-shadow: ${linkCs.boxShadow}`);
        if (linkCs.zIndex !== 'auto') problems.push(`BackLink host creates stacking context: z-index ${linkCs.zIndex}`);
        if (linkBefore.zIndex !== '-1' || linkBefore.boxShadow === 'none') {
          problems.push(`BackLink::before missing street plate (zIndex=${linkBefore.zIndex}, boxShadow=${linkBefore.boxShadow})`);
        }

        // BackLink center must not be covered by another element
        const rect = backLink.getBoundingClientRect();
        const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!topEl || (topEl !== backLink && !backLink.contains(topEl))) {
          problems.push(`BackLink center covered by ${topEl?.tagName ?? 'null'}`);
        }

        // Resolve computed link foreground and plate background via a 1x1 canvas (handles rgb/oklch/color-mix).
        // Reject invalid or non-opaque colours so a missing plate never falls back to transparent/black.
        const toOpaqueRgb = (cssColor: string): [number, number, number] | null => {
          if (!cssColor || !CSS.supports('color', cssColor)) return null;
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d')!;
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = cssColor;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
          return a === 255 ? [r, g, b] : null;
        };
        const lum = ([r, g, b]: [number, number, number]) => {
          const lin = [r, g, b].map((c) => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
        };
        const fg = toOpaqueRgb(linkCs.color);
        const bg = toOpaqueRgb(linkBefore.backgroundColor);
        if (!fg) problems.push(`BackLink foreground colour is invalid or transparent: ${linkCs.color}`);
        if (!bg) problems.push(`BackLink::before plate background is invalid or transparent: ${linkBefore.backgroundColor}`);
        const ratio = fg && bg ? (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05) : 0;

        return { problems, ratio };
      });

      expect(check.problems, check.problems.join('; ')).toEqual([]);
      expect(check.ratio, `BackLink WCAG contrast ratio under Fawanees ${theme}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe('axe - public pages', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const variant of VARIANTS) {
    test(`A11Y-03 login error [${variant.locale}/${variant.theme}]`, async ({ page }) => {
      await setPreferences(page, variant);
      await page.goto('/login?error=auth_failed');
      await expectNoAxeViolations(page, `login error ${variant.locale}/${variant.theme}`);
    });
  }
});

test.describe('axe - access denied', () => {
  test.use({ storageState: storageStatePath('nonadmin') });

  for (const variant of VARIANTS) {
    test(`A11Y-04 access denied [${variant.locale}/${variant.theme}]`, async ({ page }) => {
      await setPreferences(page, variant);
      await page.goto('/access-denied');
      await expectNoAxeViolations(page, `access-denied ${variant.locale}/${variant.theme}`);
    });
  }
});

test.describe('keyboard', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'keyboard navigation is checked on desktop projects');
  });

  test('KBD-01 skip link is the first tab stop and moves focus to main', async ({ page, browserName }) => {
    await page.goto('/dashboard');
    // WebKit only tabs to links with the "Press Tab to highlight each item" setting
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/);
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('KBD-02 nav links are reachable and show a focus indicator', async ({ page, browserName }) => {
    await page.goto('/dashboard');
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    const labels = ['Dashboard', 'Moderation', 'Translations', 'Indices'];
    const reached: string[] = [];
    // Tabs until every label is reached (the nav grows; a fixed count broke when items were added)
    for (let i = 0; i < 40 && !labels.every((l) => reached.includes(l)); i++) {
      await page.keyboard.press(tab);
      const name = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? '');
      reached.push(name);
    }
    for (const label of labels) {
      expect(reached, `tab order: ${reached.join(' | ')}`).toContain(label);
    }
    await page.getByRole('link', { name: 'Moderation', exact: true }).focus();
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return style.boxShadow !== 'none' || (style.outlineStyle !== 'none' && style.outlineWidth !== '0px');
    });
    expect(outline).toBe(true);
  });

  test('KBD-03 a moderation action can be completed with the keyboard', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'kbd' });
    await page.goto(`/moderation/reports/${report.id}`);
    const dismiss = page.getByTestId('report-actions').locator('button[data-action="dismissed"]');
    await dismiss.focus();
    await page.keyboard.press('Space');
    await expect(dismiss).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Notes (optional)').focus();
    await page.keyboard.type('keyboard only');
    await page.getByTestId('confirm-action').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/moderation$/, { timeout: 30_000 });
  });

  test('KBD-04 translation edit opens with focus in the textbox and Escape cancels', async ({ page }) => {
    await page.goto('/translations');
    const edit = page.getByRole('button', { name: 'Edit appName' });
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Value for appName' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Value for appName' })).toHaveCount(0);
  });
});
