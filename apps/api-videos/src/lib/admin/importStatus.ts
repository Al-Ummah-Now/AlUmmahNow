/**
 * The Imports view of the videos admin (wiki TOOLS-ADMIN TA-8): what became of each imported file on
 * the server, for one page of a batch (at most ADMIN_IMPORT_PAGE_SIZE files).
 *
 *   video     its title and processing state (null when it is gone)
 *   attach    the sidecars' attach job (lib/admin/importAttach.ts): state, attempts n/max, next retry,
 *             last error, what came with the file and what is on the video so far
 *   captions  one entry per language: a caption job working on it or failed, a published track, or a
 *             machine draft waiting for a person (AUN-CAPTIONS)
 *
 * Reads only: one video object, one subtitles metadata object and one drafts listing per video, and two
 * D1 queries for the whole page (admin jobs, caption jobs).
 */
import {
	ADMIN_IMPORT_PAGE_SIZE,
	CAPTION_JOB_TERMINAL,
	captionDraftsPrefix,
	IMPORT_SIDECAR_PARTS,
	type AdminImportItemStatus,
	type AdminJob,
	type CaptionJobError,
	type CaptionJobStatus,
	type ImportCaptionStatus,
	type ImportSidecarPart,
	type SearchDb,
	type SubtitleTrack,
	type VideoObject,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { readTracks } from '../captions/drafts';
import { toJob } from './jobs';
import { logger } from '../logger';

type Bucket = any;

export interface ImportStatusEnv {
	SEARCH_DB?: SearchDb;
	videos: Bucket;
	subtitles: Bucket;
}

export interface ImportStatusQuery {
	videoId: string;
	attachJobId?: string | null;
}

const PARTS = new Set<string>(IMPORT_SIDECAR_PARTS);
const parts = (value: unknown): ImportSidecarPart[] => (Array.isArray(value) ? value.filter((p): p is ImportSidecarPart => typeof p === 'string' && PARTS.has(p)) : []);
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

const needsReupload = (video: object) => {
	const v = video as { uploadStatus?: string; processingIssue?: { kind?: string } };
	return v.uploadStatus === 'failed' && v.processingIssue?.kind === 'needs_reupload';
};

interface CaptionRow { video_id: string; language: string; kind: string; status: CaptionJobStatus; error: string | null; created_at: string }

/** The languages a video has drafts in (keys only: `<videoId>/drafts/<lang>.json`). */
async function draftLanguages(bucket: Bucket, videoId: string): Promise<string[]> {
	const prefix = captionDraftsPrefix(videoId);
	const page = await bucket.list({ prefix, limit: 100 });
	return (page.objects as { key: string }[])
		.map((o) => o.key.slice(prefix.length))
		.filter((rest) => /^[^/]+\.json$/.test(rest))
		.map((rest) => rest.slice(0, -'.json'.length));
}

/**
 * One language's state. A job still working wins, then a failed last job, then a published track,
 * then a draft. A failed job with a published track already in that language shows the track: the
 * failure was a later attempt and the captions are live.
 */
export function captionState(language: string, job: CaptionRow | undefined, track: { origin?: ImportCaptionStatus['origin'] } | undefined, hasDraft: boolean): ImportCaptionStatus | null {
	const jobKind = job ? (job.kind === 'translate' ? 'translate' : 'transcribe') : undefined;
	if (job && !CAPTION_JOB_TERMINAL.includes(job.status)) return { language, state: 'working', job: jobKind };
	if (job?.status === 'failed' && !track) return { language, state: 'failed', job: jobKind, error: (job.error ?? 'failed') as CaptionJobError };
	if (track) return { language, state: 'published', origin: track.origin ?? 'upload' };
	if (hasDraft) return { language, state: 'draft', ...(jobKind ? { job: jobKind } : {}) };
	return null;
}

export async function importStatus(env: ImportStatusEnv, queries: ImportStatusQuery[]): Promise<AdminImportItemStatus[]> {
	const items = queries.slice(0, ADMIN_IMPORT_PAGE_SIZE);
	if (!items.length) return [];
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	const db = env.SEARCH_DB;
	const videoIds = [...new Set(items.map((q) => q.videoId))];
	const jobIds = [...new Set(items.map((q) => q.attachJobId).filter((id): id is string => !!id))];

	const [jobRows, captionRows] = await Promise.all([
		jobIds.length ? db.prepare(`SELECT * FROM admin_jobs WHERE id IN (${marks(jobIds.length)})`).bind(...jobIds).all<Parameters<typeof toJob>[0]>() : Promise.resolve({ results: [] }),
		db.prepare(`SELECT video_id, language, kind, status, error, created_at FROM caption_jobs WHERE video_id IN (${marks(videoIds.length)}) ORDER BY created_at DESC`).bind(...videoIds).all<CaptionRow>(),
	]);
	const jobs = new Map<string, AdminJob>((jobRows.results ?? []).map((r) => [r.id, toJob(r)]));
	// The newest caption job per video and language
	const latest = new Map<string, CaptionRow>();
	for (const row of captionRows.results ?? []) {
		const key = `${row.video_id}\u0000${row.language}`;
		if (!latest.has(key)) latest.set(key, row);
	}

	const repo = new R2Repository<VideoObject>(env.videos);
	const perVideo = new Map(
		await Promise.all(
			videoIds.map(async (videoId) => {
				const [video, tracks, drafts] = await Promise.all([
					repo.getObject(videoId).catch(() => null),
					readTracks(env.subtitles, videoId).catch((error: unknown) => {
						logger.warn('[ImportStatus] Could not read the subtitle tracks', { videoId, error: error instanceof Error ? error.message : String(error) });
						return [] as SubtitleTrack[];
					}),
					draftLanguages(env.subtitles, videoId).catch(() => [] as string[]),
				]);
				const trackBy = new Map<string, SubtitleTrack>(tracks.map((t) => [t.language, t] as const));
				const languages = new Set<string>([...trackBy.keys(), ...drafts]);
				for (const key of latest.keys()) if (key.startsWith(`${videoId}\u0000`)) languages.add(key.slice(videoId.length + 1));
				const draftSet = new Set(drafts);
				const captions = [...languages]
					.sort()
					.map((language) => captionState(language, latest.get(`${videoId}\u0000${language}`), trackBy.get(language), draftSet.has(language)))
					.filter((c): c is ImportCaptionStatus => !!c);
				return [videoId, { video, captions }] as const;
			}),
		),
	);

	return items.map((q) => {
		const { video, captions } = perVideo.get(q.videoId) ?? { video: null, captions: [] };
		const job = q.attachJobId ? jobs.get(q.attachJobId) : undefined;
		const params = (job?.params ?? {}) as { sent?: unknown; done?: unknown; warnings?: unknown };
		const result = (job?.result ?? {}) as { done?: unknown; warnings?: unknown };
		return {
			videoId: q.videoId,
			video: video ? { title: String(video.title ?? ''), processingStatus: video.processingStatus ?? null, isDeleted: !!video.isDeleted, ...(needsReupload(video) ? { needsReupload: true } : {}) } : null,
			attach: job
				? {
						jobId: job.id,
						status: job.status,
						attempts: job.attempts,
						maxAttempts: job.maxAttempts,
						nextRunAt: job.nextRunAt,
						lastError: job.lastError,
						sent: Array.isArray(params.sent) ? parts(params.sent) : null,
						// The job's result is written when a step ends; its params once the next step is queued
						done: parts(result.done ?? params.done),
						warnings: (Array.isArray(result.warnings) ? result.warnings : Array.isArray(params.warnings) ? params.warnings : []).filter((w): w is string => typeof w === 'string').slice(0, 20),
					}
				: null,
			captions,
		};
	});
}
