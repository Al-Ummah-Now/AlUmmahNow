/**
 * Release regression: platform content management in admin-web. A creator
 * (its own sink user) makes a channel and a video; an admin (another sink
 * user, promoted) finds both, edits them, suspends the channel (the public
 * API stops serving it once the queued cascade finishes), unsuspends it and
 * deletes the video and the channel. Whatever is left is removed by the
 * creator in `finally`, so a failed run leaves nothing behind.
 *
 * Runs in Chrome, Firefox and WebKit (playwright.release.config.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { promoteToAdmin } from './sink';
import { sinkEmail, target, TEST_PASSWORD } from './targets';
import { apiFetch, completeRegistration, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { fillSecret } from './secret-fill';

// Signs users in through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

const JOB_TIMEOUT = 90000;

async function signInAsAdmin(page: Page, prefix: string): Promise<void> {
  const email = sinkEmail(prefix);
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await completeRegistration(page, email);
  await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });
  await promoteToAdmin(email);
  // New tokens carry the role: drop every session and sign in from scratch
  await page.context().clearCookies();
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await page.fill('input[name="email"]', email);
  await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
  await page.click('button[data-component="button"]');
  await expect(page).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });
}

async function createChannel(user: WebUser, name: string): Promise<string> {
  // Creating channels is by invitation: an admin makes the owner a Creator (channel members upload under it)
  await grantCreatorTier(user);
  const res = await apiFetch(user, '/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: 'Created by the release E2E suite', isMain: true }),
  });
  const text = await res.text();
  expect(res.status, `POST /api/channels: ${text}`).toBeLessThan(300);
  const id = (JSON.parse(text) as { result?: { channel?: { id?: string } } }).result?.channel?.id;
  expect(id, 'channel create returned no id').toBeTruthy();
  return id as string;
}

/** A video record (upload started, no file sent): enough for the admin pages. fileSize and mimeType are required by the initiate schema. */
async function createVideo(user: WebUser, channelId: string, title: string): Promise<string> {
  const res = await apiFetch(user, '/api/videos/upload/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', channelId },
    body: JSON.stringify({ title, description: 'Created by the release E2E suite', isPublic: true, fileSize: 1024, mimeType: 'video/mp4' }),
  });
  const text = await res.text();
  expect(res.status, `POST /api/videos/upload/initiate: ${text}`).toBeLessThan(300);
  const id = (JSON.parse(text) as { result?: { videoId?: string } }).result?.videoId;
  expect(id, 'upload initiate returned no video id').toBeTruthy();
  return id as string;
}

const publicStatus = async (path: string) => (await fetch(`${target().api}${path}`, { cache: 'no-store' })).status;

/** Opens a filtered list and waits until the item is in the admin index. */
async function findInList(page: Page, url: string, row: ReturnType<Page['locator']>): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(url);
        return row.count();
      },
      { message: `not listed at ${url}`, timeout: 60000, intervals: [2000, 5000] },
    )
    .toBeGreaterThan(0);
}

/** Waits for the newest job of a kind on the detail page to finish (the panel refreshes itself while one runs). */
async function expectJobSucceeded(page: Page, kind: string): Promise<void> {
  const item = page.locator(`[data-testid="job-item"][data-job-kind="${kind}"]`).first();
  await expect(item).toBeVisible({ timeout: 30000 });
  await expect
    .poll(
      async () => {
        const status = await item.getAttribute('data-job-status');
        if (status === 'failed') throw new Error(`${kind} job failed: ${await item.innerText()}`);
        if (status !== 'succeeded') await page.reload();
        return status;
      },
      { message: `${kind} job did not finish`, timeout: JOB_TIMEOUT, intervals: [3000] },
    )
    .toBe('succeeded');
}

async function confirm(page: Page, testId: string, opts: { reason?: string; typed?: boolean } = {}): Promise<void> {
  await page.getByTestId(testId).click();
  const dialog = page.getByTestId(`${testId}-dialog`);
  await expect(dialog).toBeVisible();
  if (opts.reason) await dialog.getByTestId(`${testId}-reason`).fill(opts.reason);
  if (opts.typed) {
    const input = dialog.getByTestId(`${testId}-typed`);
    await input.fill((await input.getAttribute('data-confirm')) ?? '');
  }
  await dialog.getByTestId(`${testId}-confirm`).click();
  await expect(page.getByTestId('content-action-error')).toHaveCount(0);
}

test.describe('Release: admin content management', () => {
  test('an admin finds, edits, suspends, unsuspends and deletes a channel and its video', async ({ page, browser }, testInfo) => {
    test.skip(!process.env.TEST_PROMOTE_SECRET, 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;

    const creatorContext = await browser.newContext();
    const creator = await signUpOnWeb(await creatorContext.newPage(), 'rel-content-owner');
    await createProfile(creator);
    const channelId = await createChannel(creator, `Release E2E content ${tag}`);
    const videoTitle = `Release E2E content video ${tag}`;
    const videoId = await createVideo(creator, channelId, videoTitle);

    try {
      await signInAsAdmin(page, 'rel-content-admin');

      // Find the channel and open it
      const channelRow = page.locator(`[data-testid="channel-row"][data-channel-id="${channelId}"]`);
      await findInList(page, `${target().adminWeb}/channels?q=${encodeURIComponent(channelId)}`, channelRow);
      await channelRow.getByRole('link').first().click();
      await expect(page.getByTestId('channel-detail')).toHaveAttribute('data-channel-id', channelId);

      // Edit
      const description = `Edited by the admin E2E ${tag}`;
      await page.getByTestId('channel-edit-description').fill(description);
      await page.getByTestId('channel-edit-save').click();
      await expect(page.getByTestId('content-action-message')).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('channel-edit-description')).toHaveValue(description);

      // Suspend: hidden publicly at once, the cascade to its videos runs as a job
      expect(await publicStatus(`/api/channels/${channelId}`), 'public channel before suspend').toBe(200);
      await confirm(page, 'channel-suspend', { reason: 'Release E2E suspend' });
      await expect(page.getByTestId('channel-suspended-banner')).toBeVisible();
      await expectJobSucceeded(page, 'channel.sync-holds');
      await expect.poll(() => publicStatus(`/api/channels/${channelId}`), { message: 'suspended channel still public', timeout: 30000 }).toBe(404);

      // Unsuspend: public again
      await page.getByTestId('channel-unsuspend').click();
      await expect(page.getByTestId('channel-suspended-banner')).toHaveCount(0);
      await expect.poll(() => publicStatus(`/api/channels/${channelId}`), { message: 'unsuspended channel not public', timeout: 30000 }).toBe(200);

      // The video: find, edit, delete
      const videoRow = page.locator(`[data-testid="video-row"][data-video-id="${videoId}"]`);
      await findInList(page, `${target().adminWeb}/videos?q=${encodeURIComponent(videoId)}`, videoRow);
      await videoRow.getByTestId('video-link').click();
      await expect(page.getByTestId('video-detail')).toBeVisible();
      const newTitle = `${videoTitle} (edited)`;
      await page.getByTestId('video-edit-title').fill(newTitle);
      await page.getByTestId('video-edit-save').click();
      await expect(page.getByTestId('video-title')).toHaveText(newTitle, { timeout: 30000 });
      await confirm(page, 'video-delete', { typed: true });
      // The queued purge erases the record entirely: it leaves the admin list and the public API
      await expect
        .poll(
          async () => {
            await page.goto(`${target().adminWeb}/videos?q=${encodeURIComponent(videoId)}`);
            return videoRow.count();
          },
          { message: 'deleted video is still listed', timeout: JOB_TIMEOUT, intervals: [3000] },
        )
        .toBe(0);
      expect(await publicStatus(`/api/videos/${videoId}`), 'deleted video still public').toBe(404);

      // Delete the channel
      await page.goto(`${target().adminWeb}/channels/${encodeURIComponent(channelId)}`);
      await confirm(page, 'channel-delete', { typed: true });
      await expect(page.getByTestId('channel-deleted')).toBeVisible({ timeout: 30000 });
      await expectJobSucceeded(page, 'channel.purge');
      expect(await publicStatus(`/api/channels/${channelId}`), 'deleted channel still public').toBe(404);
    } finally {
      // Self-cleaning: whatever the admin did not delete, the creator does
      await apiFetch(creator, `/api/videos/${videoId}`, { method: 'DELETE', headers: { channelId } }).catch(() => undefined);
      await apiFetch(creator, `/api/channels/${channelId}`, { method: 'DELETE', headers: { channelId } }).catch(() => undefined);
      await creatorContext.close();
    }
  });
});
