import { test as fixturesTest, expect } from './fixtures';
import { useOwnData, type CreatedVideo, type Creator } from './release/builders';

/**
 * The save-to-playlist menu hangs from its button's start edge. When the
 * action row wraps, the button can sit at the far edge of a phone screen, and
 * the menu used to run off it (WebKit, Arabic, 390px: x = -183). The menu must
 * always be fully on screen, in both directions.
 *
 * Own data (release/builders.ts): a creator with a channel, a public video
 * (encoded, so the watch page has its player and action row) and a playlist
 * to save into, made for this spec and deleted afterwards. The variants share
 * them (serial), so the encode is waited on once per worker.
 */
const MARGIN = 8;
const data = useOwnData(fixturesTest);
let owner: Creator;

/**
 * The file's creators, made in a worker fixture rather than beforeAll: Playwright resolves a context
 * option such as storageState before beforeAll runs, so a creator made there was undefined in
 * test.use (every signed-in test failed with "reading 'state'"). Deleted by the file's DataScope.
 */
const test = fixturesTest.extend<object, { creators: { owner: Creator } }>({
  creators: [
    async ({ browser }, use) => {
      owner = await data.createCreator(browser, 'playlist-menu');
      await use({ owner });
    },
    { scope: 'worker', timeout: 300_000 },
  ],
});
let video: CreatedVideo;

test.describe('watch page - save to playlist menu stays on screen', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: async ({ creators }, use) => use(creators.owner.state) });

  test.beforeAll(async ({ browser, creators }) => {
    void browser;
    void creators;
    // Sign-up, then QA's encode (a slow one skips with #929)
    test.setTimeout(15 * 60000);
    video = await data.createVideo(owner.user, owner.channelIds[0], { clip: 'landscape40', isPublic: true });
    await data.createPlaylist(owner.user, owner.channelIds[0], { title: `E2E menu playlist ${Date.now().toString(36)}` });
  });

  for (const [lang, save] of [['en', 'Save'], ['ar', 'حفظ']] as const) {
    for (const viewport of [{ width: 390, height: 844 }, { width: 414, height: 896 }, { width: 1440, height: 900 }]) {
      test(`WATCH-PLAYLIST-MENU-001 the menu is inside the viewport (${lang}, ${viewport.width})`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(`/${lang}/video/${video.id}`);
        const trigger = page.getByRole('button', { name: save, exact: true });
        await trigger.scrollIntoViewIfNeeded({ timeout: 45000 });
        await trigger.click();
        const menu = page.getByTestId('save-to-playlist-menu');
        await expect(menu).toBeVisible();

        const box = (await menu.boundingBox())!;
        const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
        expect(box.x, 'menu starts on screen').toBeGreaterThanOrEqual(MARGIN - 1);
        expect(box.x + box.width, 'menu ends on screen').toBeLessThanOrEqual(viewportWidth - MARGIN + 1);
      });
    }
  }
});
