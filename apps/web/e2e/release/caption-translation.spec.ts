/**
 * Transcript and title translation (AUN-CAPTIONS §3.3, §5.8, §5.9), on the local stack with the
 * fixture translator and fixture Quran Foundation editions (never paid AI).
 *
 * For each language a new creator with caption minutes (an "until used" grant, the stack's D1 fast
 * path) has a ready video with an Arabic source draft: one speech cue and one accepted Quran span
 * (Al-Ikhlas 1-2). In Studio they press Translate on the Arabic draft, pick English, see the cost and
 * confirm; the English draft appears labelled "Machine translation from Arabic". Published, the
 * served English track gives the Quran span in the channel's Quran Foundation edition (the default,
 * Saheeh International) with its name, never machine-translated, and the watch page's caption menu
 * lists it as a machine translation. The title's Translate button fills the Arabic title with a
 * suggestion to review. A viewer of the other language sees the title auto-translated, labelled, with
 * "Show original" (O6); the English page shows the creator's title.
 * Everything is this spec's own, removed by the data scope afterwards.
 */
import { expect } from '@playwright/test';
import { test, ns } from './builders';
import { target } from './targets';
import { apiFetch, gotoSettled, type Locale } from './web-session';
import { confirmInApp, webConfirm } from './in-app-confirm';

// Signs users up through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

const LOCALES: Locale[] = ['en', 'ar'];
const LOCAL_CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
const MACHINE_FROM: Record<Locale, string> = { en: 'Machine translation from Arabic', ar: 'ترجمة آلية من العربية' };
const MACHINE_LABEL: Record<Locale, string> = { en: 'machine translation', ar: 'ترجمة آلية' };
const REVIEW_HINT: Record<Locale, string> = { en: 'Machine translation: review it before saving.', ar: 'ترجمة آلية: راجعها قبل الحفظ.' };

async function stackSql(sql: string): Promise<void> {
  const res = await fetch(`${LOCAL_CONTROL}/__stack/d1/al-ummah-now-search`, { method: 'POST', body: sql });
  expect(res.ok, `local stack SQL: ${await res.clone().text()}`).toBe(true);
}

test.describe('caption and title translation', () => {
  for (const locale of LOCALES) {
    test(`Studio translates a transcript and a title; Quran stays in its edition (${locale})`, async ({ browser, ownData }) => {
      test.setTimeout(300000);
      const creator = await ownData.createCreator(browser, `ctr-${locale}`, { locale });
      const channelId = creator.channelIds[0]!;
      const userId = creator.user.userId.replace(/[^A-Za-z0-9_:-]/g, '');
      // Caption minutes: the shipped tiers start at 0, the admin grants them (erased with the user)
      await stackSql(
        `INSERT INTO caption_minute_grants (id, user_id, minutes, scope, period, reason, created_by, created_at) VALUES ('e2e-${userId}-${Date.now()}', '${userId}', 30, 'until_used', NULL, 'e2e ${ns()}', 'e2e', '${new Date().toISOString()}')`,
      );
      const video = await ownData.createVideo(creator.user, channelId, { title: `Tafsir of Al-Ikhlas ${ns()} ${Date.now().toString(36)}` });

      // The Arabic source draft (what a transcription leaves): speech, then an accepted Quran span
      const now = new Date().toISOString();
      const draft = {
        v: 1,
        videoId: video.id,
        language: 'ar',
        version: 1,
        kind: 'source',
        origin: 'transcription',
        edited: false,
        machine: { provider: 'fixture' },
        cues: [
          { id: 'c1', startMs: 0, endMs: 3000, segments: [{ type: 'speech', text: 'بسم الله نبدأ الدرس' }] },
          { id: 'c2', startMs: 3000, endMs: 9000, segments: [{ type: 'quran', range: '112:1:1-112:2:2', status: 'accepted' }] },
        ],
        createdAt: now,
        updatedAt: now,
        updatedBy: creator.user.userId,
      };
      const seeded = await fetch(`${LOCAL_CONTROL}/__stack/r2/subtitles/${video.id}/drafts/ar.json`, { method: 'PUT', body: JSON.stringify(draft) });
      expect(seeded.ok, `seed draft: ${await seeded.clone().text()}`).toBe(true);

      const context = await browser.newContext({ storageState: creator.state });
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width: 1280, height: 900 });
        await gotoSettled(page, `${target().web}/${locale}/studio/video/${video.id}/edit`);

        // Translate the Arabic draft into English: the cost is shown before it starts
        const source = page.locator('[data-testid="caption-draft"][data-language="ar"]');
        await expect(source).toBeVisible({ timeout: 60000 });
        await source.getByTestId('caption-draft-translate').click();
        const form = page.getByTestId('caption-translate');
        await form.getByTestId('caption-translate-lang-en').check({ force: true });
        await expect(form.getByTestId('caption-translate-cost')).toContainText('2');
        await form.getByTestId('caption-translate-action').click();
        await confirmInApp(page, webConfirm('confirm-dialog'));

        // The English draft arrives, labelled as a machine translation of the Arabic one
        const english = page.locator('[data-testid="caption-draft"][data-language="en"]');
        await expect(async () => {
          await page.reload();
          await expect(english).toBeVisible({ timeout: 5000 });
        }).toPass({ timeout: 120000, intervals: [3000] });
        await expect(english).toContainText(MACHINE_FROM[locale]);

        // Publish it; the served track keeps Quran in the Quran Foundation edition, with its name
        const drafts = (await (await apiFetch(creator.user, `/api/videos/${video.id}/captions/drafts`)).json()) as { data?: { drafts?: Array<{ language: string; version: number; kind: string; sourceLanguage?: string }> } };
        const en = drafts.data?.drafts?.find((d) => d.language === 'en');
        expect(en, 'the English draft').toMatchObject({ kind: 'translation', sourceLanguage: 'ar' });
        const published = await apiFetch(creator.user, `/api/videos/${video.id}/captions/drafts/en/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', channelId },
          body: JSON.stringify({ baseVersion: en!.version }),
        });
        expect(published.status, `publish: ${await published.clone().text()}`).toBe(200);
        const list = (await (await fetch(`${target().api}/api/videos/${video.id}/subtitles`)).json()) as { data?: { tracks?: Array<{ language: string; machineTranslation?: boolean; sourceLanguage?: string }> } };
        expect(list.data?.tracks?.find((t) => t.language === 'en')).toMatchObject({ machineTranslation: true, sourceLanguage: 'ar' });
        const vtt = await (await fetch(`${target().api}/api/videos/${video.id}/subtitles/en`)).text();
        expect(vtt).toContain('[fixture translation 20 of 112:1]');
        expect(vtt).toContain('Saheeh International');
        expect(vtt).not.toContain('قل هو الله');

        // The title's Translate button: a suggestion for the empty Arabic title, to review before saving
        const titlePair = page.getByTestId('video-edit-title-pair');
        await titlePair.getByTestId('video-edit-title-pair-translate-ar').click();
        await expect(page.getByTestId('video-edit-title-ar')).not.toHaveValue('', { timeout: 30000 });
        await expect(titlePair.getByTestId('video-edit-title-pair-translate-note-ar')).toContainText(REVIEW_HINT[locale]);
        const usage = (await (await apiFetch(creator.user, '/api/translate/usage')).json()) as { data?: { enabled?: boolean; fairUse?: { used?: number } } };
        expect(usage.data).toMatchObject({ enabled: true, fairUse: { used: 1 } });

        // Viewers: the caption menu names the machine translation
        await gotoSettled(page, `${target().web}/${locale}/video/${video.id}`);
        await expect
          .poll(async () => page.evaluate(() => Array.from(document.querySelector('video')?.textTracks ?? []).map((t) => t.label)), { timeout: 60000 })
          .toContain(locale === 'ar' ? `الإنجليزية (${MACHINE_LABEL.ar})` : `English (${MACHINE_LABEL.en})`);
        if (locale === 'ar') {
          // The English title, auto-translated for an Arabic viewer (made once by the processor, then cached)
          const marker = page.getByTestId('watch-machine-translation');
          await expect(async () => {
            await page.reload();
            await expect(marker).toBeVisible({ timeout: 10000 });
          }).toPass({ timeout: 120000, intervals: [5000] });
          await expect(marker).toContainText('مترجم آليًا');
          await expect(page.getByTestId('watch-title')).toHaveAttribute('data-machine-translation', 'true');
          await page.getByTestId('watch-translation-toggle').click();
          await expect(page.getByTestId('watch-title')).toContainText('Tafsir of Al-Ikhlas');
        } else {
          await expect(page.getByTestId('watch-title')).toContainText('Tafsir of Al-Ikhlas');
          await expect(page.getByTestId('watch-machine-translation')).toHaveCount(0);
        }
      } finally {
        await context.close();
      }
    });
  }
});
