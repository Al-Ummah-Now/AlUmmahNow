/**
 * Release regression: Short vs video (owner decision 2026-11-09).
 *
 * A Short is at most 3 minutes AND vertical or square (encoded height >= width),
 * detected from the duration and resolution Bunny reports when encoding
 * finishes; the uploader's "Upload as Short / as video" wins. One rule
 * (shared-types video-format.ts) decides the channel Videos and Shorts tabs.
 *
 * A new user uploads a 4 s vertical clip (240x426) and a 4 s landscape clip
 * (426x240) through the upload page, waits for Bunny to encode them, then:
 * - the vertical clip is under Shorts and not under Videos, the landscape clip
 *   the other way round (API, and the channel page in en and ar);
 * - "Upload as video" on the vertical clip moves it to Videos; "auto" moves it back.
 * The clips are public (the channel tabs are what is tested) and deleted at the end.
 */
import * as path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';

// Signs in through the auth server: traces would hold the typed password and code
test.use({ trace: 'off' });

const FIXTURES = path.join(__dirname, '..', 'test-fixtures');
const VERTICAL = path.join(FIXTURES, 'e2e-sample-vertical.mp4'); // 240x426, 4 s
const LANDSCAPE = path.join(FIXTURES, 'e2e-sample.mp4'); // 426x240, 4 s
/** Bunny usually encodes these clips in under a minute; allow for a queue. */
const ENCODE_TIMEOUT_MS = 6 * 60 * 1000;

async function createChannelInMenu(page: Page, user: WebUser, name: string): Promise<string> {
  // Consent already answered, so the banner does not cover the account menu
  await page.context().addCookies([
    { name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' },
  ]);
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
    }, { message: 'the channel created in the account menu is not in GET /api/channels', timeout: 30000 })
    .not.toBe('');
  return channelId;
}

/** Upload one file through the upload page; returns the new video's id. */
async function uploadOnPage(page: Page, user: WebUser, channelId: string, file: string, title: string): Promise<string> {
  await page.goto(`${target().web}/en/upload`);
  await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('upload-file-input').setInputFiles(file);
  await expect(page.getByTestId('upload-details')).toBeVisible();
  await page.getByTestId('upload-title-en').fill(title);
  // The choice is offered and defaults to automatic detection
  await expect(page.getByTestId('video-upload-format-auto')).toBeChecked();
  await expect(page.getByTestId('video-upload-format-short')).toBeVisible();
  await expect(page.getByTestId('video-upload-format-video')).toBeVisible();

  const tus = page.waitForResponse((r) => /\/api\/videos\/tus\//.test(r.url()) && r.request().method() === 'PATCH');
  await page.getByTestId('upload-submit').click();
  expect((await tus).status(), 'TUS chunk upload').toBeLessThan(300);
  await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150000 });

  let videoId = '';
  await expect
    .poll(async () => {
      const res = await apiFetch(user, `/api/videos/search?limit=100&isOwner=true&channelIds=${channelId}`, { headers: { channelId } });
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> };
      videoId = body.data?.find((v) => v.title === title)?.id ?? '';
      return videoId;
    }, { message: `uploaded "${title}" is not in the owner's video search`, timeout: 60000 })
    .not.toBe('');
  return videoId;
}

interface StatusBody {
  result?: { status?: string; encodingStatus?: { isProcessing?: boolean } };
  status?: string;
}

/**
 * Poll the owner's upload status (which stores Bunny's duration and resolution)
 * until Bunny has finished encoding. "ready" alone is not enough: a video is
 * ready (watchable) at its first encoded resolution, while Short detection
 * reads the duration and resolution Bunny reports when processing completes
 * (shared-types video-format.ts); until then it counts as a video.
 */
async function waitEncoded(user: WebUser, channelId: string, videoId: string): Promise<'ready' | 'failed' | 'timeout'> {
  const deadline = Date.now() + ENCODE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await apiFetch(user, `/api/videos/${videoId}/upload-status`, { headers: { channelId } });
    const body = (await res.json().catch(() => ({}))) as StatusBody;
    const status = body.result?.status ?? body.status;
    if (status === 'failed') return status;
    if (status === 'ready' && body.result?.encodingStatus?.isProcessing !== true) return status;
    await new Promise((r) => setTimeout(r, 10000));
  }
  return 'timeout';
}

async function tabIds(user: WebUser, channelId: string, tab: 'videos' | 'shorts'): Promise<string[]> {
  const res = await apiFetch(user, `/api/channels/${channelId}/${tab}?limit=50`);
  expect(res.ok, `GET /api/channels/:id/${tab} answered ${res.status}`).toBe(true);
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? []).map((v) => v.id);
}

async function expectTabs(user: WebUser, channelId: string, shorts: string[], videos: string[]) {
  await expect
    .poll(async () => {
      const [s, v] = await Promise.all([tabIds(user, channelId, 'shorts'), tabIds(user, channelId, 'videos')]);
      return {
        shortsOk: shorts.every((id) => s.includes(id)) && videos.every((id) => !s.includes(id)),
        videosOk: videos.every((id) => v.includes(id)) && shorts.every((id) => !v.includes(id)),
      };
    }, { message: `Shorts tab should hold ${shorts.join(',')} and Videos tab ${videos.join(',')}`, timeout: 60000 })
    .toEqual({ shortsOk: true, videosOk: true });
}

async function setFormat(user: WebUser, channelId: string, videoId: string, format: 'short' | 'video' | 'auto') {
  const res = await apiFetch(user, `/api/videos/${videoId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', channelId },
    body: JSON.stringify({ format }),
  });
  expect(res.status, `PUT /api/videos/:id { format: ${format} }: ${await res.clone().text()}`).toBeLessThan(300);
}

test.describe('Release: Short vs video', () => {
  test('vertical ≤ 3 min is a Short, landscape is a video, the uploader choice flips it (en/ar)', async ({ page }) => {
    test.setTimeout(15 * 60 * 1000);
    const user = await signUpOnWeb(page, 'rel-format');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);
    const stamp = Date.now().toString(36);
    const channelId = await createChannelInMenu(page, user, `Release E2E format ${stamp}`);

    const created: string[] = [];
    try {
      const verticalTitle = `Release E2E vertical ${stamp}`;
      const landscapeTitle = `Release E2E landscape ${stamp}`;
      const vertical = await uploadOnPage(page, user, channelId, VERTICAL, verticalTitle);
      created.push(vertical);
      const landscape = await uploadOnPage(page, user, channelId, LANDSCAPE, landscapeTitle);
      created.push(landscape);

      const [v, l] = await Promise.all([waitEncoded(user, channelId, vertical), waitEncoded(user, channelId, landscape)]);
      expect(v, 'vertical clip encoding').not.toBe('failed');
      expect(l, 'landscape clip encoding').not.toBe('failed');
      test.skip(v === 'timeout' || l === 'timeout', `Bunny did not finish encoding within ${ENCODE_TIMEOUT_MS / 60000} min`);

      // Detection from Bunny's duration and resolution
      await expectTabs(user, channelId, [vertical], [landscape]);
      const fetched = (await (await apiFetch(user, `/api/videos/${vertical}`)).json()) as { result?: { isShort?: boolean; width?: number; height?: number } } & { isShort?: boolean; width?: number; height?: number };
      const view = fetched.result ?? fetched;
      expect(view.isShort, 'GET /api/videos/:id isShort').toBe(true);
      expect((view.height ?? 0) >= (view.width ?? 1), `stored resolution ${view.width}x${view.height} is vertical`).toBe(true);

      // The channel page shows the same split, in English and Arabic
      for (const locale of ['en', 'ar'] as const) {
        const shortsLabel = locale === 'ar' ? 'مقاطع قصيرة' : 'Shorts';
        await page.goto(`${target().web}/${locale}/channels/${channelId}?tab=shorts`);
        await expect(page.getByTestId('tab-shorts')).toContainText(shortsLabel);
        const shortsPanel = page.getByTestId('tabpanel-shorts');
        await expect(shortsPanel.getByText(verticalTitle).first()).toBeVisible({ timeout: 30000 });
        await expect(shortsPanel.getByText(landscapeTitle)).toHaveCount(0);

        await page.goto(`${target().web}/${locale}/channels/${channelId}?tab=videos`);
        const videosPanel = page.getByTestId('tabpanel-videos');
        await expect(videosPanel.getByText(landscapeTitle).first()).toBeVisible({ timeout: 30000 });
        await expect(videosPanel.getByText(verticalTitle)).toHaveCount(0);
      }

      // "Upload as video" wins over detection, "Upload as Short" too; "auto" restores it
      await setFormat(user, channelId, vertical, 'video');
      await setFormat(user, channelId, landscape, 'short');
      await expectTabs(user, channelId, [landscape], [vertical]);
      await setFormat(user, channelId, vertical, 'auto');
      await setFormat(user, channelId, landscape, 'auto');
      await expectTabs(user, channelId, [vertical], [landscape]);
    } finally {
      for (const id of created) await apiFetch(user, `/api/videos/${id}`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
