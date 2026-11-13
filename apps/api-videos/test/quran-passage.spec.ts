/**
 * GET /api/quran/passage (AUN-CAPTIONS): the official text of a range from our QF copy in the
 * private media bucket; never served once the copy is over 7 days old. Fixture data only.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QURAN_CURRENT_KEY, quranTextKey } from '@al-ummah/shared-types';
import { QuranPassageGet } from '../src/endpoints/quran/quranPassageGet';
import { clearQuranCopyCache } from '../src/lib/quran/copy';
import { MemoryBucket, buildApp } from './helpers';

const VERSION = '20261113T034100Z';

function env(syncedAt: string | null = new Date().toISOString()) {
	const MEDIA_PRIVATE = new MemoryBucket();
	if (syncedAt) MEDIA_PRIVATE.store.set(QURAN_CURRENT_KEY, JSON.stringify({ v: 1, version: VERSION, syncedAt, builtAt: syncedAt, surahs: 114, words: 77429 }));
	MEDIA_PRIVATE.store.set(
		quranTextKey(VERSION, 112),
		JSON.stringify({
			v: 1,
			surah: 112,
			name: { ar: 'الإخلاص', simple: 'Al-Ikhlas' },
			ayat: [
				{ text: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ', words: ['قُلْ', 'هُوَ', 'ٱللَّهُ', 'أَحَدٌ'] },
				{ text: 'ٱللَّهُ ٱلصَّمَدُ', words: ['ٱللَّهُ', 'ٱلصَّمَدُ'] },
				{ text: 'لَمْ يَلِدْ وَلَمْ يُولَدْ', words: ['لَمْ', 'يَلِدْ', 'وَلَمْ', 'يُولَدْ'] },
				{ text: 'وَلَمْ يَكُن لَّهُۥ كُفُوًا أَحَدٌۢ', words: ['وَلَمْ', 'يَكُن', 'لَّهُۥ', 'كُفُوًا', 'أَحَدٌۢ'] },
			],
		}),
	);
	return { MEDIA_PRIVATE };
}
const get = (e: ReturnType<typeof env>, range: string) =>
	buildApp((r) => r.get('/api/quran/passage', QuranPassageGet)).request(`/api/quran/passage?range=${encodeURIComponent(range)}`, {}, e as never);

beforeEach(() => clearQuranCopyCache());

describe('the Quran passage', () => {
	it('whole ayat verbatim, a partial ayah by word, with the label, link and attribution', async () => {
		const res = await get(env(), '112:1:1-112:2:1');
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
		const body = (await res.json()) as any;
		assert.deepEqual(body.ayat, [
			{ ayah: 1, text: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ', partial: false },
			{ ayah: 2, text: 'ٱللَّهُ', partial: true },
		]);
		assert.equal(body.label, '112:1–2');
		assert.equal(body.quranComUrl, 'https://quran.com/112/1-2');
		assert.deepEqual(body.surah, { number: 112, nameArabic: 'الإخلاص', nameSimple: 'Al-Ikhlas' });
		assert.match(body.attribution.en, /Quran Foundation \(quran\.com\)/);
		assert.equal(body.version, VERSION);
	});

	it('a malformed range is 400; a range the Quran does not have is 404', async () => {
		assert.equal((await get(env(), '112:1')).status, 400);
		assert.equal((await get(env(), '112:4:1-112:5:1')).status, 404);
		assert.equal((await get(env(), '112:4:1-112:4:6')).status, 404);
		assert.equal((await get(env(), '113:1:1-113:1:2')).status, 404, 'not in the copy');
	});

	it('no copy, or a copy not synced for 7 days, is never served (503)', async () => {
		assert.equal((await get(env(null), '112:1:1-112:1:4')).status, 503);
		clearQuranCopyCache();
		const stale = new Date(Date.now() - 8 * 24 * 3600_000).toISOString();
		const res = await get(env(stale), '112:1:1-112:1:4');
		assert.equal(res.status, 503);
		assert.equal(res.headers.get('retry-after'), '3600');
	});
});
