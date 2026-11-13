/**
 * Short share links (wiki AUN-SHORT-LINKS, apps/short-links): every share button copies the short
 * link (alummahnow.link on the deployed tiers, the stack's short-links Worker here), and opening it
 * redirects to the real page, in English and in Arabic (?lang=ar). Unknown and private ids answer
 * the bilingual 404 page, which names nothing; every response is noindex.
 *
 *   watch page share dialog → /v/<id> → /<locale>/video/<id> (t kept)
 *   playlist page Share     → /l/<id> → /<locale>/playlist/<id>
 *   channel header Share    → /@<handle> → the channel
 *   community post Share    → /p/<id> → the channel's Community tab with the post
 *
 * A creator, channel, video, playlist and post are made here and removed by the data scope.
 */
import { expect, type Page } from '@playwright/test';
import { test, ns, onLocalStack } from './builders';
import { target } from './targets';
import { apiFetch, gotoSettled } from './web-session';

// Signs users in through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

/** Clipboard writes, kept for the test (the browser's clipboard needs a permission in headless runs). */
async function captureClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const copied: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = copied;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { copied.push(text); } },
    });
    // No device share sheet: share buttons fall back to their Copy link menu
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
}

const lastCopied = (page: Page) => page.evaluate(() => {
  const list = (window as unknown as { __copied?: string[] }).__copied ?? [];
  return list[list.length - 1] ?? '';
});

/** Where a short link lands: the redirect chain, followed by the browser. */
async function follow(page: Page, link: string): Promise<string> {
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  return page.url();
}

test.describe('short links', () => {
  test.skip(!onLocalStack(), 'the local stack runs this PR\'s short-links Worker; QA/stage get it with the deploy (release smoke covers them)');

  for (const locale of ['en', 'ar'] as const) {
    test(`share buttons copy short links that open the real pages (${locale})`, async ({ browser, page, ownData }) => {
      test.setTimeout(300000);
      const short = target().shortLinks;
      const web = target().web;
      const lang = locale === 'ar' ? '?lang=ar' : '';

      const creator = await ownData.createCreator(browser, `sl-${locale}`);
      const channelId = creator.channelIds[0];
      const video = await ownData.createVideo(creator.user, channelId, { title: `Short link ${locale} ${ns()}` });
      const playlistId = await ownData.createPlaylist(creator.user, channelId, { videoIds: [video.id], isPublic: true });
      const postId = await ownData.createPost(creator.user, channelId, { text: `Short link post ${locale} ${ns()}` });
      const channel = (await (await apiFetch(creator.user, `/api/channels/${channelId}`)).json()) as { result?: { handle?: string }; handle?: string };
      const handle = channel.result?.handle ?? channel.handle;

      // Anonymous viewer on `page`
      await captureClipboard(page);

      // Watch page: the dialog shows and copies the short link; with the time box, ?t= too
      await gotoSettled(page, `${web}/${locale}/video/${video.id}`);
      await page.getByTestId('share-button').click();
      const dialog = page.getByTestId('share-dialog');
      await expect(dialog.getByTestId('share-link')).toHaveValue(`${short}/v/${video.id}${lang}`);
      await dialog.getByTestId('share-copy-link').click();
      await expect.poll(() => lastCopied(page)).toBe(`${short}/v/${video.id}${lang}`);
      expect(await follow(page, `${short}/v/${video.id}${lang}${lang ? '&' : '?'}t=7&utm_source=e2e`)).toBe(
        `${web}/${locale}/video/${video.id}?t=7&utm_source=e2e`,
      );

      // Playlist page
      await gotoSettled(page, `${web}/${locale}/playlist/${playlistId}`);
      await page.getByTestId('playlist-share').click();
      await expect.poll(() => lastCopied(page)).toBe(`${short}/l/${playlistId}${lang}`);
      expect(await follow(page, `${short}/l/${playlistId}${lang}`)).toBe(`${web}/${locale}/playlist/${playlistId}`);

      // Channel header (by @handle when the channel has one)
      await gotoSettled(page, `${web}/${locale}/channels/${channelId}`);
      await page.getByTestId('channel-share').click();
      const channelLink = handle ? `${short}/@${handle}${lang}` : `${short}/c/${channelId}${lang}`;
      await expect.poll(() => lastCopied(page)).toBe(channelLink);
      await follow(page, channelLink);
      await expect(page.getByTestId('channel-header')).toBeVisible();
      expect(new URL(page.url()).pathname.startsWith(`/${locale}/`)).toBe(true);

      // Community post: the post id alone finds its channel once the post is indexed
      await expect
        .poll(async () => (await fetch(`${target().api}/api/community/posts/${postId}`, { cache: 'no-store' })).status, { timeout: 60000 })
        .toBe(200);
      const postLink = `${short}/p/${postId}${lang}`;
      const landed = new URL(await follow(page, postLink));
      expect(landed.pathname).toBe(`/${locale}/channels/${channelId}`);
      expect(landed.searchParams.get('tab')).toBe('community');
      expect(landed.searchParams.get('post')).toBe(postId);
      await expect(page.locator(`#post-${postId}`)).toBeVisible({ timeout: 30000 });
      // The post's own Share copies the same short link
      await page.locator(`#post-${postId}`).getByTestId('post-share-button').click();
      await page.locator(`#post-${postId}`).getByTestId('post-share-copy-link').click();
      await expect.poll(() => lastCopied(page)).toBe(postLink);
    });
  }

  test('unknown and private ids answer the 404 page, never the item; everything is noindex', async ({ browser, page, ownData }) => {
    test.setTimeout(240000);
    const short = target().shortLinks;
    const creator = await ownData.createCreator(browser, 'sl-private');
    const privateTitle = `Private short link ${ns()}`;
    const priv = await ownData.createVideo(creator.user, creator.channelIds[0], { title: privateTitle, isPublic: false });

    for (const path of [`/v/${priv.id}`, '/v/does-not-exist', '/l/nope', '/p/nope', '/x/abc']) {
      const res = await page.goto(`${short}${path}`);
      expect(res?.status(), path).toBe(404);
      expect(res?.headers()['x-robots-tag'], path).toContain('noindex');
      await expect(page.getByTestId('short-link-not-found')).toContainText('Link not found');
      await expect(page.getByTestId('short-link-not-found')).toContainText('الرابط غير موجود');
      expect(await page.content()).not.toContain(privateTitle);
    }
    // Arabic first for ?lang=ar
    await page.goto(`${short}/v/does-not-exist?lang=ar`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const robots = await (await fetch(`${short}/robots.txt`)).text();
    expect(robots).toMatch(/User-agent: \*\nDisallow: \//);
    const redirect = await fetch(`${short}/v/${priv.id}`, { redirect: 'manual' });
    expect(redirect.status).toBe(404);
  });
});
