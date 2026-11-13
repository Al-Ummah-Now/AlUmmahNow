/**
 * The header account menu (docs/design/NAV.md), the 2026-11-13 production report: the menu was
 * see-through (the dashboard's cards showed through it, no lines between its sections) and named
 * the admin by email although their profile has a name.
 *
 * - The menu's background is opaque (alpha 1) and its section lines show, in light and dark.
 * - The button and the menu's top block show the admin's name by the platform rule (display name,
 *   else first + last), never the email, when the admin's videos profile has a name.
 */
import { test, expect } from './support/fixtures';
import type { Page } from '@playwright/test';
import { accounts, VIDEOS_API_URL } from './support/env';
import { getAccessToken } from './support/oauth';
import { createVideosProfile } from './support/profiles';

/** The alpha channel of a computed CSS colour (rgb() is 1). */
function alphaOf(color: string): number {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color === 'transparent' ? 0 : 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length > 3 ? Number(parts[3]) : 1;
}

async function openMenu(page: Page) {
  await page.goto('/dashboard');
  await page.getByTestId('account-menu-trigger').click();
  const menu = page.getByTestId('account-menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** The admin's name by the platform rule, from their videos profile (created when missing). */
async function adminName(): Promise<string> {
  const account = accounts.admin;
  const token = await getAccessToken(account);
  const me = await fetch(`${VIDEOS_API_URL}/api/profile`, { headers: { authorization: `Bearer ${token}` } });
  if (me.status === 404) return (await createVideosProfile(token, account.email, 'Menu Admin')).displayName;
  expect(me.status, 'GET /api/profile').toBe(200);
  const body = (await me.json()) as { result?: { profile?: Record<string, unknown> }; profile?: Record<string, unknown> };
  const p = body.result?.profile ?? body.profile ?? {};
  const first = String(p.firstName ?? '').trim();
  const last = String(p.lastName ?? '').trim();
  const name = String(p.resolvedDisplayName ?? p.displayName ?? '').trim() || [first, last].filter(Boolean).join(' ');
  expect(name, 'the admin profile has a name').not.toBe('');
  return name;
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`account menu (${colorScheme})`, () => {
    test.use({ colorScheme });

    test(`MENU-01 the menu is opaque and its lines show (${colorScheme})`, async ({ page }) => {
      const menu = await openMenu(page);
      const look = await menu.evaluate((el) => {
        const cs = getComputedStyle(el);
        const sep = el.querySelector('.aun-menu-sep');
        return {
          bg: cs.backgroundColor,
          sepColor: sep ? getComputedStyle(sep).borderTopColor : '',
          sepWidth: sep ? getComputedStyle(sep).borderTopWidth : '',
        };
      });
      expect(alphaOf(look.bg), `menu background ${look.bg}`).toBe(1);
      expect(look.sepWidth, 'a separator is drawn').toBe('1px');
      expect(alphaOf(look.sepColor), `separator colour ${look.sepColor}`).toBe(1);
    });
  });
}

test('MENU-02 the button and the menu name the admin, not their email', async ({ page }) => {
  const name = await adminName();
  const email = accounts.admin.email;
  await page.goto('/dashboard');
  const trigger = page.getByTestId('account-menu-trigger');
  await expect(trigger).toContainText(name);
  await expect(trigger).not.toContainText(email);
  await trigger.click();
  const who = page.getByTestId('account-menu-account');
  await expect(who.locator('.aun-menu-who-name')).toHaveText(name);
});
