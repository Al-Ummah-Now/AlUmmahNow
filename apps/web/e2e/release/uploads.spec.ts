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
import { test, expect } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';

const FIXTURES = path.join(__dirname, '..', 'test-fixtures');
const IMAGE = path.join(FIXTURES, 'e2e-thumbnail.jpg');
const VIDEO = path.join(FIXTURES, 'e2e-sample.mp4');

function imageForm(): FormData {
  const form = new FormData();
  form.append('photo', new Blob([fs.readFileSync(IMAGE)], { type: 'image/jpeg' }), 'release-e2e.jpg');
  return form;
}

async function expectServedImage(url: string | undefined): Promise<void> {
  expect(url, 'no image URL saved').toBeTruthy();
  const res = await fetch(url as string);
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

test.describe('Release: uploads', () => {
  test('profile and channel images upload and are served', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-images');
    await createProfile(user);

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
    // Create the channel the way users do (account menu), which also refreshes
    // the web session's channels; a channel created only through the API is
    // not in the session until its channel list is reloaded
    const channelName = `Release E2E uploads ${Date.now().toString(36)}`;
    // Consent already answered (analytics, experiments, performance all off),
    // so the banner does not cover the account menu
    await page.context().addCookies([
      { name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' },
    ]);
    await page.goto(`${target().web}/en`);
    await page.getByTestId('nav-menu-trigger').click();
    await page.getByTestId('nav-create-channel').click();
    const nameInput = page.locator('[role="menu"] input[type="text"]').first();
    await nameInput.fill(channelName);
    await nameInput.press('Enter');
    // The form closes once the channel exists and the session's channels are
    // reloaded; navigating before that loses the reload
    await expect(nameInput).toBeHidden({ timeout: 30000 });

    let channelId = '';
    await expect
      .poll(async () => {
        const res = await apiFetch(user, '/api/channels?limit=100');
        const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
        channelId = body.data?.find((c) => c.name === channelName)?.id ?? '';
        return channelId;
      }, { message: 'the channel created in the account menu is not in GET /api/channels', timeout: 30000 })
      .not.toBe('');

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

      await page.goto(`${target().web}/en/dashboard/videos`);
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 30000 });
    } finally {
      if (videoId) await apiFetch(user, `/api/videos/${videoId}`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
