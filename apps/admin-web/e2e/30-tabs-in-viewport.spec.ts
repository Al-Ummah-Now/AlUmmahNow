/**
 * No tab is ever shown half cut at an edge (owner rule; #1669, as the videos site's Studio tabs in
 * #1659): on phones a tab strip wraps onto more rows instead of scrolling sideways. At 360 and 390
 * px, English and Arabic, every tab on Payments and App config sits wholly inside the window and
 * inside its strip. Read-only: it opens the pages as a super admin and changes nothing.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { storageStatePath } from './support/env';
import { setPreferences } from './support/ui';

test.use({ storageState: storageStatePath('superadmin') });

const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
] as const;

const PAGES = [
  { path: '/payments', strip: 'payments-tabs', min: 4 },
  { path: '/app-config', strip: 'app-config-tab-', min: 2 },
] as const;

/** Every visible tab: wholly inside the window and inside each ancestor that clips it sideways. */
async function cutTabs(page: Page): Promise<{ checked: number; cut: string[]; sideways: number }> {
  return page.evaluate(() => {
    const cut: string[] = [];
    let checked = 0;
    for (const el of document.querySelectorAll<HTMLElement>('[role="tab"], [data-testid="payments-tabs"] > a')) {
      if (el.closest('[aria-hidden="true"], [inert], [hidden]')) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      checked++;
      const label = `"${(el.textContent ?? '').trim().slice(0, 40)}" x ${Math.round(r.left)}..${Math.round(r.right)}`;
      if (r.left < -1 || r.right > innerWidth + 1) {
        cut.push(`${label}: outside the window (0..${innerWidth})`);
        continue;
      }
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX === 'visible') continue;
        const b = p.getBoundingClientRect();
        if (r.left < b.left - 1 || r.right > b.right + 1) {
          cut.push(`${label}: cut by its strip (${Math.round(b.left)}..${Math.round(b.right)})`);
          break;
        }
      }
    }
    return { checked, cut, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
}

test.describe('tabs stay whole on phones', () => {
  test.skip(({ isMobile }) => isMobile, 'viewports are set per test');

  for (const vp of VIEWPORTS) {
    for (const locale of ['en', 'ar'] as const) {
      test(`TABS-VP ${vp.width}px ${locale}: Payments and App config`, async ({ page }) => {
        await page.setViewportSize(vp);
        await setPreferences(page, { locale });
        for (const { path, strip, min } of PAGES) {
          await page.goto(path);
          await expect(page.locator(`[data-testid^="${strip}"]`).first()).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const report = await cutTabs(page);
          expect(report.checked, `${path}: tabs checked`).toBeGreaterThanOrEqual(min);
          expect.soft(report.cut, `${path} ${vp.width}px ${locale}: tabs half shown at an edge`).toEqual([]);
          expect.soft(report.sideways, `${path} ${vp.width}px ${locale}: the page scrolls sideways`).toBeLessThanOrEqual(0);
        }
      });
    }
  }
});
