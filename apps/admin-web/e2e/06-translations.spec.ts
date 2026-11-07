import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { VIDEOS_API_URL } from './support/env';
import type { Page } from '@playwright/test';

interface Metadata {
  version: string;
  locales: string[];
  sections: string[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${VIDEOS_API_URL}${path}`, { cache: 'no-store' });
  const body = (await response.json()) as { result: T };
  return body.result;
}

async function openEditor(page: Page) {
  await page.goto('/translations');
  await expect(page.getByTestId('translation-editor')).toBeVisible({ timeout: 30_000 });
}

function row(page: Page, key: string) {
  return page.locator(`[data-testid="translation-row"][data-key="${key}"]`);
}

test.describe('translations editor', () => {
  test('TR-01 metadata cards reflect the i18n metadata', async ({ page }) => {
    const metadata = await fetchJson<Metadata>('/api/i18n/metadata');
    await page.goto('/translations');
    await expect(page.getByRole('heading', { level: 1, name: 'Translation Management' })).toBeVisible();
    await expect(page.getByTestId('metadata-locales').locator('dd')).toHaveText(metadata.locales.join(', ').toUpperCase());
    await expect(page.getByTestId('metadata-sections').locator('dd')).toHaveText(String(metadata.sections.length));
    await expect(page.getByTestId('metadata-version').locator('dd')).toHaveText(/^\d+\.\d+\.\d+$/);
  });

  test('TR-02 lists the keys of the default section with a matching count', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByLabel('Section')).toHaveValue('common');
    const rows = page.getByTestId('translation-row');
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    await expect(page.getByTestId('translation-count')).toHaveText(`Showing ${count} keys in common`);
    await expect(row(page, 'appName').getByTestId('translation-value')).toHaveText('Al Ummah Now');
  });

  test('TR-03 nested groups are flattened instead of showing [object Object]', async ({ page }) => {
    await openEditor(page);
    await page.getByLabel('Section').selectOption('channel');
    await expect(page.locator('[data-testid="translation-row"][data-key^="tabs."]').first()).toBeVisible();
    await expect(page.getByTestId('translation-table')).not.toContainText('[object Object]');
  });

  test('TR-04 search filters keys and values', async ({ page }) => {
    await openEditor(page);
    await page.getByLabel('Search keys or values').fill('appName');
    await expect(page.getByTestId('translation-row')).toHaveCount(1);
    await expect(page.getByTestId('translation-count')).toContainText('matching "appName"');
    await page.getByLabel('Search keys or values').fill('zz-no-such-key-zz');
    await expect(page.getByText('No keys match your search')).toBeVisible();
  });

  test('TR-05 Arabic translations render right-to-left', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('translation-locale').selectOption('ar');
    const value = row(page, 'appName').getByTestId('translation-value');
    await expect(value).toHaveAttribute('dir', 'rtl');
    await expect(value).toHaveText(/[؀-ۿ]/);
  });

  test('TR-06 cancel and Escape discard an edit', async ({ page }) => {
    await openEditor(page);
    const target = row(page, 'appName');
    const original = await target.getByTestId('translation-value').textContent();
    await target.getByRole('button', { name: 'Edit appName' }).click();
    const box = target.getByRole('textbox', { name: 'Value for appName' });
    await expect(box).toBeFocused();
    await box.fill('discard me');
    await target.getByRole('button', { name: 'Cancel editing appName' }).click();
    await expect(target.getByTestId('translation-value')).toHaveText(original!);

    await target.getByRole('button', { name: 'Edit appName' }).click();
    await target.getByRole('textbox').fill('discard me too');
    await page.keyboard.press('Escape');
    await expect(target.getByTestId('translation-value')).toHaveText(original!);
  });

  test('TR-07 a failing translations request shows the error state with retry', async ({ page }) => {
    // Translations are loaded through a server action (POST to the page URL)
    await page.route('**/translations', (route) =>
      route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
    );
    await page.goto('/translations');
    await expect(page.getByTestId('translations-error')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('translations-error')).toContainText('Failed to load translations');
    await page.unroute('**/translations');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('translation-editor')).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('translations editor - save', () => {
  // Writes the shared QA translation file: run once (chromium) and serially so
  // concurrent read-modify-write merges cannot resurrect the temporary value.
  test.describe.configure({ mode: 'serial' });
  const SECTION = 'common';
  const KEY = 'loading';
  let original: string | undefined;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'translation writes run in one project only');
    const en = await fetchJson<{ translations: Record<string, Record<string, string>> }>('/api/i18n/translations/en');
    original = en.translations[SECTION][KEY];
  });

  test.afterAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'chromium' || original === undefined) return;
    const en = await fetchJson<{ translations: Record<string, Record<string, string>> }>('/api/i18n/translations/en');
    if (en.translations[SECTION][KEY] !== original) {
      // Safety net: restore through admin-api if the UI revert did not happen
      await adminApi('/api/i18n/translations/en', {
        method: 'PUT',
        body: JSON.stringify({ translations: { [SECTION]: { [KEY]: original } }, merge: true }),
      });
    }
  });

  test('TR-08 edit, save and revert a harmless key', async ({ page }) => {
    const temporary = `${original} [e2e ${Date.now()}]`;
    await openEditor(page);
    const target = row(page, KEY);
    await expect(target.getByTestId('translation-value')).toHaveText(original!);

    await target.getByRole('button', { name: `Edit ${KEY}` }).click();
    await target.getByRole('textbox').fill(temporary);
    await target.getByRole('button', { name: `Save ${KEY}` }).click();
    await expect(page.getByTestId('save-status')).toHaveText('Saved successfully!');
    await expect(target.getByTestId('translation-value')).toHaveText(temporary);

    // Persisted: a fresh load and the public API both show the new value
    await page.reload();
    await expect(row(page, KEY).getByTestId('translation-value')).toHaveText(temporary, { timeout: 30_000 });
    const en = await fetchJson<{ translations: Record<string, Record<string, string>> }>('/api/i18n/translations/en');
    expect(en.translations[SECTION][KEY]).toBe(temporary);
    // Merge must not drop sibling keys
    expect(en.translations[SECTION].appName).toBe('Al Ummah Now');

    // Revert
    await row(page, KEY).getByRole('button', { name: `Edit ${KEY}` }).click();
    await row(page, KEY).getByRole('textbox').fill(original!);
    await row(page, KEY).getByRole('button', { name: `Save ${KEY}` }).click();
    await expect(page.getByTestId('save-status')).toHaveText('Saved successfully!');
    await expect(row(page, KEY).getByTestId('translation-value')).toHaveText(original!);
    const reverted = await fetchJson<{ translations: Record<string, Record<string, string>> }>('/api/i18n/translations/en');
    expect(reverted.translations[SECTION][KEY]).toBe(original);
  });
});
