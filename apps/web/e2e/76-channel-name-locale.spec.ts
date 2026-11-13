import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { ownPublicVideos } from './test-utils/own-public-video';

/**
 * The watch page's views and date read like the cards (separator, relative wording, exact date and
 * time in the tooltip and the expanded description).
 *
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

      // Reloaded until it holds: other specs on the shard upload and rename at the same time, and the
      // anonymous first page is cached for 30 s
      let card = page.locator('[data-testid="video-card"]').first();
      await expect(async () => {
        await page.goto(`/${lang}`);
        card = await own.showCard(page);
        await expect(card).toContainText(expected, { timeout: 5_000 });
      }).toPass({ timeout: 60_000 });
      await expect(card).not.toContainText(other);
      // YouTube style (owner, 2026-11-13): the card reads "views • 1 day ago"; its date's tooltip says
      // what the date is, with a verb and the exact date and time
      const published = lang === 'ar' ? 'نُشر في' : 'Published on';
      await expect(card.locator('time.rel-date')).toHaveAttribute('title', new RegExp(`^${published} .*\\d{2}:\\d{2}`));

      await page.goto(`/${lang}/video/${own.videos()[0].id}`);
      const channelLink = page.locator(`a[href="/${lang}/channels/${own.channelId()}"]`).filter({ hasText: expected }).first();
      await expect(channelLink).toBeVisible({ timeout: 30_000 });

      // The views and date line reads like the cards: views • relative time, with the exact date
      // and time on hover and in the expanded description (owner, 2026-11-13: «6 مشاهدات   أمس»)
      const summary = page.locator('.watch-desc summary');
      await expect(summary).toContainText('•');
      // The exact count and what the date is: on hover/focus (and for screen readers), in full when expanded
      await expect(summary).toHaveAttribute('data-tip', new RegExp(`•\\s*${published} `));
      await expect(summary.locator('time.rel-date')).not.toHaveText(lang === 'ar' ? 'أمس' : 'yesterday');
      await summary.click();
      await expect(page.getByTestId('watch-published')).toContainText(published);
    });
  }
});
