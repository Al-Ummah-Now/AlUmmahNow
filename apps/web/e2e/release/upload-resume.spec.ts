/**
 * Uploads survive a failing proxy and a page reload without starting over.
 *
 * Production v2026.11.09.5: the TUS proxy answered 500 on PATCH, then 500 on
 * HEAD, and the browser restarted every file from byte 0 (tus-js-client
 * creates a new upload on any HEAD error but 423). Here the proxy is made to
 * fail (route interception) mid-upload and the page is reloaded:
 * - every PATCH starts at or after the previous one (bytes never go back);
 * - one TUS upload per video (POST /api/videos/tus once), one video;
 * - the video reaches processing once;
 * - in a bulk batch, a file that fails transiently shows "reconnecting" and
 *   completes, and the other files complete around it;
 * - a bulk batch's default category and a row's own category (set before or
 *   after its upload) are saved on the videos (en, ar).
 *
 * Small files in 5 MB chunks (the `aun:tus-chunk-size` override) so a few
 * chunks fit in a release run.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { test, expect, type Page, type Route } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser, submitPasswordSignIn } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { submitNewChannelInMenu } from './account-menu';

// Signs users in through the auth server: traces would hold the password.
test.use({ trace: 'off' });

const MB = 1024 * 1024;
const CHUNK = 5 * MB;
const SAMPLE = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample-40s.mp4');

/** A playable mp4 padded to `bytes` (players and Bunny ignore trailing data). */
function paddedVideo(dir: string, name: string, bytes: number): string {
  const head = fs.readFileSync(SAMPLE);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.concat([head, randomBytes(Math.max(0, bytes - head.length))]));
  return file;
}

interface Uploader {
  user: WebUser;
  channelId: string;
}

/**
 * A signed-in uploader with a channel. CI: a new sink user per test. Local
 * runs without the sink secret may use an existing QA account instead
 * (E2E_UPLOAD_EMAIL / E2E_UPLOAD_PASSWORD, an account that has a channel).
 */
async function uploader(page: Page, prefix: string): Promise<Uploader> {
  await page.context().addCookies([
    { name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' },
  ]);
  const email = process.env.E2E_UPLOAD_EMAIL;
  const password = process.env.E2E_UPLOAD_PASSWORD;
  if (email && password && !process.env.E2E_CODE_SINK_SECRET) {
    await page.goto(`${target().web}/en`);
    await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click(); // the header's account menu, not a card's "more" menu
    await page.locator('[role="menu"] form button[type="submit"]').first().click();
    await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
    await submitPasswordSignIn(page, email, password);
    await expect(page).toHaveURL(new RegExp(`^${target().web}/en`), { timeout: 30000 });
    const info = await page.evaluate(async () => (await (await fetch('/api/auth/token')).json()) as { accessToken: string; userId: string; channelId: string });
    expect(info.channelId, 'the local upload account has no channel').toBeTruthy();
    return { user: { email, accessToken: info.accessToken, userId: info.userId }, channelId: info.channelId };
  }

  const user = await signUpOnWeb(page, prefix);
  await createProfile(user);
  // Uploading and creating channels are by invitation: an admin makes the new user a Creator
  await grantCreatorTier(user);
  // The channel through the account menu (also refreshes the web session's channels)
  const channelName = `Release E2E resume ${Date.now().toString(36)}`;
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
  return { user, channelId };
}

/** Everything the page sent to the TUS proxy, and the proxy's answers. */
interface TusLog {
  posts: Array<{ status: number; videoId: string }>;
  patches: Array<{ uploadId: string; offset: number; status: number; acked?: number }>;
  heads: Array<{ uploadId: string; status: number }>;
}

type Injection = (req: { method: string; uploadId: string; n: { patch: number; head: number } }) =>
  | { fulfill: number }
  | { abort: true }
  /** Never answered: the request stays pending until the page goes away (a reload) */
  | { hold: true }
  | undefined;

/**
 * Proxy the page's TUS requests through Playwright: log them, and fail the
 * ones `inject` picks (as the real proxy would: with CORS headers).
 */
async function interceptTus(page: Page, inject: Injection): Promise<TusLog> {
  const log: TusLog = { posts: [], patches: [], heads: [] };
  const n = { patch: 0, head: 0 };
  const cors = {
    'access-control-allow-origin': target().web,
    'access-control-expose-headers': 'Upload-Offset, Location, Tus-Resumable, Retry-After',
    'tus-resumable': '1.0.0',
    'retry-after': '1',
  };
  await page.route(/\/api\/videos\/tus(\/[^/?]+)?(\?.*)?$/, async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const uploadId = new URL(req.url()).pathname.split('/api/videos/tus')[1]?.replace(/^\//, '') ?? '';
    if (method === 'OPTIONS') return route.continue();
    if (method === 'PATCH') n.patch++;
    if (method === 'HEAD') n.head++;
    const offset = Number(req.headers()['upload-offset'] ?? -1);
    const injected = method === 'PATCH' || method === 'HEAD' ? inject({ method, uploadId, n }) : undefined;
    // Left pending: the page's reload cancels it (nothing to answer, nothing logged)
    if (injected && 'hold' in injected) return;
    if (injected && 'abort' in injected) {
      if (method === 'PATCH') log.patches.push({ uploadId, offset, status: 0 });
      return route.abort('failed');
    }
    if (injected) {
      if (method === 'PATCH') log.patches.push({ uploadId, offset, status: injected.fulfill });
      if (method === 'HEAD') log.heads.push({ uploadId, status: injected.fulfill });
      return route.fulfill({ status: injected.fulfill, headers: { ...cors, 'x-e2e-injected': '1' }, body: method === 'HEAD' ? undefined : '{"error":"injected"}' });
    }
    // Untouched requests go to the proxy as they are (route.fetch would drop
    // the chunk body in WebKit); their answers are logged from the response.
    return route.continue();
  });
  page.on('response', (res) => {
    const req = res.request();
    const url = new URL(req.url());
    if (!/\/api\/videos\/tus(\/[^/]+)?$/.test(url.pathname)) return;
    const method = req.method();
    const status = res.status();
    if (method === 'OPTIONS') return;
    const uploadId = url.pathname.split('/api/videos/tus')[1]?.replace(/^\//, '') ?? '';
    const headers = res.headers();
    if (method === 'POST') log.posts.push({ status, videoId: (headers['location'] ?? '').split('/').pop()?.split('.')[1] ?? '' });
    if (method === 'PATCH') {
      if (headers['x-e2e-injected']) return;
      log.patches.push({ uploadId, offset: Number(req.headers()['upload-offset'] ?? -1), status, acked: Number(headers['upload-offset'] ?? -1) });
    }
    if (method === 'HEAD' && !headers['x-e2e-injected']) log.heads.push({ uploadId, status });
  });
  return log;
}

/** PATCH offsets per upload never go backwards (a re-sent chunk starts at the same offset). */
function expectNeverBackwards(log: TusLog): void {
  const byVideo = new Map<string, number[]>();
  for (const p of log.patches.filter((x) => x.status === 204)) {
    const videoId = p.uploadId.split('.')[1] ?? p.uploadId;
    byVideo.set(videoId, [...(byVideo.get(videoId) ?? []), p.offset]);
  }
  for (const [videoId, offsets] of byVideo) {
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i], `video ${videoId}: PATCH offsets ${offsets.join(', ')} went backwards`).toBeGreaterThanOrEqual(offsets[i - 1]);
    }
  }
}

/** The video's upload status as the upload page polls it (uploading / processing / ready / failed). */
async function videoStatus(u: Uploader, videoId: string): Promise<string> {
  const res = await apiFetch(u.user, `/api/videos/${videoId}/upload-status`, { headers: { channelId: u.channelId } });
  const body = (await res.json().catch(() => ({}))) as { result?: { status?: string } };
  return body.result?.status ?? `HTTP ${res.status}`;
}

/** The stored video's category and who set it, as its owner reads it. */
async function storedCategory(u: Uploader, videoId: string): Promise<string> {
  const res = await apiFetch(u.user, `/api/videos/${videoId}`, { headers: { channelId: u.channelId } });
  const body = (await res.json().catch(() => ({}))) as { category?: string; categorySource?: string; result?: { category?: string; categorySource?: string; video?: { category?: string; categorySource?: string } } };
  const v = body.result?.video ?? body.result ?? body;
  return `${v.category ?? '-'}:${v.categorySource ?? '-'}`;
}

test.describe('Release: bulk upload categories', () => {
  test.describe.configure({ timeout: 360000 });

  for (const locale of ['en', 'ar'] as const) {
    test(`a batch default and a per-row override are saved on the videos, before and after the upload (${locale})`, async ({ page }, testInfo) => {
      const u = await uploader(page, `rel-bulk-cat-${locale}`);
      const files = [1, 2].map((i) => paddedVideo(testInfo.outputDir, `bulk-cat-${locale}-${i}-${Date.now().toString(36)}.mp4`, 400000 * i));
      const videoIds: string[] = [];
      try {
        await page.goto(`${target().web}/${locale}/upload`);
        await page.getByTestId('upload-mode-batch').click();
        await page.getByTestId('batch-category-default').selectOption('fiqh');
        await page.getByTestId('batch-file-input').setInputFiles(files);
        await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-total', '2', { timeout: 60000 });

        const rows = page.getByTestId('batch-file');
        await expect(rows.nth(1).getByTestId('batch-file-category-select')).toHaveValue('fiqh', { timeout: 30000 });
        for (let i = 0; i < 2; i++) {
          const id = await rows.nth(i).getAttribute('data-video-id');
          expect(id, 'row has its video').toBeTruthy();
          videoIds.push(id as string);
        }
        // Each row starts from the default; one row gets its own before the upload
        await expect(rows.nth(0).getByTestId('batch-file-category-select')).toHaveValue('fiqh');
        await rows.nth(1).getByTestId('batch-file-category-select').selectOption('ramadan');
        await expect(rows.nth(1).getByTestId('batch-file-category-save')).toHaveAttribute('data-state', 'saved', { timeout: 30000 });
        await page.getByTestId('batch-settings').scrollIntoViewIfNeeded();
        const shots = process.env.E2E_SCREENSHOT_DIR;
        await page.screenshot({ path: shots ? path.join(shots, `batch-categories-${locale}-${testInfo.project.name}.png`) : testInfo.outputPath(`batch-categories-${locale}.png`), fullPage: true });

        await page.getByTestId('batch-start').click();
        await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-completed', '2', { timeout: 240000 });

        // ...and the other one after its upload finished
        await rows.nth(0).getByTestId('batch-file-category-select').selectOption('aqeedah');
        await expect(rows.nth(0).getByTestId('batch-file-category-save')).toHaveAttribute('data-state', 'saved', { timeout: 30000 });

        await expect.poll(() => storedCategory(u, videoIds[0]), { timeout: 30000 }).toBe('aqeedah:uploader');
        await expect.poll(() => storedCategory(u, videoIds[1]), { timeout: 30000 }).toBe('ramadan:uploader');
      } finally {
        for (const videoId of videoIds) await apiFetch(u.user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId: u.channelId } });
      }
    });
  }
});

test.describe('Release: uploads resume', () => {
  test.describe.configure({ timeout: 360000 });

  test('a failing proxy and a reload mid-upload resume from the offset; one upload, one video', async ({ page }, testInfo) => {
    const u = await uploader(page, 'rel-resume');
    const file = paddedVideo(testInfo.outputPath(), 'resume-me.mp4', 7 * CHUNK + 123457); // 8 chunks
    await page.addInitScript((size) => window.localStorage.setItem('aun:tus-chunk-size', String(size)), CHUNK);
    page.on('dialog', (d) => void d.accept()); // "leave the page?" on reload

    // PATCH #2 -> 503, the next two HEADs -> 500 and 502 (production's failure),
    // PATCH #4 -> connection dropped. Once three chunks are at Bunny the next PATCH is held
    // until the reload: on a fast stack the whole file otherwise finished before the reload,
    // and the "same file again" then (rightly) started a new video (#1120).
    let reloaded = false;
    const log: TusLog = await interceptTus(page, ({ method, n }) => {
      if (method === 'PATCH' && !reloaded && log.patches.filter((p) => p.status === 204).length >= 3) return { hold: true };
      if (method === 'PATCH' && n.patch === 2) return { fulfill: 503 };
      if (method === 'HEAD' && (n.head === 1 || n.head === 2)) return { fulfill: n.head === 1 ? 500 : 502 };
      if (method === 'PATCH' && n.patch === 4) return { abort: true };
      return undefined;
    });

    const title = `Release E2E resume ${Date.now().toString(36)}`;
    const startUpload = async () => {
      await page.goto(`${target().web}/en/upload`);
      await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('upload-file-input').setInputFiles(file);
      await expect(page.getByTestId('upload-details')).toBeVisible();
      await page.getByTestId('upload-title-en').fill(title);
      await page.getByTestId('upload-is-public').uncheck();
      await page.getByTestId('upload-submit').click();
    };

    let videoId = '';
    try {
      await startUpload();
      // Reload once three chunks are at Bunny
      await expect.poll(() => log.patches.filter((p) => p.status === 204).length, { timeout: 120000 }).toBeGreaterThanOrEqual(3);
      const ackedBeforeReload = Math.max(...log.patches.map((p) => p.acked ?? -1));
      videoId = log.posts[0]?.videoId ?? '';
      expect(videoId, 'the TUS POST returned no upload URL with a video id').toBeTruthy();
      const patchesBeforeReload = log.patches.length;
      reloaded = true;
      await page.reload();

      // The same file again (as after a crash): resumes the same video and upload
      await startUpload();
      await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 180000 });

      const afterReload = log.patches.slice(patchesBeforeReload).filter((p) => p.status === 204);
      expect(afterReload.length, 'nothing was uploaded after the reload').toBeGreaterThan(0);
      expect(afterReload[0].offset, 'the upload restarted below what Bunny already had').toBeGreaterThanOrEqual(ackedBeforeReload);
      expect(log.posts.filter((p) => p.status === 201).map((p) => p.videoId), 'a second TUS upload was created').toEqual([videoId]);
      expect(new Set(log.patches.map((p) => p.uploadId.split('.')[1])).size, 'chunks went to another video').toBe(1);
      expectNeverBackwards(log);
      const finalAck = Math.max(...log.patches.map((p) => p.acked ?? -1));
      expect(finalAck).toBe(fs.statSync(file).size);

      // One video with this title, and it reached processing (or ready) once
      await expect.poll(() => videoStatus(u, videoId), { timeout: 60000 }).toMatch(/^(processing|ready)$/);
      const search = await apiFetch(u.user, `/api/videos/search?limit=100&isOwner=true&channelIds=${u.channelId}`, { headers: { channelId: u.channelId } });
      const found = ((await search.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> }).data ?? [];
      expect(found.filter((v) => v.title === title).map((v) => v.id), 'more than one video for one file').toEqual(
        found.some((v) => v.title === title) ? [videoId] : [],
      );
    } finally {
      for (const id of new Set([videoId, ...log.posts.map((p) => p.videoId)].filter(Boolean))) {
        await apiFetch(u.user, `/api/videos/${id}/permanent`, { method: 'DELETE', headers: { channelId: u.channelId } });
      }
    }
  });

  test('bulk: a file that fails transiently reconnects and completes; the others complete around it', async ({ page }, testInfo) => {
    const u = await uploader(page, 'rel-bulk-resume');
    const files = [1, 2, 3].map((i) => paddedVideo(testInfo.outputPath(), `bulk-${i}-${Date.now().toString(36)}.mp4`, CHUNK + 300000 * i)); // 2 chunks each
    await page.addInitScript((size) => window.localStorage.setItem('aun:tus-chunk-size', String(size)), CHUNK);

    // The first video to send a PATCH is the flaky one: its 1st PATCH -> 503,
    // its next three HEADs -> 500, then its 2nd PATCH -> connection dropped.
    let flaky = '';
    const flakyN = { patch: 0, head: 0 };
    const log = await interceptTus(page, ({ method, uploadId }) => {
      if (method === 'PATCH' && !flaky) flaky = uploadId;
      if (uploadId !== flaky) return undefined;
      if (method === 'PATCH') {
        flakyN.patch++;
        if (flakyN.patch === 1) return { fulfill: 503 };
        if (flakyN.patch === 3) return { abort: true };
      }
      if (method === 'HEAD' && ++flakyN.head <= 3) return { fulfill: 500 };
      return undefined;
    });

    try {
      await page.goto(`${target().web}/en/upload`);
      await page.getByTestId('upload-mode-batch').click();
      await page.getByTestId('batch-file-input').setInputFiles(files);
      await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-total', '3', { timeout: 60000 });
      await page.getByTestId('batch-start').click();

      // The flaky file says "reconnecting" (and is not failed) while it retries
      await expect(page.locator('[data-testid="batch-file"][data-reconnecting="true"]')).toHaveCount(1, { timeout: 60000 });
      await expect(page.locator('[data-testid="batch-file"][data-status="failed"]')).toHaveCount(0);

      await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-completed', '3', { timeout: 240000 });
      await expect(page.locator('[data-testid="batch-file"][data-status="failed"]')).toHaveCount(0);

      const created = log.posts.filter((p) => p.status === 201).map((p) => p.videoId);
      expect(created.length, 'one TUS upload per file').toBe(3);
      expect(new Set(created).size).toBe(3);
      expectNeverBackwards(log);
      expect(log.patches.some((p) => p.uploadId === flaky && p.status === 503), 'the failure was injected').toBe(true);
      for (const videoId of created) {
        await expect.poll(() => videoStatus(u, videoId), { timeout: 60000 }).toMatch(/^(processing|ready)$/);
      }
    } finally {
      for (const videoId of new Set(log.posts.map((p) => p.videoId).filter(Boolean))) {
        await apiFetch(u.user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId: u.channelId } });
      }
    }
  });

  test('an upload that cannot finish is flagged: the studio offers Re-upload, which finishes the same video', async ({ page }, testInfo) => {
    const u = await uploader(page, 'rel-reupload');
    const file = paddedVideo(testInfo.outputDir, 'flag-me.mp4', 3 * CHUNK + 4321); // 4 chunks
    await page.addInitScript((size) => window.localStorage.setItem('aun:tus-chunk-size', String(size)), CHUNK);

    // PATCH #2 -> 403: not retryable, the browser gives up on this upload
    let broken = true;
    const log = await interceptTus(page, ({ method, n }) => (broken && method === 'PATCH' && n.patch === 2 ? { fulfill: 403 } : undefined));
    const reports: number[] = [];
    page.on('response', (res) => {
      if (res.request().method() === 'POST' && /\/api\/videos\/upload\/failed\//.test(res.url())) reports.push(res.status());
    });

    const title = `Release E2E reupload ${Date.now().toString(36)}`;
    let videoId = '';
    try {
      await page.goto(`${target().web}/en/upload`);
      await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('upload-file-input').setInputFiles(file);
      await page.getByTestId('upload-title-en').fill(title);
      await page.getByTestId('upload-is-public').uncheck();
      await page.getByTestId('upload-submit').click();
      await expect(page.getByTestId('upload-page-error')).toBeVisible({ timeout: 120000 });
      videoId = log.posts[0]?.videoId ?? '';
      expect(videoId, 'the TUS POST returned no upload URL with a video id').toBeTruthy();

      // Never silent: reported, and the video is flagged
      await expect.poll(() => reports, { message: 'the browser did not report the failed upload', timeout: 30000 }).toContain(200);
      await expect.poll(() => videoStatus(u, videoId), { timeout: 30000 }).toBe('failed');

      // Studio lists it under Failed and offers "Upload again" into the same video, on its channel
      broken = false;
      await page.goto(`${target().web}/en/studio/${u.channelId}/content/videos?status=failed`);
      const row = page.getByTestId('studio-video-row').filter({ hasText: title });
      await expect(row).toBeVisible({ timeout: 60000 });
      await row.getByTestId('studio-video-actions').click();
      const reupload = page.getByTestId('studio-video-action-retryUpload');
      await expect(reupload).toHaveAttribute('href', new RegExp(`resume=${videoId}.*channel=${u.channelId}`));
      await reupload.click();
      await expect(page.getByTestId('upload-reupload-banner')).toHaveAttribute('data-video-id', videoId, { timeout: 30000 });

      await page.getByTestId('upload-file-input').setInputFiles(file);
      await expect(page.getByTestId('upload-title-en')).toHaveValue(title);
      await page.getByTestId('upload-submit').click();
      await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 180000 });

      // Same video, no second one; the bytes Bunny had were kept
      expect(new Set(log.posts.filter((p) => p.status === 201).map((p) => p.videoId)), 'the re-upload created another video').toEqual(new Set([videoId]));
      expect(new Set(log.patches.map((p) => p.uploadId.split('.')[1])).size, 'chunks went to another video').toBe(1);
      expectNeverBackwards(log);
      await expect.poll(() => videoStatus(u, videoId), { timeout: 60000 }).toMatch(/^(processing|ready)$/);
    } finally {
      for (const id of new Set([videoId, ...log.posts.map((p) => p.videoId)].filter(Boolean))) {
        await apiFetch(u.user, `/api/videos/${id}/permanent`, { method: 'DELETE', headers: { channelId: u.channelId } });
      }
    }
  });
});

test.describe('Release: a finished file picked again', () => {
  test.describe.configure({ timeout: 300000 });

  for (const locale of ['en', 'ar'] as const) {
    test(`says "Already uploaded" with a link to its video, and uploads it again only when asked (${locale})`, async ({ page }, testInfo) => {
      const u = await uploader(page, `rel-again-${locale}`);
      const file = paddedVideo(testInfo.outputPath(), `again-${locale}-${Date.now().toString(36)}.mp4`, 400000);
      const ui = locale === 'ar'
        ? { heading: 'تم رفعه من قبل', view: 'مشاهدة المرئي', again: 'ارفعه مرة أخرى كمرئي جديد', another: 'اختر ملفًا آخر' }
        : { heading: 'Already uploaded', view: 'View video', again: 'Upload again as a new video', another: 'Choose another file' };
      // Every video this test creates (initiate answers), for the checks and the clean-up
      const created: string[] = [];
      page.on('response', async (res) => {
        if (res.request().method() !== 'POST' || !/\/api\/videos\/upload\/initiate$/.test(new URL(res.url()).pathname)) return;
        const body = (await res.json().catch(() => ({}))) as { result?: { videoId?: string } };
        if (body.result?.videoId) created.push(body.result.videoId);
      });
      const pick = async () => {
        await page.goto(`${target().web}/${locale}/upload`);
        await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('upload-file-input').setInputFiles(file);
      };
      const send = async (title: string) => {
        await expect(page.getByTestId('upload-details')).toBeVisible();
        await page.getByTestId('upload-title-en').fill(title);
        await page.getByTestId('upload-is-public').uncheck();
        await page.getByTestId('upload-submit').click();
        await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 120000 });
      };

      try {
        await pick();
        await send(`Release E2E again ${locale} ${Date.now().toString(36)}`);
        await expect.poll(() => created.length).toBe(1);
        const first = created[0];

        // The same file again: not uploaded, not a second video; its video is linked
        await pick();
        const panel = page.getByTestId('upload-already-uploaded');
        await expect(panel).toBeVisible({ timeout: 30000 });
        await expect(panel.getByRole('heading', { name: ui.heading })).toBeVisible();
        await expect(panel.getByRole('link', { name: ui.view })).toHaveAttribute('href', `/${locale}/video/${first}`);
        await expect(panel.getByRole('button', { name: ui.another })).toBeVisible();
        expect(created, 'picking a finished file again created a video').toEqual([first]);

        // Asked for: a new video
        await panel.getByRole('button', { name: ui.again }).click();
        await send(`Release E2E again ${locale} copy ${Date.now().toString(36)}`);
        await expect.poll(() => created.length).toBe(2);
        expect(created[1]).not.toBe(first);
      } finally {
        for (const id of new Set(created)) {
          await apiFetch(u.user, `/api/videos/${id}/permanent`, { method: 'DELETE', headers: { channelId: u.channelId } });
        }
      }
    });
  }
});
