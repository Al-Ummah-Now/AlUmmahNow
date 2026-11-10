/**
 * Release regression (2026-11-10): "in upload page there is no channel
 * selection". The upload page never showed or let you choose the channel a
 * video goes to; it used the session's acting channel.
 *
 * One new user with two channels (A, then B):
 * 1. Switches to A in the header's channel switcher, opens /upload and
 *    uploads: the initiate request's channelId header and the stored video
 *    are on A (annotated as `nav-switch`, the evidence for the report).
 * 2. With the channel picker on QA: it starts on A (the header's channel),
 *    picking B uploads to B, a ?channel= link preselects its channel, and
 *    changing channel with a file queued asks first in the in-app dialog.
 * Every video is deleted afterwards.
 */
import * as path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { createChannelInMenu } from './account-menu';

test.use({ trace: 'off' });

const CLIP = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample.mp4');

/** Switches the acting channel in the videos header's account menu. */
async function switchChannelInHeader(page: Page, channelId: string): Promise<void> {
  await page.goto(`${target().web}/en`, { waitUntil: 'load' });
  const switchChannel = page.locator('[data-testid="nav-switch-channel"]:visible').first();
  await expect(async () => {
    if (!(await switchChannel.isVisible())) await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
    await expect(switchChannel).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
  await switchChannel.click();
  const option = page.locator(`[data-testid="nav-channel-option"][data-channel-id="${channelId}"]:visible`).first();
  await expect(option).toBeVisible({ timeout: 30000 });
  await option.click();
  await expect(page.locator(`[data-testid="nav-channel-option"][data-channel-id="${channelId}"]`).first()).toHaveAttribute('aria-checked', 'true', { timeout: 30000 });
}

/** Uploads the clip in single mode; returns the new video id and the channelId header initiate was sent with. */
async function uploadOnPage(page: Page, title: string): Promise<{ videoId: string; headerChannelId: string }> {
  await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('upload-file-input').setInputFiles(CLIP);
  await expect(page.getByTestId('upload-details')).toBeVisible();
  await page.getByTestId('upload-title-en').fill(title);
  await page.getByTestId('upload-is-public').uncheck();
  const initiate = page.waitForResponse((r) => /\/api\/videos\/upload\/initiate/.test(r.url()) && r.request().method() === 'POST');
  await page.getByTestId('upload-submit').click();
  const response = await initiate;
  const headers = await response.request().allHeaders();
  const body = (await response.json().catch(() => ({}))) as { result?: { videoId?: string } };
  await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150000 });
  return { videoId: body.result?.videoId ?? '', headerChannelId: headers['channelid'] ?? '' };
}

async function storedChannel(user: WebUser, videoId: string, channelId: string): Promise<string> {
  const res = await apiFetch(user, `/api/videos/${videoId}`, { headers: { channelId } });
  const body = (await res.json().catch(() => ({}))) as { data?: { channelId?: string; channel?: string }; channelId?: string };
  return body.data?.channelId ?? body.data?.channel ?? body.channelId ?? '';
}

test.describe('Release: the upload page shows and follows the chosen channel', () => {
  test('header switch, picker, deep link and confirm decide where an upload goes', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const user = await signUpOnWeb(page, 'rel-upload-channel');
    await createProfile(user);
    await grantCreatorTier(user);
    const stamp = Date.now().toString(36);
    const channelA = await createChannelInMenu(page, user, `Release E2E chan A ${stamp}`);
    const channelB = await createChannelInMenu(page, user, `Release E2E chan B ${stamp}`);
    const uploads: Array<{ videoId: string; channelId: string }> = [];

    try {
      // 1. The header's switch decides where /upload sends the video
      await switchChannelInHeader(page, channelA);
      await page.goto(`${target().web}/en/upload`);
      const picker = page.getByTestId('upload-channel-picker');
      const hasPicker = await picker.waitFor({ timeout: 15000 }).then(() => true, () => false);
      if (hasPicker) await expect(picker).toHaveAttribute('data-channel-id', channelA);
      const first = await uploadOnPage(page, `Release E2E nav switch ${stamp}`);
      expect(first.videoId, 'upload initiate returned no video id').toBeTruthy();
      uploads.push({ videoId: first.videoId, channelId: channelA });
      const firstStored = await storedChannel(user, first.videoId, channelA);
      test.info().annotations.push({
        type: 'nav-switch',
        description: `header switched to A=${channelA} (B=${channelB} was created last); initiate channelId header=${first.headerChannelId}; stored video channelId=${firstStored}; picker on page=${hasPicker}`,
      });
      expect(first.headerChannelId, 'initiate was sent for another channel than the header\'s').toBe(channelA);
      expect(firstStored, 'the video landed on another channel than the header\'s').toBe(channelA);

      test.skip(!hasPicker, 'the QA build predates the upload channel picker');

      // 2. Picking B in the picker uploads to B, whatever the header says
      await page.goto(`${target().web}/en/upload`);
      await expect(picker).toHaveAttribute('data-channel-id', channelA, { timeout: 30000 });
      await expect(picker).toHaveAttribute('data-mode', 'choose');
      const combobox = page.getByRole('combobox', { name: 'Choose the channel to upload to' });
      await combobox.click();
      await page.getByTestId(`upload-channel-option-${channelB}`).click();
      await expect(picker).toHaveAttribute('data-channel-id', channelB);
      const second = await uploadOnPage(page, `Release E2E picked B ${stamp}`);
      uploads.push({ videoId: second.videoId, channelId: channelB });
      expect(second.headerChannelId).toBe(channelB);
      expect(await storedChannel(user, second.videoId, channelB), 'the picked channel was not where the video landed').toBe(channelB);
      // The owner's channel B lists it
      await expect
        .poll(async () => {
          const res = await apiFetch(user, `/api/channels/${channelB}/videos?limit=100`, { headers: { channelId: channelB } });
          return (((await res.json().catch(() => ({}))) as { data?: Array<{ id: string }> }).data ?? []).map((v) => v.id);
        }, { message: 'channel B does not list the upload', timeout: 60000 })
        .toContain(second.videoId);

      // The pick is remembered while the header channel stays the same
      await page.goto(`${target().web}/en/upload`);
      await expect(picker).toHaveAttribute('data-channel-id', channelB, { timeout: 30000 });

      // A ?channel= link preselects its channel
      await page.goto(`${target().web}/en/upload?channel=${channelA}`);
      await expect(picker).toHaveAttribute('data-channel-id', channelA, { timeout: 30000 });

      // With a file queued, changing channel asks first (in-app dialog); cancel keeps it
      await page.getByTestId('upload-mode-batch').click();
      await page.getByTestId('batch-file-input').setInputFiles(CLIP);
      await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-total', '1', { timeout: 60000 });
      await combobox.click();
      await page.getByTestId(`upload-channel-option-${channelB}`).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('playlists and categories');
      await page.getByTestId('upload-channel-switch-cancel').click();
      await expect(dialog).toBeHidden();
      await expect(picker).toHaveAttribute('data-channel-id', channelA);
      await combobox.click();
      await page.getByTestId(`upload-channel-option-${channelB}`).click();
      await page.getByTestId('upload-channel-switch-confirm').click();
      await expect(picker).toHaveAttribute('data-channel-id', channelB);
      await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-total', '1');
    } finally {
      await page.goto('about:blank');
      for (const u of uploads) {
        if (u.videoId) await apiFetch(user, `/api/videos/${u.videoId}`, { method: 'DELETE', headers: { channelId: u.channelId } });
      }
    }
  });
});
