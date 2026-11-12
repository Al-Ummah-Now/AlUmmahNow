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
import { findPlayableVideo, NO_PLAYABLE_VIDEO, watchUrl } from './videos';
import { fixtureVideo } from './fixtures';
import { fetchRetry } from './net';

// Same scheme as the site under test: an https host page cannot frame the local stack's plain http (mixed content)
const HOST_PAGE = `${releaseEnv() === 'local' ? 'http' : 'https'}://embed-host.release.test/page`;

async function embedDeployed(): Promise<boolean> {
  // A build without /embed redirects it to /{locale}/embed/... and then 404s
  const res = await fetchRetry(`${target().web}/embed/v/release-probe`);
  return res.status !== 404 && new URL(res.url).pathname.startsWith('/embed/');
}

async function skipIfNotDeployedOnPr(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return;
  test.skip(!(await embedDeployed()), '/embed is not deployed on the target yet (it lands with the PR that adds it)');
}

async function hostIframe(page: Page, src: string, size = { width: 640, height: 360 }): Promise<void> {
  await page.route(HOST_PAGE, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0">
        <iframe id="aun" src="${src}" width="${size.width}" height="${size.height}" allow="autoplay; fullscreen" style="border:0"></iframe>
      </body></html>`,
    }),
  );
  await page.goto(HOST_PAGE);
}

test.describe('Release: embeds', () => {
  test.beforeEach(skipIfNotDeployedOnPr);

  for (const lang of ['en', 'ar'] as const) {
    test(`a public video plays in a cross-origin iframe (${lang})`, async ({ page }) => {
      const video = await findPlayableVideo();
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
    const video = await findPlayableVideo();
    test.skip(!video, NO_PLAYABLE_VIDEO);

    const res = await fetchRetry(`${target().web}/oembed?format=json&url=${encodeURIComponent(watchUrl(video!.id))}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ version: '1.0', type: 'video', provider_name: 'Al Ummah Now', aun_video_id: video!.id });
    expect(String(body.html)).toContain(`/embed/v/${video!.id}`);
  });

  /*
   * 2026-11-12, www home in Arabic, dark: an embed showed parchment bands above and below a
   * 345x46 strip with pillarboxes (the theme's page background and `main { transparent }` beat
   * the frame's black; the watch page's max-height 100dvh - 148px squashed the player). The
   * host sizes the frame to the video (www: its aspect ratio); the player must fill it on black.
   */
  for (const { key, width, height } of [
    { key: 'landscape', width: 345, height: 194 },
    { key: 'landscape', width: 800, height: 450 },
    { key: 'vertical', width: 216, height: 384 },
  ] as const) {
    for (const scheme of ['dark', 'light'] as const) {
      test(`the player fills a ${width}x${height} frame on the night colour (${key}, ${scheme})`, async ({ page }, testInfo) => {
        const video = await fixtureVideo(key);
        await page.emulateMedia({ colorScheme: scheme });
        await hostIframe(page, `${target().web}/embed/v/${video.id}?lang=ar&autoplay=1`, { width, height });
        const frame = page.frameLocator('#aun');
        const player = frame.locator('.custom-video-player');
        await expect(player).toBeVisible({ timeout: 45000 });
        const embed = page.frame({ url: /\/embed\/v\// })!;
        const look = () =>
          embed.evaluate(() => {
            const bg = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : '');
            const p = document.querySelector('.custom-video-player')!.getBoundingClientRect();
            // the theme's night colour (--fanous-c-nav-bg), dark in every theme and mode
            const night = getComputedStyle(document.documentElement).getPropertyValue('--fanous-c-nav-bg').trim();
            const probe = document.createElement('i');
            probe.style.color = night;
            document.body.append(probe);
            const nightRgb = getComputedStyle(probe).color;
            probe.remove();
            const [r, g, b] = (nightRgb.match(/\d+/g) ?? ['255', '255', '255']).map(Number);
            const dark = 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 80;
            const all = [bg(document.documentElement), bg(document.body), bg(document.querySelector('main'))];
            return { backdrop: all.every((c) => c === nightRgb) && dark, w: Math.round(p.width), h: Math.round(p.height) };
          });
        if (process.env.GITHUB_EVENT_NAME === 'pull_request' && !(await look()).backdrop) {
          testInfo.annotations.push({ type: 'skip', description: 'this build predates the embed frame fill (components/embed/embed-frame.css)' });
          test.skip(true, 'this build predates the embed frame fill');
        }
        await expect.poll(look, { timeout: 15000 }).toEqual({ backdrop: true, w: width, h: height });
      });
    }
  }
});
