/**
 * Release regression: the embed player (docs/embeds/README.md) plays inside a
 * cross-origin iframe, refuses unknown videos with the unavailable frame, and
 * oEmbed answers for a watch URL. Runs in the "player" project (branded Chrome,
 * H.264). The host page lives on a fake origin served by page.route, so the
 * frame really is cross-origin and frame-ancestors is exercised.
 *
 * On a pull request the target is the already-deployed QA build, so the PR
 * that introduces a route cannot pass a spec for it: when /embed is not on the
 * target yet, PR runs skip with that reason. Stage release runs never skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { target, releaseEnv } from './targets';
import { NO_PLAYABLE_VIDEO, watchUrl } from './videos';
import { fetchRetry } from './net';
import { useOwnVideos } from './own-videos';

// This spec's own videos (created in beforeAll, deleted in afterAll): never the seed's or the newest public one
const own = useOwnVideos(test);
// It signs a user up through the auth server: traces and video would hold the password and code
test.use({ trace: 'off', video: 'off' });

// A fake origin served by page.route, cross-origin to the site under test. On the local stack it is
// 127.0.0.1 (the site is localhost): Chrome's Local Network Access lets a page frame loopback only
// from a secure context holding the local-network-access permission. A plain-http public host is not
// a secure context (the permission can't be granted) and an https one is; loopback is both secure and
// local, so the plain-http stack frames without mixed content.
const HOST_PAGE = releaseEnv() === 'local' ? 'http://127.0.0.1:3001/__embed-host/page' : 'https://embed-host.release.test/page';

async function embedDeployed(): Promise<boolean> {
  // A build without /embed redirects it to /{locale}/embed/... and then 404s
  const res = await fetchRetry(`${target().web}/embed/v/release-probe`);
  return res.status !== 404 && new URL(res.url).pathname.startsWith('/embed/');
}

async function skipIfNotDeployedOnPr(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return;
  test.skip(!(await embedDeployed()), '/embed is not deployed on the target yet (it lands with the PR that adds it)');
}

async function hostIframe(page: Page, src: string): Promise<void> {
  // Headless Chrome denies the Local Network Access prompt without asking (Chrome's error page in the frame)
  if (releaseEnv() === 'local') await page.context().grantPermissions(['local-network-access'], { origin: new URL(HOST_PAGE).origin });
  await page.route(HOST_PAGE, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0">
        <iframe id="aun" src="${src}" width="640" height="360" allow="autoplay; fullscreen" style="border:0"></iframe>
      </body></html>`,
    }),
  );
  await page.goto(HOST_PAGE);
}

test.describe('Release: embeds', () => {
  test.beforeEach(skipIfNotDeployedOnPr);

  for (const lang of ['en', 'ar'] as const) {
    test(`a public video plays in a cross-origin iframe (${lang})`, async ({ page }) => {
      const video = await own('landscape');
      test.skip(!video, NO_PLAYABLE_VIDEO);

      await hostIframe(page, `${target().web}/embed/v/${video!.id}?lang=${lang}`);
      const frame = page.frameLocator('#aun');
      await expect(frame.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      await frame.getByTestId('embed-facade').click();

      const embed = page.frame({ url: /\/embed\/v\// })!;
      await expect
        .poll(() => embed.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')?.currentTime ?? 0), {
          message: 'embedded playback did not reach 2s',
          timeout: 45000,
        })
        .toBeGreaterThan(2);
      await expect(frame.getByTestId('embed-watch-link')).toHaveAttribute('href', new RegExp(`/${lang}/video/${video!.id}`));
    });
  }

  test('an unknown video shows the unavailable frame', async ({ page }) => {
    await hostIframe(page, `${target().web}/embed/v/does-not-exist-${Date.now()}`);
    await expect(page.frameLocator('#aun').getByTestId('embed-unavailable')).toBeVisible();
  });

  test('embed responses allow any framer; watch pages do not', async () => {
    const embed = await fetchRetry(`${target().web}/embed/v/release-probe`);
    expect(embed.headers.get('content-security-policy') ?? '').toMatch(/frame-ancestors \*/);
    expect(embed.headers.get('x-frame-options')).toBeNull();

    const app = await fetchRetry(`${target().web}/en`);
    const appCsp = app.headers.get('content-security-policy') ?? '';
    expect(appCsp.includes('frame-ancestors *')).toBe(false);
  });

  test('oEmbed describes a watch URL', async () => {
    const video = await own('landscape');
    test.skip(!video, NO_PLAYABLE_VIDEO);

    const res = await fetchRetry(`${target().web}/oembed?format=json&url=${encodeURIComponent(watchUrl(video!.id))}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ version: '1.0', type: 'video', provider_name: 'Al Ummah Now', aun_video_id: video!.id });
    expect(String(body.html)).toContain(`/embed/v/${video!.id}`);
  });
});
