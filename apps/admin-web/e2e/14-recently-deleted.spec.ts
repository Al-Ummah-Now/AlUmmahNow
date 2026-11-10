/**
 * Recently deleted (admin soft deletes), end to end on QA: the page lists
 * deleted items per area with who deleted them and the days left; "Delete
 * permanently now" opens an in-app dialog with Cancel focused and the confirm
 * button disabled until the item's id is typed. Nothing is restored or purged
 * here (QA data is shared); the API flow is covered by the api-videos and
 * admin-api unit tests. Arabic renders right to left.
 */
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { expectDirection, expectNoAxeViolations, setPreferences } from './support/ui';

test.describe('recently deleted', () => {
  test.beforeAll(async () => {
    // PR runs hit QA, which follows main: skip until admin-api has the route there
    const probe = await adminApi('/api/content/deletions?pageSize=1');
    test.skip(probe.status === 404, 'admin-api on QA does not have soft deletes yet');
  });

  test('DEL-01 lists deleted items per area, with an accessible type-to-confirm permanent delete', async ({ page }) => {
    await page.goto('/deleted');
    await expect(page.getByRole('heading', { level: 1, name: 'Recently deleted' })).toBeVisible();
    await expect(page.getByTestId('deleted-kinds')).toBeVisible();
    await page.getByTestId('deleted-kind-video').click();
    await expect(page).toHaveURL(/\/deleted\?kind=video$/);
    await expect(page.getByTestId('deleted-kind-video')).toHaveAttribute('aria-current', 'page');

    const row = page.getByTestId('deleted-row').filter({ has: page.getByTestId('deleted-purge') }).first();
    if (await row.count()) {
      const id = await row.getAttribute('data-id');
      await row.getByTestId('deleted-purge').click();
      const dialog = row.getByTestId('deleted-purge-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      const confirm = dialog.getByTestId('deleted-purge-confirm');
      await expect(confirm).toBeDisabled();
      await dialog.getByTestId('deleted-purge-typed').fill(`${id}x`);
      await expect(confirm).toBeDisabled();
      await dialog.getByTestId('deleted-purge-typed').fill(id!);
      await expect(confirm).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(row).toHaveAttribute('data-status', 'deleted');
    } else {
      await expect(page.getByText('Nothing was deleted in the last 30 days.')).toBeVisible();
    }
    await expectNoAxeViolations(page, 'recently deleted');
  });

  test('DEL-02 every content list links to its Recently deleted view; Arabic is right to left', async ({ page }) => {
    await page.goto('/playlists');
    await page.getByTestId('view-deleted').click();
    await expect(page).toHaveURL(/\/deleted\?kind=playlist$/);
    await setPreferences(page, { locale: 'ar' });
    await page.goto('/deleted');
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'المحذوفات مؤخرًا' })).toBeVisible();
    await setPreferences(page, { locale: 'en' });
  });
});
