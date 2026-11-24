/**
 * Urgent & CSAM offline download revocations (Epic 14, E14-D8 / E14-S11a).
 *
 * Mandatory 4-step order for every takedown:
 *   1. Block video metadata first (`isHidden` / `isDeleted` / `csamTakedown` / `isPublic = false`)
 *      so `POST /api/v1/videos/:id/downloads` immediately returns `404 not_found` and
 *      `POST /api/v1/downloads/sync` returns `available: false`.
 *   2. (CSAM path) Finish encrypted evidence preservation BEFORE touching `pub/`.
 *   3. Delete/tombstone `pub/<videoId>/` (and `priv/<videoId>/`) and purge Cloudflare edge cache
 *      by prefix (`purgeVideoRenditions(..., { strict: true })`).
 *   4. Append `(event_id, video_id, created_at)` to `download_revocations` LAST via
 *      `INSERT OR IGNORE` keyed on `UNIQUE(event_id)`.
 *
 * If step 3 or 4 fails on a manual admin takedown, the `downloads.revoke` admin job is queued on
 * `ADMIN_JOBS_QUEUE` with the exact same `eventId` for automatic retries, DLQ, and an Admin Errors
 * alert (`O26`) on final exhaustion so an urgent purge is never silently dropped.
 */
import {
	ADMIN_JOB_MAX_RETRIES,
	reportNeedsAction,
	resolveNeedsAction,
	type AdminJob,
	type ErrorReporterEnv,
} from '@al-ummah/shared-types';
import { createJob, type JobEnv, type JobOutcome } from '../admin/jobs';
import { purgeVideoRenditions, type MediaEnv } from '../media/r2-delivery';
import R2Repository from '../r2Repo';
import { logger } from '../logger';

export const REVOCATIONS_PAGE_SIZE = 100;

export interface RevocationItem {
	seq: number;
	videoId: string;
}

export interface RevocationsPage {
	items: RevocationItem[];
	nextCursor: number;
	hasMore: boolean;
}

export type DownloadRevokeEnv = JobEnv &
	Partial<MediaEnv> &
	ErrorReporterEnv & {
		videos?: R2Bucket;
		SEARCH_DB?: D1Database;
	};

export interface DownloadRevokeParams {
	videoId: string;
	eventId: string;
	reason?: string;
}

const SAFE_EVENT_ID = /^[A-Za-z0-9:_-]{1,160}$/;
const SAFE_VIDEO_ID = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Idempotently appends one takedown event to `download_revocations`.
 * Keyed on `UNIQUE(event_id)` so retries of the same takedown keep the same `seq`,
 * while a second takedown of a previously restored video uses a new `event_id` and
 * receives a new higher `seq`.
 */
export async function appendDownloadRevocation(
	db: D1Database,
	input: { eventId: string; videoId: string; createdAt?: number },
): Promise<{ inserted: boolean; seq: number }> {
	const eventId = input.eventId.trim();
	const videoId = input.videoId.trim();
	if (!SAFE_EVENT_ID.test(eventId)) {
		throw new Error(`Invalid revocation eventId: ${input.eventId}`);
	}
	if (!SAFE_VIDEO_ID.test(videoId)) {
		throw new Error(`Invalid revocation videoId: ${input.videoId}`);
	}
	const createdAt = input.createdAt ?? Date.now();
	const insert = await db
		.prepare(
			`INSERT OR IGNORE INTO download_revocations (event_id, video_id, created_at)
			 VALUES (?1, ?2, ?3)`,
		)
		.bind(eventId, videoId, createdAt)
		.run();
	const row = await db
		.prepare(`SELECT seq FROM download_revocations WHERE event_id = ?1`)
		.bind(eventId)
		.first<{ seq: number }>();
	if (!row || typeof row.seq !== 'number') {
		throw new Error(`Failed to read seq for download revocation ${eventId}`);
	}
	const changes = Number((insert.meta as { changes?: number } | undefined)?.changes ?? 0);
	return { inserted: changes > 0, seq: row.seq };
}

/**
 * Reads up to `limit` (max 100) revocations strictly after `since` in ascending `seq` order.
 * Payload carries ONLY `seq` and `videoId` — never title, channel, takedown reason, or PII.
 */
export async function listDownloadRevocations(
	db: D1Database,
	since: number,
	limit = REVOCATIONS_PAGE_SIZE,
): Promise<RevocationsPage> {
	const pageSize = Math.max(1, Math.min(REVOCATIONS_PAGE_SIZE, Math.floor(limit)));
	const { results } = await db
		.prepare(
			`SELECT seq, video_id
			 FROM download_revocations
			 WHERE seq > ?1
			 ORDER BY seq ASC
			 LIMIT ?2`,
		)
		.bind(since, pageSize + 1)
		.all<{ seq: number; video_id: string }>();

	const rows = results ?? [];
	const hasMore = rows.length > pageSize;
	const items: RevocationItem[] = rows.slice(0, pageSize).map((row) => ({
		seq: Number(row.seq),
		videoId: String(row.video_id),
	}));
	const nextCursor = items.length > 0 ? items[items.length - 1]!.seq : since;
	return { items, nextCursor, hasMore };
}

/**
 * Step 1 helper: ensures the video record in R2 is already blocked from public reads and downloads.
 * Fails loudly when `env.videos` is unbound or the R2 write fails so the caller queues a retry /
 * raises an admin alert rather than purging without confirming the metadata block.
 */
async function ensureVideoMetadataBlocked(
	env: DownloadRevokeEnv,
	videoId: string,
	eventId: string,
): Promise<boolean> {
	if (!env.videos) {
		throw new Error('videos R2 bucket is not bound');
	}
	const repo = new R2Repository<Record<string, unknown>>(env.videos);
	const saved = await repo.updateObject(videoId, (video) => {
		const alreadyBlocked = video.isDeleted === true || video.isHidden === true || video.isPublic === false;
		if (alreadyBlocked) return false;
		const now = new Date().toISOString();
		video.isHidden = true;
		video.isPublic = false;
		video.downloadRevocation = {
			eventId,
			at: now,
		};
		video.dateModified = now;
		return true;
	});
	return !!saved;
}

async function executePurgeAndAppend(
	env: DownloadRevokeEnv,
	params: DownloadRevokeParams,
): Promise<{ renditionsDeleted: number; seq: number; inserted: boolean }> {
	await ensureVideoMetadataBlocked(env, params.videoId, params.eventId);
	const renditionsDeleted = await purgeVideoRenditions(env as unknown as MediaEnv, params.videoId, { strict: true });
	if (!env.SEARCH_DB) {
		throw new Error('SEARCH_DB is not bound');
	}
	const rev = await appendDownloadRevocation(env.SEARCH_DB, {
		eventId: params.eventId,
		videoId: params.videoId,
	});
	return { renditionsDeleted, seq: rev.seq, inserted: rev.inserted };
}

/**
 * Executes the manual admin urgent/legal takedown revocation sequence:
 *   1. Block metadata first
 *   2. Delete `pub/<videoId>/` (+ `priv/<videoId>/`) and purge Cloudflare edge cache by prefix
 *   3. Append `event_id = "admin:<actionId>"` to `download_revocations`
 *
 * If step 2 or 3 fails, enqueues a resumable `'downloads.revoke'` admin job with the exact same
 * `eventId` so Cloudflare Queue retries, DLQ, and O26 Admin Errors alerting guarantee completion.
 */
export async function revokeVideoDownloads(
	env: DownloadRevokeEnv,
	input: { videoId: string; eventId: string; actorId: string; reason?: string },
): Promise<
	| { status: 'revoked'; eventId: string; videoId: string; seq: number; inserted: boolean; renditionsDeleted: number }
	| { status: 'queued'; eventId: string; videoId: string; jobId: string }
> {
	const eventId = input.eventId.trim();
	const videoId = input.videoId.trim();
	if (!SAFE_EVENT_ID.test(eventId)) {
		throw new Error(`Invalid revocation eventId: ${input.eventId}`);
	}
	if (!SAFE_VIDEO_ID.test(videoId)) {
		throw new Error(`Invalid revocation videoId: ${input.videoId}`);
	}
	const params: DownloadRevokeParams = {
		videoId,
		eventId,
		...(input.reason ? { reason: input.reason } : {}),
	};

	try {
		const res = await executePurgeAndAppend(env, params);
		resolveNeedsAction(env, undefined, `download-revoke:${eventId}`);
		return {
			status: 'revoked',
			eventId,
			videoId,
			seq: res.seq,
			inserted: res.inserted,
			renditionsDeleted: res.renditionsDeleted,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		logger.warn('[Downloads] Urgent revocation inline step failed; queueing retry job', {
			videoId,
			eventId,
			error: msg,
		});
		if (env.SEARCH_DB && env.ADMIN_JOBS_QUEUE) {
			const job = await createJob(env, {
				kind: 'downloads.revoke',
				targetKind: 'video',
				targetId: videoId,
				actorId: input.actorId,
				params: params as unknown as Record<string, unknown>,
			});
			return { status: 'queued', eventId, videoId, jobId: job.id };
		}
		reportNeedsAction('api-videos', env, undefined, {
			key: `download-revoke:${eventId}`,
			source: 'admin-job',
			title: 'Urgent download revocation did not finish',
			message: `Video ${videoId} (${eventId}): urgent download revocation failed (${msg}) and no retry queue was available.`,
			itemType: 'video',
			itemId: videoId,
			itemUrl: `/videos/${videoId}`,
		});
		throw error;
	}
}

/** Admin-jobs queue consumer handler for `'downloads.revoke'`. */
export async function runDownloadRevokeJob(env: DownloadRevokeEnv, job: AdminJob): Promise<JobOutcome> {
	const p = job.params as unknown as DownloadRevokeParams;
	const needsActionKey = `download-revoke:${p.eventId}`;
	try {
		if (!p || typeof p.videoId !== 'string' || typeof p.eventId !== 'string') {
			throw new Error('invalid downloads.revoke params');
		}
		const res = await executePurgeAndAppend(env, p);
		resolveNeedsAction(env, undefined, needsActionKey);
		return {
			done: true,
			result: {
				eventId: p.eventId,
				videoId: p.videoId,
				seq: res.seq,
				inserted: res.inserted,
				renditionsDeleted: res.renditionsDeleted,
			},
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		logger.error('[Downloads] Urgent download revocation job failed', {
			videoId: p?.videoId,
			eventId: p?.eventId,
			attempt: job.attempts,
			error: reason,
		});
		if (job.attempts > ADMIN_JOB_MAX_RETRIES) {
			reportNeedsAction('api-videos', env, undefined, {
				key: needsActionKey,
				source: 'admin-job',
				title: 'Urgent download revocation did not finish',
				message: `Video ${p?.videoId ?? job.targetId} (${p?.eventId ?? job.id}): urgent download revocation failed after every retry (${reason}). Retry the job to complete the purge.`,
				itemType: 'video',
				itemId: p?.videoId ?? job.targetId,
				itemUrl: `/videos/${p?.videoId ?? job.targetId}`,
			});
		}
		throw error;
	}
}
