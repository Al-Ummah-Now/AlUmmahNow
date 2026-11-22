/**
 * The Imports view's status lookup (wiki TOOLS-ADMIN TA-8, lib/admin/importStatus.ts): per imported file
 * the video, the attach job (state, attempts n/max, next retry, what came and what is on), and each
 * caption language's state; plus the route and its limits.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import adminRouter from '../src/routers/admin.router';
import { captionState, importStatus } from '../src/lib/admin/importStatus';
import { sentParts } from '../src/lib/admin/importAttach';
import { createJob } from '../src/lib/admin/jobs';
import { MemoryBucket, MemoryQueue } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const ADMIN = 'usr_' + 'a'.repeat(32);
const OWNER = 'usr_' + 'b'.repeat(32);

function env() {
	const db = new SqliteD1();
	return {
		db,
		env: {
			SEARCH_DB: db,
			videos: new MemoryBucket({
				v1: { id: 'v1', title: 'خطبة الجمعة', userId: OWNER, channelId: 'ch1', processingStatus: 'completed' },
				v2: { id: 'v2', title: 'Second', userId: OWNER, channelId: 'ch1', processingStatus: 'processing' },
			}),
			subtitles: new MemoryBucket(),
			global_settings: new MemoryBucket(),
			ADMIN_JOBS_QUEUE: new MemoryQueue(),
		},
	};
}

function captionJob(db: SqliteD1, id: string, videoId: string, language: string, kind: string, status: string, createdAt: string, error: string | null = null) {
	db.db
		.prepare(
			`INSERT INTO caption_jobs (id, idempotency_key, video_id, subject_id, requested_by, kind, language, provider, model, status, error, waived, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'workers-ai', 'm', ?, ?, 1, ?, ?)`,
		)
		.run(id, id, videoId, OWNER, ADMIN, kind, language, status, error, createdAt, createdAt);
}

describe('import status (Imports view)', () => {
	it('reads the video, the attach job and each caption language for a page of files', async () => {
		const { db, env: e } = env();
		const job = await createJob(e as never, {
			kind: 'import.attach',
			targetKind: 'video',
			targetId: 'v1',
			params: { videoId: 'v1', key: 'k', sent: ['captions', 'chapters', 'thumbnail'], done: ['captions'], waits: 1, warnings: [] },
			actorId: ADMIN,
		});
		db.db.prepare("UPDATE admin_jobs SET status = 'retrying', attempts = 2, last_error = 'R2 put failed', next_run_at = '2026-11-22T19:30:00.000Z', result = ? WHERE id = ?").run(JSON.stringify({ videoId: 'v1', done: ['captions', 'chapters'], warnings: ['chapters: line 3 has no time'] }), job.id);
		// ar: uploaded with the file and live; en: a translation draft; fr: translating; de: failed
		await e.subtitles.put('v1/metadata.json', JSON.stringify({ tracks: [{ id: 't', language: 'ar', label: 'العربية', kind: 'subtitles', origin: 'upload', uploadedBy: ADMIN, uploadedAt: '' }] }));
		await e.subtitles.put('v1/drafts/en.json', JSON.stringify({ language: 'en' }));
		await e.subtitles.put('v1/drafts/en/v1.json', JSON.stringify({ language: 'en' }));
		captionJob(db, 'c1', 'v1', 'en', 'translate', 'ready', '2026-11-22T10:00:00Z');
		captionJob(db, 'c2', 'v1', 'fr', 'translate', 'translating', '2026-11-22T10:01:00Z');
		captionJob(db, 'c3', 'v1', 'de', 'translate', 'failed', '2026-11-22T10:02:00Z', 'translation_failed');
		// An older failure under a newer success: the newest job decides
		captionJob(db, 'c0', 'v1', 'en', 'translate', 'failed', '2026-11-21T10:00:00Z', 'translation_failed');

		const [one, two, gone] = await importStatus(e as never, [{ videoId: 'v1', attachJobId: job.id }, { videoId: 'v2' }, { videoId: 'v9', attachJobId: null }]);
		assert.deepEqual(one.video, { title: 'خطبة الجمعة', processingStatus: 'completed', isDeleted: false });
		assert.deepEqual(one.attach, {
			jobId: job.id,
			status: 'retrying',
			attempts: 2,
			maxAttempts: 6,
			nextRunAt: '2026-11-22T19:30:00.000Z',
			lastError: 'R2 put failed',
			sent: ['captions', 'chapters', 'thumbnail'],
			done: ['captions', 'chapters'],
			warnings: ['chapters: line 3 has no time'],
		});
		assert.deepEqual(one.captions, [
			{ language: 'ar', state: 'published', origin: 'upload' },
			{ language: 'de', state: 'failed', job: 'translate', error: 'translation_failed' },
			{ language: 'en', state: 'draft', job: 'translate' },
			{ language: 'fr', state: 'working', job: 'translate' },
		]);
		assert.deepEqual(two, { videoId: 'v2', video: { title: 'Second', processingStatus: 'processing', isDeleted: false }, attach: null, captions: [] });
		assert.deepEqual(gone, { videoId: 'v9', video: null, attach: null, captions: [] });
	});

	it('an attach job from before TA-8 has no list of what came: only what is done is known', async () => {
		const { env: e } = env();
		const job = await createJob(e as never, { kind: 'import.attach', targetKind: 'video', targetId: 'v1', params: { videoId: 'v1', key: 'k', done: ['playlist'], waits: 0, warnings: [] }, actorId: ADMIN });
		const [status] = await importStatus(e as never, [{ videoId: 'v1', attachJobId: job.id }]);
		assert.equal(status.attach?.sent, null);
		assert.deepEqual(status.attach?.done, ['playlist']);
	});

	it('a live track wins over a later failed job; a job still working wins over everything', () => {
		const row = (status: string, error: string | null = null) => ({ video_id: 'v', language: 'ar', kind: 'transcribe', status: status as never, error, created_at: '' });
		assert.deepEqual(captionState('ar', row('failed', 'no_speech'), { origin: 'machine' }, true), { language: 'ar', state: 'published', origin: 'machine' });
		assert.deepEqual(captionState('ar', row('transcribing'), { origin: 'upload' }, true), { language: 'ar', state: 'working', job: 'transcribe' });
		assert.deepEqual(captionState('ar', row('failed', 'weird_code'), undefined, false), { language: 'ar', state: 'failed', job: 'transcribe', error: 'weird_code' });
		assert.equal(captionState('ar', row('cancelled'), undefined, false), null);
	});

	it('the attach job records which parts came with the file', () => {
		assert.deepEqual(sentParts({ publishAt: 'x', captions: [{ language: 'ar', content: 'c' }], thumbnail: { data: 'd', mimeType: 'image/png' } }), ['captions', 'thumbnail', 'schedule']);
		assert.deepEqual(sentParts({ playlistId: 'p', chapters: '0:00 a' }), ['playlist', 'chapters']);
	});

	it('the route takes at most one page of files', async () => {
		const { env: e } = env();
		const app = new Hono();
		app.route('/internal/admin', adminRouter);
		const post = (items: unknown[]) =>
			app.request('/internal/admin/import/status', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN }, body: JSON.stringify({ items }) }, e);
		const ok = await post([{ videoId: 'v1' }]);
		assert.equal(ok.status, 200);
		assert.equal(((await ok.json()) as any).result.items[0].video.title, 'خطبة الجمعة');
		assert.equal((await post(Array.from({ length: 51 }, (_, i) => ({ videoId: `v${i}` })))).status, 400);
		assert.equal((await post([{ videoId: '' }])).status, 400);
	});
});
