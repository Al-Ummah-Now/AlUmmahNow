/**
 * A deploy while a page is open (incident 2026-11-09: a bulk upload page failed
 * with `Server Action "…" was not found on the server` after production was
 * deployed). The page here was served by the build under test ("build A");
 * route interception makes the server answer like a newer build ("build B")
 * that no longer has what the page asks for.
 *
 * - A Server Action the server does not have: the themed "new version" notice,
 *   never the raw message, then a reload into a working page.
 * - The same during an upload: the bytes keep going, the reload waits until the
 *   upload is complete, and the video exists.
 *
 * Real routing of old pages to their own build is checked by the release
 * itself (scripts/release/skew-check.ts, after every promote).
 */
import * as path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { submitNewChannelInMenu } from './account-menu';

// Signs users in through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

const VIDEO = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample.mp4');
const RAW_MESSAGE = /was not found on the server|failed-to-find-server-action|ChunkLoadError/;

/** Server Actions answer like a build that does not have them, while `state.skew` is set. */
async function simulateNewBuild(page: Page, state: { skew: boolean }): Promise<void> {
  await page.route('**/*', (route) => {
    const req = route.request();
    if (state.skew && req.method() === 'POST' && req.headers()['next-action']) {
      return route.fulfill({
        status: 404,
        headers: { 'x-nextjs-action-not-found': '1', 'content-type': 'text/plain' },
        body: 'Server action not found.',
      });
    }
    return route.fallback();
  });
}

/** Skips on a target deployed before skew protection (its pages carry no deployment id). */
async function gotoBuildA(page: Page, url: string): Promise<void> {
  const res = await page.goto(url);
  const html = (await res?.text()) ?? '';
  test.skip(!/data-dpl-id="/.test(html), `${target().web} predates skew protection (no deployment id in the page)`);
}

/** Times of full document loads from now on (a reload; client-side navigations do not count) */
function documentLoads(page: Page): number[] {
  const at: number[] = [];
  page.on('domcontentloaded', () => at.push(Date.now()));
  return at;
}

test.describe('Release: a deploy while the page is open', () => {
  test('a Server Action the new build does not have: new-version notice, reload, working page', async ({ page }) => {
    const state = { skew: true };
    await simulateNewBuild(page, state);
    // The videos page loads its list through a Server Action as it mounts
    await gotoBuildA(page, `${target().web}/en/videos`);
    const navigations = documentLoads(page);

    const notice = page.getByTestId('version-skew-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('A new version is available');
    await expect(page.getByText(RAW_MESSAGE)).toHaveCount(0);

    // The reload loads build B, which has the action
    state.skew = false;
    await expect.poll(() => navigations.length, { message: 'the page did not reload', timeout: 15000 }).toBeGreaterThan(0);
    await page.waitForLoadState('load');
    await expect(notice).toBeHidden();
    await expect(page.getByText(RAW_MESSAGE)).toHaveCount(0);
    await expect(page.locator('main, #main-content, #page-content').first()).toBeVisible();
  });

  test('an upload in progress keeps going; the page reloads only after it is complete', async ({ page }) => {
    test.setTimeout(360000);
    const user: WebUser = await signUpOnWeb(page, 'rel-skew-upload');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);
    await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);

    // A channel, created the way users do (it also refreshes the web session's channels)
    const channelName = `Release E2E skew ${Date.now().toString(36)}`;
    await gotoBuildA(page, `${target().web}/en`);
    await submitNewChannelInMenu(page, channelName);
    let channelId = '';
    await expect
      .poll(async () => {
        const res = await apiFetch(user, '/api/channels?limit=100');
        const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
        channelId = body.data?.find((c) => c.name === channelName)?.id ?? '';
        return channelId;
      }, { timeout: 30000 })
      .not.toBe('');

    await page.goto(`${target().web}/en/upload`);
    await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
    await page.evaluate(() => ((window as unknown as { __buildA?: boolean }).__buildA = true));
    const navigations = documentLoads(page);

    // Slow the TUS chunks down so the "deploy" lands mid-transfer
    await page.route(/\/api\/videos\/tus\//, async (route) => {
      if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 4000));
      await route.fallback();
    });
    let completedAt = 0;
    page.on('response', (res) => {
      if (/\/api\/videos\/upload\/complete$/.test(res.url()) && res.status() < 300) completedAt = Date.now();
    });

    await page.getByTestId('upload-file-input').setInputFiles(VIDEO);
    await expect(page.getByTestId('upload-details')).toBeVisible();
    const title = `Release E2E skew upload ${Date.now().toString(36)}`;
    await page.getByTestId('upload-title-en').fill(title);
    await page.getByTestId('upload-is-public').uncheck();
    const firstChunk = page.waitForRequest((r) => /\/api\/videos\/tus\//.test(r.url()) && r.method() === 'PATCH');
    await page.getByTestId('upload-submit').click();
    await firstChunk;

    // "Deploy": the page now hits what a newer build no longer has (a lazy chunk)
    await page.evaluate(() => {
      setTimeout(() => {
        const error = new Error('Loading chunk 9999 failed. (error: /_next/static/chunks/9999-gone.js)');
        error.name = 'ChunkLoadError';
        void Promise.reject(error);
      }, 0);
    });
    const notice = page.getByTestId('version-skew-notice');
    await expect(notice).toHaveAttribute('data-state', 'waiting-for-uploads');
    await expect(notice).toContainText('uploads keep going');
    await expect(page.getByText(RAW_MESSAGE)).toHaveCount(0);

    // The upload finishes in this page (no reload under it), then the page reloads
    await expect.poll(() => completedAt, { message: 'upload/complete never answered', timeout: 240000 }).toBeGreaterThan(0);
    await expect.poll(() => navigations.length, { message: 'the page did not reload after the upload', timeout: 240000 }).toBeGreaterThan(0);
    expect(navigations[0], 'the page reloaded before the upload was complete').toBeGreaterThan(completedAt);
    await page.waitForLoadState('load');
    expect(await page.evaluate(() => (window as unknown as { __buildA?: boolean }).__buildA ?? false)).toBe(false);

    let videoId = '';
    try {
      await expect
        .poll(async () => {
          const res = await apiFetch(user, `/api/videos/search?limit=100&isOwner=true&channelIds=${channelId}`, { headers: { channelId } });
          const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> };
          videoId = body.data?.find((v) => v.title === title)?.id ?? '';
          return videoId;
        }, { message: 'the video uploaded across the "deploy" is missing', timeout: 60000 })
        .not.toBe('');
    } finally {
      if (videoId) await apiFetch(user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
