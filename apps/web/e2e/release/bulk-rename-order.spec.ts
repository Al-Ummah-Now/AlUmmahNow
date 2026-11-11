/**
 * Release regression: ordering a bulk rename (owner, 2026-11-11: "i can't
 * order the videos in the list to allow for proper renaming with numbers").
 *
 * A new creator has 4 videos titled "… 10", "… 2", "… 1", "… 3" (created
 * the way the upload page does, no file: Studio lists them under
 * Processing). In Studio Content → Videos they select all 4, open Edit,
 * rename with `Lesson {n}`, order by title (natural: 1, 2, 3, 10), then move
 * "10" up one with Alt+↑. The preview and the stored titles follow that
 * order: 1 → Lesson 1, 2 → Lesson 2, 10 → Lesson 3, 3 → Lesson 4.
 *
 * The direction button (2026-11-11 "not ordering items asc and desc when
 * dir button is clicked"): by upload date and by title it reverses the
 * preview at once and the numbers follow; its label says the direction. A
 * sort none of the videos can be sorted by (duration: nothing is encoded)
 * is offered disabled (builds with the fix; older ones are annotated).
 * Deleted afterwards. Skips while the build has no order control.
 */
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { submitNewChannelInMenu } from './account-menu';

test.use({ trace: 'off' });

async function createChannelInMenu(page: Page, user: WebUser, name: string): Promise<string> {
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await page.goto(`${target().web}/en`);
  await submitNewChannelInMenu(page, name);
  let channelId = '';
  await expect
    .poll(async () => {
      const res = await apiFetch(user, '/api/channels?limit=100');
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
      channelId = body.data?.find((c) => c.name === name)?.id ?? '';
      return channelId;
    }, { timeout: 30000 })
    .not.toBe('');
  return channelId;
}

async function createVideo(user: WebUser, channelId: string, title: string): Promise<string> {
  const res = await apiFetch(user, '/api/videos/upload/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', channelId },
    body: JSON.stringify({ title, fileSize: 1024, mimeType: 'video/mp4', isPublic: false }),
  });
  const text = await res.text();
  expect(res.status, `POST /api/videos/upload/initiate: ${text}`).toBeLessThan(300);
  const id = (JSON.parse(text) as { result?: { videoId?: string } }).result?.videoId ?? '';
  expect(id, 'upload initiate returned no video id').toBeTruthy();
  return id;
}

async function titleOf(user: WebUser, channelId: string, id: string, language: 'en' | 'ar' = 'en'): Promise<string> {
  const res = await apiFetch(user, `/api/videos/${id}`, { headers: { channelId } });
  // The video view itself (GET /api/videos/:id)
  const v = (await res.json().catch(() => ({}))) as { title?: string; titleLocalized?: Record<string, string> };
  return language === 'ar' ? v?.titleLocalized?.ar || '' : v?.titleLocalized?.en || v?.title || '';
}

test.describe('Release: bulk rename order', () => {
  test('order by title, move one by keyboard, rename Lesson {n}: the numbers follow the order', async ({ page }) => {
    test.setTimeout(8 * 60_000);
    const user = await signUpOnWeb(page, 'rel-bulk-order');
    await createProfile(user);
    await grantCreatorTier(user);
    const stamp = Date.now().toString(36);
    const channelId = await createChannelInMenu(page, user, `Release E2E order ${stamp}`);

    const ids: Record<string, string> = {};
    try {
      for (const n of ['10', '2', '1', '3']) ids[n] = await createVideo(user, channelId, `Order ${stamp} ${n}`);

      await page.goto(`${target().web}/en/studio/${channelId}/content/videos?status=processing&q=${encodeURIComponent(`Order ${stamp}`)}`);
      await expect(page.getByTestId('studio-video-select')).toHaveCount(4, { timeout: 60000 });
      await page.getByTestId('studio-select-all').check();
      await page.getByTestId('studio-bulk-bar').getByTestId('studio-bulk-edit').click();
      await expect(page.getByTestId('bulk-edit-panel')).toBeVisible();
      await page.getByTestId('bulk-edit-tick-title').check();
      const orderKey = page.getByTestId('bulk-edit-preview-order-key');
      if (!(await orderKey.isVisible().catch(() => false))) {
        test.info().annotations.push({ type: 'not-deployed', description: 'this build has no order control in the rename preview yet' });
        test.skip(true, 'this build has no order control in the rename preview yet');
      }
      await page.getByTestId('rename-pattern-en').or(page.getByTestId('rename-pattern')).fill('Lesson {n}');

      const rows = page.getByTestId('bulk-edit-preview-row');
      await expect(rows).toHaveCount(4);
      const order = async () => rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
      const lessons = page.locator('[data-testid="bulk-edit-preview-after"][data-language="en"]');
      const dir = page.getByTestId('bulk-edit-preview-order-dir');
      const flip = async (expected: string[], label: RegExp) => {
        await dir.click();
        await expect.poll(order, { message: `the direction button should re-sort to ${label}` }).toEqual(expected);
        await expect(dir).toHaveAttribute('aria-label', label);
        await expect(lessons).toHaveText(['Lesson 1', 'Lesson 2', 'Lesson 3', 'Lesson 4']);
      };
      const created = [ids['10'], ids['2'], ids['1'], ids['3']];
      const natural = [ids['1'], ids['2'], ids['3'], ids['10']];

      // Upload date: created 10, 2, 1, 3; the direction button reverses it and back
      await orderKey.selectOption('uploaded');
      await expect.poll(order).toEqual(created);
      await flip([...created].reverse(), /Descending$/);
      await flip(created, /Ascending$/);

      // Nothing is encoded, so there is no duration to sort by
      const durationOption = orderKey.locator('option[value="duration"]');
      if (await durationOption.evaluate((o) => (o as HTMLOptionElement).disabled)) {
        await expect(durationOption).toHaveText('Duration (none to sort by)');
      } else {
        test.info().annotations.push({ type: 'not-deployed', description: 'this build still offers sorts with no values (the direction did nothing there)' });
      }

      // Title (natural), both ways
      await orderKey.selectOption('title');
      await expect.poll(order).toEqual(natural);
      await flip([...natural].reverse(), /Descending$/);
      await flip(natural, /Ascending$/);

      // Move "10" up one with the keyboard; the move is announced
      const handle10 = page.locator(`[data-testid="bulk-edit-preview-handle"][data-id="${ids['10']}"]`);
      await handle10.focus();
      await page.keyboard.press('Alt+ArrowUp');
      await expect(page.getByTestId('bulk-edit-preview-moved')).toHaveText('Moved to position 3 of 4');
      expect(await order()).toEqual([ids['1'], ids['2'], ids['10'], ids['3']]);
      // The Arabic title in the same pass, its own pattern, same numbers (builds with a rule per language)
      const arPattern = page.getByTestId('rename-pattern-ar');
      await page.getByTestId('rename-lang-ar').check();
      const bilingual = await arPattern.isVisible().catch(() => false);
      if (bilingual) {
        await arPattern.fill('الدرس {n}');
        await expect(page.locator('[data-testid="bulk-edit-preview-after"][data-language="ar"]')).toHaveText(['الدرس 1', 'الدرس 2', 'الدرس 3', 'الدرس 4']);
      } else {
        await page.getByTestId('rename-lang-ar').uncheck();
      }
      await expect(page.locator('[data-testid="bulk-edit-preview-after"][data-language="en"]')).toHaveText(['Lesson 1', 'Lesson 2', 'Lesson 3', 'Lesson 4']);

      await page.getByTestId('bulk-edit-review').click();
      await page.getByTestId('bulk-edit-apply').click();
      const result = page.getByTestId('bulk-edit-result');
      await expect(result).toHaveAttribute('data-succeeded', '4', { timeout: 60000 });
      await expect(result).toHaveAttribute('data-failed', '0');

      const expected: Record<string, string> = { '1': 'Lesson 1', '2': 'Lesson 2', '10': 'Lesson 3', '3': 'Lesson 4' };
      for (const [n, title] of Object.entries(expected)) {
        await expect.poll(() => titleOf(user, channelId, ids[n]), { message: `"${n}" should be renamed "${title}"`, timeout: 30000 }).toBe(title);
        if (bilingual) {
          const ar = title.replace('Lesson', 'الدرس');
          await expect.poll(() => titleOf(user, channelId, ids[n], 'ar'), { message: `"${n}" should be renamed "${ar}" in Arabic`, timeout: 30000 }).toBe(ar);
        }
      }
    } finally {
      for (const id of Object.values(ids)) await apiFetch(user, `/api/videos/${id}/permanent`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
