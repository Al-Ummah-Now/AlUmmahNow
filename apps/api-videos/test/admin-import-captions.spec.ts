/**
 * Admin Tools captions (wiki TOOLS-ADMIN TA-7): a transcript made on the admin's computer goes to the
 * same on-device claim as desktop Studio, its Quran spans references only (QF terms 2026-11-21);
 * translations of the source draft are queued per language with no caption minutes.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { MessageType, captionDraftKey, onDeviceTranscriptKey, type CaptionDraft } from '@al-ummah/shared-types';
import adminInternalRouter from '../src/routers/admin.router';
import { MemoryBucket, MemoryQueue } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const ADMIN = 'usr_' + 'a'.repeat(32);
const OWNER = 'usr_' + 'b'.repeat(32);
const realFetch = globalThis.fetch;
beforeEach(() => {
	globalThis.fetch = (async () => new Response('{}')) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const sourceDraft: CaptionDraft = {
	v: 1,
	videoId: 'v1',
	language: 'ar',
	version: 1,
	kind: 'source',
	origin: 'on_device',
	edited: false,
	cues: [{ id: 'c1', startMs: 0, endMs: 4000, segments: [{ type: 'speech', text: 'قال الله تعالى' }, { type: 'quran', range: '112:1:1-112:2:2', status: 'confirmed' }] }],
	createdAt: '2026-11-21T00:00:00.000Z',
	updatedAt: '2026-11-21T00:00:00.000Z',
	updatedBy: ADMIN,
};

async function harness() {
	const env = {
		videos: new MemoryBucket(),
		subtitles: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		queue: new MemoryQueue(),
		SEARCH_DB: new SqliteD1() as unknown as D1Database,
		ERRORS_INGEST_URL: 'https://admin.example/internal/errors',
		INTERNAL_API_KEY: 'k',
	};
	await env.videos.put('v1', JSON.stringify({ id: 'v1', userId: OWNER, channelId: 'ch1', title: 'Lesson 1', duration: 125, uploadStatus: 'ready' }));
	const app = new Hono();
	app.route('/internal/admin', adminInternalRouter as never);
	const post = async (path: string, body: unknown, actor: string | null = ADMIN) => {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (actor) headers['X-Admin-Actor'] = actor;
		const res = await app.request(`/internal/admin/import/videos/${path}`, { method: 'POST', headers, body: JSON.stringify(body) }, env);
		return { status: res.status, body: (await res.json()) as any };
	};
	return { env, post };
}

const transcript = {
	segments: [
		{ startMs: 0, endMs: 2000, text: 'قال الشيخ' },
		{ startMs: 2000, endMs: 6000, quran: { range: '112:1:1-112:4:5', status: 'confirmed' } },
	],
	engine: { provider: 'whisper.cpp', model: 'large-v3-turbo-q5_0' },
};

describe('admin import transcript', () => {
	it('stores the keys-only transcript and queues the on-device claim, requested by the admin', async () => {
		const { env, post } = await harness();
		const res = await post('v1/captions/ar/transcript', transcript);
		assert.equal(res.status, 200, JSON.stringify(res.body));
		assert.deepEqual(res.body.result, { status: 'queued', segments: 2 });
		const stored = JSON.parse(env.subtitles.store.get(onDeviceTranscriptKey('v1', 'ar'))!);
		assert.deepEqual(stored.segments[1], { startMs: 2000, endMs: 6000, text: '', quran: { range: '112:1:1-112:4:5', status: 'confirmed' } });
		const msg = env.queue.messages.find((m: any) => m.type === MessageType.CaptionClaimTranscript) as any;
		assert.ok(msg, 'claim queued');
		assert.equal(msg.payload.requestedBy, ADMIN);
		assert.equal(msg.payload.source, 'on_device');
	});

	it('refuses Quran words with a span, a missing video, an unknown language and an actor that is not a user id', async () => {
		const { post } = await harness();
		const words = { ...transcript, segments: [{ startMs: 0, endMs: 1000, text: 'قل هو الله احد', quran: { range: '112:1:1-112:1:4' } }] };
		const bad = await post('v1/captions/ar/transcript', words);
		assert.equal(bad.status, 400);
		assert.equal(bad.body.reason, 'invalid_segment');
		assert.equal((await post('nope/captions/ar/transcript', transcript)).status, 404);
		assert.equal((await post('v1/captions/xx-nope/transcript', transcript)).status, 400);
		assert.equal((await post('v1/captions/ar/transcript', transcript, 'admin')).status, 400);
	});

	it('an existing draft needs replace', async () => {
		const { env, post } = await harness();
		await env.subtitles.put(captionDraftKey('v1', 'ar'), JSON.stringify(sourceDraft));
		const res = await post('v1/captions/ar/transcript', transcript);
		assert.equal(res.status, 409);
		assert.equal(res.body.code, 'draft_exists');
		assert.equal((await post('v1/captions/ar/transcript', { ...transcript, replace: true })).status, 200);
	});
});

describe('admin import translations', () => {
	it('queues one waived job per language and reports each refusal on its own', async () => {
		const { env, post } = await harness();
		await env.subtitles.put(captionDraftKey('v1', 'ar'), JSON.stringify(sourceDraft));
		await env.subtitles.put(captionDraftKey('v1', 'fr'), JSON.stringify({ ...sourceDraft, language: 'fr', kind: 'translation' }));
		const res = await post('v1/translations', { sourceLanguage: 'ar', languages: ['en', 'en', 'fr', 'ar'] });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		const byLang = Object.fromEntries(res.body.result.results.map((r: any) => [r.language, r]));
		assert.equal(Object.keys(byLang).length, 3, 'duplicates once');
		assert.ok(byLang.en.jobId);
		assert.equal(byLang.fr.error, 'draft_exists');
		assert.equal(byLang.ar.error, 'same_language');
		const row = await env.SEARCH_DB.prepare('SELECT waived, requested_by FROM caption_jobs WHERE id = ?').bind(byLang.en.jobId).first<{ waived: number; requested_by: string }>();
		assert.deepEqual({ ...row }, { waived: 1, requested_by: ADMIN });
	});

	it('no source draft: every language says source_missing', async () => {
		const { post } = await harness();
		const res = await post('v1/translations', { sourceLanguage: 'ar', languages: ['en'] });
		assert.deepEqual(res.body.result.results, [{ language: 'en', error: 'source_missing' }]);
	});
});
