import { test, expect } from './fixtures';
import { ANONYMOUS_STATE, AUTH_STATE, readAccount } from './test-utils/auth-state';
import { apiCall } from './test-utils/watch-page';
import { ownPublicVideos } from './test-utils/own-public-video';

/**
 * The watch page's views and date read like the cards (separator, relative wording, exact date and
 * time in the tooltip and the expanded description).
 *
 * A channel's name follows the page's language (owner, 2026-11-13: an Arabic page showed
 * "Al Ummah Now" under «وقفة منسية مع أمهات المؤمنين»). This file's own channel has an English and
 * an Arabic name; its video's card on the home grid and its watch page show the Arabic name on
 * /ar and the English one on /en.
 *
 * A video's title follows it too (owner, 2026-11-13: the Arabic home page showed English titles in
 * Continue watching, whose entries carried only the stored default title): the home card and the
 * signed-in Continue watching shelf show the Arabic title on /ar and the English one on /en.
 */
test.describe.configure({ mode: 'default' });

const TITLE_AR = 'محاضرة اختبار الاسم';
const own = ownPublicVideos(test, 'channel-name', [{ title: 'Channel name lecture', titleAr: TITLE_AR }], { nameAr: 'قناة اختبار الاسم' });

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
      // The video's title in the page language too
      const title = lang === 'ar' ? TITLE_AR : own.videos()[0].title;
      const otherTitle = lang === 'ar' ? own.videos()[0].title : TITLE_AR;
      await expect(card).toContainText(title);
      await expect(card).not.toContainText(otherTitle);
      // YouTube style (owner, 2026-11-13): the card reads "views • 1 day ago"; its date's tooltip says
      // what the date is, with a verb and the exact date and time (the hour has no leading zero)
      const published = lang === 'ar' ? 'نُشر في' : 'Published on';
      await expect(card.locator('time.rel-date')).toHaveAttribute('title', new RegExp(`^${published} .*[0-9٠-٩]{1,2}:[0-9٠-٩]{2}`));

      await page.goto(`/${lang}/video/${own.videos()[0].id}`);
      const channelLink = page.locator(`a[href="/${lang}/channels/${own.channelId()}"]`).filter({ hasText: expected }).first();
      await expect(channelLink).toBeVisible({ timeout: 30_000 });

      // The views and date line reads like the cards: views • relative time (Arabic joins with «،»,
      // lib/i18n/meta-separator.ts), with the exact date and time on hover and in the expanded
      // description (owner, 2026-11-13: «6 مشاهدات   أمس»)
      const sep = lang === 'ar' ? '،' : '•';
      const summary = page.locator('.watch-desc summary');
      await expect(summary).toContainText(sep);
      if (lang === 'ar') await expect(summary).not.toContainText('•');
      // The exact count and what the date is: on hover/focus (and for screen readers), in full when expanded
      await expect(summary).toHaveAttribute('data-tip', new RegExp(`${sep}\\s*${published} `));
      await expect(summary.locator('time.rel-date')).not.toHaveText(lang === 'ar' ? 'أمس' : 'yesterday');
      await summary.click();
      await expect(page.getByTestId('watch-published')).toContainText(published);
    });
  }
});

test.describe('Video title in the page language: Continue watching', () => {
  // The "multi" suite user: no other spec records its watch history (33-watch-history uses "none")
  test.use({ storageState: AUTH_STATE.multi });

  test('the home card shows the Arabic title on /ar and the English one on /en', async ({ page, request }) => {
    const video = own.videos()[0];
    const { accessToken } = readAccount('multi');
    const duration = 40; // the landscape40 clip
    const res = await apiCall(request, 'POST', '/api/watch-history', { token: accessToken, data: { videoId: video.id, progress: Math.round(duration * 0.3), duration } });
    expect(res.status(), await res.text()).toBeLessThan(300);
    try {
      for (const [lang, expected, other] of [['ar', TITLE_AR, video.title], ['en', video.title, TITLE_AR]] as const) {
        await page.goto(`/${lang}`);
        // One card (owner 2026-11-21): the newest unfinished video's title in its meta line, Resume opens it
        const card = page.locator(`[data-testid="continue-watching"][data-video-id="${video.id}"]`);
        await expect(card).toBeVisible({ timeout: 30_000 });
        await expect(card.getByTestId('continue-watching-meta')).toContainText(expected);
        await expect(card.getByTestId('continue-watching-meta')).not.toContainText(other);
        await expect(card.getByTestId('continue-watching-resume')).toHaveAttribute('href', `/${lang}/video/${video.id}`);
        await expect(card.getByTestId('continue-watching-card')).toHaveAttribute('href', `/${lang}/history?view=continue`);
      }
    } finally {
      await apiCall(request, 'DELETE', `/api/watch-history/${video.id}`, { token: accessToken });
    }
  });
});
