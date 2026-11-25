/**
 * Why videos failed (shared-types video-failure.ts): the failures of a set of videos, and which videos have one.
 * A video has failed when its upload or Bunny did (content_ownership.upload_status 'failed', processingIssue on
 * the record) or when its R2 transcode did (media_jobs 'failed'), also while Bunny's copy of it plays.
 */
import { baseName, explainVideoFailure, sanitizeSourceFacts, scrubOpsText, VIDEO_FAILURES_MAX, type TroubleshootSource, type VideoFailure, type VideoMediaProviders } from '@al-ummah/shared-types';
import { readMany } from '../admin/directory';

export interface FailuresEnv {
	videos: R2Bucket;
	SEARCH_DB?: D1Database;
}

/** The states of a video that is not ready, as content_ownership.upload_status has them. */
export type UnfinishedState = 'initiated' | 'uploading' | 'processing' | 'failed';

/** SQL: what idx_content_ownership_unfinished holds (its own terms, so it always applies), in one state. */
const inState = (state: UnfinishedState) => `content_ownership INDEXED BY idx_content_ownership_unfinished WHERE kind = 'video' AND is_deleted = 0 AND upload_status <> 'ready' AND upload_status = '${state}'`;

/** SQL: the ids of every video that failed: rows in that state only, by the two indexes that start with it. */
export const FAILED_VIDEO_IDS_SQL = `SELECT id FROM ${inState('failed')} UNION SELECT video_id FROM media_jobs INDEXED BY idx_media_jobs_status WHERE status = 'failed'`;

/** Which videos a list is of; `all`: every one. */
export interface VideoStates {
	states: UnfinishedState[];
	/** Those whose R2 transcode failed, also while Bunny's copy plays */
	r2Failed?: boolean;
	/** Oldest first (a stalled one is an old one) */
	oldest?: boolean;
	all?: boolean;
}

/**
 * SQL: a page of those videos' ids, in date order. Each state's rows come in that order from its index and only
 * as many as the page reaches; failed jobs are found by theirs, then their video by its key. Binds: ?1 rows a
 * state gives (offset + page), ?2 page, ?3 offset.
 */
export function videoStatesSql({ states, r2Failed, oldest, all }: VideoStates): string {
	const order = oldest ? 'created_at ASC, id DESC' : 'created_at DESC, id';
	if (all) return `SELECT id FROM content_ownership INDEXED BY idx_content_ownership_created WHERE kind = 'video' AND is_deleted = 0 ORDER BY created_at DESC LIMIT min(?1, ?2) OFFSET ?3`;
	const arms = states.map((state) => `SELECT * FROM (SELECT id, created_at FROM ${inState(state)} ORDER BY ${order} LIMIT ?1)`);
	if (r2Failed) {
		arms.push(`SELECT v.id, v.created_at FROM media_jobs j INDEXED BY idx_media_jobs_status CROSS JOIN content_ownership v ON v.kind = 'video' AND v.id = j.video_id WHERE j.status = 'failed' AND v.is_deleted = 0`);
	}
	return `SELECT id FROM (${arms.join(' UNION ')}) ORDER BY ${order} LIMIT min(?1, ?2) OFFSET ?3`;
}

/** One page of ids and whether there are more; null without an index (a local run). Throws when D1 fails. */
export async function videoIdsInStates(env: FailuresEnv, of: VideoStates, from: number, limit: number): Promise<{ ids: string[]; more: boolean } | null> {
	if (!env.SEARCH_DB) return null;
	const { results } = await env.SEARCH_DB.prepare(videoStatesSql(of)).bind(from + limit + 1, limit + 1, from).all<{ id: string }>();
	const ids = (results ?? []).map((r) => r.id);
	return { ids: ids.slice(0, limit), more: ids.length > limit };
}

/** Ids read at once, and most records one page looks through */
const WINDOW = 50;
const MAX_READS = 300;

/**
 * A page of the records of those videos that are wanted, and where the next one starts (null: no more). Records
 * the list does not want are passed over, as many as MAX_READS; the next page goes on from there. Null without an index.
 */
export async function pageOfVideos<T extends { id?: string }>(
	env: FailuresEnv,
	of: VideoStates,
	opts: { from: number; limit: number; wanted: (video: T) => boolean },
): Promise<{ items: T[]; next: number | null; read: number } | null> {
	const items: T[] = [];
	let at = opts.from;
	let read = 0;
	while (true) {
		const page = await videoIdsInStates(env, of, at, WINDOW);
		if (!page) return null;
		const records = await readMany<T>(env.videos, page.ids);
		read += page.ids.length;
		let consumed = 0;
		for (const id of page.ids) {
			consumed++;
			const video = records.get(id);
			if (video && opts.wanted(video)) items.push(video);
			if (items.length >= opts.limit) break;
		}
		at += consumed;
		if (consumed >= page.ids.length && !page.more) return { items, next: null, read };
		if (items.length >= opts.limit || read >= MAX_READS) return { items, next: at, read };
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
	media?: VideoMediaProviders;
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

/** R2 is the copy that decides the video's state (r2-delivery.ts r2DecidesState). */
const r2Decides = (video: FailedRecord) => !!video.media?.providers.r2 && (!video.media.providers.bunny || video.media.providers.bunny.status === 'failed');

/** One video's failure from its record and its failed job; null when it has none. Pure (tested). */
export function toVideoFailure(id: string, video: FailedRecord, row: JobRow | null): VideoFailure | null {
	const job = row && video.r2?.status === 'failed' && row.job_id === video.r2.jobId ? { error: row.error, source: sourceOf(row.source_facts) } : null;
	const why = explainVideoFailure({ uploadStatus: video.uploadStatus, issue: video.processingIssue, r2: video.r2, r2Decides: r2Decides(video), job });
	if (!why) return null;
	const failedJob = why.where === 'r2' && video.r2?.status === 'failed';
	const error = failedJob ? (job?.error ?? video.r2?.error) : null;
	return {
		videoId: id,
		...why,
		title: video.title?.trim() || null,
		plays: !video.uploadStatus || video.uploadStatus === 'ready',
		jobId: failedJob ? (video.r2?.jobId ?? null) : null,
		error: error ? scrubOpsText(error).slice(0, 300) : null,
		source: job?.source ?? null,
		failedAt: (failedJob ? (video.r2?.failedAt ?? row?.failed_at) : (video.processingIssue?.at ?? video.dateModified)) ?? null,
		// The name only: a folder of the sender's computer is nobody's business
		fileName: (video.originalFilename && baseName(video.originalFilename).slice(0, 500)) || null,
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
