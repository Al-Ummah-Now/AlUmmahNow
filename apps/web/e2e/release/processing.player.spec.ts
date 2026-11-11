/**
 * Release regression for the 2026-11-10 upload incident: uploads stayed
 * "processing" forever (only the uploader's open page ever finished them),
 * thumbnails 404'd and the player showed a raw "network error".
 *
 * A new user uploads a small video on /upload and leaves. Nobody polls the
 * owner's status endpoint after that, so only the server's processing-check
 * loop (queue → check Bunny → queue → done) can make it ready. Then:
 * - while processing, the watch page shows "Processing, ready soon", never a
 *   player error;
 * - it becomes ready on its own (missed webhook / closed tab);
 * - its thumbnail loads (naturalWidth > 0) in the owner's studio;
 * - the watch page plays it (currentTime advances; branded Chrome, "player"
 *   project, for H.264 HLS).
 * The video and channel are the run's own; the video is deleted at the end.
 */
import * as path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { playFor, watchUrl } from './videos';
import { submitNewChannelInMenu } from './account-menu';

// Signs in through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

// 40 s so playback has room to advance (the 3 s sample can end first)
const VIDEO = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample-40s.mp4');
/** Loop checks every minute for the first 10 min (sync.ts CHECK_BACKOFF_SECONDS); a short clip encodes in ~1 min */
const READY_TIMEOUT_MS = 9 * 60_000;

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
    }, { message: 'the new channel is not in GET /api/channels', timeout: 30000 })
    .not.toBe('');
  return channelId;
}

async function videoState(user: WebUser, id: string) {
  // GET /api/videos/:id only reads; it never moves a video to ready
  const res = await apiFetch(user, `/api/videos/${id}`);
  const body = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown> } & Record<string, unknown>;
  return ((body.result ?? body) as { uploadStatus?: string; thumbnailUrl?: string; availableResolutions?: string[] }) ?? {};
}

test.describe('Release: upload processing', () => {
  test('an upload left alone becomes ready, shows its thumbnail and plays; meanwhile the watch page says it is processing', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const user = await signUpOnWeb(page, 'rel-processing');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);
    const channelId = await createChannelInMenu(page, user, `Release E2E processing ${Date.now().toString(36)}`);

    await page.goto(`${target().web}/en/upload`);
    await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('upload-file-input').setInputFiles(VIDEO);
    await expect(page.getByTestId('upload-details')).toBeVisible();
    const title = `Release E2E processing ${Date.now().toString(36)}`;
    await page.getByTestId('upload-title-en').fill(title);
    await page.getByTestId('upload-is-public').uncheck();
    await page.getByTestId('upload-submit').click();
    await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150000 });
    const uploadedAt = Date.now();

    let videoId = '';
    try {
      await expect
        .poll(async () => {
          const res = await apiFetch(user, `/api/videos/search?limit=100&isOwner=true&channelIds=${channelId}`, { headers: { channelId } });
          const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> };
          videoId = body.data?.find((v) => v.title === title)?.id ?? '';
          return videoId;
        }, { message: 'the upload is not in the owner\'s video search', timeout: 60000 })
        .not.toBe('');

      // Leave the upload page: from here on nothing client-side checks the status
      await page.goto('about:blank');

      const first = await videoState(user, videoId);
      if (first.uploadStatus !== 'ready') {
        const watcher = await page.context().newPage();
        // A second page that is not the uploader's: it must not poll the owner endpoint
        await watcher.route(/\/upload-status/, (route) => route.abort());
        await watcher.goto(watchUrl(videoId, 'en'));
        const state = watcher.getByTestId('video-processing-state');
        await expect(state).toBeVisible({ timeout: 30000 });
        await expect(state.getByRole('status')).toHaveText(/Processing, ready soon/);
        await expect(watcher.getByTestId('video-error')).toHaveCount(0);
        await watcher.close();
      } else {
        test.info().annotations.push({ type: 'note', description: 'Encoded before the first check; the processing state was not observable' });
      }

      await expect
        .poll(async () => (await videoState(user, videoId)).uploadStatus, {
          message: 'the video did not become ready by itself (processing-check loop)',
          timeout: READY_TIMEOUT_MS,
          intervals: [5_000],
        })
        .toBe('ready');
      // Reported for the incident follow-up: upload complete → ready (first playable resolution)
      const readyAfter = Math.round((Date.now() - uploadedAt) / 1000);
      test.info().annotations.push({ type: 'ready-after-upload', description: `${readyAfter}s` });
      process.stdout.write(`[processing] ready ${readyAfter}s after the upload completed\n`);
      const ready = await videoState(user, videoId);
      expect(ready.availableResolutions?.length ?? 0, 'ready video has resolutions').toBeGreaterThan(0);

      // Thumbnail really loads (signed URL, right library host)
      // Studio's Videos list (the creator home); a ready public upload is under Published
      await page.goto(`${target().web}/en/studio/go/content/videos`);
      const card = page.getByTestId('studio-video-row').filter({ hasText: title }).first();
      await expect(card).toBeVisible({ timeout: 30000 });
      const thumbnail = card.locator('img').first();
      await expect
        .poll(() => thumbnail.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), {
          message: 'the thumbnail did not load',
          timeout: 30000,
        })
        .toBeGreaterThan(0);

      // And it plays
      await page.goto(watchUrl(videoId, 'en'));
      await expect(page.getByTestId('video-processing-state')).toHaveCount(0);
      expect(await playFor(page, 2)).toBeGreaterThan(1);
    } finally {
      if (videoId) await apiFetch(user, `/api/videos/${videoId}`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
