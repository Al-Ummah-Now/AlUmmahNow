/**
 * YouTube Takeout files for a YouTube import source (wiki TOOLS-ADMIN TA-9/TA-13). YouTube's terms forbid
 * downloading, so a YouTube source's records wait for their file (`awaiting_file`, note `takeout_file`)
 * and the file comes from the owner's Google Takeout export, through Admin Tools:
 *
 *   list     the app lists the export's video files (name, size, and what the export's metadata says:
 *            video id, title, duration) → import_takeout_files rows, state 'new'. Unique per source on
 *            name + size, so listing the export again finds the same rows.
 *   match    the queued job 'import.takeout-match' matches each new file to a record: by the export's
 *            video id, else a video id in the file name, else the title (and the duration when both
 *            sides know it). One record → matched; several → ambiguous (an admin picks one); none →
 *            unmatched with the reason.
 *   upload   for a matched file the app opens the record's upload (the same initiate as the sync's
 *            videos and Admin Tools' imports: owned by the channel's owner, uploaded by the admin; the file
 *            claim is named by source + record, so opening it again resumes the same video) and sends the
 *            file over TUS, then says it is uploaded.
 *   attach   the same job posts the record's video on the channel (lib/importSources/post.ts) and marks the
 *            file attached.
 *
 * The job is idempotent and resumable (the state is on the rows), retried with backoff, then the DLQ; a
 * failure is flagged on the Errors page with Retry (/internal/admin/import/sources/retry), and the job's
 * state, reason and log are on the Jobs page and in the app. An admin can cancel it (job.ts
 * cancelSourceJob).
 */
import {
	IMPORT_POSTS_PER_STEP,
	reportNeedsAction,
	resolveNeedsAction,
	TAKEOUT_DURATION_TOLERANCE_MS,
	TAKEOUT_MATCH_PER_STEP,
	type AdminJob,
	type ErrorReporterEnv,
	type SourceItemState,
	type TakeoutCandidate,
	type TakeoutFileInput,
	type TakeoutFileNote,
	type TakeoutFileState,
	type TakeoutFileView,
	type TakeoutMatchedBy,
	type TakeoutReport,
	type VideoObject,
} from '@al-ummah/shared-types';
import { createJob, getJob, isCancelled, type JobOutcome } from '../admin/jobs';
import R2Repository from '../r2Repo';
import { loadChannelRecord } from '../channelAccess';
import type { FetchedItem } from './fetchers';
import { postItem } from './post';
import { changes, claimItemIds, readSource, SourceError, sourceDb, type ItemRow, type SourceDbEnv, type SourceRow } from './store';
import { initiateImportVideo, markVideoImported, type ImportUpload } from './video';
import type { SourceSyncEnv } from './job';
import { codedError } from './errors';
import { logger } from '../logger';

export const TAKEOUT_JOB_KIND = 'import.takeout-match' as const;
export const takeoutNeedsActionKey = (sourceId: string) => `import-takeout:${sourceId}`;

export interface TakeoutRow {
	id: string;
	source_id: string;
	name: string;
	size: number;
	youtube_id: string | null;
	title: string | null;
	duration_ms: number | null;
	mime_type: string | null;
	state: TakeoutFileState;
	matched_by: TakeoutMatchedBy | null;
	note: TakeoutFileNote | null;
	item_id: string | null;
	candidates: string | null;
	video_id: string | null;
	created_by: string;
	created_at: number;
	updated_at: number;
}

interface TakeoutParams {
	sourceId: string;
	matched: number;
	unmatched: number;
	ambiguous: number;
	attached: number;
	failed: number;
}

/** States in which a file holds its record: no other file of the export can match it. */
const HOLDING: readonly TakeoutFileState[] = ['matched', 'uploading', 'uploaded', 'attached'];
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const iso = (ms: number) => new Date(ms).toISOString();

// --- matching (pure) ---------------------------------------------------------------------------------

/** A title as compared: letters and digits only, any case, any spacing (Takeout file names drop some characters). */
export function normalizeTitle(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/** The file name without its extension. */
export const baseName = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, '');

/** Every word of the file name shaped like a YouTube video id (`My talk [dQw4w9WgXcQ].mp4`, `dQw4w9WgXcQ.mp4`). */
export function idsInFileName(name: string): string[] {
	return baseName(name)
		.split(/[^A-Za-z0-9_-]+/)
		.filter((word) => YOUTUBE_ID.test(word));
}

/** A record the files are matched against. */
export interface MatchRecord {
	itemId: string;
	title: string | null;
	durationMs: number | null;
	/** awaiting_file: waits for its file; otherwise it already has its video (or was skipped) */
	state: SourceItemState;
}

export interface MatchFile {
	name: string;
	youtubeId: string | null;
	title: string | null;
	durationMs: number | null;
}

export type MatchResult =
	| { state: 'matched'; itemId: string; matchedBy: TakeoutMatchedBy }
	| { state: 'ambiguous'; candidates: string[]; note: 'several_records' }
	| { state: 'unmatched'; note: TakeoutFileNote };

/**
 * Matches one file. `records` has every record named by the file's ids; `byTitle` the source's waiting
 * records by normalized title; `taken` the records another file already holds.
 */
export function matchTakeoutFile(file: MatchFile, records: ReadonlyMap<string, MatchRecord>, byTitle: ReadonlyMap<string, readonly MatchRecord[]>, taken: ReadonlySet<string>): MatchResult {
	const direct = (record: MatchRecord, matchedBy: TakeoutMatchedBy): MatchResult => {
		if (record.state !== 'awaiting_file') return { state: 'unmatched', note: 'has_file' };
		if (taken.has(record.itemId)) return { state: 'unmatched', note: 'file_taken' };
		return { state: 'matched', itemId: record.itemId, matchedBy };
	};
	// The export's own video id is the answer, found or not
	if (file.youtubeId) {
		const record = records.get(file.youtubeId);
		return record ? direct(record, 'video_id') : { state: 'unmatched', note: 'no_record' };
	}
	for (const id of idsInFileName(file.name)) {
		const record = records.get(id);
		if (record) return direct(record, 'file_name');
	}
	const key = normalizeTitle(file.title || baseName(file.name));
	const sameTitle = key ? (byTitle.get(key) ?? []) : [];
	const fits = sameTitle.filter(
		(r) => file.durationMs == null || r.durationMs == null || Math.abs(r.durationMs - file.durationMs) <= TAKEOUT_DURATION_TOLERANCE_MS,
	);
	const free = fits.filter((r) => r.state === 'awaiting_file' && !taken.has(r.itemId));
	if (free.length === 1) return { state: 'matched', itemId: free[0]!.itemId, matchedBy: 'title' };
	if (free.length > 1) return { state: 'ambiguous', candidates: free.map((r) => r.itemId), note: 'several_records' };
	if (fits.some((r) => r.state === 'awaiting_file')) return { state: 'unmatched', note: 'file_taken' };
	return { state: 'unmatched', note: fits.length ? 'has_file' : 'no_record' };
}

// --- store -----------------------------------------------------------------------------------------

const db = (env: SourceDbEnv) => sourceDb(env);

function itemTitle(row: Pick<ItemRow, 'payload'>): { title: string | null; durationMs: number | null } {
	try {
		const item = JSON.parse(row.payload ?? '{}') as Partial<FetchedItem> & { durationMs?: number };
		return { title: item.title ?? null, durationMs: typeof item.durationMs === 'number' ? item.durationMs : null };
	} catch {
		return { title: null, durationMs: null };
	}
}

async function readItems(env: SourceDbEnv, sourceId: string, itemIds: string[]): Promise<Map<string, ItemRow>> {
	const out = new Map<string, ItemRow>();
	const ids = [...new Set(itemIds)];
	for (let i = 0; i < ids.length; i += 50) {
		const chunk = ids.slice(i, i + 50);
		const { results } = await db(env)
			.prepare(`SELECT * FROM import_source_items WHERE source_id = ? AND item_id IN (${chunk.map(() => '?').join(', ')})`)
			.bind(sourceId, ...chunk)
			.all<ItemRow>();
		for (const row of results ?? []) out.set(row.item_id, row);
	}
	return out;
}

function candidateOf(row: ItemRow | undefined, itemId: string): TakeoutCandidate {
	return { itemId, title: row ? itemTitle(row).title : null, originalUrl: row?.original_url ?? null, originalAt: row?.original_at != null ? iso(row.original_at) : null };
}

function parseIds(value: string | null): string[] {
	try {
		const ids = JSON.parse(value ?? '[]');
		return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === 'string') : [];
	} catch {
		return [];
	}
}

export function fileView(row: TakeoutRow, items: ReadonlyMap<string, ItemRow>): TakeoutFileView {
	return {
		id: row.id,
		sourceId: row.source_id,
		name: row.name,
		size: Number(row.size),
		videoId: row.youtube_id,
		title: row.title,
		durationMs: row.duration_ms,
		state: row.state,
		matchedBy: row.matched_by,
		note: row.note,
		itemId: row.item_id,
		item: row.item_id ? candidateOf(items.get(row.item_id), row.item_id) : null,
		candidates: parseIds(row.candidates).map((id) => candidateOf(items.get(id), id)),
		uploadVideoId: row.video_id,
		createdAt: iso(row.created_at),
		updatedAt: iso(row.updated_at),
	};
}

async function views(env: SourceDbEnv, sourceId: string, rows: TakeoutRow[]): Promise<TakeoutFileView[]> {
	const items = await readItems(env, sourceId, rows.flatMap((r) => [...(r.item_id ? [r.item_id] : []), ...parseIds(r.candidates)]));
	return rows.map((r) => fileView(r, items));
}

export async function readTakeoutFile(env: SourceDbEnv, sourceId: string, fileId: string): Promise<TakeoutRow | null> {
	return db(env).prepare('SELECT * FROM import_takeout_files WHERE id = ? AND source_id = ?').bind(fileId, sourceId).first<TakeoutRow>();
}

export async function viewTakeoutFile(env: SourceDbEnv, row: TakeoutRow): Promise<TakeoutFileView> {
	return (await views(env, row.source_id, [row]))[0]!;
}

/** The source's listed files (newest first), counts per state and the latest job. */
export async function takeoutReport(env: SourceDbEnv, source: SourceRow, query: { state?: TakeoutFileState; limit?: number } = {}): Promise<TakeoutReport> {
	const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
	const { results } = query.state
		? await db(env).prepare('SELECT * FROM import_takeout_files WHERE source_id = ? AND state = ? ORDER BY created_at DESC, name LIMIT ?').bind(source.id, query.state, limit).all<TakeoutRow>()
		: await db(env).prepare('SELECT * FROM import_takeout_files WHERE source_id = ? ORDER BY created_at DESC, name LIMIT ?').bind(source.id, limit).all<TakeoutRow>();
	const { results: counted } = await db(env).prepare('SELECT state, COUNT(*) AS n FROM import_takeout_files WHERE source_id = ? GROUP BY state').bind(source.id).all<{ state: TakeoutFileState; n: number }>();
	return {
		files: await views(env, source.id, results ?? []),
		counts: Object.fromEntries((counted ?? []).map((r) => [r.state, Number(r.n)])),
		jobId: source.takeout_job_id ?? null,
	};
}

/** Records the listed files; a file listed before keeps its row (and its match). Returns how many are new. */
export async function listTakeoutFiles(env: SourceDbEnv, sourceId: string, files: TakeoutFileInput[], actorId: string, now = Date.now()): Promise<number> {
	let added = 0;
	const store = db(env);
	for (let i = 0; i < files.length; i += 50) {
		const out = await store.batch(
			files.slice(i, i + 50).map((f) =>
				store
					.prepare(
						`INSERT INTO import_takeout_files (id, source_id, name, size, youtube_id, title, duration_ms, mime_type, state, created_by, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?) ON CONFLICT (source_id, name, size) DO NOTHING`,
					)
					.bind(
						`tkf_${crypto.randomUUID().replace(/-/g, '')}`,
						sourceId,
						f.name,
						f.size,
						f.videoId && YOUTUBE_ID.test(f.videoId) ? f.videoId : null,
						f.title?.trim() || null,
						f.durationMs ?? null,
						f.mimeType ?? null,
						actorId,
						now,
						now,
					),
			),
		);
		added += out.reduce((n, r) => n + changes(r as { meta?: unknown }), 0);
	}
	return added;
}

async function takenItems(env: SourceDbEnv, sourceId: string): Promise<Set<string>> {
	const { results } = await db(env)
		.prepare(`SELECT item_id FROM import_takeout_files WHERE source_id = ? AND item_id IS NOT NULL AND state IN (${HOLDING.map(() => '?').join(', ')})`)
		.bind(sourceId, ...HOLDING)
		.all<{ item_id: string }>();
	return new Set((results ?? []).map((r) => r.item_id));
}

/** The source's records still waiting for a Takeout file, by normalized title (an indexed read of one source's waiting rows). */
async function waitingByTitle(env: SourceDbEnv, sourceId: string): Promise<Map<string, MatchRecord[]>> {
	const { results } = await db(env)
		.prepare("SELECT item_id, payload, state FROM import_source_items WHERE source_id = ? AND state = 'awaiting_file' AND note = 'takeout_file'")
		.bind(sourceId)
		.all<Pick<ItemRow, 'item_id' | 'payload' | 'state'>>();
	const out = new Map<string, MatchRecord[]>();
	for (const row of results ?? []) {
		const { title, durationMs } = itemTitle(row);
		const key = normalizeTitle(title);
		if (!key) continue;
		out.set(key, [...(out.get(key) ?? []), { itemId: row.item_id, title, durationMs, state: row.state }]);
	}
	return out;
}

const toRecord = (row: ItemRow): MatchRecord => ({ itemId: row.item_id, ...itemTitle(row), state: row.note === 'takeout_file' || row.state !== 'awaiting_file' ? row.state : 'skipped' });

/** A write refused by a unique index (D1 and SQLite word it the same). */
const isUniqueViolation = (error: unknown) => /UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error));

async function setFile(env: SourceDbEnv, id: string, fields: Partial<Pick<TakeoutRow, 'state' | 'matched_by' | 'note' | 'item_id' | 'candidates' | 'video_id'>>, now = Date.now()): Promise<void> {
	const entries = Object.entries(fields);
	await db(env)
		.prepare(`UPDATE import_takeout_files SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
		.bind(...entries.map(([, v]) => v ?? null), now, id)
		.run();
}

// --- the job ---------------------------------------------------------------------------------------

/** Queues the source's match job, or returns the one already waiting or running (one per source at a time). */
export async function startTakeoutJob(env: SourceSyncEnv, source: Pick<SourceRow, 'id' | 'channel_id' | 'takeout_job_id'>, actorId: string): Promise<AdminJob> {
	// Read now, not from the caller's row: a job about to finish releases it (runTakeoutSteps), so new
	// files listed or uploaded after that get a job of their own instead of the finishing one
	const current = await db(env).prepare('SELECT takeout_job_id FROM import_sources WHERE id = ?').bind(source.id).first<{ takeout_job_id: string | null }>();
	const jobId = current ? current.takeout_job_id : source.takeout_job_id;
	if (jobId) {
		const running = await getJob(env, jobId);
		if (running && ['queued', 'running', 'retrying'].includes(running.status)) return running;
	}
	const params: TakeoutParams = { sourceId: source.id, matched: 0, unmatched: 0, ambiguous: 0, attached: 0, failed: 0 };
	const job = await createJob(env, { kind: TAKEOUT_JOB_KIND, targetKind: 'channel', targetId: source.channel_id, params: params as unknown as Record<string, unknown>, actorId });
	await db(env).prepare('UPDATE import_sources SET takeout_job_id = ?, updated_at = ? WHERE id = ?').bind(job.id, Date.now(), source.id).run();
	return job;
}

async function matchStep(env: SourceDbEnv, source: SourceRow, params: TakeoutParams): Promise<number> {
	const { results } = await db(env)
		.prepare("SELECT * FROM import_takeout_files WHERE source_id = ? AND state = 'new' ORDER BY created_at, name LIMIT ?")
		.bind(source.id, TAKEOUT_MATCH_PER_STEP)
		.all<TakeoutRow>();
	const rows = results ?? [];
	if (!rows.length) return 0;
	const named = await readItems(env, source.id, rows.flatMap((r) => [...(r.youtube_id ? [r.youtube_id] : []), ...idsInFileName(r.name)]));
	const records = new Map([...named].map(([id, row]) => [id, toRecord(row)]));
	const byTitle = await waitingByTitle(env, source.id);
	const taken = await takenItems(env, source.id);
	for (const row of rows) {
		const result = matchTakeoutFile({ name: row.name, youtubeId: row.youtube_id, title: row.title, durationMs: row.duration_ms }, records, byTitle, taken);
		if (result.state === 'matched') {
			taken.add(result.itemId);
			try {
				await setFile(env, row.id, { state: 'matched', matched_by: result.matchedBy, item_id: result.itemId, note: null, candidates: null });
				params.matched++;
			} catch (error) {
				// An admin's pick (or another step) claimed the record since this step read the taken ones
				if (!isUniqueViolation(error)) throw error;
				params.unmatched++;
				await setFile(env, row.id, { state: 'unmatched', note: 'file_taken', item_id: null, candidates: null });
			}
		} else if (result.state === 'ambiguous') {
			params.ambiguous++;
			await setFile(env, row.id, { state: 'ambiguous', note: result.note, candidates: JSON.stringify(result.candidates), item_id: null });
		} else {
			params.unmatched++;
			await setFile(env, row.id, { state: 'unmatched', note: result.note, item_id: null, candidates: null });
		}
	}
	logger.debug('[Takeout] Matched a step', { sourceId: source.id, files: rows.length, ...params });
	return rows.length;
}

/** Posts the record's video of a file the app uploaded. Throws while the upload has not finished (the job retries). */
async function attachFile(env: SourceSyncEnv, ctx: ExecutionContext, source: SourceRow, file: TakeoutRow, actorId: string): Promise<'attached' | 'failed'> {
	const item = file.item_id ? (await readItems(env, source.id, [file.item_id])).get(file.item_id) : undefined;
	if (!item || !file.video_id) {
		await setFile(env, file.id, { state: 'failed', note: 'post_refused' });
		return 'failed';
	}
	if (item.state === 'posted') {
		await setFile(env, file.id, { state: 'attached', note: null });
		return 'attached';
	}
	const video = await new R2Repository<VideoObject & { isDeleted?: boolean }>(env.videos).getObject(file.video_id);
	if (!video || video.isDeleted) {
		await setFile(env, file.id, { state: 'failed', note: 'post_refused' });
		return 'failed';
	}
	// The app says it sent the whole file; the upload completes as its last part lands
	if (video.uploadStatus === 'initiated' || video.uploadStatus === 'uploading') {
		throw new Error(`upload_incomplete: the video ${file.video_id} of ${file.name} has not finished uploading`);
	}
	try {
		const outcome = await postItem(env, ctx, source, { ...item, video_id: file.video_id }, actorId);
		if (outcome.status !== 'posted') {
			await setFile(env, file.id, { state: 'failed', note: 'post_refused' });
			return 'failed';
		}
	} catch (error) {
		if (error instanceof SourceError && error.code !== 'channel_unavailable') {
			logger.warn('[Takeout] Post refused', { sourceId: source.id, fileId: file.id, code: error.code });
			await setFile(env, file.id, { state: 'failed', note: 'post_refused' });
			return 'failed';
		}
		throw error;
	}
	await setFile(env, file.id, { state: 'attached', note: null });
	return 'attached';
}

function stepContext(): { ctx: ExecutionContext; settle(): Promise<unknown> } {
	const pending: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
	return { ctx, settle: () => Promise.allSettled(pending) };
}

/**
 * The job: match the new files (a step at a time), then post the uploaded ones. A failure is thrown with its coded
 * reason (`"<code>: <detail>"`, lib/importSources/errors.ts): `upload_incomplete`, a SourceError's code, else
 * `takeout_failed`.
 */
export async function runTakeoutJob(env: SourceSyncEnv, job: AdminJob): Promise<JobOutcome> {
	try {
		return await runTakeoutSteps(env, job);
	} catch (error) {
		throw codedError(error, 'takeout_failed');
	}
}

async function runTakeoutSteps(env: SourceSyncEnv, job: AdminJob): Promise<JobOutcome> {
	const params = { matched: 0, unmatched: 0, ambiguous: 0, attached: 0, failed: 0, ...(job.params as unknown as Partial<TakeoutParams>) } as TakeoutParams;
	if (!params.sourceId) throw new Error('import.takeout-match: missing sourceId');
	const result = () => ({ ...params });
	const again = (): JobOutcome => ({ done: false, params: params as unknown as Record<string, unknown>, result: result(), delaySeconds: 0 });
	const source = await readSource(env, params.sourceId);
	if (!source) return { done: true, result: { ...result(), skipped: 'source_deleted' } };

	if ((await matchStep(env, source, params)) === TAKEOUT_MATCH_PER_STEP) return again();

	const { results } = await db(env)
		.prepare("SELECT * FROM import_takeout_files WHERE source_id = ? AND state = 'uploaded' ORDER BY updated_at, name LIMIT ?")
		.bind(source.id, IMPORT_POSTS_PER_STEP)
		.all<TakeoutRow>();
	const { ctx, settle } = stepContext();
	try {
		for (const file of results ?? []) {
			// An admin's Cancel stops the job between files
			if (await isCancelled(env, job.id)) {
				logger.info('[Takeout] Cancelled', { jobId: job.id, sourceId: source.id });
				return { done: true, result: { ...result(), cancelled: true } };
			}
			params[await attachFile(env, ctx, source, file, job.actorId)]++;
		}
	} finally {
		await settle();
	}
	if (await isCancelled(env, job.id)) return { done: true, result: { ...result(), cancelled: true } };
	// Finishing: release the source's job id first, then look for files listed or uploaded meanwhile. A
	// start after the release queues a new job; files from before it are counted here and this job
	// continues (taking the id back unless a new job already holds it)
	const left = async () =>
		Number(
			(await db(env).prepare("SELECT COUNT(*) AS n FROM import_takeout_files WHERE source_id = ? AND state IN ('new', 'uploaded')").bind(source.id).first<{ n: number }>())?.n ?? 0,
		);
	if ((await left()) > 0) return again();
	await db(env).prepare('UPDATE import_sources SET takeout_job_id = NULL WHERE id = ? AND takeout_job_id = ?').bind(source.id, job.id).run();
	if ((await left()) > 0) {
		const took = await db(env).prepare('UPDATE import_sources SET takeout_job_id = ? WHERE id = ? AND takeout_job_id IS NULL').bind(job.id, source.id).run();
		if (changes(took)) return again();
	}
	resolveNeedsAction(env as unknown as ErrorReporterEnv, undefined, takeoutNeedsActionKey(source.id));
	logger.info('[Takeout] Done', { jobId: job.id, ...result() });
	return { done: true, result: result() };
}

/** The job failed for good: an Errors page item with Retry (the same route as a sync's). */
export async function onTakeoutFailed(env: SourceSyncEnv, job: AdminJob, error: string): Promise<void> {
	const sourceId = String((job.params as { sourceId?: string })?.sourceId ?? '');
	reportNeedsAction('api-videos', env as unknown as ErrorReporterEnv, undefined, {
		key: takeoutNeedsActionKey(sourceId || job.id),
		source: 'queue',
		title: 'Social import: matching YouTube Takeout files failed',
		message: error.slice(0, 500),
		itemType: 'channel',
		itemId: job.targetId,
		retry: { kind: 'service', service: 'api-videos', path: '/internal/admin/import/sources/retry', body: { jobId: job.id } },
		retryLabel: 'Try again',
		extra: { jobId: job.id, sourceId, network: 'youtube' },
	});
}

// --- admin actions ---------------------------------------------------------------------------------

/** An admin picks the record of an ambiguous file (one of its candidates). */
export async function confirmTakeoutFile(env: SourceDbEnv, source: SourceRow, fileId: string, itemId: string): Promise<TakeoutFileView> {
	const file = await readTakeoutFile(env, source.id, fileId);
	if (!file) throw new SourceError(404, 'file_not_found', 'No such Takeout file');
	if (file.state === 'matched' && file.item_id === itemId) return viewTakeoutFile(env, file);
	if (file.state !== 'ambiguous') throw new SourceError(409, 'not_ambiguous', 'Only an ambiguous file needs a choice');
	if (!parseIds(file.candidates).includes(itemId)) throw new SourceError(400, 'not_a_candidate', 'That record is not one this file could be');
	if ((await takenItems(env, source.id)).has(itemId)) throw new SourceError(409, 'file_taken', 'Another file already matched that record');
	try {
		await setFile(env, file.id, { state: 'matched', matched_by: 'admin', item_id: itemId, note: null, candidates: null });
	} catch (error) {
		// Claimed at the same moment by the match job or another admin (idx_import_takeout_files_holding)
		if (isUniqueViolation(error)) throw new SourceError(409, 'file_taken', 'Another file already matched that record');
		throw error;
	}
	logger.info('[Takeout] Ambiguous file confirmed', { sourceId: source.id, fileId, itemId });
	return viewTakeoutFile(env, (await readTakeoutFile(env, source.id, fileId))!);
}

/**
 * Opens (or resumes) the upload of a matched file's record: the record's video, owned by the channel's
 * owner, uploaded by the admin, its TUS session the admin's. The file claim is named by source + record,
 * so this always finds the same video for the same record.
 */
export async function openTakeoutUpload(env: SourceSyncEnv, ctx: ExecutionContext, source: SourceRow, fileId: string, actorId: string): Promise<{ file: TakeoutFileView; upload: ImportUpload }> {
	const file = await readTakeoutFile(env, source.id, fileId);
	if (!file) throw new SourceError(404, 'file_not_found', 'No such Takeout file');
	if (file.state !== 'matched' && file.state !== 'uploading') throw new SourceError(409, 'not_matched', 'Only a matched file can be uploaded');
	const item = (await readItems(env, source.id, [file.item_id!])).get(file.item_id!);
	if (!item || item.state !== 'awaiting_file') throw new SourceError(409, 'has_file', 'That record already has its video');
	const payload = JSON.parse(item.payload ?? '{}') as Partial<FetchedItem>;
	const { videoId, upload } = await initiateImportVideo(env, ctx, {
		channelId: source.channel_id,
		actorId,
		sourceId: source.id,
		itemId: item.item_id,
		title: (payload.title || baseName(file.name)).trim(),
		description: payload.text ?? '',
		bytes: Number(file.size),
		mimeType: file.mime_type ?? 'video/mp4',
	});
	await claimItemIds(env, source.id, item.item_id, { videoId });
	const ownerId = ((await loadChannelRecord(env as never, source.channel_id).catch(() => null)) as { userId?: string } | null)?.userId;
	await markVideoImported(env, videoId, ownerId ?? actorId, {
		platform: 'youtube',
		videoId: item.item_id,
		publishedAt: item.original_at != null ? iso(item.original_at) : null,
		madeForKids: false,
		importId: source.yt_import_id ?? source.id,
	}).catch((error) => logger.warn('[Takeout] Could not mark the video imported', { videoId, error: error instanceof Error ? error.message : String(error) }));
	await setFile(env, file.id, { state: 'uploading', video_id: videoId });
	logger.info('[Takeout] Upload opened', { sourceId: source.id, fileId, itemId: item.item_id, videoId, reused: !!upload.reused });
	return { file: await viewTakeoutFile(env, (await readTakeoutFile(env, source.id, fileId))!), upload };
}

/** The app sent the whole file: the job posts the record's video. */
export async function markTakeoutUploaded(env: SourceSyncEnv, source: SourceRow, fileId: string, actorId: string): Promise<{ file: TakeoutFileView; jobId: string; status: string }> {
	const file = await readTakeoutFile(env, source.id, fileId);
	if (!file) throw new SourceError(404, 'file_not_found', 'No such Takeout file');
	if (file.state !== 'uploading' && file.state !== 'uploaded' && file.state !== 'attached') throw new SourceError(409, 'not_uploading', 'Open the upload first');
	if (file.state === 'uploading') await setFile(env, file.id, { state: 'uploaded' });
	const job = await startTakeoutJob(env, source, actorId);
	return { file: await viewTakeoutFile(env, (await readTakeoutFile(env, source.id, fileId))!), jobId: job.id, status: job.status };
}
