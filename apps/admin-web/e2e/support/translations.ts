/**
 * Helpers shared by the translations editor specs (06-translations and the
 * shared-state 06-translations-save).
 */
import { expect, type Page } from '@playwright/test';
import { VIDEOS_API_URL } from './env';

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${VIDEOS_API_URL}${path}`, { cache: 'no-store' });
  const body = (await response.json()) as { result: T };
  return body.result;
}

export async function openEditor(page: Page) {
  await page.goto('/translations');
  await expect(page.getByTestId('translation-editor')).toBeVisible({ timeout: 30_000 });
}

export function row(page: Page, key: string) {
  return page.locator(`[data-testid="translation-row"][data-key="${key}"]`);
}
