/**
 * Internal processing-health endpoints (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). The admin API proxies these behind its
 * `videos:processing` permission and writes the audit row (apps/admin-api,
 * endpoints/processing). Not part of the public contract.
 *
 *   GET  /internal/processing/videos?status=stuck|processing|failed|r2_failed|stalled|needs_reupload|all&bunny=1&limit=&offset=
 *                                          one page in date order; nextOffset: where the next starts (null after the last)
 *   GET  /internal/processing/errors       failed/flagged videos + dead-lettered checks + failed thumbnail runs + index drift
 *   GET  /internal/processing/thumbnails   recent thumbnail aspect repair runs (admin jobs)
 *   POST /internal/processing/thumbnails   { ids?: string[], dryRun?: boolean, actorId } → queued run (dry run by default)
 *   POST /internal/processing/thumbnails/:jobId/retry  resume a failed run
 *   POST /internal/processing/index-rebuild  { kind, actorId } → queued index rebuild (Errors page drift flag):
 *                                          kind video|channel|profile (ownership) or search:<entity> (search table)
 *   POST /internal/processing/index-repairs/retry  { entity?, id? } → failed per-object repairs back to pending (all when omitted)
 *   POST /internal/processing/sync         { ids: string[], dryRun?: boolean } (apply = queue the check now)
 *   POST /internal/processing/retry        { ids: string[] }
 *   POST /internal/processing/mark-failed  { ids: string[], reason?: string }
 */

import type { VideoStates } from '../../lib/media/failures';
import { bunnyRef } from '../../lib/media/providers';
import { Hono } from 'hono';
import { readErasureDeadLetters, type ErasureDeadLetter } from '../../lib/privacy/erasure-dead-letters';
import { logger } from '../../lib/logger';
import R2Repository from '../../lib/r2Repo';
import {
	fetchBunnyVideo,
	ProcessingEnv,
	readSweepStats,
	startProcessingLoop,
	syncVideoFromBunny,
} from '../../lib/processing/loop';
import { announceAndRecordProcessingResult, pendingProcessingResult } from '../../lib/notification-events';
import { createJob, getJob, listJobs, retryJob, type JobEnv } from '../../lib/admin/jobs';
import { THUMBNAIL_REPAIR_JOB, THUMBNAIL_REPAIR_TARGET, isStillFlagged, latestFlagged, type FlaggedThumbnails } from '../../lib/thumbnail/repair';
import { isSourceChanged, SOURCE_CHANGED_REASON } from '../../lib/media/source-changed';
import { isOwnershipComplete, keysetArms, readOwnershipDrift } from '../../lib/search/ownership';
import { isOwnershipKind, ownershipRebuildJobs, startOwnershipRebuild, type OwnershipRebuildEnv } from '../../lib/search/ownershipRebuild';
import { isSearchEntity, readSearchDrift, searchReconcileJobs, startSearchReconcile, type SearchReconcileEnv } from '../../lib/search/backfill';
import { readIndexRepairs, repairJobs, retryIndexRepairs, type RepairJobEnv } from '../../lib/search/repairs';
import { ALL_OWNERSHIP_KINDS, INDEX_REPAIR_ENTITIES, OWNERSHIP_TABLE, SEARCH_ENTITY_TYPES, type AdminJob, type IndexRepair, type IndexRepairEntity, type OwnershipDrift, type SearchDrift } from '@al-ummah/shared-types';

const MAX_IDS = 100;
/** Max concurrent live Bunny API calls per request (stays under Cloudflare's 6-connection cap). */
export const PROCESSING_BUNNY_CONCURRENCY = 5;
/** Hard cap on live Bunny API calls per list request when `?bunny=1` is requested. */
export const PROCESSING_MAX_LIVE_BUNNY = 25;
/** Max concurrent R2 object reads per list request. */
export const PROCESSING_R2_CONCURRENCY = 20;
/** Max R2 objects read per indexed list request across keyset pages (stays under Workers' subrequest limit). */
export const PROCESSING_INDEX_SCAN_CAP = 800;
/** Max R2 objects scanned per request when falling back without a complete ownership index. */
export const PROCESSING_FALLBACK_SCAN_CAP = 1000;

const PROCESSING_STATUSES = ['initiated', 'uploading', 'processing'] as const;
const NON_READY_STATUSES = [...PROCESSING_STATUSES, 'failed'] as const;

async function mapLimited<T, R>(items: readonly T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Math.min(Math.max(1, concurrency), items.length);
	await Promise.all(
		Array.from({ length: workers }, async () => {
			while (next < items.length) {
				const idx = next++;
				results[idx] = await fn(items[idx], idx);
			}
		}),
	);
	return results;
}

/** The videos each filter is of (the record then decides, matches()): a filter never reads other states' rows. */
const LISTED = {
	stuck: { states: [...NON_READY_STATUSES], r2Failed: true },
	processing: { states: [...PROCESSING_STATUSES] },
	failed: { states: ['failed'], r2Failed: true },
	r2_failed: { states: [], r2Failed: true },
	stalled: { states: [...PROCESSING_STATUSES], oldest: true },
	needs_reupload: { states: [...NON_READY_STATUSES] },
	all: { states: [], all: true },
	flagged: { states: [...PROCESSING_STATUSES], oldest: true },
} satisfies Record<string, VideoStates>;

const pageStart = (value: string | undefined) => Math.min(Math.max(parseInt(value || '0', 10) || 0, 0), 100_000);

interface HealthVideo {
	id: string;
	title?: string;
	channelId?: string;
	userId?: string;
	dateCreated?: string;
	dateModified?: string;
	uploadStatus?: string;
	isPublic?: boolean;
	isDeleted?: boolean;
	availableResolutions?: string[];
	thumbnailUrl?: string;
	playUrl?: string;
	processingIssue?: { kind: string; reason?: string; at: string };
	processingCheck?: Record<string, unknown>;
	processingAnnounced?: 'ready' | 'failed';
	/** Removed by the upload reaper (Stale uploads view) */
	abandoned?: unknown;
	r2?: { status: string };
}

function parseIds(body: unknown): string[] | null {
	const ids = (body as { ids?: unknown })?.ids;
	if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
	const clean = ids.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id));
	return clean.length === ids.length ? [...new Set(clean)] : null;
}

function matches(video: HealthVideo, status: string): boolean {
	if (video.isDeleted) return false;
	if (status === 'all') return true;
	if (video.abandoned) return false;

	// An R2 transcode can fail while the video is playable from Bunny.
	const r2Failed = video.r2?.status === 'failed';
	const notReady = video.uploadStatus !== 'ready';
	switch (status) {
		case 'processing':
			return PROCESSING_STATUSES.some((state) => state === video.uploadStatus);
		case 'failed':
			return video.uploadStatus === 'failed' || r2Failed;
		case 'r2_failed':
			return r2Failed;
		case 'stalled':
			return notReady && video.processingIssue?.kind === 'stalled';
		case 'needs_reupload':
			return notReady && video.processingIssue?.kind === 'needs_reupload';
		case 'flagged':
			return notReady && !r2Failed && video.uploadStatus !== 'failed' && !!video.processingIssue;
		case 'errors':
			return video.uploadStatus === 'failed' || r2Failed || (notReady && !!video.processingIssue);
		default:
			return r2Failed || (notReady && (!!video.uploadStatus || !!video.processingIssue));
	}
}

interface StoredBunnyView {
	status?: number;
	encodeProgress?: number;
	availableResolutions?: string | null;
	length?: number;
	storageSize?: number;
	width?: number;
	height?: number;
	error?: string;
}

/**
 * Derive the Bunny column from the video's stored processing-check state (0 Bunny API calls).
 * Live Bunny state is only fetched on Sync or when a caller explicitly passes `?bunny=1`.
 */
function storedBunnyView(video: HealthVideo): StoredBunnyView | null | undefined {
	if (!bunnyRef(video as never)) return null;
	const check = video.processingCheck as
		| {
				bunnyStatus?: number;
				bunnyProgress?: number;
				bunnyResolutions?: string | null;
				bunnyMissing?: boolean;
				lastCheckedAt?: string;
				outcome?: string;
		  }
		| undefined;
	if (check?.bunnyMissing) return null;
	if (typeof check?.bunnyStatus === 'number') {
		const resolutions = check.bunnyResolutions ?? (video.availableResolutions?.length ? video.availableResolutions.join(',') : null);
		return {
			status: check.bunnyStatus,
			...(typeof check.bunnyProgress === 'number' ? { encodeProgress: check.bunnyProgress } : {}),
			...(resolutions ? { availableResolutions: resolutions } : {}),
		};
	}
	if (check?.lastCheckedAt && check.outcome === 'needs_reupload' && video.processingIssue?.reason === 'Video not found at Bunny') {
		return null;
	}
	if (video.uploadStatus === 'ready') {
		const resolutions = video.availableResolutions?.length ? video.availableResolutions.join(',') : null;
		return {
			status: 4,
			encodeProgress: 100,
			...(resolutions ? { availableResolutions: resolutions } : {}),
		};
	}
	return undefined;
}

interface CandidateRow {
	id: string;
	created_at: number;
}

interface CandidatePage {
	items: HealthVideo[];
	scanned: number;
	truncated: boolean;
	next: number | null;
}

/** One bounded keyset seek per state and cursor arm, merged outside D1. */
async function indexedRows(
	db: D1Database,
	of: VideoStates,
	limit: number,
	cursor: CandidateRow | undefined,
	channelId?: string,
): Promise<CandidateRow[]> {
	const direction = of.oldest ? 'ASC' : 'DESC';
	const order = `COALESCE(created_at, 0) ${direction}, id ${direction}`;
	const arms = cursor
		? keysetArms(['COALESCE(created_at, 0)', 'id'], direction, [cursor.created_at, cursor.id])
		: [{ where: '1 = 1', params: [], orderBy: order }];
	const channelClause = channelId ? ' AND channel_id = ?' : '';
	const channelBinds = channelId ? [channelId] : [];
	const states = of.all ? [null] : of.states;
	const queries = states.flatMap((state) => arms.map((arm) => ({
		sql: `SELECT * FROM (SELECT id, COALESCE(created_at, 0) AS created_at FROM ${OWNERSHIP_TABLE}
			WHERE kind = 'video' AND is_deleted = 0${state ? ' AND upload_status = ?' : ''}${channelClause}
			AND ${arm.where} ORDER BY ${arm.orderBy} LIMIT ?)`,
		params: [...(state ? [state] : []), ...channelBinds, ...arm.params, limit],
	})));
	if (!queries.length) return [];
	const { results } = await db.prepare(queries.map((q) => q.sql).join(' UNION ALL ')).bind(...queries.flatMap((q) => q.params)).all<CandidateRow>();
	return results ?? [];
}

function compareRows(a: CandidateRow, b: CandidateRow): number {
	return a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Read only failed jobs and look up each video by primary key, including playable videos.
 * The job index orders by job time, so only this subset is sorted by video creation time.
 */
async function r2FailedRows(db: D1Database, limit: number, channelId?: string): Promise<CandidateRow[]> {
	const { results } = await db.prepare(
		`SELECT v.id, COALESCE(v.created_at, 0) AS created_at
		FROM media_jobs j INDEXED BY idx_media_jobs_status
		CROSS JOIN ${OWNERSHIP_TABLE} v ON v.kind = 'video' AND v.id = j.video_id
		WHERE j.status = 'failed' AND v.is_deleted = 0${channelId ? ' AND v.channel_id = ?' : ''}
		ORDER BY COALESCE(v.created_at, 0) DESC, v.id DESC LIMIT ?`,
	).bind(...(channelId ? [channelId, limit] : [limit])).all<CandidateRow>();
	return results ?? [];
}

async function readHealthVideo(bucket: R2Bucket, key: string): Promise<HealthVideo | null> {
	try {
		return (await (await bucket.get(key))?.json<HealthVideo>()) ?? null;
	} catch {
		return null;
	}
}

async function loadIndexedCandidates(
	db: D1Database,
	bucket: R2Bucket,
	status: keyof typeof LISTED,
	limit: number,
	channelId: string | undefined,
	from: number,
	budget: number,
): Promise<CandidatePage> {
	const of: VideoStates = LISTED[status];
	const compare = of.oldest ? compareRows : (a: CandidateRow, b: CandidateRow) => compareRows(b, a);
	const r2Rows = of.r2Failed ? await r2FailedRows(db, from + budget + 1, channelId) : [];
	const filterByIssue = status === 'stalled' || status === 'needs_reupload' || status === 'flagged';
	const batchSize = filterByIssue ? Math.min(Math.max(limit, 100), 200) : limit;
	const items: HealthVideo[] = [];
	let scanned = 0;
	let at = 0;
	let r2At = 0;
	let cursor: CandidateRow | undefined;
	while (scanned < budget) {
		// Keep numeric offsets for the admin's page links. Skip earlier ids without fetching their R2 records.
		const size = at < from ? Math.min(from - at, 500) : Math.min(batchSize, budget - scanned);
		const rows = await indexedRows(db, of, size + 1, cursor, channelId);
		rows.push(...r2Rows.slice(r2At, r2At + size + 1));
		const ordered = [...new Map(rows.map((row) => [row.id, row])).values()].sort(compare);
		const page = ordered.slice(0, size);
		if (at >= from) {
			scanned += page.length;
			const loaded = await mapLimited(page, PROCESSING_R2_CONCURRENCY, (row) => readHealthVideo(bucket, row.id));
			const end = at + ordered.length;
			for (const video of loaded) {
				at++;
				if (!video?.id || !matches(video, status) || (channelId && video.channelId !== channelId)) continue;
				items.push(video);
				if (items.length === limit) {
					return { items, scanned, truncated: false, next: at < end ? at : null };
				}
			}
		} else {
			at += page.length;
		}
		if (ordered.length <= size) return { items, scanned, truncated: false, next: null };
		cursor = page[page.length - 1];
		while (r2At < r2Rows.length && compare(r2Rows[r2At], cursor) <= 0) r2At++;
	}
	return { items, scanned, truncated: true, next: at };
}

async function loadProcessingCandidates(
	env: ProcessingEnv,
	status: string,
	limit: number,
	channelId?: string,
	from = 0,
): Promise<CandidatePage> {
	const db = env.SEARCH_DB;
	const filter = Object.hasOwn(LISTED, status) ? status as keyof typeof LISTED : 'stuck';
	if (db) {
		try {
			// R2-only failures are selected by media_jobs, independently of the upload-status index.
			if (status === 'r2_failed' || await isOwnershipComplete(db, 'video')) {
				const read = (of: keyof typeof LISTED, count: number, offset: number, budget: number) =>
					loadIndexedCandidates(db, env.videos, of, count, channelId, offset, budget);
				if (status !== 'errors') return await read(filter, limit, from, PROCESSING_INDEX_SCAN_CAP);
				// Show actual failures first, followed by the oldest flagged uploads.
				const failed = await read('failed', limit, 0, PROCESSING_INDEX_SCAN_CAP);
				if (failed.items.length === limit || failed.truncated) return failed;
				const flagged = await read('flagged', limit - failed.items.length, 0, PROCESSING_INDEX_SCAN_CAP - failed.scanned);
				return { ...flagged, items: [...failed.items, ...flagged.items], scanned: failed.scanned + flagged.scanned };
			}
		} catch (error) {
			logger.warn('[ProcessingAdmin] Ownership index lookup failed; falling back to bounded R2 scan', {
				status,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const items: HealthVideo[] = [];
	let scanned = 0;
	let cursor: string | undefined;
	do {
		const page = await env.videos.list({ cursor, limit: Math.min(200, PROCESSING_FALLBACK_SCAN_CAP - scanned) });
		cursor = page.truncated ? page.cursor : undefined;
		const keys = page.objects.map((object) => object.key).filter((key) => !key.includes('/') && !key.includes(':'));
		// Count listed metadata keys too, to bound requests even when a bucket contains no video records.
		scanned += page.objects.length;
		const loaded = await mapLimited(keys, PROCESSING_R2_CONCURRENCY, (key) => readHealthVideo(env.videos, key));
		items.push(...loaded.filter((video): video is HealthVideo => !!video?.id && matches(video, status) && (!channelId || video.channelId === channelId)));
	} while (cursor && scanned < PROCESSING_FALLBACK_SCAN_CAP);
	const row = (video: HealthVideo): CandidateRow => ({ id: video.id, created_at: Date.parse(video.dateCreated ?? '') || 0 });
	items.sort((a, b) => {
		if (status === 'errors') {
			const aFailed = matches(a, 'failed');
			const bFailed = matches(b, 'failed');
			if (aFailed !== bFailed) return aFailed ? -1 : 1;
			return aFailed ? compareRows(row(b), row(a)) : compareRows(row(a), row(b));
		}
		const of: VideoStates = LISTED[filter];
		return of.oldest ? compareRows(row(a), row(b)) : compareRows(row(b), row(a));
	});
	return { items: items.slice(from, from + limit), scanned, truncated: !!cursor, next: items.length > from + limit ? from + limit : null };
}

/** Failed thumbnail repair runs, for the Errors page (an unreadable jobs table is logged, not fatal). */
/**
 * Thumbnails the latest every-video check flagged (shape differs from the
 * video), minus the ones whose thumbnail changed since. Null when unreadable.
 */
async function flaggedThumbnails(env: JobEnv & { videos: R2Bucket }): Promise<(FlaggedThumbnails & { total: number }) | null> {
	try {
		const flagged = latestFlagged(await listJobs(env, { targetKind: 'video', targetId: THUMBNAIL_REPAIR_TARGET, limit: 20 }));
		if (!flagged) return null;
		const repo = new R2Repository<{ id: string; title?: string; channelId?: string; isDeleted?: boolean; thumbnailCheck?: { outcome?: string } }>(env.videos);
		const items = (
			await Promise.all(
				flagged.items.slice(0, 100).map(async (item) => {
					const record = await repo.getObject(item.videoId).catch(() => null);
					return isStillFlagged(record) ? { ...item, title: record?.title, channelId: record?.channelId } : null;
				}),
			)
		).filter((item): item is NonNullable<typeof item> => !!item);
		return { ...flagged, items, total: items.length };
	} catch (error) {
		logger.warn('[ProcessingAdmin] Flagged thumbnails unavailable', { error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

/**
 * Ownership index drift flags (a finished pass found the index short of the
 * objects in R2), each with its latest rebuild job. Empty when unreadable.
 */
async function indexDrift(env: OwnershipRebuildEnv): Promise<Array<OwnershipDrift & { rebuild: AdminJob | null }>> {
	if (!env.SEARCH_DB) return [];
	try {
		const flags = await readOwnershipDrift(env.SEARCH_DB);
		return await Promise.all(flags.map(async (flag) => ({ ...flag, rebuild: (await ownershipRebuildJobs(env, flag.kind, 1))[0] ?? null })));
	} catch (error) {
		logger.warn('[ProcessingAdmin] Index drift unavailable', { error: error instanceof Error ? error.message : String(error) });
		return [];
	}
}

async function failedThumbnailRuns(env: JobEnv) {
	try {
		const runs = await listJobs(env, { targetKind: 'video', targetId: THUMBNAIL_REPAIR_TARGET, limit: 20 });
		return runs.filter((run) => run.status === 'failed');
	} catch (error) {
		logger.warn('[ProcessingAdmin] Thumbnail runs unavailable', { error: error instanceof Error ? error.message : String(error) });
		return [];
	}
}

/** Search table drift flags, each with its latest reconcile job. Empty when unreadable. */
async function searchDrift(env: SearchReconcileEnv): Promise<Array<SearchDrift & { rebuild: AdminJob | null }>> {
	if (!env.SEARCH_DB) return [];
	try {
		const flags = await readSearchDrift(env.SEARCH_DB);
		return await Promise.all(flags.map(async (flag) => ({ ...flag, rebuild: (await searchReconcileJobs(env, flag.entity, 1))[0] ?? null })));
	} catch (error) {
		logger.warn('[ProcessingAdmin] Search drift unavailable', { error: error instanceof Error ? error.message : String(error) });
		return [];
	}
}

/** Per-object repairs: pending count, the failed ones (Retry) and the latest repair job. Null when unreadable. */
async function indexRepairs(env: RepairJobEnv): Promise<{ pending: number; failedTotal: number; failed: IndexRepair[]; job: AdminJob | null } | null> {
	if (!env.SEARCH_DB) return null;
	try {
		const repairs = await readIndexRepairs(env.SEARCH_DB);
		return { ...repairs, job: (await repairJobs(env, 1))[0] ?? null };
	} catch (error) {
		logger.warn('[ProcessingAdmin] Index repairs unavailable', { error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

/**
 * Index maintenance in progress: the latest reconcile/rebuild job of every
 * index (ownership kinds, search tables), with its progress (pages, objects).
 */
async function indexMaintenance(env: OwnershipRebuildEnv & SearchReconcileEnv): Promise<Array<{ index: string; job: AdminJob }>> {
	if (!env.SEARCH_DB) return [];
	try {
		const ownership = await Promise.all(ALL_OWNERSHIP_KINDS.map(async (kind) => ({ index: kind as string, job: (await ownershipRebuildJobs(env, kind, 1))[0] })));
		const search = await Promise.all(SEARCH_ENTITY_TYPES.map(async (entity) => ({ index: `search:${entity}`, job: (await searchReconcileJobs(env, entity, 1))[0] })));
		return [...ownership, ...search].filter((row): row is { index: string; job: AdminJob } => !!row.job);
	} catch (error) {
		logger.warn('[ProcessingAdmin] Index maintenance unavailable', { error: error instanceof Error ? error.message : String(error) });
		return [];
	}
}

export function createProcessingInternalRouter() {
	const app = new Hono<{ Bindings: ProcessingEnv }>();

	app.get('/videos', async (c) => {
		const status = c.req.query('status') || 'stuck';
		const withBunny = c.req.query('bunny') === '1';
		const channelId = c.req.query('channelId');
		const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);
		const from = pageStart(c.req.query('offset'));
		const [{ items: page, scanned, truncated, next }, reconciler] = await Promise.all([
			loadProcessingCandidates(c.env, status, limit, channelId, from),
			readSweepStats(c.env),
		]);
		const liveBunny = withBunny
			? await mapLimited(page.slice(0, PROCESSING_MAX_LIVE_BUNNY), PROCESSING_BUNNY_CONCURRENCY, async (video) => {
					try {
						// Bunny's copy is under its own id (new videos: the stored GUID); none, nothing to read
						const bunnyId = bunnyRef(video as never);
						const b = bunnyId ? await fetchBunnyVideo(c.env, bunnyId, video as never) : null;
						return b
							? { status: b.status, encodeProgress: b.encodeProgress, availableResolutions: b.availableResolutions, length: b.length, storageSize: b.storageSize, width: b.width, height: b.height }
							: null;
					} catch (error) {
						return { error: error instanceof Error ? error.message : String(error) };
					}
				})
			: null;
		const rows = page.map((video, index) => {
			const bunny = liveBunny && index < liveBunny.length ? liveBunny[index] : storedBunnyView(video);
			return {
				id: video.id,
				title: video.title,
				channelId: video.channelId,
				userId: video.userId,
				dateCreated: video.dateCreated,
				dateModified: video.dateModified,
				uploadStatus: video.uploadStatus,
				isPublic: video.isPublic,
				availableResolutions: video.availableResolutions ?? [],
				thumbnailUrl: video.thumbnailUrl,
				r2Status: video.r2?.status ?? null,
				processingIssue: video.processingIssue ?? null,
				processingCheck: video.processingCheck ?? null,
				...(bunny !== undefined ? { bunny } : {}),
			};
		});
		return c.json({ success: true, result: { items: rows, scanned, nextOffset: next, ...(truncated ? { truncated: true } : {}), reconciler } });
	});

	// Dry run (default): Bunny is read and the plan returned, nothing written.
	// Apply: each video's check loop is (re)started through the queue, which
	// syncs it now and keeps checking until Bunny finishes (retry, backoff, DLQ).
	app.post('/sync', async (c) => {
		const body = await c.req.json().catch(() => null);
		const ids = parseIds(body);
		if (!ids) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids` }, 400);
		const dryRun = (body as { dryRun?: unknown }).dryRun !== false;
		const results = await mapLimited(ids, PROCESSING_BUNNY_CONCURRENCY, async (id) => {
			try {
				if (dryRun) return await syncVideoFromBunny(c.env, id, { dryRun: true });
				return { videoId: id, ...(await startProcessingLoop(c.env, id, { reason: 'admin-sync', force: true, initialDelaySeconds: 0 })) };
			} catch (error) {
				return { videoId: id, error: error instanceof Error ? error.message : String(error) };
			}
		});
		logger.debug('[ProcessingAdmin] Sync from Bunny', { count: ids.length, dryRun });
		return c.json({ success: true, result: { dryRun, results } });
	});

	// Failures that need an admin: flagged / failed videos and dead-lettered
	// processing checks (stored by the processor's DLQ consumer in NOTIFICATIONS_DB).
	app.get('/errors', async (c) => {
		const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);
		const { items: videos, next, truncated } = await loadProcessingCandidates(c.env, 'errors', limit);
		const moreVideos = next !== null || truncated || videos.length === limit;
		videos.sort((a, b) => (b.processingIssue?.at || b.dateModified || '').localeCompare(a.processingIssue?.at || a.dateModified || ''));
		let deadLetters: unknown[] = [];
		const db = (c.env as { NOTIFICATIONS_DB?: D1Database }).NOTIFICATIONS_DB;
		if (db) {
			try {
				const { results } = await db
					.prepare(
						`SELECT id, type_name, dlq, attempts, failure_reason, body_json, received_at FROM dead_letters
						 WHERE replayed_at IS NULL AND body_json LIKE '%"kind":"processing-check"%' ORDER BY received_at DESC LIMIT ?`,
					)
					.bind(limit)
					.all<{ id: string; dlq: string; attempts: number; failure_reason: string | null; body_json: string; received_at: string | number }>();
				deadLetters = (results ?? []).map((row) => {
					let videoId: string | undefined;
					try {
						videoId = (JSON.parse(row.body_json) as { videoId?: string }).videoId;
					} catch {
						videoId = undefined;
					}
					return { id: row.id, dlq: row.dlq, attempts: row.attempts, failureReason: row.failure_reason, receivedAt: row.received_at, videoId };
				});
			} catch (error) {
				logger.warn('[ProcessingAdmin] Dead letters unavailable', { error: error instanceof Error ? error.message : String(error) });
			}
		}
		// Account erasure steps that failed for good (#616): the Errors page lists them too
		let erasureDeadLetters: ErasureDeadLetter[] = [];
		if (db) {
			try {
				erasureDeadLetters = await readErasureDeadLetters(db, limit);
			} catch (error) {
				logger.warn('[ProcessingAdmin] Erasure dead letters unavailable', { error: error instanceof Error ? error.message : String(error) });
			}
		}
		return c.json({
			success: true,
			result: {
				videos: videos.map((v) => ({
					id: v.id,
					title: v.title,
					channelId: v.channelId,
					userId: v.userId,
					uploadStatus: v.uploadStatus,
					processingIssue: v.processingIssue ?? null,
					dateCreated: v.dateCreated,
					dateModified: v.dateModified,
				})),
				moreVideos,
				...(truncated ? { truncated: true } : {}),
				deadLetters,
				erasureDeadLetters,
				thumbnailRuns: await failedThumbnailRuns(c.env as unknown as JobEnv),
				thumbnailFlagged: await flaggedThumbnails(c.env as never),
				indexDrift: await indexDrift(c.env as unknown as OwnershipRebuildEnv),
				searchDrift: await searchDrift(c.env as unknown as SearchReconcileEnv),
				indexRepairs: await indexRepairs(c.env as unknown as RepairJobEnv),
				indexMaintenance: await indexMaintenance(c.env as never),
				reconciler: await readSweepStats(c.env),
			},
		});
	});

	// Thumbnail aspect repair (lib/thumbnail/repair.ts): an admin job, dry run first
	app.get('/thumbnails', async (c) => {
		const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '1', 10) || 1, 1), 20);
		const runs = await listJobs(c.env as unknown as JobEnv, { targetKind: 'video', targetId: THUMBNAIL_REPAIR_TARGET, limit });
		return c.json({ success: true, result: { runs } });
	});

	app.post('/thumbnails', async (c) => {
		const body = ((await c.req.json().catch(() => null)) ?? {}) as { ids?: unknown; dryRun?: unknown; actorId?: unknown };
		const ids = body.ids === undefined ? undefined : parseIds(body);
		if (ids === null) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids (omit for every video)` }, 400);
		const dryRun = body.dryRun !== false;
		const actorId = typeof body.actorId === 'string' && body.actorId ? body.actorId.slice(0, 128) : 'admin';
		const job = await createJob(c.env as unknown as JobEnv, {
			kind: THUMBNAIL_REPAIR_JOB,
			targetKind: 'video',
			targetId: THUMBNAIL_REPAIR_TARGET,
			params: { dryRun, ...(ids ? { ids } : {}) },
			actorId,
		});
		logger.info('[ProcessingAdmin] Thumbnail repair queued', { jobId: job.id, dryRun, scope: ids ? ids.length : 'all', status: job.status });
		return c.json({ success: true, result: { job } }, 202);
	});

	app.post('/thumbnails/:jobId/retry', async (c) => {
		const env = c.env as unknown as JobEnv;
		const existing = await getJob(env, c.req.param('jobId'));
		if (!existing || existing.kind !== THUMBNAIL_REPAIR_JOB) return c.json({ success: false, error: 'Unknown thumbnail run' }, 404);
		if (existing.status !== 'failed') return c.json({ success: false, error: 'Only a failed run can be retried' }, 409);
		return c.json({ success: true, result: { job: await retryJob(env, existing.id) } });
	});

	// Index rebuild: the Errors page's "Index out of sync" Rebuild. Ownership kinds
	// (lib/search/ownershipRebuild.ts) or a search table (`search:<entity>`, lib/search/backfill.ts)
	app.post('/index-rebuild', async (c) => {
		const body = ((await c.req.json().catch(() => null)) ?? {}) as { kind?: unknown; actorId?: unknown };
		const searchEntity = typeof body.kind === 'string' && body.kind.startsWith('search:') ? body.kind.slice('search:'.length) : null;
		if (!isOwnershipKind(body.kind) && !isSearchEntity(searchEntity)) {
			return c.json({ success: false, error: 'kind must be video, channel, profile or search:<video|channel|playlist|post>' }, 400);
		}
		const env = c.env as unknown as OwnershipRebuildEnv & SearchReconcileEnv;
		if (!env.SEARCH_DB) return c.json({ success: false, error: 'SEARCH_DB is not bound' }, 503);
		const actorId = typeof body.actorId === 'string' && body.actorId ? body.actorId.slice(0, 128) : 'admin';
		const { job, existing } = isSearchEntity(searchEntity)
			? await startSearchReconcile(env, searchEntity, actorId, { fresh: true })
			: await startOwnershipRebuild(env, body.kind as never, actorId);
		return c.json({ success: true, result: { job, existing } }, existing ? 200 : 202);
	});

	// Per-object index repairs that failed after their retries (Errors page): back to pending, job started
	app.post('/index-repairs/retry', async (c) => {
		const body = ((await c.req.json().catch(() => null)) ?? {}) as { entity?: unknown; id?: unknown };
		const env = c.env as unknown as RepairJobEnv;
		if (!env.SEARCH_DB) return c.json({ success: false, error: 'SEARCH_DB is not bound' }, 503);
		let target: { entity: IndexRepairEntity; id: string } | undefined;
		if (body.entity !== undefined || body.id !== undefined) {
			if (typeof body.entity !== 'string' || !(INDEX_REPAIR_ENTITIES as readonly string[]).includes(body.entity) || typeof body.id !== 'string' || !body.id || body.id.length > 200) {
				return c.json({ success: false, error: 'entity and id name one repair (omit both to retry every failed one)' }, 400);
			}
			target = { entity: body.entity as IndexRepairEntity, id: body.id };
		}
		const result = await retryIndexRepairs(env, target);
		return c.json({ success: true, result });
	});

	app.post('/retry', async (c) => {
		const ids = parseIds(await c.req.json().catch(() => null));
		if (!ids) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids` }, 400);
		const results = [];
		for (const id of ids) {
			try {
				// Clear a stalled/failed flag so the loop decides again from Bunny's state
				let changed = false;
				await new R2Repository<HealthVideo>(c.env.videos).updateObject(id, (fresh) => {
					changed = isSourceChanged(fresh);
					if (changed) return false;
					if (!fresh.processingIssue && fresh.uploadStatus !== 'failed') return false;
					delete fresh.processingIssue;
					if (fresh.uploadStatus === 'failed') {
						fresh.uploadStatus = 'processing';
						// The retried attempt gets its own "ready" / "failed" announcement
						delete fresh.processingAnnounced;
					}
					return true;
				});
				if (changed) {
					results.push({ videoId: id, started: false, why: SOURCE_CHANGED_REASON });
					continue;
				}
				results.push({ videoId: id, ...(await startProcessingLoop(c.env, id, { reason: 'admin-retry', force: true, initialDelaySeconds: 0 })) });
			} catch (error) {
				results.push({ videoId: id, started: false, why: error instanceof Error ? error.message : String(error) });
			}
		}
		return c.json({ success: true, result: { results } });
	});

	app.post('/mark-failed', async (c) => {
		const body = await c.req.json().catch(() => null);
		const ids = parseIds(body);
		if (!ids) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids` }, 400);
		const reasonRaw = (body as { reason?: unknown }).reason;
		const reason = typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim().slice(0, 300) : 'Marked by an admin: upload again';
		const now = new Date().toISOString();
		const repo = new R2Repository<HealthVideo>(c.env.videos);
		const results = [];
		for (const id of ids) {
			let transitioned = false;
			const saved = await repo.updateObject(id, (fresh) => {
				transitioned = fresh.uploadStatus !== 'failed';
				if (!transitioned && fresh.processingIssue?.kind === 'needs_reupload') return false;
				fresh.uploadStatus = 'failed';
				fresh.processingIssue = { kind: 'needs_reupload', reason, at: now };
				if (fresh.processingCheck && !fresh.processingCheck.finishedAt) {
					fresh.processingCheck = { ...fresh.processingCheck, finishedAt: now, outcome: 'marked_failed', nextCheckAt: undefined };
				}
				fresh.dateModified = now;
				return true;
			});
			// Tell the uploader. Also repeats an earlier announcement that never
			// landed, so re-running mark-failed recovers a lost notification.
			let announced = true;
			if (saved && pendingProcessingResult(saved) === 'failed') {
				try {
					await announceAndRecordProcessingResult(c.env as never, { ...saved, id }, 'failed');
				} catch (error) {
					announced = false;
					logger.error('[ProcessingAdmin] Failed notification not queued; run mark-failed again', {
						videoId: id,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
			results.push({ videoId: id, found: !!saved, changed: !!saved && transitioned, announced });
		}
		return c.json({ success: true, result: { results } });
	});

	return app;
}
