/**
 * Why videos failed (shared-types video-failure.ts): the failures of a set of videos, and which videos have one.
 * A video has failed when its upload or Bunny did (content_ownership.upload_status 'failed', processingIssue on
 * the record) or when its R2 transcode did (media_jobs 'failed'), also while Bunny's copy of it plays.
 */
import { explainVideoFailure, sanitizeSourceFacts, scrubOpsText, VIDEO_FAILURES_MAX, type TroubleshootSource, type VideoFailure } from '@al-ummah/shared-types';
import { readMany } from '../admin/directory';
import { logger } from '../logger';
import { isOwnershipComplete } from '../search/ownership';

export interface FailuresEnv {
	videos: R2Bucket;
	SEARCH_DB?: D1Database;
}

const UNFINISHED = ['initiated', 'uploading', 'processing', 'failed'] as const;

/** SQL: the ids of every video that failed. Seeks of (kind, upload_status, id) and (status, updated_at). */
export const FAILED_VIDEO_IDS_SQL = `SELECT id FROM content_ownership WHERE kind = 'video' AND upload_status = 'failed' UNION SELECT video_id FROM media_jobs WHERE status = 'failed'`;

/** The same, with the videos still uploading or processing. */
export const UNFINISHED_VIDEO_IDS_SQL = `${UNFINISHED.map((s) => `SELECT id FROM content_ownership WHERE kind = 'video' AND upload_status = '${s}'`).join(' UNION ')} UNION SELECT video_id FROM media_jobs WHERE status = 'failed'`;

/** The newest unfinished or failed videos' ids; null when the index cannot answer. */
export async function unfinishedVideoIds(env: FailuresEnv, limit: number): Promise<string[] | null> {
	const db = env.SEARCH_DB;
	if (!db) return null;
	try {
		if (!(await isOwnershipComplete(db as never, 'video'))) return null;
		const { results } = await db
			.prepare(`SELECT v.id AS id FROM (${UNFINISHED_VIDEO_IDS_SQL}) u JOIN content_ownership v ON v.kind = 'video' AND v.id = u.id WHERE v.is_deleted = 0 ORDER BY v.created_at DESC LIMIT ?`)
			.bind(limit)
			.all<{ id: string }>();
		return (results ?? []).map((r) => r.id);
	} catch (error) {
		logger.warn('[Failures] The index cannot list unfinished videos', { error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

interface FailedRecord {
	id?: string;
	title?: string;
	uploadStatus?: string;
	isDeleted?: boolean;
	abandoned?: unknown;
	dateModified?: string;
	originalFilename?: string;
	processingIssue?: { kind: string; code?: string; at?: string } | null;
	r2?: { status: string; jobId: string; error?: string; failedAt?: string };
}

interface JobRow {
	video_id: string;
	job_id: string;
	error: string | null;
	failed_at: string | null;
	source_facts: string | null;
}

/** The stored source facts without the hash. */
export function sourceOf(json: string | null | undefined): TroubleshootSource | null {
	if (!json) return null;
	try {
		const facts = sanitizeSourceFacts(JSON.parse(json));
		if (!facts) return null;
		const rest: TroubleshootSource & { sha256?: string } = facts;
		delete rest.sha256;
		return rest;
	} catch {
		return null;
	}
}

/** One video's failure from its record and its failed job; null when it has none. Pure (tested). */
export function toVideoFailure(id: string, video: FailedRecord, row: JobRow | null): VideoFailure | null {
	const job = row && video.r2?.status === 'failed' && row.job_id === video.r2.jobId ? { error: row.error, source: sourceOf(row.source_facts) } : null;
	const why = explainVideoFailure({ uploadStatus: video.uploadStatus, issue: video.processingIssue, r2: video.r2, job });
	if (!why) return null;
	const r2 = why.where === 'r2';
	const error = r2 ? (job?.error ?? video.r2?.error) : null;
	return {
		videoId: id,
		...why,
		title: video.title?.trim() || null,
		plays: !video.uploadStatus || video.uploadStatus === 'ready',
		jobId: r2 ? (video.r2?.jobId ?? null) : null,
		error: error ? scrubOpsText(error).slice(0, 300) : null,
		source: job?.source ?? null,
		failedAt: (r2 ? (video.r2?.failedAt ?? row?.failed_at) : (video.processingIssue?.at ?? video.dateModified)) ?? null,
		fileName: video.originalFilename?.slice(0, 500) || null,
		importBatchId: null,
	};
}

/** The failures among `ids` (one D1 read by primary key, one R2 get each), in their order. */
export async function readVideoFailures(env: FailuresEnv, ids: string[]): Promise<VideoFailure[]> {
	const wanted = [...new Set(ids)].slice(0, VIDEO_FAILURES_MAX);
	if (!wanted.length) return [];
	const [records, jobs] = await Promise.all([
		readMany<FailedRecord>(env.videos, wanted),
		env.SEARCH_DB
			? env.SEARCH_DB.prepare(`SELECT video_id, job_id, error, failed_at, source_facts FROM media_jobs WHERE status = 'failed' AND video_id IN (SELECT value FROM json_each(?))`)
					.bind(JSON.stringify(wanted))
					.all<JobRow>()
					.then((r) => new Map((r.results ?? []).map((row) => [row.video_id, row])))
			: new Map<string, JobRow>(),
	]);
	return wanted.flatMap((id) => {
		const video = records.get(id);
		return video && !video.isDeleted && !video.abandoned ? (toVideoFailure(id, video, jobs.get(id) ?? null) ?? []) : [];
	});
}
