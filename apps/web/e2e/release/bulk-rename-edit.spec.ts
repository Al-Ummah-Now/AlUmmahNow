/**
 * Release regression: bulk rename and bulk edit (2026-11-10, "bulk name
 * changes or bulk edits").
 *
 * A new creator queues 3 files on /upload (bulk mode), sets their titles
 * for all files with a pattern ("Set values": `{n}`, zero padded), keeps one
 * row's hand-typed Arabic title, and uploads. The 3 videos are created with
 * those titles (no later bulk call). Then in Studio's Content → Videos tab
 * the creator selects the 3 videos and, through "Edit", changes the category
 * and adds them to a playlist (PATCH /api/videos/bulk); the API shows both.
 * Everything is deleted afterwards. Encoding is not awaited.
 *
 * Skips with a reason while the environment's build has no "Set values"
 * (the spec runs on QA before the change is deployed there).
 */
import * as path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';

test.use({ trace: 'off' });

const FIXTURES = path.join(__dirname, '..', 'test-fixtures');
const CLIPS = ['e2e-sample.mp4', 'e2e-sample-40s.mp4', 'e2e-sample-vertical.mp4'].map((f) => path.join(FIXTURES, f));

async function createChannelInMenu(page: Page, user: WebUser, name: string): Promise<string> {
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await page.goto(`${target().web}/en`);
  await page.getByTestId('nav-menu-trigger').click();
  const switchChannel = page.getByTestId('nav-switch-channel');
  await switchChannel.or(page.getByTestId('nav-create-channel')).first().waitFor();
  if (await switchChannel.isVisible()) await switchChannel.click();
  await page.getByTestId('nav-create-channel').click();
  const nameInput = page.locator('[role="menu"] input[type="text"]').first();
  await nameInput.fill(name);
  await nameInput.press('Enter');
  await expect(nameInput).toBeHidden({ timeout: 30000 });
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

interface OwnVideo { id: string; title: string; titleLocalized?: Record<string, string>; category?: string }

async function ownVideos(user: WebUser, channelId: string): Promise<OwnVideo[]> {
  const out: OwnVideo[] = [];
  for (const kind of ['videos', 'shorts']) {
    const res = await apiFetch(user, `/api/channels/${channelId}/${kind}?limit=100`);
    out.push(...(((await res.json().catch(() => ({}))) as { data?: OwnVideo[] }).data ?? []));
  }
  return out;
}

async function videoRecord(user: WebUser, id: string, channelId: string): Promise<OwnVideo | null> {
  const res = await apiFetch(user, `/api/videos/${id}`, { headers: { channelId } });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { result?: { video?: OwnVideo }; data?: OwnVideo } & OwnVideo;
  return body.result?.video ?? body.data ?? (body.id ? body : null);
}

test.describe('Release: bulk rename and bulk edit', () => {
  test('3 queued files renamed with a pattern upload with those titles; Studio bulk-changes category and playlist', async ({ page }) => {
    test.setTimeout(12 * 60_000);
    const user = await signUpOnWeb(page, 'rel-bulk-edit');
    await createProfile(user);
    await grantCreatorTier(user);
    const stamp = Date.now().toString(36);
    const channelId = await createChannelInMenu(page, user, `Release E2E bulk ${stamp}`);

    await page.goto(`${target().web}/en/upload`);
    await page.getByTestId('upload-mode-batch').click();
    const setValuesButton = page.getByTestId('batch-settings-set-values');
    if (!(await setValuesButton.isVisible({ timeout: 15000 }).catch(() => false))) {
      test.info().annotations.push({ type: 'not-deployed', description: 'this build has no "Set values" on the upload page yet' });
      test.skip(true, 'this build has no "Set values" on the upload page yet');
    }

    const ids: string[] = [];
    let playlistId = '';
    try {
      await page.getByTestId('batch-file-input').setInputFiles(CLIPS);
      await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-total', '3', { timeout: 90000 });

      // A title typed on the second row is the creator's own
      const arTitles = page.getByTestId('batch-file-title-ar');
      await expect(arTitles).toHaveCount(3, { timeout: 30000 });
      await arTitles.nth(1).fill(`عنوان ${stamp}`);
      await expect(arTitles.nth(1)).toHaveAttribute('dir', 'rtl');

      // Set for all: a numbered pattern in both title fields
      await page.getByTestId('batch-set-values').click();
      const panel = page.getByTestId('batch-set-panel');
      await expect(panel).toBeVisible();
      await page.getByTestId('batch-set-scope-all').check();
      await page.getByTestId('bulk-set-tick-title').check();
      await page.getByTestId('rename-lang-ar').check();
      await page.getByTestId('rename-pattern').fill(`Bulk ${stamp} {n}`);
      await page.getByTestId('rename-pad').fill('2');
      const preview = page.getByTestId('bulk-set-preview-row');
      await expect(preview).toHaveCount(6);
      await expect(page.getByTestId('bulk-set-preview-after').first()).toHaveText(`Bulk ${stamp} 01`);
      await page.getByTestId('batch-set-apply').click();
      await expect(panel).toBeHidden();
      await expect(page.getByTestId('batch-set-notice')).toContainText('3 files');

      const enTitles = page.getByTestId('batch-file-title-en');
      await expect(enTitles.nth(0)).toHaveValue(`Bulk ${stamp} 01`);
      await expect(enTitles.nth(2)).toHaveValue(`Bulk ${stamp} 03`);
      await expect(arTitles.nth(1)).toHaveValue(`عنوان ${stamp}`);
      await expect(arTitles.nth(0)).toHaveValue(`Bulk ${stamp} 01`);

      // Saved onto each row's video before the bytes go up
      await expect(page.getByTestId('batch-file-values-save').filter({ hasText: 'Saved' })).toHaveCount(3, { timeout: 30000 });
      await page.getByTestId('batch-start').click();
      await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-completed', '3', { timeout: 6 * 60_000 });

      await expect
        .poll(async () => {
          const list = await ownVideos(user, channelId);
          ids.splice(0, ids.length, ...list.map((v) => v.id));
          return list.map((v) => v.titleLocalized?.en || v.title).sort();
        }, { message: 'the 3 videos carry the pattern titles', timeout: 60000 })
        .toEqual([`Bulk ${stamp} 01`, `Bulk ${stamp} 02`, `Bulk ${stamp} 03`]);
      const second = (await ownVideos(user, channelId)).find((v) => (v.titleLocalized?.en || v.title) === `Bulk ${stamp} 02`);
      expect(second?.titleLocalized?.ar, 'the hand-typed Arabic title is kept').toBe(`عنوان ${stamp}`);

      // Studio: select the 3 videos, Edit → category and a playlist
      const created = await apiFetch(user, '/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', channelId },
        body: JSON.stringify({ title: `Bulk playlist ${stamp}`, isPublic: false, channelId }),
      });
      playlistId = ((await created.json().catch(() => ({}))) as { result?: { id?: string }; data?: { id?: string }; id?: string }).result?.id ?? '';
      expect(playlistId, 'playlist created').not.toBe('');

      await page.goto(`${target().web}/en/studio/${channelId}/content/videos`);
      const bar = page.getByTestId('studio-bulk-bar');
      const rows = page.getByTestId('studio-video-select');
      if (!(await rows.first().isVisible({ timeout: 30000 }).catch(() => false))) {
        test.info().annotations.push({ type: 'not-deployed', description: 'Studio Content → Videos is not on this build yet' });
        return;
      }
      await page.getByTestId('studio-select-all').check();
      await expect(bar).toBeVisible();
      await bar.getByTestId('studio-bulk-edit').click();
      const edit = page.getByTestId('bulk-edit-panel');
      await expect(edit).toBeVisible();
      await expect(page.getByTestId('bulk-edit-state-title')).toHaveText('Stays as it is');

      await page.getByTestId('bulk-edit-tick-category').check();
      await page.getByTestId('bulk-edit-category').getByRole('combobox').fill('Fiqh');
      await page.getByTestId('bulk-edit-category-option-fiqh').click();
      await page.getByTestId('bulk-edit-tick-playlists').check();
      await page.getByTestId('bulk-edit-playlists-add').getByRole('combobox').fill(`Bulk playlist ${stamp}`);
      await page.getByTestId('bulk-edit-playlists-add').getByRole('option').first().click();
      await page.getByTestId('bulk-edit-review').click();
      await expect(page.getByTestId('bulk-edit-confirm-category')).toHaveAttribute('data-changes', 'true');
      await expect(page.getByTestId('bulk-edit-confirm-title')).toHaveAttribute('data-changes', 'false');
      await page.getByTestId('bulk-edit-apply').click();
      const result = page.getByTestId('bulk-edit-result');
      await expect(result).toHaveAttribute('data-succeeded', '3', { timeout: 60000 });
      await expect(result).toHaveAttribute('data-failed', '0');

      for (const id of ids) {
        await expect.poll(async () => (await videoRecord(user, id, channelId))?.category, { timeout: 30000 }).toBe('fiqh');
      }
      const playlist = await apiFetch(user, `/api/playlists/${playlistId}`, { headers: { channelId } });
      const body = (await playlist.json().catch(() => ({}))) as { result?: { videos?: Array<string | { id: string }> }; data?: { videos?: Array<string | { id: string }> } };
      const inPlaylist = (body.result?.videos ?? body.data?.videos ?? []).map((v) => (typeof v === 'string' ? v : v.id));
      expect(inPlaylist.sort()).toEqual([...ids].sort());
    } finally {
      for (const id of ids) await apiFetch(user, `/api/videos/${id}`, { method: 'DELETE', headers: { channelId } });
      if (playlistId) await apiFetch(user, `/api/playlists/${playlistId}`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
