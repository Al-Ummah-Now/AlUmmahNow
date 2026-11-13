import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { ownPublicVideos } from './test-utils/own-public-video';

/**
 * A channel's name follows the page's language (owner, 2026-11-13: an Arabic page showed
 * "Al Ummah Now" under «وقفة منسية مع أمهات المؤمنين»). This file's own channel has an English and
 * an Arabic name; its video's card on the home grid and its watch page show the Arabic name on
 * /ar and the English one on /en.
 */
test.describe.configure({ mode: 'default' });

const own = ownPublicVideos(test, 'channel-name', [{ title: 'Channel name lecture' }], { nameAr: 'قناة اختبار الاسم' });

test.describe('Channel name in the page language', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  for (const lang of ['ar', 'en'] as const) {
    test(`home card and watch page show the ${lang} channel name`, async ({ page }) => {
      const expected = lang === 'ar' ? 'قناة اختبار الاسم' : own.channelName();
      const other = lang === 'ar' ? own.channelName() : 'قناة اختبار الاسم';

      await page.goto(`/${lang}`);
      const card = await own.showCard(page);
      await expect(card).toContainText(expected);
      await expect(card).not.toContainText(other);

      await page.goto(`/${lang}/video/${own.videos()[0].id}`);
      const channelLink = page.locator(`a[href="/${lang}/channels/${own.channelId()}"]`).filter({ hasText: expected }).first();
      await expect(channelLink).toBeVisible({ timeout: 30_000 });
    });
  }
});
