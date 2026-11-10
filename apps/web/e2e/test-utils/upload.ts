import * as fs from 'fs';
import * as path from 'path';
import { expect, type Page, type Request, type Route } from '@playwright/test';
import { type AuthUser, readAccount, readSession } from './auth-state';

/**
 * Helpers for the single-video upload flow (apps/web/src/components/videoUpload).
 *
 * The real flow runs against the target environment:
 *   1. initiateVideoUpload server action (server-side, creates the video record)
 *   2. browser TUS upload: POST {API}/api/videos/tus, then PATCH {API}/api/videos/tus/<id>
 *   3. completeVideoUpload / getVideoUploadStatus server actions
 * Only step 2 originates in the browser, so it is the only part tests can
 * intercept with page.route.
 */

export const API_URL = process.env.API_URL || 'https://videos.api.qa.alummahnow.net';

/** Matches the TUS proxy create (POST) and chunk (HEAD/PATCH) URLs */
export const TUS_URL_PATTERN = /\/api\/videos\/tus(\/|$|\?)/;

const FIXTURES_DIR = path.join(__dirname, '..', 'test-fixtures');
const SAMPLE_MP4 = path.join(FIXTURES_DIR, 'e2e-sample.mp4');

/**
 * Writes a test file into e2e/test-fixtures.
 * `.mp4` files are the committed 2-second H.264 sample, padded up to `sizeKB`
 * with an ISO-BMFF `free` box so the result is still a valid, encodable MP4.
 * Other extensions are zero-filled.
 */
/** Delete the generated fixture files whose name starts with `prefix` (createTestFile output). */
export function removeTestFiles(prefix: string): void {
  if (!prefix || !fs.existsSync(FIXTURES_DIR)) return;
  for (const name of fs.readdirSync(FIXTURES_DIR)) {
    if (name.startsWith(prefix)) fs.rmSync(path.join(FIXTURES_DIR, name), { force: true });
  }
}

export function createTestFile(filename: string, sizeKB = 100): string {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  const filePath = path.join(FIXTURES_DIR, filename);
  const target = sizeKB * 1024;

  if (filename.toLowerCase().endsWith('.mp4') && fs.existsSync(SAMPLE_MP4)) {
    const sample = fs.readFileSync(SAMPLE_MP4);
    const padding = target - sample.length;
    if (padding >= 8) {
      const free = Buffer.alloc(padding, 0);
      free.writeUInt32BE(padding, 0);
      free.write('free', 4, 'ascii');
      fs.writeFileSync(filePath, Buffer.concat([sample, free]));
    } else {
      fs.writeFileSync(filePath, sample);
    }
    return filePath;
  }

  fs.writeFileSync(filePath, Buffer.alloc(target, 0));
  return filePath;
}

/** Locators for the upload page / component (data-testid based) */
export function uploadUi(page: Page) {
  return {
    fileInput: page.getByTestId('upload-file-input'),
    dropzone: page.getByTestId('upload-dropzone'),
    details: page.getByTestId('upload-details'),
    fileName: page.getByTestId('upload-file-name'),
    titleEn: page.getByTestId('upload-title-en'),
    titleAr: page.getByTestId('upload-title-ar'),
    descriptionEn: page.getByTestId('upload-description-en'),
    descriptionAr: page.getByTestId('upload-description-ar'),
    langTabEn: page.getByTestId('upload-lang-tab-en'),
    langTabAr: page.getByTestId('upload-lang-tab-ar'),
    isPublic: page.getByTestId('upload-is-public'),
    submit: page.getByTestId('upload-submit'),
    cancelForm: page.getByTestId('upload-cancel-form'),
    close: page.getByTestId('upload-close'),
    progress: page.getByTestId('upload-progress'),
    progressBar: page.getByTestId('upload-progress').getByRole('progressbar'),
    progressPercent: page.getByTestId('upload-progress-percent'),
    pause: page.getByTestId('upload-pause'),
    resume: page.getByTestId('upload-resume'),
    cancel: page.getByTestId('upload-cancel'),
    retry: page.getByTestId('upload-retry'),
    error: page.getByTestId('upload-error'),
    pageError: page.getByTestId('upload-page-error'),
    success: page.getByTestId('upload-success'),
    successTitle: page.getByTestId('upload-success-title'),
    viewVideo: page.getByTestId('upload-view-video'),
    processingMessage: page.getByTestId('upload-processing-message'),
    processingStatus: page.getByTestId('upload-processing-status'),
    uploadAnother: page.getByTestId('upload-another'),
    channelRequired: page.getByTestId('upload-channel-required'),
    /** A signed-in user without a creator tier: uploading is by invitation */
    byInvitation: page.getByTestId('upload-by-invitation'),
    signIn: page.getByTestId('upload-sign-in'),
  };
}

/** Opens /{locale}/upload and waits for the single-upload drop zone */
export async function gotoUpload(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/upload`);
  await expect(uploadUi(page).dropzone).toBeVisible();
}

/** Selects a file and waits for the metadata form */
export async function selectVideo(page: Page, filePath: string) {
  const ui = uploadUi(page);
  await ui.fileInput.setInputFiles(filePath);
  await expect(ui.details).toBeVisible();
}

/** Selects a file, sets the English title and clicks Upload */
export async function startUpload(page: Page, filePath: string, titleEn: string) {
  const ui = uploadUi(page);
  await selectVideo(page, filePath);
  await ui.titleEn.fill(titleEn);
  await ui.submit.click();
}

/**
 * Waits for the upload (initiate → TUS → complete) to finish. The page then
 * shows "Upload complete" while the video processes on the server.
 */
export async function expectUploadSuccess(page: Page, title?: string, timeout = 120_000) {
  const ui = uploadUi(page);
  await expect(ui.success).toBeVisible({ timeout });
  if (title) await expect(ui.successTitle).toHaveText(title);
}

function decodeTusMetadata(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (header || '').split(',')) {
    const [key, value] = pair.trim().split(' ');
    if (key) out[key] = value ? Buffer.from(value, 'base64').toString('utf8') : '';
  }
  return out;
}

export interface TusRequestLog {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/**
 * Records every browser request (for security assertions) and the ids of
 * videos created through the TUS proxy (for cleanup).
 */
export function trackUploads(page: Page) {
  const requests: TusRequestLog[] = [];
  const videoIds = new Set<string>();
  page.on('request', (request: Request) => {
    const headers = request.headers();
    requests.push({ url: request.url(), method: request.method(), headers });
    if (TUS_URL_PATTERN.test(request.url()) && request.method() === 'POST') {
      const meta = decodeTusMetadata(headers['upload-metadata']);
      if (meta.videoId) videoIds.add(meta.videoId);
    }
  });
  return {
    requests,
    videoIds,
    tusRequests: () => requests.filter((r) => TUS_URL_PATTERN.test(r.url)),
  };
}

/** Best-effort deletion of videos a test created (keeps QA from filling up) */
export async function deleteVideos(page: Page, videoIds: Iterable<string>, user: AuthUser = 'single') {
  const ids = [...videoIds];
  if (ids.length === 0) return;
  const { accessToken: token, channels } = readAccount(user);
  const channelId = readSession(user).activeChannelId ?? channels[0]?.id ?? null;
  if (!token) return;
  for (const id of ids) {
    await page.request
      .delete(`${API_URL}/api/videos/${id}`, {
        headers: { Authorization: `Bearer ${token}`, ...(channelId ? { channelId } : {}) },
        failOnStatusCode: false,
      })
      .catch(() => undefined);
  }
}

/**
 * Holds TUS PATCH (chunk) requests until released, so a test can act while an
 * upload is deterministically "in flight". Other TUS requests pass through.
 */
export async function holdTusPatches(page: Page) {
  const held: Route[] = [];
  let heldCount = 0;
  let holding = true;

  await page.route(TUS_URL_PATTERN, async (route) => {
    if (route.request().method() !== 'PATCH' || !holding) {
      await route.continue().catch(() => undefined);
      return;
    }
    held.push(route);
    heldCount++;
  });

  return {
    /** Resolves once at least one PATCH is being held */
    async waitForHeldPatch() {
      await expect.poll(() => heldCount, { timeout: 60_000 }).toBeGreaterThan(0);
    },
    /**
     * Stops holding and lets held requests continue. Requests the page has
     * already aborted (pause/cancel) are ignored; they are not awaited because
     * continuing an aborted request may never settle.
     */
    async release() {
      holding = false;
      for (const route of held.splice(0)) {
        void route.continue().catch(() => undefined);
      }
    },
  };
}

/**
 * Makes the TUS proxy reject chunk uploads with an HTTP status. 4xx statuses
 * (other than 409/423) are not retried by tus-js-client, so the failure
 * surfaces immediately. Returns a function that removes the rule.
 */
export async function failTusPatches(page: Page, status = 403, times?: number) {
  let remaining = times ?? Number.POSITIVE_INFINITY;
  const handler = async (route: Route) => {
    if (route.request().method() === 'PATCH' && remaining > 0) {
      remaining--;
      await route.fulfill({
        status,
        headers: { 'Access-Control-Allow-Origin': '*', 'Tus-Resumable': '1.0.0' },
        body: '',
      });
      return;
    }
    await route.continue().catch(() => undefined);
  };
  await page.route(TUS_URL_PATTERN, handler);
  return () => page.unroute(TUS_URL_PATTERN, handler);
}

/**
 * Whether the target has upload playlists (POST/GET /api/playlists/upload-adds).
 * Before they are deployed, GET /api/playlists/upload-adds is read as a
 * playlist id (404); once deployed it needs a sign-in (401).
 */
export async function uploadPlaylistsDeployed(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/playlists/upload-adds?videoIds=probe`);
    return res.status !== 404;
  } catch {
    return false;
  }
}
