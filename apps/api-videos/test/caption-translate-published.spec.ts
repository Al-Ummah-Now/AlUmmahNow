/**
 * Translate from the published track (TA-20, wiki AUN-CAPTIONS §5.7): a language with no caption
 * draft (sidecar captions an import attached, or a file the creator uploaded) is translated from its
 * published track. A draft still wins; source_missing only when neither exists. The result is the
 * same machine-translated draft, the same minutes and the same refusals; Quran markers stay references.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
	MessageType,
	captionCuesFromVtt,
	captionDraftKey,
	captionPublishedSourceKey,
	renderCaptionVtt,
	type CaptionDraft,
	type SubtitleMetadata,
	type SubtitleTrack,
	type VideoObject,
} from '@al-ummah/shared-types';
import { assignTier, saveTier } from '../src/lib/creatorTiers';
import { CaptionJobHttpError, finishJob, requestTranslationJob, resolveTranslationSource, retryJob, type CaptionJobsEnv } from '../src/lib/captions/jobs';
import { captionSubject, readUsage } from '../src/lib/captions/minutes';
import { CaptionTranslateCreate } from '../src/endpoints/captions/captionJobs';
import adminInternalRouter from '../src/routers/admin.router';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const NOV = new Date('2026-11-22T12:00:00.000Z');
const ADMIN = 'usr_' + 'a'.repeat(32);

/** An imported sidecar as the subtitle store keeps it (converted to WebVTT, right-to-left marks). */
const SIDECAR_VTT = ['WEBVTT', '', '1', '00:00:00.000 --> 00:00:04.000', '‏بسم الله نبدأ الدرس', '', '2', '00:00:04.500 --> 00:00:09.000', '‏<i>الصبر</i> &amp; الشكر', ''].join('\n');

const sourceDraft = (over: Partial<CaptionDraft> = {}): CaptionDraft => ({
	v: 1,
	videoId: 'v1',
	language: 'ar',
	version: 3,
	kind: 'source',
	origin: 'transcription',
	edited: true,
	cues: [{ id: 'c1', startMs: 0, endMs: 4000, segments: [{ type: 'speech', text: 'قال الله تعالى' }, { type: 'quran', range: '112:1:1-112:2:2', status: 'accepted' }] }],
	createdAt: NOV.toISOString(),
	updatedAt: NOV.toISOString(),
	updatedBy: 'alice',
	...over,
});

const track = (over: Partial<SubtitleTrack> = {}): SubtitleTrack =>
	({ id: 't-ar', language: 'ar', label: 'العربية', kind: 'subtitles', isDefault: true, origin: 'upload', uploadedBy: 'alice', uploadedAt: NOV.toISOString(), fileSize: 100, format: 'vtt', url: 'https://api/v1/ar', status: 'ready', ...over }) as SubtitleTrack;

const video = (over: Partial<VideoObject> = {}): VideoObject =>
	({ id: 'v1', userId: 'alice', channelId: 'c1', title: 'Patience', duration: 125, uploadStatus: 'ready', ...over }) as VideoObject;

const realFetch = globalThis.fetch;
beforeEach(() => {
	globalThis.fetch = (async () => new Response('{}')) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

async function setup(opts: { minutes?: number; draft?: CaptionDraft | null; published?: { vtt: string; track?: Partial<SubtitleTrack> } | null } = {}) {
	const d1 = new SqliteD1() as unknown as D1Database;
	await saveTier(d1, 'captions', { name: 'Captions', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 1, captionMinutesMonth: opts.minutes ?? 10 }, 'admin-1', { create: true });
	await assignTier(d1, 'alice', 'captions', 'admin-1');
	const subtitles = new MemoryBucket();
	if (opts.draft) await subtitles.put(captionDraftKey('v1', 'ar'), JSON.stringify(opts.draft));
	if (opts.published) {
		await subtitles.put('v1/ar.vtt', opts.published.vtt);
		await subtitles.put('v1/metadata.json', JSON.stringify({ videoId: 'v1', tracks: [track(opts.published.track)], defaultTrack: 'ar', lastModified: NOV.toISOString() } as SubtitleMetadata));
	}
	const env = {
		SEARCH_DB: d1,
		MEDIA_PRIVATE: new MemoryBucket(),
		subtitles,
		videos: new MemoryBucket({ v1: { ...video(), isPublic: true } }),
		global_settings: new MemoryBucket(),
		queue: new MemoryQueue(),
		TRANSCODE_QUEUE: new MemoryQueue(),
		ERRORS_INGEST_URL: 'https://admin.example/internal/errors',
		INTERNAL_API_KEY: 'k',
	};
	const remaining = async () => (await readUsage(d1, await captionSubject(d1, { userId: 'alice' }), NOV)).remaining;
	return { env, d1, asEnv: env as unknown as CaptionJobsEnv, remaining };
}

const translate = (env: CaptionJobsEnv, over: Partial<{ language: string; replace: boolean; waive: boolean }> = {}) =>
	requestTranslationJob(env, { video: video(), userId: 'alice', sourceLanguage: 'ar', language: over.language ?? 'en', replace: over.replace ?? false, waive: over.waive }, NOV);

describe('the source of a translation (TA-20)', () => {
	it('a draft wins over the published track', async () => {
		const { env, asEnv } = await setup({ draft: sourceDraft(), published: { vtt: SIDECAR_VTT } });
		assert.deepEqual(await resolveTranslationSource(asEnv, 'v1', 'ar'), { source: 'draft', version: 3 });
		const out = await translate(asEnv);
		assert.ok('job' in out);
		assert.equal(out.job.source, 'draft');
		assert.equal(out.job.sourceVersion, 3);
		assert.equal(env.MEDIA_PRIVATE.store.size, 0, 'no copy of the published track');
		assert.equal(env.queue.messages[0].payload.source, 'draft');
	});

	it('no draft: the published track, copied into the job’s work prefix and sent as source published', async () => {
		const { env, asEnv } = await setup({ published: { vtt: SIDECAR_VTT } });
		const resolved = await resolveTranslationSource(asEnv, 'v1', 'ar');
		assert.equal(resolved.source, 'published');
		assert.equal(resolved.version, 1, 'an upload without a version is 1');
		const out = await translate(asEnv);
		assert.ok('job' in out && !out.existing);
		assert.equal(out.job.kind, 'translate');
		assert.equal(out.job.source, 'published');
		assert.equal(out.job.sourceVersion, 1);
		assert.equal(env.MEDIA_PRIVATE.store.get(captionPublishedSourceKey(out.job.id)), SIDECAR_VTT, 'the track as it was when the job started');
		const msg = env.queue.messages[0];
		assert.equal(msg.type, MessageType.CaptionTranslate);
		assert.equal(msg.payload.source, 'published');
		assert.equal(msg.payload.sourceLanguage, 'ar');
		assert.equal(msg.payload.language, 'en');
		const row = await env.SEARCH_DB.prepare('SELECT source_kind FROM caption_jobs WHERE id = ?').bind(out.job.id).first<{ source_kind: string }>();
		assert.equal(row!.source_kind, 'published');
		// Sidecars stay where they are, untouched
		assert.equal(env.subtitles.store.get('v1/ar.vtt'), SIDECAR_VTT);
		assert.equal(env.subtitles.store.has(captionDraftKey('v1', 'ar')), false, 'no draft is made of the source');
	});

	it('a draft with no cues counts as none: the published track is used', async () => {
		const { asEnv } = await setup({ draft: sourceDraft({ cues: [] }), published: { vtt: SIDECAR_VTT, track: { version: 4, origin: 'machine' } } });
		assert.deepEqual({ ...(await resolveTranslationSource(asEnv, 'v1', 'ar')), vtt: undefined }, { source: 'published', version: 4, vtt: undefined });
	});

	it('neither a draft nor a published track: source_missing (also for an empty or unreadable track)', async () => {
		let s = await setup();
		await assert.rejects(translate(s.asEnv), (e: CaptionJobHttpError) => e.status === 404 && e.code === 'source_missing');
		s = await setup({ published: { vtt: 'WEBVTT\n\n' } });
		await assert.rejects(translate(s.asEnv), /source_missing/);
		s = await setup({ published: { vtt: SIDECAR_VTT, track: { status: 'processing' } } });
		await assert.rejects(translate(s.asEnv), /source_missing/);
		assert.equal(await s.remaining(), 10, 'nothing reserved');
	});

	it('a published machine translation is not a source', async () => {
		const { asEnv } = await setup({ published: { vtt: SIDECAR_VTT, track: { origin: 'machine', machineTranslation: true, sourceLanguage: 'en' } } });
		await assert.rejects(translate(asEnv), (e: CaptionJobHttpError) => e.status === 409 && e.code === 'source_is_translation');
	});

	it('the same minutes: reserved per language, charged when it ends, back when it fails; 402 when none are left', async () => {
		const { asEnv, remaining } = await setup({ minutes: 10, published: { vtt: SIDECAR_VTT } });
		const a = await translate(asEnv);
		assert.ok('job' in a);
		assert.equal(a.job.minutesReserved, 3, '125 s = 3 minutes');
		assert.equal(await remaining(), 7);
		await finishJob(asEnv, a.job.id, { outcome: 'ready', minutesUsed: 0 }, undefined, NOV);
		assert.equal(await remaining(), 7);
		const b = await translate(asEnv, { language: 'fr' });
		assert.ok('job' in b);
		await finishJob(asEnv, b.job.id, { outcome: 'failed', error: 'translation_failed' }, undefined, NOV);
		assert.equal(await remaining(), 7);
		const none = await setup({ minutes: 0, published: { vtt: SIDECAR_VTT } });
		const refused = await translate(none.asEnv);
		assert.ok('refused' in refused && refused.refused === 'upgrade_required');
		assert.equal(none.env.MEDIA_PRIVATE.store.size, 0, 'nothing copied when refused');
	});

	it('the same refusals: draft_exists unless replace, translation_paused', async () => {
		const { env, asEnv } = await setup({ published: { vtt: SIDECAR_VTT } });
		await env.subtitles.put(captionDraftKey('v1', 'en'), JSON.stringify(sourceDraft({ language: 'en', kind: 'translation' })));
		await assert.rejects(translate(asEnv), /draft_exists/);
		const replaced = await translate(asEnv, { replace: true });
		assert.ok('job' in replaced && replaced.job.source === 'published' && replaced.job.replace);
		await env.global_settings.put('captions/settings.json', JSON.stringify({ translation: { enabled: false } }));
		await assert.rejects(translate(asEnv, { language: 'de' }), /translation_paused/);
	});

	it('an admin Retry copies the published track again (the failed job’s work was cleared)', async () => {
		const { env, asEnv } = await setup({ published: { vtt: SIDECAR_VTT } });
		const out = await translate(asEnv);
		assert.ok('job' in out);
		await finishJob(asEnv, out.job.id, { outcome: 'failed', error: 'translation_failed' }, undefined, NOV);
		assert.equal(env.MEDIA_PRIVATE.store.has(captionPublishedSourceKey(out.job.id)), false);
		const retried = await retryJob(asEnv, out.job.id, video(), NOV);
		assert.equal(retried.status, 'queued');
		assert.equal(retried.source, 'published');
		assert.equal(env.MEDIA_PRIVATE.store.get(captionPublishedSourceKey(out.job.id)), SIDECAR_VTT);
		assert.equal(env.queue.messages.at(-1).payload.source, 'published');
		// The track removed since: the retry fails as source_missing
		await finishJob(asEnv, out.job.id, { outcome: 'failed', error: 'translation_failed' }, undefined, NOV);
		await env.subtitles.delete('v1/ar.vtt');
		await assert.rejects(retryJob(asEnv, out.job.id, video(), NOV), /source_missing/);
		const row = await env.SEARCH_DB.prepare('SELECT status, error FROM caption_jobs WHERE id = ?').bind(out.job.id).first<{ status: string; error: string }>();
		assert.deepEqual({ ...row }, { status: 'failed', error: 'source_missing' });
	});
});

describe('a published track as source cues (captionCuesFromVtt)', () => {
	it('reads a converted sidecar: times, plain text, no tags, entities or direction marks', () => {
		assert.deepEqual(captionCuesFromVtt(SIDECAR_VTT), [
			{ id: 'c1', startMs: 0, endMs: 4000, segments: [{ type: 'speech', text: 'بسم الله نبدأ الدرس' }] },
			{ id: 'c2', startMs: 4500, endMs: 9000, segments: [{ type: 'speech', text: 'الصبر & الشكر' }] },
		]);
	});

	it('Quran markers of a track published from a draft become references again, never text', () => {
		const draft = sourceDraft({
			cues: [
				{ id: 'c1', startMs: 0, endMs: 4000, segments: [{ type: 'speech', text: 'قال الله تعالى' }, { type: 'quran', range: '112:1:1-112:2:2', status: 'accepted' }] },
				{ id: 'c2', startMs: 4000, endMs: 8000, segments: [{ type: 'quran', range: '2:255:1-2:255:5', status: 'review' }] },
			],
		});
		const cues = captionCuesFromVtt(renderCaptionVtt(draft));
		assert.deepEqual(cues, [
			{ id: 'c1', startMs: 0, endMs: 4000, segments: [{ type: 'speech', text: 'قال الله تعالى' }, { type: 'quran', range: '112:1:1-112:2:2', status: 'accepted' }] },
			{ id: 'c2', startMs: 4000, endMs: 8000, segments: [{ type: 'quran', range: '2:255:1-2:255:5', status: 'review' }] },
		]);
	});

	it('skips the header, NOTE and STYLE blocks, bad timings and empty cues; accepts short and comma times', () => {
		const vtt = ['WEBVTT - imported', 'Kind: captions', '', 'NOTE a comment --> not a cue', '', 'STYLE', '::cue { color: red }', '', '00:01.000 --> 00:02,500 align:start', 'Hello', '', '00:05.000 --> 00:04.000', 'Backwards', '', '00:06.000 --> 00:07.000', '<b></b>', ''].join('\n');
		assert.deepEqual(captionCuesFromVtt(vtt), [{ id: 'c1', startMs: 1000, endMs: 2500, segments: [{ type: 'speech', text: 'Hello' }] }]);
	});
});

describe('POST /api/videos/:videoId/captions/translations (Studio)', () => {
	const post = (app: Hono, env: unknown, body: unknown) =>
		app.request('/api/videos/v1/captions/translations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env as never);
	const studio = () => buildApp((router) => router.post('/api/videos/:videoId/captions/translations', CaptionTranslateCreate), { userId: 'alice' });

	it('answers each job’s source: published without a draft, draft with one', async () => {
		let s = await setup({ published: { vtt: SIDECAR_VTT } });
		let res = await post(studio(), s.env, { sourceLanguage: 'ar', languages: ['en', 'fr'] });
		assert.equal(res.status, 202, await res.clone().text());
		let body = (await res.json()) as { data: { jobs: Array<{ language: string; source: string; kind: string }> } };
		assert.deepEqual(body.data.jobs.map((j) => [j.language, j.kind, j.source]), [['en', 'translate', 'published'], ['fr', 'translate', 'published']]);

		s = await setup({ draft: sourceDraft(), published: { vtt: SIDECAR_VTT } });
		res = await post(studio(), s.env, { sourceLanguage: 'ar', languages: ['en'] });
		body = (await res.json()) as typeof body;
		assert.equal(body.data.jobs[0]!.source, 'draft');
	});

	it('404 source_missing only when neither exists', async () => {
		const s = await setup();
		const res = await post(studio(), s.env, { sourceLanguage: 'ar', languages: ['en'] });
		assert.equal(res.status, 404);
		assert.deepEqual(await res.json(), { success: false, error: 'source_missing' });
	});
});

describe('POST /internal/admin/import/videos/:videoId/translations (Admin Tools, TA-13 sidecars)', () => {
	async function importer(opts: Parameters<typeof setup>[0]) {
		const s = await setup(opts);
		const app = new Hono();
		app.route('/internal/admin', adminInternalRouter as never);
		const post = async (body: unknown) => {
			const res = await app.request('/internal/admin/import/videos/v1/translations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN }, body: JSON.stringify(body) }, s.env);
			return { status: res.status, body: (await res.json()) as any };
		};
		return { ...s, post };
	}

	it('translates the published sidecar, waived, and says so per result', async () => {
		const { env, post } = await importer({ minutes: 0, published: { vtt: SIDECAR_VTT } });
		const res = await post({ sourceLanguage: 'ar', languages: ['en'] });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		const [r] = res.body.result.results;
		assert.equal(r.language, 'en');
		assert.equal(r.source, 'published');
		assert.equal(r.status, 'queued');
		assert.ok(r.jobId);
		const row = await env.SEARCH_DB.prepare('SELECT waived, source_kind FROM caption_jobs WHERE id = ?').bind(r.jobId).first<{ waived: number; source_kind: string }>();
		assert.deepEqual({ ...row }, { waived: 1, source_kind: 'published' });
	});

	it('a draft still wins; source_missing only when neither exists', async () => {
		let s = await importer({ draft: sourceDraft(), published: { vtt: SIDECAR_VTT } });
		assert.equal((await s.post({ sourceLanguage: 'ar', languages: ['en'] })).body.result.results[0].source, 'draft');
		s = await importer({});
		assert.deepEqual((await s.post({ sourceLanguage: 'ar', languages: ['en'] })).body.result.results, [{ language: 'en', error: 'source_missing' }]);
	});
});
