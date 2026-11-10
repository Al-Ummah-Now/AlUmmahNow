/**
 * A retried upload reuses its video (owner, 2026-11-10: every retry created a
 * new Bunny video and the old ones stayed forever).
 *
 * The upload is interrupted (the browser context is closed mid-upload), then
 * retried in a FRESH context (no cookies, no localStorage: nothing remembers
 * the file). Upload initiate keys the unfinished upload on channel + uploader
 * + file fingerprint, so the retry:
 * - gets the same video id back (`reused: true`), not a new Bunny video;
 * - resumes the earlier Bunny upload at its offset (no second TUS POST);
 * - finishes, and the channel has exactly one video for the file.
 *
 * Small file in 5 MB chunks (the `aun:tus-chunk-size` override).
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signInAgain, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';

// Signs users in through the auth server: traces would hold the password.
test.use({ trace: 'off' });

const MB = 1024 * 1024;
const CHUNK = 5 * MB;
const SAMPLE = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample-40s.mp4');

function paddedVideo(dir: string, name: string, bytes: number): string {
  const head = fs.readFileSync(SAMPLE);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.concat([head, randomBytes(Math.max(0, bytes - head.length))]));
  return file;
}

/** A new sink user with a profile and a channel (created through the account menu). */
async function uploader(page: Page): Promise<{ user: WebUser; channelId: string }> {
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  const user = await signUpOnWeb(page, 'rel-reuse');
  await createProfile(user);
  // Creating a channel and uploading are by invitation: the Creator tier first
  await grantCreatorTier(user);
  const channelName = `Release E2E reuse ${Date.now().toString(36)}`;
  await page.goto(`${target().web}/en`);
  await page.getByTestId('nav-menu-trigger').click();
  const switchChannel = page.getByTestId('nav-switch-channel');
  await switchChannel.or(page.getByTestId('nav-create-channel')).first().waitFor();
  if (await switchChannel.isVisible()) await switchChannel.click();
  await page.getByTestId('nav-create-channel').click();
  const nameInput = page.locator('[role="menu"] input[type="text"]').first();
  await nameInput.fill(channelName);
  await nameInput.press('Enter');
  await expect(nameInput).toBeHidden({ timeout: 30000 });
  let channelId = '';
  await expect
    .poll(async () => {
      const res = await apiFetch(user, '/api/channels?limit=100');
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
      channelId = body.data?.find((c) => c.name === channelName)?.id ?? '';
      return channelId;
    }, { timeout: 30000 })
    .not.toBe('');
  return { user, channelId };
}

interface Log {
  initiates: Array<{ videoId: string; reused?: boolean; tusUploadId?: string }>;
  posts: number;
  patches: Array<{ offset: number; acked: number }>;
}

/** Watches the page's initiate answers and its TUS traffic (no interception). */
function watch(page: Page, log: Log): void {
  page.on('response', async (res) => {
    const url = res.url();
    const method = res.request().method();
    if (method === 'POST' && /\/api\/videos\/upload\/initiate$/.test(url)) {
      const body = (await res.json().catch(() => ({}))) as { result?: { videoId: string; reused?: boolean; tusUploadId?: string } };
      if (body.result) log.initiates.push({ videoId: body.result.videoId, reused: body.result.reused, tusUploadId: body.result.tusUploadId });
    }
    if (method === 'POST' && /\/api\/videos\/tus\/?$/.test(url) && res.status() === 201) log.posts++;
    if (method === 'PATCH' && /\/api\/videos\/tus\/[^/]+$/.test(url) && res.status() === 204) {
      log.patches.push({ offset: Number(res.request().headers()['upload-offset'] ?? -1), acked: Number(res.headers()['upload-offset'] ?? -1) });
    }
  });
}

async function startUpload(page: Page, file: string, title: string): Promise<void> {
  await page.addInitScript((size) => window.localStorage.setItem('aun:tus-chunk-size', String(size)), CHUNK);
  await page.goto(`${target().web}/en/upload`);
  await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('upload-file-input').setInputFiles(file);
  await expect(page.getByTestId('upload-details')).toBeVisible();
  await page.getByTestId('upload-title-en').fill(title);
  await page.getByTestId('upload-is-public').uncheck();
  await page.getByTestId('upload-submit').click();
}

test.describe('Release: retried uploads reuse their video', () => {
  test.describe.configure({ timeout: 360000 });

  test('interrupted, then retried in a fresh browser context: one video, resumed at its offset', async ({ browser }, testInfo) => {
    const first = await browser.newContext();
    const page = await first.newPage();
    const u = await uploader(page);
    const file = paddedVideo(testInfo.outputDir, 'reuse-me.mp4', 5 * CHUNK + 4321); // 6 chunks
    const title = `Release E2E reuse ${Date.now().toString(36)}`;
    const firstLog: Log = { initiates: [], posts: 0, patches: [] };
    watch(page, firstLog);
    page.on('dialog', (d) => void d.accept());

    let videoId = '';
    try {
      await startUpload(page, file, title);
      await expect.poll(() => firstLog.patches.length, { timeout: 120000 }).toBeGreaterThanOrEqual(2);
      videoId = firstLog.initiates[0]?.videoId ?? '';
      expect(videoId, 'the first initiate returned no video').toBeTruthy();
      expect(firstLog.initiates[0].reused).toBe(false);
      const ackedBefore = Math.max(...firstLog.patches.map((p) => p.acked));
      // Interrupt: the whole browser context goes away mid-upload
      await first.close();

      // Retry in a fresh context: no cookies, no localStorage
      const second = await browser.newContext();
      const page2 = await second.newPage();
      const log: Log = { initiates: [], posts: 0, patches: [] };
      watch(page2, log);
      page2.on('dialog', (d) => void d.accept());
      const again = await signInAgain(page2, u.user.email);
      u.user.accessToken = again.accessToken;
      // signInAgain clears cookies: consent again so the banner stays out of the way
      await page2.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
      expect(await page2.evaluate(() => window.localStorage.getItem('aun-upload-resume:v1'))).toBeNull();
      await startUpload(page2, file, title);
      await expect(page2.getByTestId('upload-success')).toBeVisible({ timeout: 180000 });

      expect(log.initiates.map((i) => i.videoId), 'the retry created another video').toEqual([videoId]);
      expect(log.initiates[0].reused, 'the server did not reuse the unfinished upload').toBe(true);
      expect(log.initiates[0].tusUploadId, 'no earlier upload to resume').toBeTruthy();
      expect(log.posts, 'the retry created a second TUS upload at Bunny').toBe(0);
      expect(log.patches[0]?.offset ?? -1, 'the retry restarted below what Bunny already had').toBeGreaterThanOrEqual(ackedBefore);
      expect(Math.max(...log.patches.map((p) => p.acked))).toBe(fs.statSync(file).size);

      // Exactly one video for the file on the channel
      await expect
        .poll(async () => {
          const res = await apiFetch(u.user, `/api/videos/${videoId}/upload-status`, { headers: { channelId: u.channelId } });
          return ((await res.json().catch(() => ({}))) as { result?: { status?: string } }).result?.status ?? '';
        }, { timeout: 60000 })
        .toMatch(/^(processing|ready)$/);
      await expect
        .poll(async () => {
          const res = await apiFetch(u.user, `/api/videos/search?limit=100&isOwner=true&channelIds=${u.channelId}`, { headers: { channelId: u.channelId } });
          const found = ((await res.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> }).data ?? [];
          return found.filter((v) => v.title === title).map((v) => v.id);
        }, { timeout: 60000, message: 'the channel must hold exactly the one reused video' })
        .toEqual([videoId]);
      await second.close();
    } finally {
      if (videoId) await apiFetch(u.user, `/api/videos/${videoId}`, { method: 'DELETE', headers: { channelId: u.channelId } });
    }
  });
});
