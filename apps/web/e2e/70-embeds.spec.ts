import * as fs from 'fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { canDecodeHls, watchUrl } from './test-utils/watch-page';
import { createDisposableVideo, deleteVideoQuietly } from './test-utils/e2e-videos';
import { useOwnVideos } from './release/own-videos';

/**
 * Embeds & sharing (docs/embeds/README.md), against the deployed web app.
 *
 * - The embed frame is loaded from a page on ANOTHER origin (a routed fake
 *   host), so framing headers, cross-origin postMessage and the referrer are real.
 * - Playback needs H.264: it runs on WebKit and branded Chrome
 *   (A11Y_CHROME_CHANNEL=chrome); bundled Chromium skips it with that reason.
 */

test.use({ storageState: ANONYMOUS_STATE });
if (process.env.A11Y_CHROME_CHANNEL) {
  test.use({ channel: process.env.A11Y_CHROME_CHANNEL });
}

/**
 * The host page lives on another origin: a fake origin served by page.route. On the local stack
 * (E2E_ENV=local) the site is loopback (http://localhost) and Chrome's Local Network Access blocks a
 * public page from framing it (a page.route answer counts as public whatever its URL), so there the
 * host page comes from a real loopback server of this spec (127.0.0.1, still cross-origin to
 * localhost), as in release/embed.player.spec.ts (#1052).
 */
const HOST_PAGE = process.env.EMBED_HOST_PAGE || 'https://embed-host.e2e.test/page';
const LOCAL = process.env.E2E_ENV === 'local';
let loopbackHost: Server | undefined;
/** Host page bodies by path, for the loopback server */
const hostBodies = new Map<string, string>();

async function loopbackHostOrigin(): Promise<string> {
  if (!loopbackHost) {
    const server = createServer((req, res) => {
      const body = hostBodies.get(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      if (body === undefined) res.writeHead(404).end();
      else res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    loopbackHost = server;
  }
  return `http://127.0.0.1:${(loopbackHost.address() as AddressInfo).port}`;
}

test.afterAll(async () => {
  const server = loopbackHost;
  loopbackHost = undefined;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** This file's own public videos (release/own-videos.ts: made in beforeAll, deleted afterwards) */
const own = useOwnVideos(test as never);
const ownLecture = async () => (await own('landscape')) as Awaited<ReturnType<typeof own>> & { titleLocalized?: { en?: string; ar?: string } };
const NO_CODEC = 'bundled Chromium has no H.264 decoder for the HLS stream; run with webkit or A11Y_CHROME_CHANNEL=chrome';

function baseOrigin(testInfo: TestInfo): string {
  return new URL(String(testInfo.project.use.baseURL)).origin;
}

/** Serve a page on another origin that frames `src` and records the player's messages. */
async function openHostPage(page: Page, body: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embed host</title></head><body>
      ${body}
      <script>
        window.__aun = [];
        window.addEventListener('message', function (e) {
          if (e.data && typeof e.data.type === 'string' && e.data.type.indexOf('aun:v1:') === 0) {
            window.__aun.push({ origin: e.origin, data: e.data });
          }
        });
      </script></body></html>`;
  if (LOCAL) {
    const path = `/host/${hostBodies.size + 1}`;
    hostBodies.set(path, html);
    await page.goto(`${await loopbackHostOrigin()}${path}`);
    return;
  }
  await page.route(HOST_PAGE, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(HOST_PAGE);
}

function playerFrame(origin: string, src: string, size = 'width="640" height="360"') {
  return `<iframe id="aun" src="${src}" ${size} title="Al Ummah Now video player" frameborder="0"
    allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen
    referrerpolicy="strict-origin-when-cross-origin"></iframe>`.replace('{origin}', origin);
}

/**
 * PR runs target the already-deployed QA build, so the PR that adds /embed
 * cannot pass these. A build without /embed redirects it to
 * /{locale}/embed/... and 404s; PR runs skip then. Pushes to main never skip.
 */
let embedDeployed: boolean | undefined;
test.beforeEach(async ({}, testInfo) => {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return;
  if (embedDeployed === undefined) {
    const res = await fetch(`${baseOrigin(testInfo)}/embed/v/deploy-probe`).catch(() => null);
    embedDeployed = !!res && res.status !== 404 && new URL(res.url).pathname.startsWith('/embed/');
  }
  test.skip(!embedDeployed, '/embed is not deployed on the target yet (it lands with the PR that adds it)');
});

async function messages(page: Page) {
  return page.evaluate(() => (window as unknown as { __aun: Array<{ origin: string; data: { event?: string; type: string; error?: { code: string } } }> }).__aun);
}

test.describe('embed framing policy', () => {
  test('EMBED-001 the embed route is frameable by any origin; app pages are not', async ({ request }, testInfo) => {
    const video = await ownLecture();
    const embed = await request.get(`${baseOrigin(testInfo)}/embed/v/${video.id}`);
    expect(embed.status()).toBe(200);
    expect(embed.headers()['content-security-policy']).toMatch(/frame-ancestors \*(;|$)/);
    expect(embed.headers()['x-frame-options']).toBeUndefined();

    const watch = await request.get(`${baseOrigin(testInfo)}${watchUrl(video.id)}`);
    expect(watch.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(watch.headers()['x-frame-options']).toBe('DENY');
  });
});

test.describe('embed player', () => {
  test('EMBED-002 a public video embedded on another origin plays and reports events', async ({ page, browserName }, testInfo) => {
    test.skip(!canDecodeHls(browserName, testInfo), NO_CODEC);
    const origin = baseOrigin(testInfo);
    const video = await ownLecture();
    await openHostPage(page, playerFrame(origin, `${origin}/embed/v/${video.id}?start=5`));

    const frame = page.frameLocator('#aun');
    await expect(frame.getByTestId('embed-facade')).toBeVisible({ timeout: 30000 });
    await expect(frame.getByTestId('embed-watch-link')).toHaveAttribute('href', `/en/video/${video.id}?t=5`);
    await expect.poll(async () => (await messages(page)).some((m) => m.data.event === 'ready' && m.origin === origin)).toBe(true);

    await frame.getByTestId('embed-facade').click();
    const media = frame.locator('.video-js video');
    await expect(media).toBeAttached({ timeout: 45000 });
    // Playing: time moves past the start position
    await expect.poll(async () => media.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 45000 }).toBeGreaterThan(5.5);
    await expect.poll(async () => (await messages(page)).some((m) => m.data.event === 'play')).toBe(true);
    // Events are posted to this page's origin only
    for (const m of await messages(page)) expect(m.origin).toBe(origin);

    // Commands from the host page are obeyed (strict origin on the player side)
    await page.evaluate((target) => {
      (document.getElementById('aun') as HTMLIFrameElement).contentWindow!.postMessage({ type: 'aun:v1:command', command: 'pause' }, target);
    }, origin);
    await expect.poll(async () => media.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  });

  test('EMBED-003 autoplay=1 starts muted without a click', async ({ page, browserName }, testInfo) => {
    test.skip(!canDecodeHls(browserName, testInfo), NO_CODEC);
    const origin = baseOrigin(testInfo);
    const video = await ownLecture();
    await openHostPage(page, playerFrame(origin, `${origin}/embed/v/${video.id}?autoplay=1`));
    const media = page.frameLocator('#aun').locator('.video-js video');
    await expect.poll(async () => media.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 45000 }).toBeGreaterThan(0.5);
    expect(await media.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  });

  test('EMBED-004 Arabic embed renders right to left', async ({ page }, testInfo) => {
    const origin = baseOrigin(testInfo);
    const video = await ownLecture();
    await page.goto(`${origin}/embed/v/${video.id}?lang=ar`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    const main = page.getByTestId('embed-player');
    await expect(main).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('embed-watch-link')).toContainText('شاهد على الأمة الآن');
    if (video.titleLocalized?.ar) await expect(page.getByTestId('embed-title')).toHaveText(video.titleLocalized.ar);
    // No app chrome inside the frame
    await expect(page.locator('header nav, [data-testid="consent-banner"]')).toHaveCount(0);
  });
});

test.describe('unavailable videos', () => {
  test('EMBED-005 an unknown video shows the unavailable frame and reports it', async ({ page }, testInfo) => {
    const origin = baseOrigin(testInfo);
    await openHostPage(page, playerFrame(origin, `${origin}/embed/v/00000000-0000-4000-8000-000000000000`));
    const frame = page.frameLocator('#aun');
    await expect(frame.getByTestId('embed-unavailable')).toBeVisible({ timeout: 30000 });
    await expect(frame.locator('.video-js')).toHaveCount(0);
    await expect.poll(async () => (await messages(page)).some((m) => m.data.event === 'error' && m.data.error?.code === 'unavailable')).toBe(true);
  });

  test('EMBED-006 a private video shows the same unavailable frame', async ({ page, request }, testInfo) => {
    test.skip(!fs.existsSync(AUTH_STATE.single), 'needs the E2E users from global setup');
    test.setTimeout(240000);
    // The single user's own private upload (record only), deleted afterwards
    const privateVideo = await createDisposableVideo('single', 'embed-private', { isPublic: false });
    try {
    expect(privateVideo?.isPublic).toBe(false);
    const origin = baseOrigin(testInfo);

    await openHostPage(page, playerFrame(origin, `${origin}/embed/v/${privateVideo.id}`));
    await expect(page.frameLocator('#aun').getByTestId('embed-unavailable')).toBeVisible({ timeout: 30000 });

    const oembed = await request.get(`${origin}/oembed?url=${encodeURIComponent(`${origin}${watchUrl(privateVideo.id)}`)}`);
    expect(oembed.status()).toBe(404);
    } finally {
      await deleteVideoQuietly('single', privateVideo);
    }
  });
});

test.describe('oEmbed and social previews', () => {
  test('EMBED-007 oEmbed returns a valid video response with CORS', async ({ request }, testInfo) => {
    const origin = baseOrigin(testInfo);
    const video = await ownLecture();
    const res = await request.get(`${origin}/oembed?url=${encodeURIComponent(`${origin}${watchUrl(video.id)}`)}&maxwidth=480&format=json`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(res.headers()['access-control-allow-origin']).toBe('*');
    const body = await res.json();
    expect(body).toMatchObject({
      version: '1.0',
      type: 'video',
      provider_name: 'Al Ummah Now',
      provider_url: origin,
      width: 480,
      height: 270,
      aun_video_id: video.id,
    });
    expect(typeof body.title).toBe('string');
    expect(body.html).toContain(`<iframe src="${origin}/embed/v/${video.id}"`);
    expect(body.html).toContain('allowfullscreen');

    expect((await request.get(`${origin}/oembed?url=${encodeURIComponent('https://example.com/x')}`)).status()).toBe(404);
    expect((await request.get(`${origin}/oembed?url=x&format=xml`)).status()).toBe(501);
  });

  test('EMBED-008 the watch page advertises oEmbed and a Twitter player card', async ({ request }, testInfo) => {
    const origin = baseOrigin(testInfo);
    const video = await ownLecture();
    const html = await (await request.get(`${origin}${watchUrl(video.id)}`)).text();
    expect(html).toMatch(/<link[^>]+rel="alternate"[^>]+type="application\/json\+oembed"/);
    expect(html).toContain(`<meta property="og:video" content="${origin}/embed/v/${video.id}"`);
    expect(html).toContain('<meta name="twitter:card" content="player"');
    expect(html).toContain(`<meta name="twitter:player" content="${origin}/embed/v/${video.id}"`);
  });
});

test.describe('share dialog', () => {
  test('EMBED-009 copies the link and the embed snippet', async ({ page }, testInfo) => {
    const origin = baseOrigin(testInfo);
    const video = await ownLecture();
    await page.addInitScript(() => {
      const copied: string[] = [];
      (window as unknown as { __copied: string[] }).__copied = copied;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => { copied.push(text); } },
      });
    });
    await page.goto(watchUrl(video.id));
    await page.getByTestId('share-button').click();
    const dialog = page.getByTestId('share-dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByTestId('share-copy-link').click();
    await dialog.getByTestId('share-copy-embed').click();
    const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
    expect(copied[0]).toBe(`${origin}/en/video/${video.id}`);
    expect(copied[1]).toBe(
      `<iframe src="${origin}/embed/v/${video.id}" width="560" height="315" title="${video.title.replace(/"/g, '&quot;')}" ` +
      'frameborder="0" loading="lazy" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen ' +
      'referrerpolicy="strict-origin-when-cross-origin"></iframe>',
    );
  });

  test('EMBED-010 ?t= starts the watch page at that time', async ({ page, browserName }, testInfo) => {
    test.skip(!canDecodeHls(browserName, testInfo), NO_CODEC);
    const video = await ownLecture();
    await page.goto(`${watchUrl(video.id)}?t=20`);
    const media = page.locator('.video-js video');
    await expect.poll(async () => media.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 45000 }).toBeGreaterThan(0);
    await expect.poll(async () => media.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20000 }).toBeGreaterThanOrEqual(19);
  });
});

test.describe('embedded discussions (read-only)', () => {
  test('EMBED-011 the widget renders the comments frame on another origin', async ({ page }, testInfo) => {
    const origin = baseOrigin(testInfo);
    const video = await ownLecture();
    await openHostPage(page, `<script src="${origin}/embed/widget.js"></script>
      <alummah-discussion video="${video.id}" lang="ar"></alummah-discussion>`);
    const frame = page.frameLocator('alummah-discussion iframe');
    const comments = frame.getByTestId('embed-comments');
    await expect(comments).toBeVisible({ timeout: 30000 });
    await expect(comments).toHaveAttribute('dir', 'rtl');
    // The widget sized the iframe from the frame's resize message
    await expect.poll(async () => page.locator('alummah-discussion iframe').evaluate((f: HTMLIFrameElement) => f.style.height)).toMatch(/px$/);
  });
});
