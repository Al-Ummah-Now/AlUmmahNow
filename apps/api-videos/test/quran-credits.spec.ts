/**
 * GET /api/quran/credits (QF 2026-11-23): QF's full attribution line and every translation edition
 * in use, generated from the shipped defaults, the platform's picks and the channels' picks, named
 * as QF's catalogue gives them. Fixture editions only: no call to Quran Foundation.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QURAN_CURRENT_KEY } from '@al-ummah/shared-types';
import { QuranCreditsGet, editionsInUse } from '../src/endpoints/quran/quranCredits';
import { clearQuranCopyCache } from '../src/lib/quran/copy';
import { MemoryBucket, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const NOW = new Date().toISOString();

function env(opts: { text?: boolean; editions?: boolean } = {}) {
	const MEDIA_PRIVATE = new MemoryBucket();
	if (opts.text !== false) MEDIA_PRIVATE.store.set(QURAN_CURRENT_KEY, JSON.stringify({ v: 1, version: 'v1', syncedAt: NOW, builtAt: NOW, surahs: 114, words: 77429 }));
	return { MEDIA_PRIVATE, SEARCH_DB: new SqliteD1() as unknown as D1Database, ...(opts.editions === false ? {} : { QURAN_PROVIDER: 'fixture' }) };
}

const get = (e: ReturnType<typeof env>) => buildApp((r) => r.get('/api/quran/credits', QuranCreditsGet)).request('/api/quran/credits', {}, e as never);

beforeEach(() => clearQuranCopyCache());

describe('Quran credits', () => {
	it("QF's full line, the short credit and the shipped default edition with its translator", async () => {
		const res = await get(env());
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
		const { data } = (await res.json()) as any;
		assert.equal(data.attribution.en, 'Quran data provided by Quran Foundation (https://quran.foundation/)');
		assert.equal(data.attribution.ar, 'بيانات القرآن مقدَّمة من مؤسسة القرآن (https://quran.foundation/‎)');
		assert.deepEqual(data.credit, { en: 'Source: Quran Foundation', ar: 'المصدر: مؤسسة القرآن', url: 'https://quran.foundation/' });
		assert.equal(data.quranText, true);
		assert.deepEqual(data.editions, [{ id: 20, name: 'Saheeh International', author: 'Saheeh International', language: 'en' }]);
	});

	it('lists the platform and every channel pick once, from what is configured, never hand-typed', async () => {
		const e = env();
		const d1 = e.SEARCH_DB;
		await d1.prepare("INSERT INTO quran_translation_defaults (lang, qf_translation_id, name, updated_by, updated_at) VALUES ('fr', 31, 'Muhammad Hamidullah', 'admin', ?)").bind(NOW).run();
		for (const ch of ['c1', 'c2']) {
			await d1.prepare("INSERT INTO channel_quran_translations (channel_id, lang, qf_translation_id, name, updated_by, updated_at) VALUES (?, 'en', 85, 'M.A.S. Abdel Haleem', 'alice', ?)").bind(ch, NOW).run();
		}
		const { data } = (await (await get(e)).json()) as any;
		assert.deepEqual(
			data.editions.map((x: { id: number; author?: string; language: string }) => [x.language, x.id, x.author]),
			[
				['en', 85, 'Abdel Haleem'],
				['en', 20, 'Saheeh International'],
				['fr', 31, 'Hamidullah'],
			],
		);
	});

	it('QF unreachable: the stored names stand, with no invented translator', () => {
		const list = editionsInUse([{ lang: 'ur', qf_translation_id: 97, name: 'Tafheem e Quran' }], null);
		assert.deepEqual(list.find((x) => x.id === 97), { id: 97, name: 'Tafheem e Quran', language: 'ur' });
	});

	it('only the official text (no editions configured): the attribution, no editions', async () => {
		const { data } = (await (await get(env({ editions: false }))).json()) as any;
		assert.equal(data.quranText, true);
		assert.deepEqual(data.editions, []);
	});

	it('no Quran text from QF here at all: 404 feature_off, so the page and its link stay hidden', async () => {
		const res = await get(env({ text: false, editions: false }));
		assert.equal(res.status, 404);
		assert.equal(((await res.json()) as any).code, 'feature_off');
	});
});
