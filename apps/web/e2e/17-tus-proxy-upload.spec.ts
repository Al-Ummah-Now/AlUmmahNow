import { test, expect, helpers } from './fixtures';
import { AUTH_STATE } from './test-utils/auth-state';
import {
  API_URL,
  deleteVideos,
  expectUploadSuccess,
  failTusPatches,
  gotoUpload,
  startUpload,
  trackUploads,
  TUS_URL_PATTERN,
  uploadUi,
} from './test-utils/upload';

/**
 * TUS Proxy Security E2E Tests
 *
 * Architecture:
 *   Browser → api-videos /api/videos/tus (JWT + KV upload session) → Bunny.net
 *
 * Requirements verified against the real target environment:
 * 1. Upload traffic goes only to the api-videos TUS proxy, never to Bunny.net
 * 2. Every TUS request carries the user's JWT as a Bearer token
 * 3. Bunny.net credentials never reach the browser (requests or responses)
 * 4. The proxy rejects requests without a valid token / upload session
 */

const BUNNY_UPLOAD_HOSTS = /(^|\.)(bunnycdn\.com|bunny\.net)$/;
const SECRET_MARKERS = ['AuthorizationSignature', 'AuthorizationExpire', 'AccessKey', 'bunny-stream-key', 'image_storage_key'];
const apiHost = new URL(API_URL).hostname;

test.describe('TUS Proxy - Security Verification', () => {
  test.use({ storageState: AUTH_STATE.single });

  let tracker: ReturnType<typeof trackUploads>;

  test.beforeEach(async ({ page }) => {
    tracker = trackUploads(page);
    // Server action responses (initiate/complete/status) are the only place
    // upload credentials could leak to the browser. Their streamed bodies are
    // not reliably readable from Playwright's network events, so copy them
    // in the page from the fetch calls Next.js makes for server actions.
    await page.addInitScript(() => {
      const w = window as unknown as { __actionBodies: string[] };
      w.__actionBodies = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        const headers = new Headers(init?.headers);
        if (headers.has('next-action')) {
          response.clone().text().then((body) => w.__actionBodies.push(body), () => undefined);
        }
        return response;
      };
    });
    await gotoUpload(page, 'en');
  });

  test.afterEach(async ({ page }) => {
    await deleteVideos(page, tracker.videoIds);
  });

  test('uploads only through the TUS proxy with a Bearer token and no Bunny credentials', async ({ page }) => {
    await startUpload(page, await helpers.createTestVideo('security-test.mp4', 64), 'Security Test Video');
    await expectUploadSuccess(page, 'Security Test Video');

    // 1. Upload requests go to the api-videos proxy only
    const tusRequests = tracker.tusRequests();
    expect(tusRequests.map((r) => r.method)).toEqual(expect.arrayContaining(['POST', 'PATCH']));
    for (const request of tusRequests) {
      const url = new URL(request.url);
      expect(url.hostname).toBe(apiHost);
      expect(url.pathname).toMatch(/^\/api\/videos\/tus(\/|$)/);
    }
    const bunnyWrites = tracker.requests.filter(
      (r) => r.method !== 'GET' && BUNNY_UPLOAD_HOSTS.test(new URL(r.url).hostname),
    );
    expect(bunnyWrites).toEqual([]);

    // 2. Every TUS request is authenticated with the user's JWT
    for (const request of tusRequests) {
      expect(request.headers['authorization']).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    }

    // 3. No Bunny.net credentials in any browser request or server action response
    const browserTraffic = JSON.stringify(tracker.requests).toLowerCase();
    const actionBodies = () => page.evaluate(() => (window as unknown as { __actionBodies: string[] }).__actionBodies);
    // The initiate response (which carries the upload session) must be among them
    await expect.poll(async () => (await actionBodies()).some((body) => body.includes('tusSessionId'))).toBe(true);
    const responses = (await actionBodies()).join('\n').toLowerCase();
    for (const marker of SECRET_MARKERS) {
      expect(browserTraffic).not.toContain(marker.toLowerCase());
      expect(responses).not.toContain(marker.toLowerCase());
    }
  });

  test('sends the upload session and video id as TUS metadata', async ({ page }) => {
    await startUpload(page, await helpers.createTestVideo('metadata-test.mp4', 64), 'Metadata Test');
    await expect.poll(() => tracker.videoIds.size).toBe(1);

    const create = tracker.tusRequests().find((r) => r.method === 'POST');
    const metadata = Object.fromEntries(
      (create?.headers['upload-metadata'] || '').split(',').map((pair) => {
        const [key, value] = pair.trim().split(' ');
        return [key, value ? Buffer.from(value, 'base64').toString('utf8') : ''];
      }),
    );
    expect(metadata.videoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(metadata.tusSessionId).toBeTruthy();
    expect(metadata.filename).toBe('metadata-test.mp4');
    expect(metadata.filetype).toBe('video/mp4');
    expect(create?.headers['tus-resumable']).toBe('1.0.0');
    expect(Number(create?.headers['upload-length'])).toBe(64 * 1024);

    await expectUploadSuccess(page, 'Metadata Test');
  });
});

test.describe('TUS Proxy - Server-side validation', () => {
  test('rejects TUS uploads without a token', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/videos/tus`, {
      headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': '1024', 'Upload-Metadata': `videoId ${Buffer.from('x').toString('base64')}` },
      failOnStatusCode: false,
    });
    expect([401, 403]).toContain(res.status());
  });

  test('rejects TUS uploads with an invalid token', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/videos/tus`, {
      headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': '1024', Authorization: 'Bearer not.a.jwt' },
      failOnStatusCode: false,
    });
    expect([401, 403]).toContain(res.status());
  });
});

test.describe('TUS Proxy - Error Handling', () => {
  test.use({ storageState: AUTH_STATE.single });

  let tracker: ReturnType<typeof trackUploads>;

  test.beforeEach(async ({ page }) => {
    tracker = trackUploads(page);
    await gotoUpload(page, 'en');
  });

  test.afterEach(async ({ page }) => {
    await deleteVideos(page, tracker.videoIds);
  });

  test('reports the failure after automatic retries are exhausted', async ({ page }) => {
    test.slow(); // tus retries after 0, 3, 5, 10 and 20 seconds
    const ui = uploadUi(page);
    await failTusPatches(page, 500);

    await startUpload(page, await helpers.createTestVideo('server-error.mp4', 64), 'Server Error Test');

    await expect(ui.progress).toHaveAttribute('data-state', 'error', { timeout: 90_000 });
    await expect(ui.error).toBeVisible();
    await expect(ui.retry).toBeVisible();
    const patches = tracker.tusRequests().filter((r) => r.method === 'PATCH');
    // The client retried before giving up
    expect(patches.length).toBeGreaterThan(1);
    expect(patches.every((p) => TUS_URL_PATTERN.test(p.url))).toBe(true);
  });
});
