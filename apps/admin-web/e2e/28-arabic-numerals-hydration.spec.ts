/**
 * Arabic admin pages hydrate in Safari (#1488). Plain "ar" formats Arabic numerals 0–9 in Node and
 * Eastern Arabic (Hindi) numerals ٠–٩ in WebKit, so a number or date rendered on the server and
 * again in the browser used to disagree: React threw #418 and rendered the page again (main red
 * 2026-11-15, NAV-07). Every formatter now pins the numbering system (locale-format), so the
 * server and WebKit write the same ٠–٩.
 *
 * WebKit only (the engine that differs). Read-only: it opens pages with counts, money, dates and
 * times in Arabic as a super admin and changes nothing.
 */
import { test, expect } from './support/fixtures';
import { storageStatePath } from './support/env';
import { setPreferences } from './support/ui';

test.use({ storageState: storageStatePath('superadmin') });

/** Minified React hydration errors: text mismatch, hydration failed, server/client text differ. */
const HYDRATION = /Minified React error #(418|423|425)\b|Hydration failed|did not match|hydrat(ed|ion) .*mismatch|server rendered (text|HTML) didn't match/i;

const PAGES = [
  { path: '/dashboard', what: 'counts and the Errors badge' },
  { path: '/costs', what: 'money, percentages and dates' },
  { path: '/delivery', what: 'durations, money and the transcode troubleshooting times' },
  { path: '/backfill', what: 'estimates in money and time' },
  { path: '/status', what: 'uptime percentages and dates' },
  { path: '/errors', what: 'counts and relative times' },
];

for (const { path, what } of PAGES) {
  test(`HYD-AR ${path} hydrates in Arabic on WebKit with ٠–٩ (${what})`, async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'the WebKit/Node digit mismatch is WebKit-only');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && HYDRATION.test(m.text())) errors.push(m.text());
    });
    await setPreferences(page, { locale: 'ar', theme: 'dark' });
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('main')).toBeVisible();
    // hydration runs after load; give React the moment it needs to report a mismatch
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    expect(errors.filter((e) => HYDRATION.test(e)), `hydration errors on ${path}`).toEqual([]);
    // the page shows numbers in Eastern Arabic (Hindi) numerals (the sidebar and header at least)
    const text = await page.locator('main').innerText();
    if (/[0-9٠-٩]/.test(text)) expect(text).toMatch(/[٠-٩]/);
  });
}
