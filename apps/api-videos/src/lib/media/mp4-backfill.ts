/**
 * Public MP4 backfill (#1182, D-SEO-11): renditions transcoded before the transcoder made the
 * progressive 480p MP4 (#1181) get it now, as a remux-only job on the transcode queue (apps/media
 * Transcoder.remuxMp4: stream copy of the rendition's own rung, no encode, no new rev). The result
 * comes back on POST /internal/media/mp4 (applyMp4Event) and fills `r2.result.mp4`; publicMp4Url
 * then exposes it for public videos only.
 *
 * Like #1181, every ready rendition gets the MP4 (private and unlisted ones too, under priv/, never
 * exposed), so a video made public later already has it.
 *
 * Candidates come from media_jobs (SEARCH_DB), which mirrors every R2 job: one page by primary key
 * per message (`video_id > cursor`), never a scan of the videos bucket. Each candidate's record is
 * the source of truth. A dry run by default: it lists and writes nothing but the run's own state.
 * One page per message on the processing-check queue (index.ts queue(), like the publishedAt
 * backfill); the run is in global_settings `ops/mp4-backfill/runs/<runId>.json`.
 *
 * Start a run with scripts/release/mp4-backfill.ts (sends { kind: 'mp4-backfill', runId, page: 0,
 * cursor: null, dryRun, limit } to the env's processing-check queue).
 */
import type { MediaAccess, Mp4JobMessage, VideoR2State } from '@al-ummah/shared-types';
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { publicMp4Url, type MediaEnv } from './r2-delivery';

export const MP4_BACKFILL_KIND = 'mp4-backfill';
const RUN_PREFIX = 'ops/mp4-backfill/runs/';
const PAGE_DELAY_SECONDS = 5;
/** Remux jobs of one page start this far apart (one container each; gentle on max_instances). */
export const JOB_SPACING_SECONDS = 30;
const MAX_LIMIT = 20;
const MAX_ITEMS = 2000;

export interface Mp4BackfillMessage {
	kind: typeof MP4_BACKFILL_KIND;
	runId: string;
	page: number;
	cursor: string | null;
	/** List only, queue nothing (the default when absent) */
	dryRun?: boolean;
	limit?: number;
}

export type Mp4BackfillState = 'candidate' | 'has-mp4' | 'not-ready' | 'deleted' | 'missing';

export interface Mp4BackfillItem {
	id: string;
	title: string | null;
	state: Mp4BackfillState;
	access: MediaAccess | null;
	rev: string | null;
	rungs: string[];
	/** The rung the MP4 is (or would be) made from */
	mp4Rung: string | null;
	/** Its MP4 is (or will be) the public contentUrl: a public video under pub/ */
	public: boolean;
	/** queued: sent to the transcode queue; would-queue: dry run */
	action: 'queued' | 'would-queue' | 'skip';
	jobId?: string;
}

export interface Mp4BackfillCounts {
	scanned: number;
	candidate: number;
	candidatePublic: number;
	hasMp4: number;
	notReady: number;
	deleted: number;
	missing: number;
	queued: number;
}

export interface Mp4BackfillRun {
	runId: string;
	dryRun: boolean;
	status: 'running' | 'done';
	startedAt: string;
	updatedAt: string;
	finishedAt?: string;
	pages: Record<string, Mp4BackfillCounts>;
	totals: Mp4BackfillCounts;
	items: Mp4BackfillItem[];
}

type Env = Pick<MediaEnv, 'videos' | 'SEARCH_DB' | 'TRANSCODE_QUEUE' | 'MEDIA_PUBLIC_HOST' | 'PROCESSING_CHECK_QUEUE' | 'global_settings'>;

interface Video {
	id: string;
	title?: string;
	isPublic?: boolean;
	isHidden?: boolean;
	isDeleted?: boolean;
	r2?: VideoR2State;
}

const EMPTY: Mp4BackfillCounts = { scanned: 0, candidate: 0, candidatePublic: 0, hasMp4: 0, notReady: 0, deleted: 0, missing: 0, queued: 0 };

export function isMp4BackfillMessage(body: unknown): body is Mp4BackfillMessage {
	const m = body as Partial<Mp4BackfillMessage> | null;
	return !!m && m.kind === MP4_BACKFILL_KIND && typeof m.runId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(m.runId) && Number.isInteger(m.page) && (m.page as number) >= 0;
}

/** The rung the transcoder remuxes (apps/media/container/ladder.mjs mp4Rung): 480p, else 360p, else the first. */
export function mp4RungOf(names: string[]): string | null {
	for (const name of ['480p', '360p']) if (names.includes(name)) return name;
	return names[0] ?? null;
}

const PROBE_MP4 = { file: 'video.mp4', rung: '480p', width: 0, height: 0, bytes: 1 };

/** Whether this ready rendition's MP4 is (or, once made, will be) the public contentUrl: publicMp4Url's own rule. */
function mp4IsPublic(env: Pick<Env, 'MEDIA_PUBLIC_HOST'>, video: Video): boolean {
	const r2 = video.r2;
	if (!r2?.result) return false;
	return !!publicMp4Url({ MEDIA_PUBLIC_HOST: env.MEDIA_PUBLIC_HOST || 'media.invalid' }, { ...video, r2: { ...r2, result: { ...r2.result, mp4: r2.result.mp4 ?? PROBE_MP4 } } });
}

/** One video's place in the backfill. */
export function classifyForMp4(env: Pick<Env, 'MEDIA_PUBLIC_HOST'>, id: string, video: Video | null): Mp4BackfillItem {
	const r2 = video?.r2;
	const rungs = r2?.result?.rungs?.map((r) => r.name) ?? [];
	const base = { id, title: typeof video?.title === 'string' ? video.title.slice(0, 120) : null, access: r2?.access ?? null, rev: r2?.rev ?? null, rungs, mp4Rung: mp4RungOf(rungs) };
	if (!video) return { ...base, state: 'missing', public: false, action: 'skip' };
	if (video.isDeleted) return { ...base, state: 'deleted', public: false, action: 'skip' };
	if (!r2 || r2.status !== 'ready' || !r2.result || !rungs.length) return { ...base, state: 'not-ready', public: false, action: 'skip' };
	if (r2.result.mp4) return { ...base, mp4Rung: r2.result.mp4.rung, state: 'has-mp4', public: mp4IsPublic(env, video), action: 'skip' };
	return { ...base, state: 'candidate', public: mp4IsPublic(env, video), action: 'skip' };
}

/** The remux-only job for a candidate. */
export function mp4JobFor(video: Video, runId: string, now: Date): Mp4JobMessage | null {
	const r2 = video.r2;
	if (!r2 || r2.status !== 'ready' || !r2.result?.rungs?.length || r2.result.mp4) return null;
	return {
		kind: 'mp4',
		videoId: video.id,
		jobId: crypto.randomUUID(),
		rev: r2.rev,
		access: r2.access,
		rungs: r2.result.rungs.map((r) => ({ name: r.name, width: r.width, height: r.height })),
		queuedAt: now.toISOString(),
		runId,
	};
}

/** One page of media_jobs: list, and (not a dry run) queue the remux jobs. */
export async function runMp4Page(
	env: Env,
	message: Pick<Mp4BackfillMessage, 'cursor' | 'limit' | 'dryRun' | 'runId'>,
	now = new Date(),
): Promise<{ counts: Mp4BackfillCounts; items: Mp4BackfillItem[]; nextCursor: string | null }> {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	const dryRun = message.dryRun !== false;
	if (!dryRun && !env.TRANSCODE_QUEUE) throw new Error('TRANSCODE_QUEUE is not bound');
	const limit = Math.min(Math.max(Math.floor(message.limit ?? MAX_LIMIT), 1), MAX_LIMIT);
	// Primary-key range: reads only this page's rows
	const { results } = await env.SEARCH_DB.prepare('SELECT video_id FROM media_jobs WHERE video_id > ? ORDER BY video_id LIMIT ?')
		.bind(message.cursor ?? '', limit)
		.all<{ video_id: string }>();
	const ids = (results ?? []).map((r) => r.video_id);
	const repo = new R2Repository<Video>(env.videos);
	const counts = { ...EMPTY };
	const items: Mp4BackfillItem[] = [];
	let spacing = 0;
	for (const id of ids) {
		const video = await repo.getObject(id);
		const item = classifyForMp4(env, id, video);
		counts.scanned++;
		if (item.state === 'candidate') {
			counts.candidate++;
			if (item.public) counts.candidatePublic++;
			if (dryRun) item.action = 'would-queue';
			else {
				const job = mp4JobFor(video!, message.runId, now);
				if (job) {
					await env.TRANSCODE_QUEUE!.send(job, spacing ? { delaySeconds: spacing } : undefined);
					spacing += JOB_SPACING_SECONDS;
					item.action = 'queued';
					item.jobId = job.jobId;
					counts.queued++;
				}
			}
		} else if (item.state === 'has-mp4') counts.hasMp4++;
		else if (item.state === 'not-ready') counts.notReady++;
		else if (item.state === 'deleted') counts.deleted++;
		else counts.missing++;
		items.push(item);
	}
	return { counts, items, nextCursor: ids.length === limit ? ids[ids.length - 1] : null };
}

const runKey = (runId: string) => `${RUN_PREFIX}${runId}.json`;

function sum(pages: Record<string, Mp4BackfillCounts>): Mp4BackfillCounts {
	const total = { ...EMPTY };
	for (const page of Object.values(pages)) for (const key of Object.keys(total) as Array<keyof Mp4BackfillCounts>) total[key] += page[key] ?? 0;
	return total;
}

interface QueueMessageLike {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** Consumer for one backfill message (index.ts queue()). A page already recorded is skipped (no second job). */
export async function handleMp4BackfillMessage(env: Env, msg: QueueMessageLike, now = new Date()): Promise<void> {
	const body = msg.body as Mp4BackfillMessage;
	try {
		if (!env.global_settings) throw new Error('global_settings bucket is not bound');
		const stored = await env.global_settings.get(runKey(body.runId));
		const run: Mp4BackfillRun = stored
			? ((await stored.json()) as Mp4BackfillRun)
			: { runId: body.runId, dryRun: body.dryRun !== false, status: 'running', startedAt: now.toISOString(), updatedAt: now.toISOString(), pages: {}, totals: { ...EMPTY }, items: [] };
		if (run.status === 'done' || run.pages[String(body.page)]) {
			msg.ack();
			return;
		}
		const result = await runMp4Page(env, { ...body, dryRun: run.dryRun }, now);
		run.pages[String(body.page)] = result.counts;
		run.totals = sum(run.pages);
		run.items = [...run.items, ...result.items].slice(0, MAX_ITEMS);
		run.updatedAt = now.toISOString();
		if (!result.nextCursor) {
			run.status = 'done';
			run.finishedAt = now.toISOString();
		}
		// Recorded before the next page is queued: a redelivered page finds itself done and queues nothing twice
		await env.global_settings.put(runKey(run.runId), JSON.stringify(run), { httpMetadata: { contentType: 'application/json' } });
		if (result.nextCursor) {
			await env.PROCESSING_CHECK_QUEUE!.send({ ...body, dryRun: run.dryRun, page: body.page + 1, cursor: result.nextCursor } satisfies Mp4BackfillMessage, { delaySeconds: PAGE_DELAY_SECONDS });
		}
		logger.info('[Mp4Backfill] Page done', { runId: run.runId, page: body.page, dryRun: run.dryRun, counts: result.counts, done: run.status === 'done' });
		msg.ack();
	} catch (error) {
		logger.warn('[Mp4Backfill] Page failed; retrying', { runId: body.runId, page: body.page, attempts: msg.attempts, error: error instanceof Error ? error.message : String(error) });
		msg.retry({ delaySeconds: Math.min(300, 30 * 2 ** Math.max(0, msg.attempts - 1)) });
	}
}
