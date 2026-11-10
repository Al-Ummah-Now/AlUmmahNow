/**
 * TR-08: edits and reverts a key of the shared QA translation file, which every
 * environment reader sees. Matched only by the shared-state project
 * (playwright.config.ts).
 */
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { fetchJson, openEditor, row } from './support/translations';

test.describe('translations editor - save', () => {
  // Writes the shared QA translation file: serial, and only in the
  // shared-state project, which CI runs once per run under a cross-run lock,
  // so no concurrent read-modify-write merge can resurrect the temporary value
  // or see it.
  test.describe.configure({ mode: 'serial' });
  const SECTION = 'common';
  const KEY = 'loading';
  let original: string | undefined;

  test.beforeAll(async () => {
    const en = await fetchJson<{ translations: Record<string, Record<string, string>> }>('/api/i18n/translations/en');
    original = en.translations[SECTION][KEY];
  });

  test.afterAll(async () => {
    if (original === undefined) return;
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
