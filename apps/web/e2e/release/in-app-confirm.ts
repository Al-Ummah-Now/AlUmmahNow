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
  // A list renders one closed dialog per row under the same test id (every theme row has its own
  // theme-delete-confirm-dialog): act on the open one only. A plain getByTestId matched them all, the
  // strict-mode error read as "no dialog" and the delete was never confirmed.
  const dialog = page.getByTestId(ids.dialog).filter({ visible: true });
  // 15 s: on a slow admin page the dialog opens late (a click just after navigation lands before
  // React hydrates). With 5 s the helper gave up, the typed id was never entered, the confirm stayed
  // disabled and the theme was not deleted (site-theme, main run 43245388363); old builds without
  // the dialog only cost the wait.
  const shown = await dialog
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true, () => false);
  if (!shown) return;
  if (ids.typedField && typed !== undefined) await dialog.getByTestId(ids.typedField).fill(typed);
  await dialog.getByTestId(ids.confirm).click();
}

/** admin-web ConfirmDialog test ids for a base id. */
export const adminConfirm = (base: string) => ({ dialog: `${base}-dialog`, confirm: `${base}-confirm`, typedField: `${base}-typed` });

/** web ConfirmDialog test ids for a base id. */
export const webConfirm = (base: string) => ({ dialog: base, confirm: `${base}-confirm`, typedField: `${base}-typed` });
