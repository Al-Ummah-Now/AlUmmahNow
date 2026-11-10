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
import { test, expect, type Locator, type Page } from '@playwright/test';
import { promoteToAdmin } from './sink';
import { sinkEmail, target, TEST_PASSWORD } from './targets';
import { apiFetch, completeRegistration, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { fillSecret } from './secret-fill';

// Signs users in through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

// channel.purge scans the playlists bucket in steps (no per-channel index): allow it a couple of minutes
const JOB_TIMEOUT = 120000;
/** admin-web content.queued (en): the answer to every queued action */
const QUEUED_NOTICE = 'Queued. It runs in the background';

async function signInAsAdmin(page: Page, prefix: string): Promise<void> {
  const email = sinkEmail(prefix);
  await gotoDom(page, `${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await completeRegistration(page, email);
  await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });
  await promoteToAdmin(email);
  // New tokens carry the role: drop every session and sign in from scratch
  await page.context().clearCookies();
  await gotoDom(page, `${target().adminWeb}/login`);
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

/**
 * Waits until the page's jobs panel stops re-reading the page (no job in
 * progress). Navigating away while it does (router.refresh every 3s) crashed
 * WebKit's page ("page.goto: Page crashed", and earlier on page.reload).
 */
async function jobsIdle(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="jobs-panel"] [data-active="true"]'), 'a job is still running on this page').toHaveCount(0, { timeout: JOB_TIMEOUT });
}

/**
 * page.goto that waits for the DOM only and survives the app navigating on its own: the page
 * being left can still hard-navigate (a jobs panel refreshing a just-purged record), and the
 * session refresh redirects through /api/auth/refresh back to the same URL. WebKit reports
 * either as an interrupted navigation, Firefox as NS_BINDING_ABORTED (Chromium folds them in);
 * settle and go again.
 */
async function gotoDom(page: Page, url: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return;
    } catch (error) {
      if (attempt >= 3 || !/interrupted by another navigation|NS_BINDING_ABORTED/.test(String(error))) throw error;
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    }
  }
}

/** Opens a filtered list and waits until the item is in the admin index. */
async function findInList(page: Page, url: string, row: ReturnType<Page['locator']>): Promise<void> {
  await jobsIdle(page);
  await expect
    .poll(
      async () => {
        await gotoDom(page, url);
        return row.count();
      },
      { message: `not listed at ${url}`, timeout: 60000, intervals: [2000, 5000] },
    )
    .toBeGreaterThan(0);
}

/**
 * Waits for the newest job of a kind on the detail page to finish. No reloads:
 * the jobs panel re-reads the page every 3s while a job runs, which is what an
 * admin sees (and reloading on top of that crashed WebKit's page).
 */
async function expectJobSucceeded(page: Page, kind: string, count = 1): Promise<void> {
  const items = page.locator(`[data-testid="job-item"][data-job-kind="${kind}"]`);
  // The newest is listed first; `count` waits for this action's job when an earlier one of the kind is listed
  await expect(items.nth(count - 1)).toBeVisible({ timeout: 30000 });
  const item = items.first();
  await expect
    .poll(
      async () => {
        const status = await item.getAttribute('data-job-status');
        if (status === 'failed') throw new Error(`${kind} job failed: ${await item.innerText()}`);
        return status;
      },
      { message: `${kind} job did not finish`, timeout: JOB_TIMEOUT, intervals: [3000] },
    )
    .toBe('succeeded');
}

/**
 * Opens an admin detail page and waits until React has hydrated its actions
 * panel: a fill or click before that is lost (hydration resets the field), which
 * left Save disabled. React marks the DOM nodes it owns with __reactFiber keys.
 */
async function openDetail(page: Page, path: string, actionsTestId: string): Promise<void> {
  await gotoDom(page, `${target().adminWeb}${path}`);
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactFiber'));
    },
    actionsTestId,
    { timeout: 45000 },
  );
}

/** `answer`: what shows once the action is done, when the page drops its action panel (a deleted channel); default the queued notice. */
async function confirm(page: Page, testId: string, opts: { reason?: string; typed?: boolean; answer?: Locator } = {}): Promise<void> {
  await page.getByTestId(testId).click();
  const dialog = page.getByTestId(`${testId}-dialog`);
  await expect(dialog).toBeVisible();
  if (opts.reason) await dialog.getByTestId(`${testId}-reason`).fill(opts.reason);
  if (opts.typed) {
    const input = dialog.getByTestId(`${testId}-typed`);
    await input.fill((await input.getAttribute('data-confirm')) ?? '');
  }
  await dialog.getByTestId(`${testId}-confirm`).click();
  // The form's submit closes the dialog and starts the action
  await expect(dialog, `${testId}: the confirm did not submit`).toBeHidden();
  // This action's own answer (an earlier "Saved" may still be on screen): the queued notice, or its error
  const queued = opts.answer ?? page.getByTestId('content-action-message').filter({ hasText: QUEUED_NOTICE });
  const error = page.getByTestId('content-action-error');
  await expect(queued.or(error).first(), `${testId}: no answer from the action`).toBeVisible({ timeout: 30000 });
  if (await error.first().isVisible()) throw new Error(`${testId} failed: ${await error.first().innerText()}`);
}

test.describe('Release: admin content management', () => {
  test('an admin finds, edits, suspends, unsuspends and deletes a channel and its video', async ({ page, browser }, testInfo) => {
    test.skip(!process.env.TEST_PROMOTE_SECRET, 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    // Two sign-ups, three queued jobs and index polling: longer than the suite's default
    test.setTimeout(360000);
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
      const channelPath = `/channels/${encodeURIComponent(channelId)}`;
      await openDetail(page, channelPath, 'channel-actions');
      await expect(page.getByTestId('channel-detail')).toHaveAttribute('data-channel-id', channelId);

      // Edit
      const description = `Edited by the admin E2E ${tag}`;
      await page.getByTestId('channel-edit-description').fill(description);
      await page.getByTestId('channel-edit-save').click();
      await expect(page.getByTestId('content-action-message')).toBeVisible();
      await openDetail(page, channelPath, 'channel-actions');
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
      // Its cascade is a second sync-holds job; leaving the page waits for it (jobsIdle)
      await expectJobSucceeded(page, 'channel.sync-holds', 2);
      await expect.poll(() => publicStatus(`/api/channels/${channelId}`), { message: 'unsuspended channel not public', timeout: 30000 }).toBe(200);

      // The video: find, edit, delete
      const videoRow = page.locator(`[data-testid="video-row"][data-video-id="${videoId}"]`);
      await findInList(page, `${target().adminWeb}/videos?q=${encodeURIComponent(videoId)}`, videoRow);
      await openDetail(page, `/videos/${encodeURIComponent(videoId)}`, 'video-actions');
      await expect(page.getByTestId('video-detail')).toBeVisible();
      const newTitle = `${videoTitle} (edited)`;
      await page.getByTestId('video-edit-title').fill(newTitle);
      await page.getByTestId('video-edit-save').click();
      await expect(page.getByTestId('video-title')).toHaveText(newTitle, { timeout: 30000 });
      // Its answer is the queued notice, or (purge already done when the page re-reads) the deleted view
      await confirm(page, 'video-delete', {
        typed: true,
        answer: page.getByTestId('content-action-message').filter({ hasText: QUEUED_NOTICE }).or(page.getByTestId('video-erased')),
      });
      // The purge job polls this page; leave once it is done (the record may be gone by then)
      await jobsIdle(page);
      // The queued purge erases the record entirely: it leaves the admin list and the public API
      await expect
        .poll(
          async () => {
            await gotoDom(page, `${target().adminWeb}/videos?q=${encodeURIComponent(videoId)}`);
            return videoRow.count();
          },
          { message: 'deleted video is still listed', timeout: JOB_TIMEOUT, intervals: [3000] },
        )
        .toBe(0);
      expect(await publicStatus(`/api/videos/${videoId}`), 'deleted video still public').toBe(404);

      // Delete the channel
      await openDetail(page, channelPath, 'channel-actions');
      // A deleted channel's page shows the deleted notice instead of its action panel
      await confirm(page, 'channel-delete', { typed: true, answer: page.getByTestId('channel-deleted') });
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
