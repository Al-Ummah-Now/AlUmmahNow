/**
 * App config → Releases (wiki AUN-APP-UPDATES §4.2), on the local stack: what each app released and whether its
 * signature checked out; a super admin marks a TestFlight upload available and clears it, and Edit opens that row's
 * version entry; an admin sees the same page read-only and the API refuses their changes.
 *
 * The release index comes from GitHub, so the spec seeds the index and the marks in KV and puts both back exactly as
 * they were. It saves no document and refreshes nothing.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { ADMIN_WEB_URL, storageStatePath } from './support/env';
import { stackKvGet, stackKvPut } from './support/local-stack';

const LOCAL_STACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(ADMIN_WEB_URL);
const KEYS = ['releases', 'availability'] as const;
const before: Partial<Record<(typeof KEYS)[number], string | null>> = {};

const entry = (over: Record<string, unknown>) => ({
  channel: 'stable',
  publishedAt: '2026-11-24T20:29:30Z',
  notes: { en: 'Faster folder scans.', ar: 'فحص أسرع للمجلدات.' },
  signed: true,
  private: false,
  url: null,
  manifestUrl: null,
  artifacts: [],
  stores: [],
  history: [],
  ...over,
});

test.describe('app releases', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!LOCAL_STACK, 'local stack only: seeds the release index');
    for (const k of KEYS) before[k] = await stackKvGet('APP_CONFIG', k);
    await stackKvPut('APP_CONFIG', 'availability', null);
    await stackKvPut(
      'APP_CONFIG',
      'releases',
      JSON.stringify({
        updatedAt: '2026-11-24T21:00:00Z',
        rev: 2,
        entries: {
          'tools/windows/stable': entry({ app: 'tools', platform: 'windows', repo: 'AlUmmahNowTools', version: '2026.11.24', tag: 'v2026.11.24' }),
          'admin/ios/beta': entry({ app: 'admin', platform: 'ios', channel: 'beta', repo: 'AlUmmahNowApple', version: '1.4.0.2', tag: 'admin-v1.4.0-2', private: true, stores: ['testflight'] }),
        },
        appStore: {},
        seen: {},
        rooted: [],
        keys: { AlUmmahNowTools: { serial: 1, list: '{}', sig: '{}', revoked: [], yanked: [], acceptedAt: '2026-11-24T21:00:00Z' } },
        quarantined: [{ source: 'github:AlUmmahNowTools', repo: 'AlUmmahNowTools', tag: 'v2026.11.25', reason: 'bad_signature', at: '2026-11-24T21:00:00Z' }],
      }),
    );
  });

  test.afterAll(async () => {
    if (!LOCAL_STACK) return;
    for (const k of KEYS) await stackKvPut('APP_CONFIG', k, before[k] ?? null);
  });

  test.describe('super admin', () => {
    test.use({ storageState: storageStatePath('superadmin') });

    test('APPREL-01 lists releases, signatures and refusals in words', async ({ page }) => {
      await page.goto('/app-config');
      const row = page.locator('[data-testid="app-releases-row"][data-target="tools/windows/stable"]');
      await expect(row).toContainText('2026.11.24');
      await expect(row).toContainText('Signed');
      const refused = page.getByTestId('app-releases-quarantined');
      await expect(refused).toContainText('v2026.11.25');
      await expect(refused).toContainText('Its signature is wrong');
      await expect(refused).not.toContainText('bad_signature');
    });

    test('APPREL-05 on a phone nothing is off the screen and Edit is reachable', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/app-config');
      const edit = page.locator('[data-testid="app-releases-row"][data-target="tools/windows/stable"]').getByTestId('app-releases-edit');
      await edit.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'the page scrolls sideways').toBeLessThanOrEqual(0);
      const box = (await edit.boundingBox())!;
      expect(box.x >= 0 && box.x + box.width <= 390, `Edit ${Math.round(box.x)}..${Math.round(box.x + box.width)} inside 0..390`).toBe(true);
    });

    test('APPREL-02 marks a TestFlight upload available, then clears it', async ({ page }) => {
      await page.goto('/app-config');
      const row = page.locator('[data-testid="app-releases-row"][data-target="admin/ios/beta"]');
      await row.getByTestId('app-releases-mark').click();
      await expect(page.getByTestId('app-releases-notice')).toHaveText('Marked available.');
      expect(JSON.parse((await stackKvGet('APP_CONFIG', 'availability')) ?? '{}')).toEqual({ 'admin/ios/testflight': '1.4.0.2' });
      await row.getByTestId('app-releases-unmark').click();
      await expect(row.getByTestId('app-releases-unmark')).toHaveCount(0);
      expect(JSON.parse((await stackKvGet('APP_CONFIG', 'availability')) ?? '{}')).toEqual({});
    });

    test('APPREL-03 Edit opens the row’s version entry, ready to type', async ({ page }) => {
      await page.goto('/app-config');
      await page.locator('[data-testid="app-releases-row"][data-target="tools/windows/stable"]').getByTestId('app-releases-edit').click();
      await expect(page.getByTestId('app-config-panel')).toHaveAttribute('data-document', 'versions');
      const card = page.locator('[data-testid="app-config-version"][data-target="tools/windows"]');
      await expect(card).toHaveCount(1);
      await expect(card.getByTestId('app-config-version-minimumVersion')).toBeFocused();
      await expect(card.getByTestId('app-config-version-minimumVersion')).toBeEditable();
    });
  });

  test.describe('admin', () => {
    test.use({ storageState: storageStatePath('admin') });

    test('APPREL-04 reads releases and versions, changes neither', async ({ page }) => {
      await page.goto('/app-config');
      await expect(page.locator('[data-testid="app-releases-row"][data-target="tools/windows/stable"]')).toBeVisible();
      await expect(page.getByTestId('app-releases-edit')).toHaveCount(0);
      await expect(page.getByTestId('app-releases-mark')).toHaveCount(0);
      await page.getByTestId('app-config-tab-versions').click();
      await expect(page.getByTestId('app-config-versions-readonly')).toBeVisible();
      await expect(page.getByTestId('app-config-save')).toHaveCount(0);
      await expect(page.getByTestId('app-config-add-versions')).toHaveCount(0);
      await expect(page.getByTestId('app-config-versions').locator('input, select, textarea, button')).toHaveCount(0);
      const token = readTokens().admin;
      expect((await adminApi('/api/app-config/versions', { method: 'PUT', token, body: JSON.stringify({ value: {} }) })).status).toBe(403);
      expect((await adminApi('/api/app-config/releases/available', { method: 'PUT', token, body: JSON.stringify({ app: 'admin', platform: 'ios', source: 'testflight', version: '1.4.0' }) })).status).toBe(403);
    });
  });
});
