import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { applyTheme, LANGS, measureText, MODES, mockApi, THEMES } from './harness';
import { consentCookie } from '../test-utils/consent';

/**
 * THEME-NAV-CHANNELS (docs/design/NAV.md "Context slot"): the videos account menu's channel layer.
 * Two accounts in one browser, each with several channels and its own creator tier (the mock API
 * answers per access token, e2e/themes/mock-server.mjs CHANNEL_FIXTURES):
 * - Aisha owns two channels (her tier's limit) and manages one of Omar's;
 * - Omar owns three and may create more;
 * - Hana may create one more until another tab uses it up (the create is refused: channel_limit);
 * - a viewer has no channel and no creator tier.
 * The layer sits in the shared slot (after who, before the accounts) in every case, the active channel
 * scopes Upload and Studio, and switching channels stays separate from switching accounts.
 */
/** The local mock API (playwright.themes.config.ts MOCK_API). */
const MOCK_API = `http://127.0.0.1:${process.env.MOCK_API_PORT || 3158}`;

type Who = 'aisha' | 'omar' | 'hana' | 'viewer';
const ACCOUNTS: Record<Who, { userId: string; email: string; name: string; token: string; channels: { id: string; name: string; isMain: boolean }[] }> = {
  aisha: { userId: 'nav-a', email: 'aisha@example.com', name: 'Aisha Rahman', token: 'nav-aisha', channels: [{ id: 'a1', name: 'Tafsir Lessons', isMain: true }, { id: 'a2', name: 'Hadith Circle', isMain: false }] },
  omar: { userId: 'nav-b', email: 'omar@example.com', name: 'Omar Khalid', token: 'nav-omar', channels: [{ id: 'b1', name: 'Seerah Weekly', isMain: true }, { id: 'b2', name: 'Arabic Basics', isMain: false }, { id: 'b3', name: 'Fiqh Q&A', isMain: false }] },
  hana: { userId: 'nav-h', email: 'hana@example.com', name: 'Hana Saleh', token: 'nav-race', channels: [{ id: 'h1', name: 'Quran Recitation', isMain: true }] },
  viewer: { userId: 'nav-v', email: 'viewer@example.com', name: 'Vera Viewer', token: 'nav-viewer', channels: [] },
};

/**
 * A local session cookie: `active` signed in with `channel` active, plus `others` (nothing is sent
 * anywhere). Each account's channel cache is its live list from the mock (GET /api/channels/access),
 * as after a real sign-in: a cache that differs from the live list is rewritten (a refresh that
 * would close the open menu).
 */
async function signInAs(context: BrowserContext, baseURL: string, active: Who, channel: string | null, others: Who[] = []) {
  const entry = async (who: Who) => {
    const a = ACCOUNTS[who];
    const res = await context.request.get(`${MOCK_API}/api/channels/access`, { headers: { Authorization: `Bearer ${a.token}`, Origin: baseURL } });
    const channels = ((await res.json()) as { data: unknown[] }).data;
    const first = (channels[0] as { id?: string } | undefined)?.id ?? null;
    return [a.userId, { userId: a.userId, email: a.email, displayName: a.name, accessToken: a.token, refreshToken: '', channels, activeChannelId: who === active ? channel : first, lastActivity: Date.now() }] as const;
  };
  const entries = await Promise.all([active, ...others].map(entry));
  const session = { activeUserId: ACCOUNTS[active].userId, activeChannelId: channel, accounts: Object.fromEntries(entries) };
  await context.addCookies([{ name: 'al_ummah_session', value: encodeURIComponent(JSON.stringify(session)), url: baseURL }, consentCookie(baseURL)]);
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = 'nextjs-portal,.fixed.bottom-4.right-4.z-50.max-w-sm{display:none!important}';
      document.head.append(s);
    });
  });
}

async function openMenu(page: Page) {
  const trigger = page.locator('[data-testid="nav-menu-trigger"]:visible').first();
  const menu = page.getByTestId('nav-menu');
  await expect(async () => {
    if (!(await menu.isVisible())) await trigger.click();
    await expect(menu).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  return menu;
}

/** The test ids of the main view, in order. */
const order = (page: Page) => page.getByTestId('nav-menu').evaluate((m) => Array.from(m.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid')!));

test.describe.configure({ retries: 1 });
test.beforeEach(async ({ request }) => {
  await request.get(`${MOCK_API}/__fixtures/reset`);
});

test('two accounts with several channels: the channel layer sits in the shared slot and scopes Studio and the header Upload', async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, 'aisha', 'a2', ['omar']);
  await mockApi(page);
  await page.goto('/en');
  const menu = await openMenu(page);
  // who → channel layer → accounts → this app → other apps → sign out (NAV.md)
  await expect.poll(async () => {
    const ids = await order(page);
    const at = (id: string) => ids.indexOf(id);
    return [at('nav-profile-link'), at('nav-channel-layer'), at('nav-add-account'), at('nav-apps'), at('nav-sign-out')].join(',');
  }).toMatch(/^\d+,\d+,\d+,\d+,\d+$/);
  const ids = await order(page);
  const sequence = ['nav-profile-link', 'nav-channel-layer', 'nav-active-channel', 'nav-switch-channel', 'nav-menu-studio', 'nav-more-accounts', 'nav-add-account', 'nav-apps', 'nav-sign-out', 'nav-sign-out-all'];
  expect(sequence.map((id) => ids.indexOf(id))).toEqual([...sequence.map((id) => ids.indexOf(id))].sort((a, b) => a - b));

  const layer = menu.getByTestId('nav-channel-layer');
  await expect(layer).toHaveAttribute('role', 'group');
  await expect(layer).toHaveAccessibleName('Channel');
  // The active channel (avatar + name) links to it. No Upload in the menu (owner review rev 5, the
  // YouTube pattern): the header's Upload, first in the action cluster, goes to that channel's upload
  await expect(layer.getByTestId('nav-active-channel')).toContainText('Hadith Circle');
  await expect(layer.getByTestId('nav-active-channel')).toHaveAttribute('href', '/en/channels/a2');
  await expect(menu.getByTestId('nav-menu-upload')).toHaveCount(0);
  await expect(page.locator('.ah-end [data-testid="header-upload"]').first()).toHaveAttribute('href', '/en/upload?channel=a2');
  await expect(layer.getByTestId('nav-menu-studio')).toHaveAttribute('href', '/en/studio');

  // Switching channels lists this account's channels only (owned, then managed with the role), never the other account's own
  await menu.getByTestId('nav-switch-channel').click();
  await expect(menu.getByTestId('nav-channel-group-owned').getByTestId('nav-channel-option')).toHaveCount(2);
  const managed = menu.getByTestId('nav-channel-group-managed').getByTestId('nav-channel-option');
  await expect(managed).toHaveCount(1);
  await expect(managed).toHaveAttribute('data-role', 'admin');
  await expect(managed.getByTestId('nav-channel-role')).toHaveClass(/aun-badge/);
  await expect(menu.locator('[data-channel-id="b2"], [data-channel-id="b3"]')).toHaveCount(0);
  await expect(menu.locator('[data-channel-id="a2"]')).toHaveAttribute('aria-checked', 'true');
  // At the tier's limit there is no Create: the limit says why (channel_limit)
  await expect(menu.getByTestId('nav-create-channel')).toHaveCount(0);
  await expect(menu.getByTestId('nav-channel-limit')).toHaveText('You can own up to 2 channels');

  // Accounts (the Google pattern): Aisha, current, is the top of the menu; Omar is under "More accounts"
  // with a sign-out icon button; switching channels never touched that list
  await menu.getByTestId('nav-menu-back').click();
  const rows = menu.getByTestId('nav-account');
  await expect(rows).toHaveCount(2);
  await expect(menu.getByTestId('nav-active-context').getByTestId('nav-account')).toHaveAttribute('data-active', 'true');
  const more = menu.getByTestId('nav-more-accounts').getByTestId('nav-account');
  await expect(more).toHaveCount(1);
  await expect(more).toContainText('Omar Khalid');
  await expect(more.getByTestId('nav-account-sign-out')).toHaveAccessibleName('Sign out of Omar Khalid');
  // Each other app shows its own icon
  // Each app's own favicon: a separate static file (never inlined in the CSS), loaded at 96 px
  const icon = menu.locator('[data-testid="nav-apps"] img.aun-app-icon').first();
  await expect(icon).toHaveAttribute('src', /^\/aun-nav\/icons\/[a-z-]+\.webp$/);
  await expect.poll(() => icon.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))).toBe(96);
});

test('an account that may create channels gets Create in the switcher', async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, 'omar', 'b2');
  await mockApi(page);
  await page.goto('/ar');
  const menu = await openMenu(page);
  await expect(menu.getByTestId('nav-channel-layer')).toHaveAccessibleName('القناة');
  await expect(menu.getByTestId('nav-menu-upload')).toHaveCount(0);
  await expect(page.locator('.ah-end [data-testid="header-upload"]').first()).toHaveAttribute('href', '/ar/upload?channel=b2');
  await menu.getByTestId('nav-switch-channel').click();
  await expect(menu.getByTestId('nav-channel-group-owned').getByTestId('nav-channel-option')).toHaveCount(3);
  await expect(menu.getByTestId('nav-channel-group-managed')).toHaveCount(0);
  await expect(menu.getByTestId('nav-create-channel')).toBeVisible();
  await expect(menu.getByTestId('nav-channel-limit')).toHaveCount(0);
});

test('a create refused for the channel limit closes the form and shows the limit, not a generic error', async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, 'hana', 'h1');
  await mockApi(page);
  await page.goto('/en');
  const menu = await openMenu(page);
  await menu.getByTestId('nav-switch-channel').click();
  await menu.getByTestId('nav-create-channel').click();
  const input = menu.locator('#nav-new-channel-name');
  await input.fill('Second channel');
  await input.press('Enter');
  await expect(menu.getByTestId('nav-channel-limit')).toHaveText('You can own up to 2 channels', { timeout: 20_000 });
  await expect(input).toBeHidden();
  await expect(menu.getByText('Failed to create', { exact: false })).toHaveCount(0);
});

test('a viewer (no channel, no creator tier) keeps the layer without Studio or Create', async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, 'viewer', null);
  await mockApi(page);
  await page.goto('/en');
  const menu = await openMenu(page);
  await expect(menu.getByTestId('nav-no-active-channel')).toBeVisible();
  await expect(menu.getByTestId('nav-menu-upload')).toHaveCount(0);
  await expect(menu.getByTestId('nav-menu-studio')).toHaveCount(0);
  await expect(menu.getByTestId('nav-create-channel')).toHaveCount(0);
  await menu.getByTestId('nav-switch-channel').click();
  await expect(menu.getByTestId('nav-channel-option-none')).toHaveAttribute('aria-checked', 'true');
  // By invitation (no tier) is not a limit: no limit line either
  await expect(menu.getByTestId('nav-channel-limit')).toHaveCount(0);
});

// The channel switcher reads in every theme (the main view is in account-menu.spec.ts)
for (const lang of LANGS) {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      test(`channel switcher ${theme} ${mode} ${lang}`, async ({ page, context, baseURL }, info) => {
        test.skip(info.project.name !== 'desktop', 'one layout is enough for colours');
        await signInAs(context, baseURL!, 'aisha', 'a1');
        await mockApi(page);
        await page.goto(`/${lang}`);
        await applyTheme(page, theme, mode);
        const menu = await openMenu(page);
        await menu.getByTestId('nav-switch-channel').click();
        await expect(menu.getByTestId('nav-channel-limit')).toBeVisible();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        let texts = await measureText(page, '[data-testid=nav-menu]');
        await expect.poll(async () => (texts = await measureText(page, '[data-testid=nav-menu]')).length, { timeout: 20_000 }).toBeGreaterThan(4);
        const low = texts.filter((t) => t.ratio < 4.5);
        expect(low, `low contrast:\n${low.map((t) => `${t.ratio}:1 ${t.fg} on ${t.bg} "${t.text}" (${t.selector})`).join('\n')}`).toEqual([]);
        const axe = await new AxeBuilder({ page }).include('[data-testid=nav-menu]').withRules(['color-contrast']).analyze();
        expect(axe.violations.flatMap((v) => v.nodes.map((n) => n.failureSummary))).toEqual([]);
      });
    }
  }
}
