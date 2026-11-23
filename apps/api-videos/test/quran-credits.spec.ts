/**
 * GET /api/quran/credits (QF 2026-11-23): QF's full attribution line and every translation edition
 * in use, generated from the shipped defaults, the platform's picks and the channels' picks, named
 * as QF's catalogue gives them. Fixture editions only: no call to Quran Foundation.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QURAN_CURRENT_KEY, writeFeatureSwitch } from '@al-ummah/shared-types';
import { QuranCreditsGet, editionsInUse, invalidateQuranCreditsCache } from '../src/endpoints/quran/quranCredits';
import { ChannelQuranTranslationReset, ChannelQuranTranslationSet } from '../src/endpoints/quran/quranTranslations';
import { forgetFeatureCaches } from '../src/lib/features';
import { clearQuranCopyCache } from '../src/lib/quran/copy';
import { MemoryBucket, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const NOW = new Date().toISOString();

function env(opts: { text?: boolean; editions?: boolean; forceOff?: string; channels?: MemoryBucket } = {}) {
	const MEDIA_PRIVATE = new MemoryBucket();
	if (opts.text !== false) MEDIA_PRIVATE.store.set(QURAN_CURRENT_KEY, JSON.stringify({ v: 1, version: 'v1', syncedAt: NOW, builtAt: NOW, surahs: 114, words: 77429 }));
	const sqlite = new SqliteD1();
	return {
		MEDIA_PRIVATE,
		SEARCH_DB: sqlite as unknown as D1Database,
		sqlite,
		...(opts.channels ? { channels: opts.channels } : {}),
		...(opts.editions === false ? {} : { QURAN_PROVIDER: 'fixture' }),
		...(opts.forceOff ? { FEATURES_FORCE_OFF: opts.forceOff } : {}),
	};
}

const get = (e: ReturnType<typeof env>) => buildApp((r) => r.get('/api/quran/credits', QuranCreditsGet)).request('/api/quran/credits', {}, e as never);

beforeEach(async () => {
	clearQuranCopyCache();
	forgetFeatureCaches();
	await invalidateQuranCreditsCache();
});
afterEach(async () => {
	clearQuranCopyCache();
	forgetFeatureCaches();
	await invalidateQuranCreditsCache();
});

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

	it('respects the quranEditions admin switch: hides editions when off, 404 feature_off when text is also off', async () => {
		const withText = env();
		await writeFeatureSwitch(withText as never, { key: 'quranEditions', enabled: false, expectedVersion: 0, actorId: 'admin-1' });
		forgetFeatureCaches();
		const res1 = await get(withText);
		assert.equal(res1.status, 200);
		const body1 = (await res1.json()) as any;
		assert.equal(body1.data.quranText, true);
		assert.deepEqual(body1.data.editions, []);

		const noText = env({ text: false });
		await writeFeatureSwitch(noText as never, { key: 'quranEditions', enabled: false, expectedVersion: 0, actorId: 'admin-1' });
		clearQuranCopyCache();
		forgetFeatureCaches();
		const res2 = await get(noText);
		assert.equal(res2.status, 404);
		assert.equal(((await res2.json()) as any).code, 'feature_off');

		// Forced-off env switch behaves identically
		clearQuranCopyCache();
		forgetFeatureCaches();
		const res3 = await get(env({ text: false, forceOff: 'quranEditions' }));
		assert.equal(res3.status, 404);
		assert.equal(((await res3.json()) as any).code, 'feature_off');
	});

	it('uses the covering index on channel_quran_translations (no full table scan or temp B-tree)', async () => {
		const e = env();
		const plan = e.sqlite.plan({
			sql: 'SELECT DISTINCT lang, qf_translation_id, name FROM channel_quran_translations',
			params: [],
		});
		const joined = plan.join(' | ');
		assert.match(joined, /USING COVERING INDEX idx_channel_quran_translations_edition/, joined);
		assert.doesNotMatch(joined, /USE TEMP B-TREE FOR DISTINCT/i, joined);
	});

	it('caches edition rows across requests and invalidates when a channel sets or resets its translation', async () => {
		const channels = new MemoryBucket({ ch1: { id: 'ch1', userId: 'alice', members: [] } });
		const e = env({ channels });
		const app = buildApp(
			(r) => {
				r.get('/api/quran/credits', QuranCreditsGet);
				r.put('/api/channels/:channelId/quran-translations/:language', ChannelQuranTranslationSet);
				r.delete('/api/channels/:channelId/quran-translations/:language', ChannelQuranTranslationReset);
			},
			{ userId: 'alice' },
		);

		// First request populates the cache
		const first = (await (await app.request('/api/quran/credits', {}, e as never)).json()) as any;
		assert.deepEqual(first.data.editions.map((x: { id: number }) => x.id), [20]);
		const queriesAfterFirst = e.sqlite.queries;

		// Second request is served from cache without hitting D1
		const second = (await (await app.request('/api/quran/credits', {}, e as never)).json()) as any;
		assert.deepEqual(second.data.editions.map((x: { id: number }) => x.id), [20]);
		assert.equal(e.sqlite.queries, queriesAfterFirst, 'second credits read should not re-query D1');

		// Channel picks edition 85: cache is invalidated and next credits read sees 85
		const setRes = await app.request(
			'/api/channels/ch1/quran-translations/en',
			{ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 85 }) },
			e as never,
		);
		assert.equal(setRes.status, 200);
		const afterSet = (await (await app.request('/api/quran/credits', {}, e as never)).json()) as any;
		assert.deepEqual(afterSet.data.editions.map((x: { id: number }) => x.id), [85, 20]);

		// Channel resets its pick: cache is invalidated again and 85 disappears
		const resetRes = await app.request('/api/channels/ch1/quran-translations/en', { method: 'DELETE' }, e as never);
		assert.equal(resetRes.status, 200);
		const afterReset = (await (await app.request('/api/quran/credits', {}, e as never)).json()) as any;
		assert.deepEqual(afterReset.data.editions.map((x: { id: number }) => x.id), [20]);
	});

	it('populates and invalidates Cloudflare Cache API (caches.default) when available', async () => {
		const store = new Map<string, Response>();
		const fakeDefault = {
			async match(req: Request) {
				const hit = store.get(req.url);
				return hit ? hit.clone() : undefined;
			},
			async put(req: Request, res: Response) {
				store.set(req.url, res.clone());
			},
			async delete(req: Request) {
				return store.delete(req.url);
			},
		};
		const prevCaches = (globalThis as { caches?: unknown }).caches;
		(globalThis as { caches?: unknown }).caches = { default: fakeDefault };
		try {
			const e = env();
			await e.SEARCH_DB.prepare("INSERT INTO channel_quran_translations (channel_id, lang, qf_translation_id, name, updated_by, updated_at) VALUES ('c1', 'en', 85, 'M.A.S. Abdel Haleem', 'alice', ?)").bind(NOW).run();
			const first = (await (await get(e)).json()) as any;
			assert.deepEqual(first.data.editions.map((x: { id: number }) => x.id), [85, 20]);
			assert.equal(store.size, 1, 'edge cache should be populated');

			// Fresh D1 instance (bypasses isolateRowsCache) still gets edge-cached rows without querying D1
			const freshEnv = env();
			const qBefore = freshEnv.sqlite.queries;
			const fromEdge = (await (await get(freshEnv)).json()) as any;
			assert.deepEqual(fromEdge.data.editions.map((x: { id: number }) => x.id), [85, 20]);
			// Only feature_switches is queried on freshEnv (1 query), not channel_quran_translations / quran_translation_defaults
			assert.equal(freshEnv.sqlite.queries, qBefore + 1);

			await invalidateQuranCreditsCache();
			assert.equal(store.size, 0, 'invalidation should delete the edge cache entry');
		} finally {
			(globalThis as { caches?: unknown }).caches = prevCaches;
		}
	});
});
