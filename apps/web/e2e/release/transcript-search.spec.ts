/**
 * Transcript search (AUN-CAPTIONS §5.10), on the local stack.
 *
 * For each language a new creator has two videos, one public and one private, and publishes the
 * same caption track on both: a phrase nobody else uses, said 1 min 15 s in. Once the processor has
 * indexed the tracks (TranscriptIndexSync on the videos queue), the search API lists the public
 * video under `transcripts` with that start time and never the private one. The search page shows
 * it under "Said in videos" with the words marked, and the row opens the watch page at `?t=75`.
 * Everything is this spec's own, removed by the data scope afterwards (a deleted video's passages go
 * with its search row).
 */
import { expect } from '@playwright/test';
import { test, ns } from './builders';
import { target } from './targets';
import { apiFetch, gotoSettled, type Locale } from './web-session';

// Signs users up through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

const LOCALES: Locale[] = ['en', 'ar'];
const HEADING: Record<Locale, string> = { en: 'Said in videos', ar: 'قيل في المرئيات' };

type Match = { videoId: string; startMs: number; text: string };

test.describe('transcript search', () => {
  for (const locale of LOCALES) {
    test(`search finds where a video says it and opens it there (${locale})`, async ({ browser, ownData }) => {
      test.setTimeout(240000);
      const creator = await ownData.createCreator(browser, `tsr-${locale}`, { locale });
      const channelId = creator.channelIds[0]!;
      // Letters only: one word the index keeps whole, unique to this run
      const word = `zephyr${Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]!)}`;
      const phrase = `patience is the key to ${word}`;
      const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:04.000', `Welcome ${ns()}`, '', '00:01:15.000 --> 00:01:19.000', phrase, ''].join('\n');

      const shown = await ownData.createVideo(creator.user, channelId, { title: `Friday reminder ${ns()} ${Date.now().toString(36)}` });
      const hidden = await ownData.createVideo(creator.user, channelId, { title: `Private reminder ${ns()} ${Date.now().toString(36)}`, isPublic: false, waitReady: false });
      for (const video of [shown, hidden]) {
        const form = new FormData();
        form.append('file', new Blob([vtt], { type: 'text/vtt' }), 'en.vtt');
        form.append('language', 'en');
        form.append('label', 'English');
        const res = await apiFetch(creator.user, `/api/videos/${video.id}/subtitles`, { method: 'POST', headers: { channelId }, body: form });
        expect(res.ok, `upload captions: ${await res.clone().text()}`).toBe(true);
      }

      // The processor indexes the tracks from the queue; the API then lists the public video only
      let matches: Match[] = [];
      await expect
        .poll(
          async () => {
            const res = await fetch(`${target().api}/api/search?q=${encodeURIComponent(word)}`);
            matches = ((await res.json()) as { transcripts?: Match[] }).transcripts ?? [];
            return matches.map((m) => m.videoId);
          },
          { timeout: 90000, intervals: [2000] },
        )
        .toEqual([shown.id]);
      expect(matches[0]).toMatchObject({ startMs: 75000, text: phrase });
      expect(matches.some((m) => m.videoId === hidden.id)).toBe(false);

      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width: 1280, height: 900 });
        await gotoSettled(page, `${target().web}/${locale}/search?q=${encodeURIComponent(word)}`);
        const section = page.getByTestId('search-transcripts');
        await expect(section).toBeVisible({ timeout: 30000 });
        await expect(section.getByRole('heading', { name: HEADING[locale] })).toBeVisible();
        const row = section.locator(`[data-testid="search-transcript"][data-video-id="${shown.id}"]`);
        await expect(row).toBeVisible();
        await expect(section.locator(`[data-video-id="${hidden.id}"]`)).toHaveCount(0);
        await expect(row.locator('mark')).toHaveText(word);
        const link = row.getByRole('link');
        await expect(link).toHaveAttribute('href', `/${locale}/video/${shown.id}?t=75`);
        await link.click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/video/${shown.id}\\?t=75$`));
      } finally {
        await context.close();
      }
    });
  }
});
