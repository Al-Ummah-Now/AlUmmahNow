/**
 * Release regressions for uploads, each with its own new user:
 * - profile and channel images (#229: every avatar/cover upload answered 500)
 *   are stored and the stored URL serves the image;
 * - a video uploaded through the upload page (initiate → browser TUS upload
 *   through the api-videos proxy → complete) is listed as the user's video.
 *   Encoding is not awaited: Bunny's processing time is not ours to gate on.
 */
import * as fs from 'fs';
import * as path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { submitNewChannelInMenu } from './account-menu';
import { fetchRetry } from './net';

// This file signs users in through the auth server: its traces would hold the
// typed password and email code (fillSecret args, form POST bodies). Trace off.
test.use({ trace: 'off' });

const FIXTURES = path.join(__dirname, '..', 'test-fixtures');
const IMAGE = path.join(FIXTURES, 'e2e-thumbnail.jpg');
const VIDEO = path.join(FIXTURES, 'e2e-sample.mp4');
/** 360x640 (9:16) VP8 clip: the bundled Chromium decodes VP8, not H.264 */
const VERTICAL_VIDEO = path.join(FIXTURES, 'e2e-sample-vertical-9x16.webm');

/** Pixel size of a JPEG/PNG (walks JPEG segments to the first start-of-frame). */
function imagePixels(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50) return { width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] };
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

function imageForm(): FormData {
  const form = new FormData();
  form.append('photo', new Blob([fs.readFileSync(IMAGE)], { type: 'image/jpeg' }), 'release-e2e.jpg');
  return form;
}

async function expectServedImage(url: string | undefined): Promise<void> {
  expect(url, 'no image URL saved').toBeTruthy();
  const res = await fetchRetry(url as string);
  expect(res.status, `GET ${url}`).toBe(200);
  expect(res.headers.get('content-type') ?? '').toMatch(/^image\//);
}

async function createChannel(user: WebUser, name: string): Promise<string> {
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

/**
 * Create the channel the way users do (account menu), which also refreshes the
 * web session's channels; a channel created only through the API is not in the
 * session until its channel list is reloaded. Returns its id.
 */
async function createChannelInMenu(page: Page, user: WebUser, channelName: string): Promise<string> {
  // Consent already answered (analytics, experiments, performance all off),
  // so the banner does not cover the account menu
  await page.context().addCookies([
    { name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' },
  ]);
  await page.goto(`${target().web}/en`);
  await submitNewChannelInMenu(page, channelName);

  let channelId = '';
  await expect
    .poll(async () => {
      const res = await apiFetch(user, '/api/channels?limit=100');
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
      channelId = body.data?.find((c) => c.name === channelName)?.id ?? '';
      return channelId;
    }, { message: 'the channel created in the account menu is not in GET /api/channels', timeout: 30000 })
    .not.toBe('');
  return channelId;
}

test.describe('Release: uploads', () => {
  test('profile and channel images upload and are served', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-images');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);

    const profileRes = await apiFetch(user, '/api/profile/avatar', { method: 'PUT', body: imageForm() });
    const profileText = await profileRes.text();
    expect(profileRes.status, `PUT /api/profile/avatar: ${profileText}`).toBe(200);
    await expectServedImage((JSON.parse(profileText) as { avatarUrl?: string }).avatarUrl);

    const channelId = await createChannel(user, `Release E2E images ${Date.now().toString(36)}`);
    const channelRes = await apiFetch(user, `/api/channels/${channelId}/avatar`, {
      method: 'PUT',
      body: imageForm(),
      headers: { channelId },
    });
    const channelText = await channelRes.text();
    expect(channelRes.status, `PUT /api/channels/:id/avatar: ${channelText}`).toBe(200);
    await expectServedImage((JSON.parse(channelText) as { avatarUrl?: string }).avatarUrl);
  });

  test('a video uploaded on the upload page is listed as the user\'s video', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-upload');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);
    const channelName = `Release E2E uploads ${Date.now().toString(36)}`;
    const channelId = await createChannelInMenu(page, user, channelName);

    await page.goto(`${target().web}/en/upload`);
    await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('upload-file-input').setInputFiles(VIDEO);
    await expect(page.getByTestId('upload-details')).toBeVisible();
    const title = `Release E2E upload ${Date.now().toString(36)}`;
    await page.getByTestId('upload-title-en').fill(title);
    // Keep it out of public listings
    await page.getByTestId('upload-is-public').uncheck();

    const tus = page.waitForResponse((r) => /\/api\/videos\/tus\//.test(r.url()) && r.request().method() === 'PATCH');
    await page.getByTestId('upload-submit').click();
    expect((await tus).status(), 'TUS chunk upload').toBeLessThan(300);
    await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150000 });

    let videoId = '';
    try {
      await expect
        .poll(
          async () => {
            const res = await apiFetch(user, `/api/videos/search?limit=100&isOwner=true&channelIds=${channelId}`, { headers: { channelId } });
            const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> };
            videoId = body.data?.find((v) => v.title === title)?.id ?? '';
            return videoId;
          },
          { message: 'the uploaded video is not in the owner\'s video search', timeout: 60000 },
        )
        .not.toBe('');

      // Studio's Videos list shows it (Processing until encoded, then Published)
      // The list is client-rendered: it is read once it shows rows or its empty state (never mid-load)
      const listed = page.locator('[data-testid="studio-video-row"], [data-testid="studio-videos-empty"]').first();
      await expect
        .poll(async () => {
          for (const status of ['processing', 'published']) {
            await page.goto(`${target().web}/en/studio/${channelId}/content/videos?status=${status}`);
            await expect(listed).toBeVisible({ timeout: 30000 });
            if (await page.getByTestId('studio-video-row').filter({ hasText: title }).count()) return true;
          }
          return false;
        }, { message: 'the upload is not in Studio\'s Videos list', timeout: 90000, intervals: [3000] })
        .toBe(true);
    } finally {
      if (videoId) await apiFetch(user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
    }
  });
  // 2026-11-10 "single video upload, thumbs dont match aspect": frames were drawn
  // into a fixed 1280x720 canvas, so a vertical video got a squashed thumbnail
  test('a vertical video keeps its 9:16 shape in the thumbnail picker, the preview and the stored thumbnail', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-thumb-aspect');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);
    const channelId = await createChannelInMenu(page, user, `Release E2E thumbs ${Date.now().toString(36)}`);

    await page.goto(`${target().web}/en/upload`);
    await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('upload-file-input').setInputFiles(VERTICAL_VIDEO);
    await expect(page.getByTestId('upload-details')).toBeVisible();

    const frames = page.getByTestId('upload-thumbnail-frame');
    await expect(frames).toHaveCount(5, { timeout: 60000 });
    const sizes = await frames.locator('img[data-testid="thumbnail-image"]').evaluateAll((imgs) =>
      (imgs as HTMLImageElement[]).map((i) => [i.naturalWidth, i.naturalHeight]),
    );
    expect(sizes, 'one image per frame').toHaveLength(5);
    for (const [w, h] of sizes) expect(w / h, `frame ${w}x${h} is not 9:16`).toBeCloseTo(9 / 16, 2);
    // Shown whole (letterboxed) in the 16:9 tiles, not cropped or stretched
    await expect(frames.nth(2).locator('img[data-testid="thumbnail-image"]')).toHaveAttribute('data-fit', 'contain');

    await frames.nth(2).click();
    const preview = page.getByTestId('upload-thumbnail-preview').locator('img');
    await expect(preview).toBeVisible();
    const shape = await preview.evaluate((i: HTMLImageElement) => {
      const r = i.getBoundingClientRect();
      return { natural: i.naturalWidth / i.naturalHeight, rendered: r.width / r.height };
    });
    expect(shape.natural, 'selected thumbnail is not 9:16').toBeCloseTo(9 / 16, 2);
    expect(Math.abs(shape.rendered - shape.natural), 'preview is drawn distorted').toBeLessThan(0.02);

    const title = `Release E2E vertical thumb ${Date.now().toString(36)}`;
    await page.getByTestId('upload-title-en').fill(title);
    await page.getByTestId('upload-is-public').uncheck();
    const initiate = page.waitForResponse((r) => /\/api\/videos\/upload\/initiate/.test(r.url()) && r.request().method() === 'POST');
    await page.getByTestId('upload-submit').click();
    const initiated = (await (await initiate).json().catch(() => ({}))) as { result?: { videoId?: string; thumbnailUrl?: string } };
    const videoId = initiated.result?.videoId ?? '';
    try {
      expect(videoId, 'upload initiate returned no video id').toBeTruthy();
      await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150000 });
      // The stored thumbnail is the 720x1280 frame, not a 1280x720 one
      const res = await apiFetch(user, `/api/videos/${videoId}`, { headers: { channelId } });
      const body = (await res.json().catch(() => ({}))) as { result?: { thumbnailUrl?: string; video?: { thumbnailUrl?: string } }; thumbnailUrl?: string };
      const thumbnailUrl = body.result?.video?.thumbnailUrl ?? body.result?.thumbnailUrl ?? body.thumbnailUrl ?? initiated.result?.thumbnailUrl;
      expect(thumbnailUrl, 'no thumbnail stored for the upload').toBeTruthy();
      const image = await fetchRetry(thumbnailUrl as string);
      expect(image.status, `GET ${thumbnailUrl}`).toBe(200);
      const pixels = imagePixels(new Uint8Array(await image.arrayBuffer()));
      expect(pixels, 'stored thumbnail is not a readable JPEG/PNG').not.toBeNull();
      expect(pixels!.width / pixels!.height, `stored thumbnail is ${pixels!.width}x${pixels!.height}`).toBeCloseTo(9 / 16, 2);
    } finally {
      if (videoId) await apiFetch(user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
