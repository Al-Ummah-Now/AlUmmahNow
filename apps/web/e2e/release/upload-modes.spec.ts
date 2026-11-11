/**
 * Release regression (2026-11-10): single and bulk uploads behave the same.
 * Bulk uploads showed up at once without thumbnails while single uploads did
 * not, and a visitor saw uploading/processing videos on a channel's Videos tab.
 *
 * One new user uploads one clip on /upload in single mode and one in bulk
 * mode, then for both, before and after they are ready:
 * - a signed-out visitor sees neither until it is ready, then both;
 * - the owner's channel list has both all along;
 * - the API never hands out a thumbnail URL before the video is ready.
 * Both videos are deleted afterwards.
 */
import * as path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { submitNewChannelInMenu } from './account-menu';

test.use({ trace: 'off' });

const CLIP = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample-40s.mp4');

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

interface Listed { id: string; title: string; uploadStatus?: string; thumbnailUrl?: string }

async function channelList(channelId: string, user?: WebUser): Promise<Listed[]> {
  const url = `/api/channels/${channelId}/videos?limit=100`;
  const res = user ? await apiFetch(user, url) : await fetch(`${target().api}${url}`);
  const shorts = user
    ? await apiFetch(user, `/api/channels/${channelId}/shorts?limit=100`)
    : await fetch(`${target().api}/api/channels/${channelId}/shorts?limit=100`);
  const a = ((await res.json().catch(() => ({}))) as { data?: Listed[] }).data ?? [];
  const b = ((await shorts.json().catch(() => ({}))) as { data?: Listed[] }).data ?? [];
  return [...a, ...b];
}

test.describe('Release: single and bulk uploads behave the same', () => {
  test('a visitor sees neither until ready, then both; the owner sees both all along; no thumbnail URL before ready', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const user = await signUpOnWeb(page, 'rel-upload-modes');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);
    const channelId = await createChannelInMenu(page, user, `Release E2E modes ${Date.now().toString(36)}`);
    const stamp = Date.now().toString(36);
    const singleTitle = `Release E2E single ${stamp}`;

    // Single mode (public)
    await page.goto(`${target().web}/en/upload`);
    await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('upload-file-input').setInputFiles(CLIP);
    await expect(page.getByTestId('upload-details')).toBeVisible();
    await page.getByTestId('upload-title-en').fill(singleTitle);
    await page.getByTestId('upload-submit').click();
    await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150000 });

    // Bulk mode (one file; public by default)
    await page.goto(`${target().web}/en/upload`);
    await page.getByTestId('upload-mode-batch').click();
    await page.getByTestId('batch-file-input').setInputFiles(CLIP);
    await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-total', '1', { timeout: 60000 });
    await page.getByTestId('batch-start').click();
    await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-completed', '1', { timeout: 150000 });
    await page.goto('about:blank');

    const ids: string[] = [];
    try {
      await expect
        .poll(async () => {
          ids.splice(0, ids.length, ...(await channelList(channelId, user)).map((v) => v.id));
          return ids.length;
        }, { message: 'the owner\'s channel list should have both uploads', timeout: 60000 })
        .toBe(2);

      // Until ready: never listed to a visitor, never a thumbnail URL
      const ownerView = await channelList(channelId, user);
      for (const v of ownerView) {
        if (v.uploadStatus !== 'ready') {
          expect(v.thumbnailUrl, `${v.title}: thumbnail URL before ready`).toBeFalsy();
          // The clip may become ready between the owner's read and the visitor's: what the
          // visitor's own list says about it is what counts (a ready item is allowed)
          const seen = (await channelList(channelId)).find((x) => x.id === v.id);
          expect(seen?.uploadStatus ?? 'not listed', `${v.title} is listed to a visitor before it is ready`).toMatch(/^(not listed|ready)$/);
        }
      }

      // Both become ready (check loop) and then both are listed to a visitor
      await expect
        .poll(async () => (await channelList(channelId, user)).filter((v) => v.uploadStatus === 'ready').length, {
          message: 'both uploads should become ready',
          timeout: 9 * 60_000,
          intervals: [5000],
        })
        .toBe(2);
      await expect
        .poll(async () => (await channelList(channelId)).map((v) => v.id).sort().join(','), { timeout: 60000 })
        .toBe([...ids].sort().join(','));
    } finally {
      for (const id of ids) await apiFetch(user, `/api/videos/${id}`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
