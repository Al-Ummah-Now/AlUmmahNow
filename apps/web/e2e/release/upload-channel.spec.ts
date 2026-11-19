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
 * 3. #759: an editor with no creator tier of their own uploads to a channel
 *    whose owner has one (uploads there run under the owner's tier); once the
 *    owner's tier is removed, /upload is not found (hidden when off).
 * Every video is deleted afterwards.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier, setCreatorTier } from './creator-tier';
import { createChannelInMenu } from './account-menu';

test.use({ trace: 'off' });

const CLIP = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample.mp4');

/**
 * A copy of the clip under a new name: each upload here is a different file. Picking a file this
 * browser already uploaded says "Already uploaded" instead of starting a second video (#1126).
 */
function freshClip(): string {
  const file = path.join(os.tmpdir(), `e2e-clip-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.mp4`);
  fs.copyFileSync(CLIP, file);
  return file;
}

/** Uploads the clip in single mode; returns the new video id and the channelId header initiate was sent with. */
async function uploadOnPage(page: Page, title: string): Promise<{ videoId: string; headerChannelId: string }> {
  await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('upload-file-input').setInputFiles(freshClip());
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
      await page.getByTestId('batch-file-input').setInputFiles(freshClip());
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
      // The queued file is added again on B (its placeholder video is now on B)
      await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-total', '1', { timeout: 60000 });
      await expect(picker).toHaveAttribute('data-disabled', 'false');
    } finally {
      await page.goto('about:blank');
      for (const u of uploads) {
        if (u.videoId) await apiFetch(user, `/api/videos/${u.videoId}/permanent`, { method: 'DELETE', headers: { channelId: u.channelId } });
      }
    }
  });
});

async function newSignedInPage(browser: Browser, prefix: string): Promise<{ page: Page; user: WebUser; close: () => Promise<void> }> {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const user = await signUpOnWeb(page, prefix);
  await createProfile(user);
  return { page, user, close: () => context.close() };
}

test.describe('Release: channel editors upload under the owner\'s tier (#759)', () => {
  test('an editor with no tier of their own uploads to a Creator\'s channel, and is refused once the owner has none', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const owner = await newSignedInPage(browser, 'rel-759-owner');
    const editor = await newSignedInPage(browser, 'rel-759-editor');
    let videoId = '';
    let channelId = '';
    try {
      await grantCreatorTier(owner.user);
      const created = await apiFetch(owner.user, '/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Release E2E 759 ${Date.now().toString(36)}`, description: 'Created by the release E2E suite', isMain: true }),
      });
      const createdText = await created.text();
      expect(created.status, `POST /api/channels: ${createdText}`).toBeLessThan(300);
      channelId = (JSON.parse(createdText) as { result?: { channel?: { id?: string } } }).result?.channel?.id ?? '';
      expect(channelId, 'channel create returned no id').toBeTruthy();
      // Roles are given by invitation only (docs/specs/CHANNEL-ROLES.md §4): the owner invites, the editor accepts
      const sent = await apiFetch(owner.user, `/api/channels/${channelId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: editor.user.email, role: 'editor' }),
      });
      expect(sent.status, `invite: ${await sent.clone().text()}`).toBe(200);
      const mine = (await (await apiFetch(editor.user, '/api/channel-invites')).json()) as { data?: { invites?: Array<{ id: string; channel: { id: string } }> } };
      const invitation = mine.data?.invites?.find((i) => i.channel.id === channelId);
      expect(invitation, 'the editor does not see the invitation').toBeTruthy();
      const accepted = await apiFetch(editor.user, `/api/channel-invites/${invitation!.id}/accept`, { method: 'POST' });
      expect(accepted.status, `accept: ${await accepted.clone().text()}`).toBe(200);

      // The API names the channel for the editor, whose own tier allows no uploads
      const access = async () =>
        ((await (await apiFetch(editor.user, '/api/me/creator')).json().catch(() => ({}))) as { result?: { tier?: { uploads?: boolean } | null; canUpload?: boolean; uploadChannelIds?: string[] } }).result;
      const first = await access();
      test.skip(!Array.isArray(first?.uploadChannelIds), 'the QA build predates per-channel upload eligibility (#759)');
      // Every account holds Member (no uploads) unless granted more (#1415)
      expect(first?.tier?.uploads ?? false, 'the editor\'s own tier allows uploads').toBe(false);
      await expect.poll(async () => (await access())?.uploadChannelIds ?? [], { message: 'the editor\'s channel is not listed', timeout: 30000 }).toContain(channelId);

      // /upload shows the uploader on the owner's channel, and the upload lands there
      await editor.page.goto(`${target().web}/en/upload`);
      await expect(editor.page.getByTestId('not-found-page')).toHaveCount(0);
      const picker = editor.page.getByTestId('upload-channel-picker');
      await expect(picker).toHaveAttribute('data-channel-id', channelId, { timeout: 30000 });
      const upload = await uploadOnPage(editor.page, `Release E2E 759 editor ${Date.now().toString(36)}`);
      videoId = upload.videoId;
      expect(upload.headerChannelId).toBe(channelId);
      expect(await storedChannel(editor.user, videoId, channelId), 'the editor\'s upload is not on the owner\'s channel').toBe(channelId);

      // The owner loses the tier: /upload no longer exists for the editor, and nothing says why
      await setCreatorTier(owner.user, null);
      await expect.poll(async () => (await access())?.canUpload, { message: 'the editor can still upload', timeout: 30000 }).toBe(false);
      await editor.page.goto(`${target().web}/en/upload`);
      await expect(editor.page.getByTestId('not-found-page')).toBeVisible({ timeout: 30000 });
      await expect(editor.page.getByTestId('upload-by-invitation')).toHaveCount(0);
    } finally {
      if (videoId) await apiFetch(owner.user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
      await owner.close();
      await editor.close();
    }
  });
});
