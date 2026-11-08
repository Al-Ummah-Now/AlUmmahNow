import { test, expect, helpers } from './fixtures';
import type { ConsoleMessage, Page } from '@playwright/test';
import { AUTH_STATE, readAccount } from './test-utils/auth-state';
import {
  deleteVideos,
  expectUploadSuccess,
  failTusPatches,
  gotoUpload,
  startUpload,
  trackUploads,
  uploadUi,
} from './test-utils/upload';

/**
 * TUS upload logging E2E tests.
 *
 * Browser side (every environment): the uploader logs failures through the
 * client logger (console warn/error in production) with enough context to
 * debug, and never writes credentials to the console.
 *
 * Server side (local development only): api-videos sends its TUS proxy logs to
 * the log-service (http://localhost:3089). The log-service is not deployed, so
 * these tests run only when the target is local and the service is reachable.
 */

const SECRET_MARKERS = ['AuthorizationSignature', 'AccessKey', 'bunny-stream-key', 'image_storage_key'];
const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL || 'http://localhost:3089';
const isRemoteTarget = (process.env.WEB_APP_URL || 'http://localhost:3001').startsWith('https://');

function collectConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (message: ConsoleMessage) => lines.push(`${message.type()} ${message.text()}`));
  return lines;
}

function tusMetadataValue(header: string | undefined, key: string): string | undefined {
  for (const pair of (header || '').split(',')) {
    const [k, v] = pair.trim().split(' ');
    if (k === key && v) return Buffer.from(v, 'base64').toString('utf8');
  }
  return undefined;
}

test.describe('TUS upload logging - browser', () => {
  test.use({ storageState: AUTH_STATE.single });

  let tracker: ReturnType<typeof trackUploads>;

  test.beforeEach(async ({ page }) => {
    tracker = trackUploads(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteVideos(page, tracker.videoIds);
  });

  test('logs a failed chunk upload with its cause', async ({ page }) => {
    const consoleLines = collectConsole(page);
    await gotoUpload(page, 'en');
    await failTusPatches(page, 403);

    await startUpload(page, await helpers.createTestVideo('log-error-test.mp4', 64), 'Log Error Test');
    await expect(uploadUi(page).error).toBeVisible();

    await expect
      .poll(() => consoleLines.filter((l) => l.startsWith('error') && l.includes('TUS upload error')).length)
      .toBeGreaterThan(0);
    // The visible error carries the proxy response so users/support can act on it
    await expect(uploadUi(page).error).toContainText('403');
  });

  test('never writes credentials or upload sessions to the console', async ({ page }) => {
    const consoleLines = collectConsole(page);
    await gotoUpload(page, 'en');

    await startUpload(page, await helpers.createTestVideo('log-security-test.mp4', 64), 'Log Security Test');
    await expectUploadSuccess(page, 'Log Security Test');

    const create = tracker.tusRequests().find((r) => r.method === 'POST');
    const tusSessionId = tusMetadataValue(create?.headers['upload-metadata'], 'tusSessionId');
    const bearer = (create?.headers['authorization'] || '').replace(/^Bearer /, '');
    const { accessToken } = readAccount('single');

    const output = consoleLines.join('\n');
    expect(tusSessionId).toBeTruthy();
    expect(output).not.toContain(tusSessionId!);
    expect(bearer.length).toBeGreaterThan(20);
    expect(output).not.toContain(bearer);
    if (accessToken) expect(output).not.toContain(accessToken);
    for (const marker of SECRET_MARKERS) {
      expect(output.toLowerCase()).not.toContain(marker.toLowerCase());
    }
  });
});

test.describe('TUS upload logging - log-service (local development)', () => {
  test.use({ storageState: AUTH_STATE.single });

  let tracker: ReturnType<typeof trackUploads>;

  test.beforeAll(async ({ request }) => {
    test.skip(isRemoteTarget, 'The log-service (localhost:3089) only runs in local development; deployed environments log to Cloudflare');
    const reachable = await request
      .get(`${LOG_SERVICE_URL}/logs/stream`, { params: { lines: '1' }, timeout: 3000 })
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!reachable, `log-service is not running at ${LOG_SERVICE_URL}`);
  });

  test.beforeEach(async ({ page }) => {
    tracker = trackUploads(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteVideos(page, tracker.videoIds);
  });

  async function apiLogs(page: Page): Promise<string> {
    const res = await page.request.get(`${LOG_SERVICE_URL}/logs/stream`, {
      params: { lines: '500', tail: 'true', app: 'api-videos' },
    });
    expect(res.ok()).toBeTruthy();
    return JSON.stringify(await res.json());
  }

  test('records TUS proxy operations for the uploaded video without secrets', async ({ page }) => {
    await gotoUpload(page, 'en');
    await startUpload(page, await helpers.createTestVideo('log-service-test.mp4', 64), 'Log Service Test');
    await expectUploadSuccess(page, 'Log Service Test');

    const [videoId] = [...tracker.videoIds];
    await expect.poll(async () => (await apiLogs(page)).includes(videoId), { timeout: 30_000 }).toBe(true);

    const logs = (await apiLogs(page)).toLowerCase();
    expect(logs).toMatch(/tus/);
    for (const marker of SECRET_MARKERS) {
      expect(logs).not.toContain(marker.toLowerCase());
    }
  });
});
