/**
 * Confirms the in-app confirm dialog a destructive button opens (web and
 * admin-web never use browser prompts). The suite also runs against builds
 * deployed before the dialog existed; there the click acted at once (or a
 * spec's page.on('dialog') handler accepted window.confirm), so a dialog that
 * never shows is not an error.
 */
import type { Page } from '@playwright/test';

/**
 * `dialog`: the dialog's test id; `confirm`: its confirm button's test id;
 * `typed`: text to type first for a type-to-confirm dialog.
 */
export async function confirmInApp(page: Page, ids: { dialog: string; confirm: string; typedField?: string }, typed?: string): Promise<void> {
  const shown = await page
    .getByTestId(ids.dialog)
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true, () => false);
  if (!shown) return;
  if (ids.typedField && typed !== undefined) await page.getByTestId(ids.typedField).fill(typed);
  await page.getByTestId(ids.confirm).click();
}

/** admin-web ConfirmDialog test ids for a base id. */
export const adminConfirm = (base: string) => ({ dialog: `${base}-dialog`, confirm: `${base}-confirm`, typedField: `${base}-typed` });

/** web ConfirmDialog test ids for a base id. */
export const webConfirm = (base: string) => ({ dialog: base, confirm: `${base}-confirm`, typedField: `${base}-typed` });
