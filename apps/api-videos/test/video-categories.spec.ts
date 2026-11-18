/**
 * Admin-managed video categories (migration 0050, shared-types video-categories.ts):
 * the seed equals the built-in list, the loader caches and falls back, retired
 * categories leave pickers/Explore/AI but keep their label, writes refuse
 * unknown and retired categories (a video keeps the one it has), the AI prompt
 * and mapping follow the live list, and a rename swaps labels in the index text.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_VIDEO_CATEGORY_ENTRIES,
	VIDEO_CATEGORIES,
	activeCategoryFingerprint,
	categoryAssignability,
	categoryInputHash,
	categorySystemPrompt,
	getActiveVideoCategories,
	getVideoCategories,
	loadVideoCategories,
	mapCategory,
	relabelCategoryPage,
	resetVideoCategories,
	setVideoCategories,
	slugFromLabel,
	syncSearchDocument,
	validateCategoryFields,
	videoCategoryLabel,
	type SearchDb,
	type VideoCategoryEntry,
} from '@al-ummah/shared-types';
import { Hono } from 'hono';
import { handleInvalidateCategories, handleListCategories, videoCategoriesMiddleware } from '../src/lib/categories';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { VideoBulkUpdate } from '../src/endpoints/video/videoBulkUpdate';
import { nonEmptyCategories } from '../src/lib/search/explore';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const NEW: VideoCategoryEntry = { value: 'seerah_kids', label: { en: 'Seerah for kids', ar: 'السيرة للأطفال' }, position: 5, retired: false, hint: 'stories of the Prophet told for children' };
const withChanges = () => DEFAULT_VIDEO_CATEGORY_ENTRIES.map((c) => (c.value === 'islamic_news' ? { ...c, retired: true } : c)).concat(NEW);

afterEach(() => resetVideoCategories());

describe('video categories: seed and loader', () => {
	it('migration 0050 seeds exactly the built-in list, in its order, all active', async () => {
		const db = new SqliteD1() as unknown as SearchDb;
		const list = await loadVideoCategories(db, { force: true });
		assert.deepEqual(list.map((c) => c.value), VIDEO_CATEGORIES.map((c) => c.value));
		assert.deepEqual(list.map((c) => c.label), VIDEO_CATEGORIES.map((c) => ({ en: c.label.en, ar: c.label.ar })));
		assert.ok(list.every((c) => !c.retired && !!c.hint));
	});

	it('reads D1 at most once per minute, and keeps the last good list when D1 fails', async () => {
		const sqlite = new SqliteD1();
		sqlite.db.exec("UPDATE video_categories SET label_en = 'Jurisprudence' WHERE value = 'fiqh'");
		const db = sqlite as unknown as SearchDb;
		await loadVideoCategories(db, { now: 1_000 });
		assert.equal(videoCategoryLabel('fiqh', 'en'), 'Jurisprudence');
		sqlite.db.exec("UPDATE video_categories SET label_en = 'Fiqh rulings' WHERE value = 'fiqh'");
		await loadVideoCategories(db, { now: 30_000 });
		assert.equal(videoCategoryLabel('fiqh', 'en'), 'Jurisprudence', 'cached for a minute');
		await loadVideoCategories(db, { now: 62_000 });
		assert.equal(videoCategoryLabel('fiqh', 'en'), 'Fiqh rulings');
		const broken = { prepare() { throw new Error('D1 down'); }, batch: async () => [] } as unknown as SearchDb;
		await loadVideoCategories(broken, { now: 200_000 });
		assert.equal(videoCategoryLabel('fiqh', 'en'), 'Fiqh rulings');
	});

	it('a request never awaits another request\'s read (Workers refuse cross-request promises)', async () => {
		// prod 2026-11-18: concurrent requests shared one pending D1 read; when its request ended
		// the others failed with "This promise was created by a request that has since ended"
		const sqlite = new SqliteD1();
		await loadVideoCategories(sqlite as unknown as SearchDb, { now: 1_000 });
		let release!: () => void;
		let reads = 0;
		const slow = {
			prepare: (sql: string) => {
				reads++;
				const stmt = (sqlite as unknown as SearchDb).prepare(sql);
				return { all: async () => { await new Promise<void>((r) => (release = r)); return stmt.all(); } };
			},
			batch: async () => [],
		} as unknown as SearchDb;
		const first = loadVideoCategories(slow, { now: 70_000 });
		// A second request while the first one refreshes gets the list this isolate has, at once
		const second = await loadVideoCategories(slow, { now: 70_001 });
		assert.equal(second.length, VIDEO_CATEGORIES.length);
		assert.equal(reads, 1);
		release();
		await first;
	});

	it('cold isolate: concurrent first loads each read D1 (no shared pending promise)', async () => {
		const sqlite = new SqliteD1();
		let reads = 0;
		const counting = { prepare: (sql: string) => { reads++; return (sqlite as unknown as SearchDb).prepare(sql); }, batch: async () => [] } as unknown as SearchDb;
		await Promise.all([loadVideoCategories(counting, { now: 1_000 }), loadVideoCategories(counting, { now: 1_000 })]);
		assert.equal(reads, 2);
	});

	it('an empty table falls back to the built-in list', async () => {
		const sqlite = new SqliteD1();
		sqlite.db.exec('DELETE FROM video_categories');
		await loadVideoCategories(sqlite as unknown as SearchDb, { force: true });
		assert.equal(getVideoCategories().length, VIDEO_CATEGORIES.length);
	});
});

describe('video categories: retired and new', () => {
	it('a retired category leaves the active list and Explore but keeps its label', () => {
		setVideoCategories(withChanges());
		assert.ok(!getActiveVideoCategories().some((c) => c.value === 'islamic_news'));
		assert.equal(videoCategoryLabel('islamic_news', 'ar'), 'أخبار إسلامية');
		assert.equal(getActiveVideoCategories()[0]!.value, 'seerah_kids', 'ordered by position');
		const tiles = nonEmptyCategories(new Map([['islamic_news', 3], ['seerah_kids', 2], ['fiqh', 1]]));
		assert.deepEqual(tiles.map((t) => t.value), ['seerah_kids', 'fiqh']);
	});

	it('assignability: active ok, unknown refused, retired only when the item already has it', () => {
		setVideoCategories(withChanges());
		assert.equal(categoryAssignability('seerah_kids'), 'ok');
		assert.equal(categoryAssignability('made_up'), 'unknown');
		assert.equal(categoryAssignability('islamic_news'), 'retired');
		assert.equal(categoryAssignability('islamic_news', 'islamic_news'), 'ok');
	});

	it('the AI prompt lists only active categories with their hints; answers map onto active ones', async () => {
		setVideoCategories(withChanges());
		const prompt = categorySystemPrompt();
		assert.match(prompt, /- seerah_kids: Seerah for kids \/ السيرة للأطفال: stories of the Prophet told for children/);
		assert.doesNotMatch(prompt, /islamic_news/);
		assert.equal(mapCategory('Seerah for kids'), 'seerah_kids');
		assert.equal(mapCategory('islamic_news'), null);
		assert.equal(mapCategory('news'), null, 'an alias of a retired category maps to nothing');
		assert.equal(mapCategory('tafseer'), 'quran_tafsir');
	});

	it('the AI result cache key changes with the active list only', async () => {
		const before = await categoryInputHash('Title: x');
		assert.equal(activeCategoryFingerprint(), '');
		setVideoCategories(DEFAULT_VIDEO_CATEGORY_ENTRIES.map((c) => ({ ...c, label: { ...c.label, en: `${c.label.en}!` } })));
		assert.equal(await categoryInputHash('Title: x'), before, 'a rename keeps cached answers');
		setVideoCategories(withChanges());
		assert.notEqual(await categoryInputHash('Title: x'), before);
	});

	it('field checks and slug suggestions', () => {
		assert.deepEqual(validateCategoryFields({ value: 'seerah_kids', labelEn: 'Seerah', labelAr: 'السيرة' }, true), {});
		assert.deepEqual(validateCategoryFields({ value: 'Bad Slug', labelEn: '', labelAr: 'x'.repeat(61) }, true), { value: 'invalid_slug', labelEn: 'required', labelAr: 'too_long' });
		assert.deepEqual(validateCategoryFields({ labelEn: 'Only English' }, false), {});
		assert.equal(slugFromLabel('Hajj & Umrah: a guide'), 'hajj_and_umrah_a_guide');
		assert.equal(slugFromLabel('2024 Ramadan'), 'ramadan');
		assert.equal(slugFromLabel('  Seerah for   kids '), 'seerah_for_kids');
		assert.equal(slugFromLabel('Café Fiqh'), 'cafe_fiqh');
		assert.equal(slugFromLabel('___'), '');
		assert.equal(slugFromLabel('x '.repeat(30)), 'x_x_x_x_x_x_x_x_x_x_x_x_x_x_x_x_x_x_x_x');
		assert.ok(!slugFromLabel('ab '.repeat(14)).endsWith('_'));
		// Linear on long separator runs (CodeQL js/polynomial-redos)
		const started = Date.now();
		assert.equal(slugFromLabel(`${'_'.repeat(1_000_000)}a`), '');
		assert.equal(slugFromLabel(`a${' '.repeat(1_000_000)}`), 'a');
		assert.ok(Date.now() - started < 500);
	});
});

describe('video categories: api-videos', () => {
	function listApp() {
		const app = new Hono();
		app.use('*', videoCategoriesMiddleware);
		app.get('/api/categories', handleListCategories);
		app.post('/internal/categories/invalidate', handleInvalidateCategories);
		return app;
	}

	it('GET /api/categories lists every category with retired flags, cacheable for a minute; invalidate reloads', async () => {
		const sqlite = new SqliteD1();
		const env = { SEARCH_DB: sqlite } as never;
		const res = await listApp().request('/api/categories', {}, env);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
		const body = (await res.json()) as { result: { categories: Array<{ value: string; retired: boolean; label: { en: string } }> } };
		assert.equal(body.result.categories.length, VIDEO_CATEGORIES.length);
		assert.ok(!('hint' in body.result.categories[0]!));

		sqlite.db.exec("UPDATE video_categories SET retired = 1 WHERE value = 'ramadan'");
		await listApp().request('/internal/categories/invalidate', { method: 'POST' }, env);
		const after = (await (await listApp().request('/api/categories', {}, env)).json()) as typeof body;
		assert.equal(after.result.categories.find((c) => c.value === 'ramadan')!.retired, true);
	});

	function app() {
		return buildApp((r: any) => {
			r.put('/api/videos/:id', VideoUpdate);
			r.post('/api/videos/bulk-update', VideoBulkUpdate);
		}, { userId: 'owner' });
	}
	const env = (videos: MemoryBucket) => ({ SEARCH_DB: new SqliteD1(), MODERATION_QUEUE: new MemoryQueue(), queue: new MemoryQueue(), videos }) as any;
	const put = (e: unknown, body: unknown) => app().request('/api/videos/v1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, e as never);

	it('PUT /api/videos/:id takes a new admin-made category, refuses unknown and retired ones, and keeps a retired one the video has', async () => {
		setVideoCategories(withChanges());
		const videos = new MemoryBucket({ v1: videoFixture({ id: 'v1', userId: 'owner', category: 'islamic_news', categorySource: 'uploader' }) });
		const e = env(videos);

		const keep = await put(e, { title: 'Renamed', category: 'islamic_news' });
		assert.equal(keep.status, 200);
		assert.equal(videos.read('v1').category, 'islamic_news');

		const unknown = await put(e, { category: 'made_up' });
		assert.equal(unknown.status, 400);
		assert.equal(((await unknown.json()) as any).code, 'unknown_category');

		const moved = await put(e, { category: 'seerah_kids' });
		assert.equal(moved.status, 200);
		assert.equal(videos.read('v1').category, 'seerah_kids');

		const back = await put(e, { category: 'islamic_news' });
		assert.equal(back.status, 400);
		assert.equal(((await back.json()) as any).code, 'retired_category');
	});
});

describe('video categories: rename in the search index', () => {
	it('relabelCategoryPage swaps the old labels for the new ones in the index text of that category only', async () => {
		const sqlite = new SqliteD1();
		const db = sqlite as unknown as SearchDb;
		const video = (id: string, category: string) => videoFixture({ id, title: `Video ${id}`, description: 'A talk', category, isPublic: true, visibility: 'public' });
		await syncSearchDocument(db, 'video', 'a', video('a', 'fiqh'), { version: 1 });
		await syncSearchDocument(db, 'video', 'b', video('b', 'aqeedah'), { version: 1 });
		const bodyOf = (id: string) => (sqlite.db.prepare('SELECT f.body AS body FROM search_videos_fts f JOIN search_videos v ON v.rowid = f.rowid WHERE v.id = ?').get(id) as { body: string } | undefined)?.body ?? '';
		assert.match(bodyOf('a'), /fiqh/);

		const next = await relabelCategoryPage(db, { category: 'fiqh', entity: 'video', from: { en: 'Fiqh', ar: 'الفقه' }, to: { en: 'Jurisprudence', ar: 'أحكام الفقه' } });
		assert.equal(next, null);
		assert.match(bodyOf('a'), /jurisprudence/);
		assert.doesNotMatch(bodyOf('a'), /(^| )fiqh( |$)/);
		assert.doesNotMatch(bodyOf('b'), /jurisprudence/);
		const hits = sqlite.db.prepare("SELECT v.id AS id FROM search_videos_fts f JOIN search_videos v ON v.rowid = f.rowid WHERE search_videos_fts MATCH 'jurisprudence'").all() as Array<{ id: string }>;
		assert.deepEqual(hits.map((h) => h.id), ['a']);
	});
});
