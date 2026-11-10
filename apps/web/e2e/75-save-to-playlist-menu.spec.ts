import { test, expect } from './fixtures';
import { AUTH_STATE } from './test-utils/auth-state';

/**
 * The save-to-playlist menu hangs from its button's start edge. When the
 * action row wraps, the button can sit at the far edge of a phone screen, and
 * the menu used to run off it (WebKit, Arabic, 390px: x = -183). The menu must
 * always be fully on screen, in both directions.
 */
const VIDEO = process.env.E2E_PLAYBACK_VIDEO_ID || '443418c1-dc70-43d9-944d-5388ab7dc4c3';
const MARGIN = 8;

test.describe('watch page - save to playlist menu stays on screen', () => {
  test.use({ storageState: AUTH_STATE.single });

  for (const [lang, save] of [['en', 'Save'], ['ar', 'حفظ']] as const) {
    for (const viewport of [{ width: 390, height: 844 }, { width: 414, height: 896 }, { width: 1440, height: 900 }]) {
      test(`WATCH-PLAYLIST-MENU-001 the menu is inside the viewport (${lang}, ${viewport.width})`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(`/${lang}/video/${VIDEO}`);
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
