/**
 * Videos admin › Categories (owner 2026-11-15 "can you add categories in admin?"): an admin adds a
 * category (English + Arabic), it is live at once in api-videos' GET /api/categories and in the web
 * search filter; a rename (en + ar) keeps the value; Alt+↑ / ↓ reorder it; Retire hides it from the
 * public list's active categories (Undo restores), Restore brings it back; the Arabic page is right
 * to left; a moderator only reads. Local placement: it deletes its own category and audit rows
 * straight from the stack's D1 afterwards (categories have no delete: values stay for old videos).
 * Only its own run-namespaced category is changed; the built-in ones are never touched.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { LOCAL_STACK, RUN_TAG, VIDEOS_API_URL, WEB_APP_URL } from './support/env';
import { stackSql } from './support/local-stack';
import { expectDirection, openMainNav } from './support/ui';

const SUFFIX = `${RUN_TAG}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(-24);
const VALUE = `e2e_${SUFFIX}`.replace(/_+$/, '');
const LABEL_EN = `E2E category ${SUFFIX}`;
const LABEL_AR = `تصنيف تجريبي ${SUFFIX}`;
const RENAMED_EN = `E2E renamed ${SUFFIX}`;
const RENAMED_AR = `تصنيف معدّل ${SUFFIX}`;

interface PublicCategory { value: string; label: { en: string; ar: string }; retired: boolean }

async function publicCategories(): Promise<PublicCategory[]> {
  const res = await fetch(`${VIDEOS_API_URL}/api/categories?e2e=${Date.now()}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: { categories: PublicCategory[] } }).result.categories;
}

/** Its own category and audit rows only (and the relabel touches only rows with this value: none). */
async function cleanup() {
  if (!LOCAL_STACK) return;
  await stackSql('al-ummah-now-search', `DELETE FROM video_categories WHERE value = '${VALUE}'`);
  await stackSql('al-ummah-now-reports', `DELETE FROM site_settings_log WHERE key = 'content:category:${VALUE}' OR (key = 'content:category:*order' AND instr(new_value, '${VALUE}') > 0)`);
  // The stack's api-videos drops its cached list (as admin-api does after a change)
  await fetch(`${VIDEOS_API_URL}/internal/categories/invalidate`, { method: 'POST', headers: { 'X-API-Key': process.env.LOCAL_STACK_INTERNAL_API_KEY || 'local-stack-internal-key' } }).catch(() => undefined);
}

test.describe('video categories', () => {
  test.beforeEach(async () => {
    test.skip(!LOCAL_STACK, 'changes the platform category list: local stack only');
    const probe = await adminApi('/api/video-categories');
    test.skip(probe.status === 404, 'admin-api on this target predates /api/video-categories');
  });
  test.afterAll(cleanup);

  test('CAT-01 a moderator reads the list but cannot change it; a bad token gets 401', async () => {
    expect((await adminApi('/api/video-categories', { token: 'invalid' })).status).toBe(401);
    const tokens = readTokens();
    const read = await adminApi<{ canManage: boolean; categories: unknown[] }>('/api/video-categories', { token: tokens.moderator });
    expect(read.status).toBe(200);
    expect(read.body.result!.canManage).toBe(false);
    const write = await adminApi('/api/video-categories', { token: tokens.moderator, method: 'POST', body: JSON.stringify({ labelEn: 'x', labelAr: 'س', value: 'e2e_never' }) });
    expect(write.status).toBe(403);
  });

  test('CAT-02 add, rename, reorder, retire with undo, restore: live in api-videos and the web search filter', async ({ page, browser }) => {
    await page.goto('/categories');
    await expect(page.getByRole('heading', { level: 1, name: 'Categories' })).toBeVisible();
    const builtIn = page.locator('[data-testid="category-row"][data-value="fiqh"]');
    await expect(builtIn).toBeVisible();

    // Add: the value follows the English name until edited; we set ours
    const form = page.getByTestId('category-add-form');
    await form.getByTestId('category-add-label-en').fill(LABEL_EN);
    await expect(form.getByTestId('category-add-value')).toHaveValue(/^e2e_category_/);
    await form.getByTestId('category-add-value').fill(VALUE);
    await form.getByTestId('category-add-label-ar').fill(LABEL_AR);
    await form.getByTestId('category-add-hint').fill('test videos made by the admin E2E suite');
    await form.getByTestId('category-add-submit').click();
    await expect(page.getByTestId('category-add-done')).toContainText(LABEL_EN);
    const row = page.locator(`[data-testid="category-row"][data-value="${VALUE}"]`);
    await expect(row).toContainText(LABEL_EN);
    await expect(row).toContainText(LABEL_AR);
    expect((await publicCategories()).find((c) => c.value === VALUE)).toMatchObject({ label: { en: LABEL_EN, ar: LABEL_AR }, retired: false });

    // A duplicate value is refused in the form
    await form.getByTestId('category-add-label-en').fill('Another');
    await form.getByTestId('category-add-label-ar').fill('آخر');
    await form.getByTestId('category-add-value').fill(VALUE);
    await form.getByTestId('category-add-submit').click();
    await expect(form.getByTestId('category-add-value-error')).toBeVisible();
    await form.getByTestId('category-add-label-en').fill('');
    await form.getByTestId('category-add-label-ar').fill('');

    // The web search filter offers it (en) with its Arabic name on /ar
    const viewer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const web = await viewer.newPage();
    try {
      await web.goto(`${WEB_APP_URL}/en/search?q=${encodeURIComponent('a')}`);
      await web.getByTestId('search-filters-toggle').click();
      await expect(web.getByTestId('search-filter-category').locator(`option[value="${VALUE}"]`)).toHaveText(LABEL_EN);
      await web.goto(`${WEB_APP_URL}/ar/search?q=${encodeURIComponent('a')}`);
      await web.getByTestId('search-filters-toggle').click();
      await expect(web.getByTestId('search-filter-category').locator(`option[value="${VALUE}"]`)).toHaveText(LABEL_AR);
    } finally {
      await viewer.close();
    }

    // Rename both labels: the value stays
    await page.getByTestId(`category-edit-${VALUE}`).click();
    const edit = page.getByTestId(`category-edit-form-${VALUE}`);
    await expect(edit).toContainText(VALUE);
    await edit.getByTestId('category-edit-label-en').fill(RENAMED_EN);
    await edit.getByTestId('category-edit-label-ar').fill(RENAMED_AR);
    await edit.getByTestId('category-edit-save').click();
    await expect(row).toContainText(RENAMED_EN);
    await expect(row).toContainText(RENAMED_AR);
    expect((await publicCategories()).find((c) => c.value === VALUE)!.label).toEqual({ en: RENAMED_EN, ar: RENAMED_AR });

    // Reorder: Alt+↑ moves it above its neighbour (announced), Alt+↓ puts it back
    const values = async () => page.locator('[data-testid="category-row"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-value')));
    const before = await values();
    const index = before.indexOf(VALUE);
    expect(index).toBeGreaterThan(0);
    await page.getByTestId(`category-move-up-${VALUE}`).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(async () => (await values()).indexOf(VALUE)).toBe(index - 1);
    await expect(page.getByTestId('categories-announce')).toContainText(RENAMED_EN);
    expect((await publicCategories()).findIndex((c) => c.value === VALUE)).toBe(index - 1);
    await page.getByTestId(`category-move-down-${VALUE}`).click();
    await expect.poll(values).toEqual(before);

    // Retire: hidden from the active list, its label kept; Undo restores it
    await page.getByTestId(`category-retire-${VALUE}`).click();
    await expect(row).toHaveAttribute('data-retired', 'true');
    await expect(row.getByTestId('category-retired-chip')).toBeVisible();
    expect((await publicCategories()).find((c) => c.value === VALUE)).toMatchObject({ retired: true, label: { en: RENAMED_EN } });
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(row).toHaveAttribute('data-retired', 'false');
    expect((await publicCategories()).find((c) => c.value === VALUE)!.retired).toBe(false);

    // Retire again, then Restore from the row
    await page.getByTestId(`category-retire-${VALUE}`).click();
    await expect(row).toHaveAttribute('data-retired', 'true');
    await page.getByTestId(`category-restore-${VALUE}`).click();
    await expect(row).toHaveAttribute('data-retired', 'false');

    // Latest changes, by name
    await page.reload();
    await expect(page.getByTestId('categories-history-row').first()).toBeVisible();
    const actions = await page.getByTestId('categories-history-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-action')));
    expect(actions).toEqual(expect.arrayContaining(['create', 'update', 'reorder', 'retire', 'restore']));
  });

  test('CAT-03 the Arabic page is right to left with Arabic labels', async ({ page }) => {
    await page.goto('/categories');
    await openMainNav(page);
    await page.getByTestId('language-select').selectOption('ar');
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'التصنيفات' })).toBeVisible();
    await expect(page.locator('[data-testid="category-row"][data-value="fiqh"]')).toContainText('الفقه');
    await openMainNav(page);
    await page.getByTestId('language-select').selectOption('en');
    await expectDirection(page, 'en');
  });
});
