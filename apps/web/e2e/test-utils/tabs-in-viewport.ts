import { expect, type Page } from '@playwright/test';

/**
 * Tabs and chips (owner rule, #1669): no tab or chip is ever shown half cut at an edge. Phones wrap
 * the strip onto more rows instead of scrolling it sideways.
 *
 * Every visible tab or chip on the page (`.tab-item`, `[role=tab]`, a toggle chip in a
 * `[role=group]`, a Studio tab) must sit wholly inside the window, and wholly inside each ancestor
 * that clips it sideways (a scroll strip that ends before the window's edge cuts a tab too).
 * Returns what it checked, so a spec can also assert that the strip it is about was there.
 */
export const TAB_OR_CHIP = '.tab-item, [role="tab"], [role="group"] > button[aria-pressed], [data-testid="studio-tabs"] > a';

export interface StripReport {
  checked: number;
  cut: string[];
  sideways: number;
}

export async function tabsAndChipsInView(page: Page): Promise<StripReport> {
  return page.evaluate((selector) => {
    const cut: string[] = [];
    let checked = 0;
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
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
  }, TAB_OR_CHIP);
}

/** Asserts the rule on the page as it is now; `what` names the page in the messages. */
export async function expectTabsAndChipsInView(page: Page, what: string): Promise<StripReport> {
  // Let fonts and the strip's own layout settle (the channel tabs load their config first)
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const report = await tabsAndChipsInView(page);
  expect.soft(report.cut, `${what}: tabs or chips half shown at an edge`).toEqual([]);
  expect.soft(report.sideways, `${what}: the page scrolls sideways`).toBeLessThanOrEqual(0);
  return report;
}
