import { test, expect } from '@playwright/test';
import { applyTheme, LANGS, MODES, mockApi } from './harness';
import { consentCookie } from '../test-utils/consent';
import type { BrowserContext, Page } from '@playwright/test';

/** Owner review shots of the Acting as picker (local only: SHOTS=1). */
test.skip(!process.env.SHOTS, 'review shots only');
const OUT = process.env.SHOTS_DIR || 'test-results-themes/acting-as';

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


test.beforeEach(async ({ request }) => { await request.get(`${MOCK_API}/__fixtures/reset`); });

const CASES: { id: string; who: Who; channel: string | null; view: 'main' | 'channels' }[] = [
  { id: 'menu-channel', who: 'aisha', channel: 'a1', view: 'main' },
  { id: 'menu-personal', who: 'aisha', channel: null, view: 'main' },
  { id: 'picker', who: 'aisha', channel: 'a1', view: 'channels' },
];
for (const lang of LANGS) for (const mode of MODES) for (const c of CASES) {
  test(`${c.id} ${lang} ${mode}`, async ({ page, context, baseURL }, info) => {
    await signInAs(context, baseURL!, c.who, c.channel);
    await mockApi(page);
    // Channel logos: the mock's image host does not exist; draw a simple logo per channel
    const COLORS = ['#0f766e', '#b45309', '#7c3aed', '#be123c', '#1d4ed8', '#15803d'];
    await page.route('https://img.example.test/**', (route) => {
      const n = Number(/(\d+)\.svg/.exec(route.request().url())?.[1] ?? 0);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${COLORS[n % COLORS.length]}"/><path d="M32 12 L50 44 H14 Z" fill="#fff" opacity=".9"/></svg>`;
      return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    });
    await page.goto(`/${lang}`);
    await applyTheme(page, 'fawanees', mode);
    const menu = await openMenu(page);
    if (c.view === 'channels') {
      await menu.getByTestId('nav-switch-channel').click();
      await expect(menu.getByTestId('nav-channel-option-none')).toBeVisible();
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${c.id}-${lang}-${info.project.name}-${mode}.png` });
  });
}
