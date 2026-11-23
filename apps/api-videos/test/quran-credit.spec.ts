/**
 * QF's short credit next to captions (QF 2026-11-23): "Source: Quran Foundation", linked to
 * https://quran.foundation/. Served cues end with it in the track's language; the web player lifts it
 * out of the cue into a link (splitQuranCredit). Fixture text only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QURAN_CREDIT, QURAN_FOUNDATION_URL, captionQuranMarker, fillCaptionQuranMarkers, quranCreditFor, splitQuranCredit } from '@al-ummah/shared-types';

describe('QF short credit', () => {
	it('is QF’s wording in English and the site’s Arabic name for QF, linked to quran.foundation', () => {
		assert.equal(QURAN_CREDIT.en, 'Source: Quran Foundation');
		assert.equal(QURAN_CREDIT.ar, 'المصدر: مؤسسة القرآن');
		assert.equal(QURAN_FOUNDATION_URL, 'https://quran.foundation/');
		assert.equal(quranCreditFor('ar'), QURAN_CREDIT.ar);
		assert.equal(quranCreditFor('en-GB'), QURAN_CREDIT.en);
		assert.equal(quranCreditFor('fr'), QURAN_CREDIT.en);
	});

	it('ends each served cue that shows QF text, in the track’s language; a reference-only cue has none', async () => {
		const vtt = `WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\n${captionQuranMarker('112:1:1-112:1:4', 'text')}\n\n2\n00:00:02.000 --> 00:00:04.000\n${captionQuranMarker('112:2:1-112:2:2', 'reference')}\n`;
		const ar = await fillCaptionQuranMarkers(vtt, 'ar', async () => '﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾');
		const [cue1, cue2] = ar.split(/\n{2,}/).slice(1);
		assert.equal(cue1!.split('\n').at(-1), '‏المصدر: مؤسسة القرآن');
		assert.ok(!cue2!.includes('مؤسسة'));
		const en = await fillCaptionQuranMarkers(vtt, 'en', async () => '“Say, He is Allah, the One”');
		assert.equal(en.split(/\n{2,}/)[1]!.split('\n').at(-1), 'Source: Quran Foundation');
	});

	it('splitQuranCredit takes the credit line off a cue, the text untouched', () => {
		assert.deepEqual(splitQuranCredit('﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾ (الإخلاص ١١٢:١)\n‏المصدر: مؤسسة القرآن'), { text: '﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾ (الإخلاص ١١٢:١)', credited: true });
		assert.deepEqual(splitQuranCredit('line one\nline two\nSource: Quran Foundation'), { text: 'line one\nline two', credited: true });
		// The long line cues had before 2026-11-23, still in an edge cache
		assert.deepEqual(splitQuranCredit('text\nQuran data provided by Quran Foundation (https://quran.foundation/)'), { text: 'text', credited: true });
		// Speech that merely mentions it, or a cue that is only the words, is not a credit
		assert.deepEqual(splitQuranCredit('Source: Quran Foundation'), { text: 'Source: Quran Foundation', credited: false });
		assert.deepEqual(splitQuranCredit('the Source: Quran Foundation says\nmore'), { text: 'the Source: Quran Foundation says\nmore', credited: false });
	});
});
