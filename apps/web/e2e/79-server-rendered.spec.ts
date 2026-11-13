import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { ns, useOwnData, type Creator, type CreatedVideo } from './release/builders';
import { target } from './release/targets';

/**
 * Server-rendered primary content (wiki AUN-SEO, phase 4): with JavaScript off, the watch page, home,
 * channel (by id and by @handle) and playlist pages already show their title (h1), channel link and
 * list items as real links with titles and thumbnails, as search engines and no-JS readers get them.
 *
 * The channel the spec makes has no Home sections, so its Home tab (its main URL) falls back to its
 * latest uploads (#1206). No server-rendered HTML carries a signed media URL (Bunny token or R2
 * /priv/ link): thumbnails are the stable /thumb images (#1209).
 *
 * Own data (release/builders.ts): a creator with a channel, two public videos and a public playlist
 * of both, made in beforeAll and deleted in afterAll (useOwnData), pass or fail.
 */
/** A Bunny token (query or path form) or an R2 private link, as raw HTML or the RSC payload carries it */
const SIGNED_URL = /bcdn_token=|[?&](?:amp;|\\u0026)?token=[^&"'\\\s]+(?:&|&amp;|\\u0026)expires=|\/priv\/\d{9,}\./;
const data = useOwnData(test);
let owner: Creator;
let channelId: string;
let channelName: string;
let handle: string | null = null;
const videos: CreatedVideo[] = [];
let playlistId: string;
let playlistTitle: string;

test.describe.configure({ mode: 'default' });
test.use({ storageState: ANONYMOUS_STATE, javaScriptEnabled: false });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  owner = await data.createCreator(browser, 'ssr');
  channelId = owner.channelIds[0];
  const tag = `${ns()} ${Date.now().toString(36)}`;
  for (const n of [1, 2]) videos.push(await data.createVideo(owner.user, channelId, { clip: 'landscape40', isPublic: true, title: `E2E SSR ${n} ${tag}` }));
  playlistTitle = `E2E SSR playlist ${tag}`;
  playlistId = await data.createPlaylist(owner.user, channelId, { title: playlistTitle, videoIds: videos.map((v) => v.id), isPublic: true });
  const res = await fetch(`${target().api}/api/channels/${encodeURIComponent(channelId)}`, { cache: 'no-store' });
  expect(res.ok, `GET /api/channels/${channelId} answered ${res.status}`).toBe(true);
  const channel = (await res.json()) as { name?: string; handle?: string | null; result?: { name?: string; handle?: string | null } };
  channelName = channel.name ?? channel.result?.name ?? '';
  handle = channel.handle ?? channel.result?.handle ?? null;
  expect(channelName, 'the channel has a name').toBeTruthy();
});

for (const locale of ['en', 'ar'] as const) {
  test.describe(`Server-rendered pages without JavaScript (${locale})`, () => {
    test(`SSR-001 the watch page has the title, channel link, description and poster (${locale})`, async ({ page }) => {
      const video = videos[0];
      await page.goto(`/${locale}/video/${video.id}`);
      await expect(page.getByRole('heading', { level: 1, name: video.title })).toBeVisible();
      const channel = page.getByTestId('watch-skeleton-channel-link');
      await expect(channel).toBeVisible();
      await expect(channel).toHaveAttribute('href', new RegExp(`^/${locale}/(@|channels/${channelId})`));
      await expect(page.getByTestId('watch-skeleton-description')).toContainText(`Created by ${ns()}`);
      const poster = page.getByTestId('watch-poster');
      await expect(poster).toHaveAttribute('src', `/thumb/${video.id}.jpg`);
      await expect(poster).toHaveAttribute('fetchpriority', 'high');
    });

    test(`SSR-002 home has its heading and video cards as links with thumbnails (${locale})`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('video-grid-loading')).toHaveCount(0);
      const card = page.locator(`a[data-testid="video-card"][href^="/${locale}/video/"]`).first();
      await expect(card).toBeVisible();
      await expect(card.locator('h3')).not.toBeEmpty();
      await expect(card.locator('img[data-testid="thumbnail-image"]')).toHaveAttribute('src', /.+/);
    });

    test(`SSR-003 the channel page (by id and by @handle) lists its videos as links (${locale})`, async ({ page }) => {
      const paths = [`/${locale}/channels/${channelId}?tab=videos`, ...(handle ? [`/${locale}/@${handle}?tab=videos`] : [])];
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: channelName })).toBeVisible();
        for (const video of videos) {
          const card = page.locator(`a[data-testid="video-card"][data-video-id="${video.id}"]`);
          await expect(card, `${path} lists ${video.id}`).toBeVisible();
          await expect(card).toHaveAttribute('href', `/${locale}/video/${video.id}`);
          await expect(card).toContainText(video.title);
          await expect(card.locator('img[data-testid="thumbnail-image"]')).toHaveCount(1);
        }
      }
      expect(handle, 'the channel has an @handle (its canonical page)').toBeTruthy();
    });

    test(`SSR-005 the channel's main URL (no Home sections) lists its uploads (${locale})`, async ({ page }) => {
      const paths = [`/${locale}/channels/${channelId}`, ...(handle ? [`/${locale}/@${handle}`] : [])];
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByTestId('channel-sections')).toHaveAttribute('data-fallback', 'uploads');
        for (const video of videos) {
          const card = page.locator(`a[data-testid="video-card"][data-video-id="${video.id}"]`);
          await expect(card, `${path} lists ${video.id} on its Home tab`).toBeVisible();
          await expect(card).toHaveAttribute('href', `/${locale}/video/${video.id}`);
        }
      }
    });

    test(`SSR-006 no server-rendered page carries a signed media URL; thumbnails are /thumb (${locale})`, async ({ request }) => {
      const pages = [
        `/${locale}`,
        `/${locale}/video/${videos[0].id}`,
        `/${locale}/channels/${channelId}`,
        `/${locale}/channels/${channelId}?tab=videos`,
        `/${locale}/playlist/${playlistId}`,
      ];
      for (const path of pages) {
        const res = await request.get(path);
        expect(res.status(), path).toBe(200);
        expect(res.headers()['cache-control'] ?? '', `${path} must not be stored by shared caches`).toMatch(/private|no-store/);
        const html = await res.text();
        const signed = SIGNED_URL.exec(html);
        expect(signed, `${path} carries a signed URL near: ${signed ? html.slice(Math.max(0, signed.index - 80), signed.index + 40) : ''}`).toBeNull();
      }
      const channelHtml = await (await request.get(`/${locale}/channels/${channelId}?tab=videos`)).text();
      expect(channelHtml).toContain(`/thumb/${videos[0].id}.jpg`);
    });

    test(`SSR-004 the playlist page has its title, channel link and items as links (${locale})`, async ({ page }) => {
      await page.goto(`/${locale}/playlist/${playlistId}`);
      await expect(page.getByRole('heading', { level: 1, name: playlistTitle })).toBeVisible();
      await expect(page.locator(`a[href="/${locale}/channels/${channelId}"]`).first()).toBeVisible();
      const items = page.getByTestId('playlist-video-link');
      await expect(items).toHaveCount(videos.length);
      for (const [index, video] of videos.entries()) {
        await expect(items.nth(index)).toHaveAttribute('href', new RegExp(`^/${locale}/video/${video.id}\\?list=${playlistId}`));
        await expect(items.nth(index)).toContainText(video.title);
      }
    });
  });
}
