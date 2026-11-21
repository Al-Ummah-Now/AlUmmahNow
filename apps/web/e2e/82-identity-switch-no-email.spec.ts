import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { combinedSessionState, readAccount } from './test-utils/auth-state';
import { openAccountMenu, showMenuView, switchAccountTo, waitForSessionSwitch } from './test-utils/navigation';

/**
 * #1673: switching the acting identity (Personal ↔ a channel) or the account never shows an email
 * in the header, not even for a frame. The session carries the email as a stand-in display name
 * until the profile loads and the header remounts after each switch, which used to paint the
 * email and its first letter in the account pill.
 *
 * A MutationObserver installed before any page script records every label the header renders
 * (pill name, avatar letter, the account menu's name lines) for the whole test, so a flash
 * between two assertions is caught too. The two-account session is built from the run's own
 * stored accounts (auth.setup.ts); switches only rewrite this context's cookie.
 */

test.use({
  // Playwright fixture callback, not a React hook
  // eslint-disable-next-line react-hooks/rules-of-hooks
  storageState: async ({}, use) => use(combinedSessionState('single', 'multi')),
});

declare global {
  interface Window { __aunHeaderLabels?: Array<{ where: string; text: string; name?: string }> }
}

/** Records what the header shows on every DOM change (and every animation frame while it changes). */
async function watchHeaderLabels(page: Page) {
  await page.addInitScript(() => {
    const seen: Array<{ where: string; text: string; name?: string }> = [];
    window.__aunHeaderLabels = seen;
    const record = () => {
      const trigger = document.querySelector('[data-testid="nav-menu-trigger"]');
      if (trigger) {
        const name = trigger.querySelector('[data-testid="nav-trigger-name"]')?.textContent ?? '';
        const letter = trigger.querySelector('span.aun-avatar')?.textContent ?? '';
        seen.push({ where: 'pill-name', text: name });
        seen.push({ where: 'pill-letter', text: letter, name });
      }
      for (const el of document.querySelectorAll('[data-testid="nav-user-name"], .aun-acct-label')) {
        seen.push({ where: 'menu-name', text: el.textContent ?? '' });
      }
    };
    new MutationObserver(record).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

/** Every recorded label: no @-address, and the pill's letter is its name's (or none). */
async function expectNoEmailEverShown(page: Page, emails: string[]) {
  const seen = await page.evaluate(() => window.__aunHeaderLabels ?? []);
  expect(seen.length).toBeGreaterThan(0);
  const initials = new Set(emails.map((e) => e[0].toUpperCase()));
  const bad = seen.filter((s) => {
    if (/@/.test(s.text)) return true;
    if (s.where !== 'pill-letter' || !s.text) return false;
    // A letter that is not the shown name's first letter can only have come from the email
    const nameInitial = s.name ? Array.from(s.name)[0].toUpperCase() : '';
    return s.text !== nameInitial && initials.has(s.text.toUpperCase());
  });
  expect(bad, `header labels with an email: ${JSON.stringify(bad.slice(0, 5))}`).toEqual([]);
}

async function actAs(page: Page, channelId: string | null) {
  const menu = await openAccountMenu(page);
  await showMenuView(menu, 'channel');
  const target = channelId
    ? menu.locator(`[data-testid="nav-channel-option"][data-channel-id="${channelId}"]`)
    : menu.getByTestId('nav-channel-option-none');
  await target.click();
  await waitForSessionSwitch(page, { channelId });
}

for (const lang of ['en', 'ar'] as const) {
  test(`identity and account switches never show an email in the header (${lang}) @nav`, async ({ page }) => {
    const single = readAccount('single');
    const multi = readAccount('multi');
    const emails = [single.email, multi.email];
    await watchHeaderLabels(page);
    await page.goto(`/${lang}`);
    await openAccountMenu(page);

    // Account switch, then Personal → channel → Personal → channel on the multi-channel account
    await switchAccountTo(page, multi);
    const channel = multi.channels[0];
    await actAs(page, null);
    await actAs(page, channel.id);
    await actAs(page, null);
    // The pill settles on the account's name, never its email
    await expect(page.getByTestId('nav-trigger-name')).not.toHaveText('');
    await expect(page.getByTestId('nav-trigger-name')).not.toContainText('@');
    // And back to the first account
    await openAccountMenu(page);
    await switchAccountTo(page, single);
    await expect(page.getByTestId('nav-trigger-name')).not.toContainText('@');

    await expectNoEmailEverShown(page, emails);
  });
}

/** Where each header control sits (x of its box), for the controls this header shows */
async function headerControlXs(page: Page): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of ['header-upload', 'notification-bell', 'language-toggle', 'theme-toggle', 'nav-menu-trigger']) {
    const el = page.locator('header').getByTestId(id).first();
    if (!(await el.isVisible().catch(() => false))) continue;
    const box = await el.boundingBox();
    if (box) out[id] = Math.round(box.x);
  }
  return out;
}

// AUDIT-2 2026-11-21: the account pill sized itself to the name, so switching from "Community
// Corner" to "Amina Yusuf" moved Upload, the bell, the language and theme buttons by 47px (English).
// The pill's name now has one width; nothing in the header moves when who you act as changes.
for (const lang of ['en', 'ar'] as const) {
  for (const width of [1280, 900, 390]) {
    test(`the header's controls stay put when switching who you act as (${lang}, ${width}px) @nav`, async ({ page }) => {
      const multi = readAccount('multi');
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${lang}`);
      await openAccountMenu(page);
      await switchAccountTo(page, multi);
      const channel = multi.channels[0];
      await actAs(page, channel.id);
      await expect(page.getByTestId('nav-menu-trigger')).not.toHaveAttribute('aria-busy', 'true');
      const asChannel = await headerControlXs(page);
      await actAs(page, null);
      await expect(page.getByTestId('nav-menu-trigger')).not.toHaveAttribute('aria-busy', 'true');
      const asPersonal = await headerControlXs(page);
      // Upload is hidden when acting as yourself on an account that may not create channels: that
      // control coming and going is intended; the ones shown both times must not move
      const both = Object.keys(asChannel).filter((id) => id in asPersonal);
      expect(both.length).toBeGreaterThanOrEqual(3);
      expect(Object.fromEntries(both.map((id) => [id, asPersonal[id]]))).toEqual(Object.fromEntries(both.map((id) => [id, asChannel[id]])));
    });
  }
}
