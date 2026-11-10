/**
 * AI category suggestions, api-videos side: the form endpoints queue jobs
 * (never call a model), identical text is answered from the stored result,
 * owner writes confirm or replace an AI suggestion, uploads adopt the form's
 * suggestion, and Explore hides empty categories.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	MessageType,
	draftSubjectId,
	getCategorySuggestion,
	markCategorySuggestionPending,
	recordCategorySuggestionResult,
	type SearchDb,
} from '@al-ummah/shared-types';
import { CategorySuggestionGet, CategorySuggestionRequest } from '../src/endpoints/video/categorySuggestions';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { VideoBulkUpdate } from '../src/endpoints/video/videoBulkUpdate';
import { applyBulkChanges } from '../src/lib/bulkEdit';
import { adoptOrRequestSuggestion } from '../src/lib/categorySuggestions';
import { nonEmptyCategories } from '../src/lib/search/explore';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const settle = () => new Promise((r) => setTimeout(r, 30));
const DRAFT = 'upload-k1-abcdef';

function app(userId: string | null = 'owner') {
	return buildApp((r: any) => {
		r.post('/api/videos/category-suggestions', CategorySuggestionRequest);
		r.get('/api/videos/category-suggestions', CategorySuggestionGet);
		r.put('/api/videos/:id', VideoUpdate);
		r.post('/api/videos/bulk-update', VideoBulkUpdate);
	}, userId ? { userId } : null);
}

function env(extra: Record<string, unknown> = {}) {
	return { SEARCH_DB: new SqliteD1(), MODERATION_QUEUE: new MemoryQueue(), queue: new MemoryQueue(), videos: new MemoryBucket(), ...extra } as any;
}

const post = (e: any, body: unknown, userId: string | null = 'owner') =>
	app(userId).request('/api/videos/category-suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, e);

describe('POST /api/videos/category-suggestions', () => {
	it('queues a job for new text and answers 202 pending; the same text is not queued again', async () => {
		const e = env();
		const body = { draftKey: DRAFT, title: 'شرح حديث إنما الأعمال بالنيات', tags: ['حديث'] };
		const res = await post(e, body);
		assert.equal(res.status, 202);
		const json = (await res.json()) as any;
		assert.equal(json.result.status, 'pending');
		assert.equal(e.MODERATION_QUEUE.messages.length, 1);
		const message = e.MODERATION_QUEUE.messages[0];
		assert.equal(message.type, MessageType.CategorySuggest);
		assert.deepEqual(
			{ subjectId: message.payload.subjectId, subjectType: message.payload.subjectType, reason: message.payload.reason },
			{ subjectId: draftSubjectId('owner', DRAFT), subjectType: 'draft', reason: 'draft' },
		);
		assert.equal(message.payload.text.title, body.title);

		assert.equal((await post(e, body)).status, 202);
		assert.equal(e.MODERATION_QUEUE.messages.length, 1, 'same text, no second job');
	});

	it('answers at once from an earlier identical text (no job)', async () => {
		const e = env();
		const db = e.SEARCH_DB as SearchDb;
		const text = { draftKey: 'other-form-123', title: 'Tafsir of Surah Al-Kahf' };
		await post(e, text);
		// The processor finished the first form's job
		const first = draftSubjectId('owner', 'other-form-123');
		const row = await getCategorySuggestion(db, first);
		await recordCategorySuggestionResult(db, first, { status: 'done', inputHash: row!.input_hash, scores: [{ category: 'quran_tafsir' as any, confidence: 0.9 }], model: 'm', threshold: 0.6 });

		const res = await post(e, { ...text, draftKey: DRAFT });
		assert.equal(res.status, 200);
		const json = (await res.json()) as any;
		assert.deepEqual({ status: json.result.status, preselect: json.result.preselect, lowConfidence: json.result.lowConfidence }, { status: 'done', preselect: 'quran_tafsir', lowConfidence: false });
		assert.equal(e.MODERATION_QUEUE.messages.length, 1);
	});

	it('empty text is answered without a job; unauthenticated is refused', async () => {
		const e = env();
		const res = await post(e, { draftKey: DRAFT, title: '   ', tags: [] });
		assert.equal(((await res.json()) as any).result.status, 'empty');
		assert.equal(e.MODERATION_QUEUE.messages.length, 0);
		assert.equal((await post(e, { draftKey: DRAFT, title: 'x' }, null)).status, 401);
	});

	it('a failed enqueue reports failed so the form stops waiting', async () => {
		const e = env({ MODERATION_QUEUE: { send: async () => { throw new Error('queue down'); } } });
		const res = await post(e, { draftKey: DRAFT, title: 'Fiqh of fasting' });
		assert.equal(res.status, 200);
		assert.equal(((await res.json()) as any).result.status, 'failed');
	});
});

describe('GET /api/videos/category-suggestions', () => {
	it('returns a form\'s suggestion and a video\'s only to its owner', async () => {
		const e = env({ videos: new MemoryBucket({ v1: videoFixture({ id: 'v1', userId: 'owner', category: 'fiqh', categorySource: 'ai' }) }) });
		const db = e.SEARCH_DB as SearchDb;
		await post(e, { draftKey: DRAFT, title: 'Something' });
		const draft = (await (await app().request(`/api/videos/category-suggestions?draftKey=${DRAFT}`, {}, e)).json()) as any;
		assert.equal(draft.result.status, 'pending');
		assert.equal((await app('intruder').request(`/api/videos/category-suggestions?draftKey=${DRAFT}`, {}, e)).status, 404);

		await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'backfill' });
		await recordCategorySuggestionResult(db, 'v1', { status: 'done', scores: [{ category: 'fiqh' as any, confidence: 0.4 }, { category: 'dawah' as any, confidence: 0.3 }], model: 'm', threshold: 0.6, applied: true });
		const video = (await (await app().request('/api/videos/category-suggestions?videoId=v1', {}, e)).json()) as any;
		assert.deepEqual({ categorySource: video.result.categorySource, lowConfidence: video.result.lowConfidence, options: video.result.options.length }, { categorySource: 'ai', lowConfidence: true, options: 2 });
		assert.equal((await app('intruder').request('/api/videos/category-suggestions?videoId=v1', {}, e)).status, 404);
		assert.equal((await app().request('/api/videos/category-suggestions', {}, e)).status, 400);
	});
});

describe('owner writes and uploads', () => {
	it('PUT /api/videos/:id: a category the owner saves is theirs and the outcome is recorded', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ id: 'v1', userId: 'owner', category: 'fiqh', categorySource: 'ai' }) });
		const e = env({ videos });
		const db = e.SEARCH_DB as SearchDb;
		await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'upload' });
		await recordCategorySuggestionResult(db, 'v1', { status: 'done', scores: [{ category: 'fiqh' as any, confidence: 0.9 }], model: 'm', applied: true });

		const res = await app().request('/api/videos/v1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'aqeedah' }) }, e);
		assert.equal(res.status, 200);
		await settle();
		assert.deepEqual({ category: videos.read('v1').category, categorySource: videos.read('v1').categorySource }, { category: 'aqeedah', categorySource: 'uploader' });
		assert.equal(((await res.json()) as any).result.video.categorySource, 'uploader');
		assert.deepEqual(await getCategorySuggestion(db, 'v1').then((r) => ({ outcome: r!.outcome, final: r!.final_category, by: r!.reviewed_by })), { outcome: 'changed', final: 'aqeedah', by: 'owner' });
	});

	it('PUT /api/videos/:id: new text without a person-chosen category re-requests a suggestion; with one it does not', async () => {
		const videos = new MemoryBucket({
			a: videoFixture({ id: 'a', userId: 'owner', title: 'Old', isPublic: false }),
			b: videoFixture({ id: 'b', userId: 'owner', title: 'Old', category: 'fiqh', categorySource: 'uploader' }),
		});
		const e = env({ videos });
		for (const id of ['a', 'b']) {
			await app().request(`/api/videos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Ruling on fasting while travelling' }) }, e);
		}
		await settle();
		const jobs = e.MODERATION_QUEUE.messages.filter((m: any) => m.type === MessageType.CategorySuggest);
		assert.deepEqual(jobs.map((m: any) => [m.payload.subjectId, m.payload.reason]), [['a', 'edit']]);
		assert.equal((await getCategorySuggestion(e.SEARCH_DB, 'a'))!.status, 'pending');
	});

	it('bulk edit: the owner\'s category replaces an AI suggestion; null clears both', () => {
		const now = '2026-11-09T00:00:00Z';
		const set = applyBulkChanges({ category: 'fiqh', categorySource: 'ai' as const }, { category: 'ramadan' }, now);
		assert.deepEqual(set.ok && { c: set.video.category, s: set.video.categorySource }, { c: 'ramadan', s: 'uploader' });
		const confirm = applyBulkChanges({ category: 'fiqh', categorySource: 'ai' as const }, { category: 'fiqh' }, now);
		assert.ok(confirm.ok && confirm.changed, 'confirming an AI category is a change of source');
		const cleared = applyBulkChanges({ category: 'fiqh', categorySource: 'uploader' as const }, { category: null }, now);
		assert.deepEqual(cleared.ok && { c: cleared.video.category, s: cleared.video.categorySource }, { c: undefined, s: undefined });
	});

	it('upload: adopts the form\'s finished suggestion and records the outcome; otherwise requests one', async () => {
		const e = env();
		const db = e.SEARCH_DB as SearchDb;
		const draft = draftSubjectId('owner', DRAFT);
		await markCategorySuggestionPending(db, { subjectId: draft, subjectType: 'draft', reason: 'draft', userId: 'owner' });
		await recordCategorySuggestionResult(db, draft, { status: 'done', scores: [{ category: 'fiqh' as any, confidence: 0.9 }], model: 'm' });
		const c = { env: e } as any;

		adoptOrRequestSuggestion(c, { videoId: 'v-up', userId: 'owner', channelId: 'ch', category: 'fiqh', draftKey: DRAFT });
		adoptOrRequestSuggestion(c, { videoId: 'v-none', userId: 'owner', channelId: 'ch', category: null });
		adoptOrRequestSuggestion(c, { videoId: 'v-chosen', userId: 'owner', channelId: 'ch', category: 'ramadan' });
		await settle();
		assert.deepEqual(await getCategorySuggestion(db, 'v-up').then((r) => [r!.subject_type, r!.outcome, r!.final_category]), ['video', 'accepted', 'fiqh']);
		assert.deepEqual(e.MODERATION_QUEUE.messages.map((m: any) => [m.payload.subjectId, m.payload.reason]), [['v-none', 'upload']]);
		assert.equal(await getCategorySuggestion(db, 'v-chosen'), null);
	});
});

describe('Explore categories', () => {
	it('keeps only categories with at least one public ready video, in canonical order', () => {
		const tiles = nonEmptyCategories(new Map([['fiqh', 3], ['quran_recitation', 1], ['ramadan', 0], ['not_a_category', 9]]));
		assert.deepEqual(tiles.map((t) => [t.value, t.count]), [['quran_recitation', 1], ['fiqh', 3]]);
		assert.deepEqual(nonEmptyCategories(new Map()), []);
	});
});
