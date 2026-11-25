/**
 * The HDR check (shared-types hdr-check.ts): which published renditions still carry HDR color tags.
 *
 * Read only: it changes no video and queues no encode. Candidates come from media_jobs (SEARCH_DB), one
 * page by primary key per message (`video_id > cursor`), never a scan; each video's record says its
 * rendition, and its lowest rung's playlist and init segment are read from R2 (two small reads: one
 * encode makes every rung, so one rung tells). One page per message on the processing-check queue
 * (index.ts queue()), like the MP4 backfill. The latest run is in global_settings `ops/hdr-check/latest.json`.
 */
import { hdrKindOf, HDR_CHECK_MAX_ITEMS, initColors, mediaPrefix, underHold, type HdrCheckCounts, type HdrCheckItem, type HdrCheckRun, type VideoR2State } from '@al-ummah/shared-types';
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import type { MediaEnv } from './r2-delivery';

export const HDR_CHECK_KIND = 'hdr-check';
const RUN_KEY = 'ops/hdr-check/latest.json';
const PAGE = 20;
const PAGE_DELAY_SECONDS = 2;
/** A run whose last page is older than this died; another may start. */
export const HDR_CHECK_STALE_MS = 30 * 60_000;
/** An init segment is 1–2 KB. */
const INIT_BYTES = 64 * 1024;
/** Records read at once when a GET says where each listed video is now. */
const NOW_CONCURRENCY = 8;

export interface HdrCheckMessage {
	kind: typeof HDR_CHECK_KIND;
	runId: string;
	page: number;
	cursor: string | null;
}

type Env = Pick<MediaEnv, 'videos' | 'SEARCH_DB' | 'MEDIA' | 'MEDIA_PRIVATE' | 'PROCESSING_CHECK_QUEUE' | 'global_settings'>;

interface Video {
	id: string;
	title?: string;
	isDeleted?: boolean;
	r2?: VideoR2State;
	suspensionHolds?: unknown;
	csamTakedown?: unknown;
}

/** Deleted, or under a hold or takedown (whose purge may still be running): never looked at, never listed. */
const outOfReach = (video: Video | null): boolean => !video || !!video.isDeleted || underHold(video) || !!video.csamTakedown;

/** Stored with the run: pages already done, so a redelivered page counts nothing twice. */
type StoredRun = HdrCheckRun & { nextPage: number };

export function isHdrCheckMessage(body: unknown): body is HdrCheckMessage {
	const m = body as Partial<HdrCheckMessage> | null;
	return !!m && m.kind === HDR_CHECK_KIND && typeof m.runId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(m.runId) && Number.isInteger(m.page) && (m.page as number) >= 0;
}

/** The ready rendition. A video being encoded (again) is skipped: what comes out is SDR. */
function shownRendition(r2: VideoR2State | undefined): { rev: string; access: 'pub' | 'priv'; rung: string } | null {
	return r2?.status === 'ready' && r2.result?.rungs?.length ? { rev: r2.rev, access: r2.access, rung: r2.result.rungs[0]!.name } : null;
}

const SAFE_FILE = /^[A-Za-z0-9._-]{1,64}$/;

/** The colors of a rendition as its init segment says them; 'unreadable' when there is none to read. */
export async function renditionHdr(env: Pick<Env, 'MEDIA' | 'MEDIA_PRIVATE'>, video: { id: string }, shown: { rev: string; access: 'pub' | 'priv'; rung: string }) {
	const bucket = shown.access === 'priv' ? env.MEDIA_PRIVATE : env.MEDIA;
	if (!bucket) throw new Error(`the ${shown.access} media bucket is not bound`);
	const base = `${mediaPrefix(shown.access, video.id, shown.rev)}/${shown.rung}`;
	const playlist = await bucket.get(`${base}/index.m3u8`);
	const init = playlist && /^#EXT-X-MAP:URI="([^"]+)"/m.exec(await playlist.text())?.[1];
	if (!init || !SAFE_FILE.test(init)) return 'unreadable' as const;
	const segment = await bucket.get(`${base}/${init}`, { range: { offset: 0, length: INIT_BYTES } });
	if (!segment) return 'unreadable' as const;
	return hdrKindOf(initColors(new Uint8Array(await segment.arrayBuffer())));
}

async function readRun(env: Env): Promise<StoredRun | null> {
	if (!env.global_settings) throw new Error('global_settings bucket is not bound');
	const stored = await env.global_settings.get(RUN_KEY);
	return stored ? ((await stored.json()) as StoredRun) : null;
}

const writeRun = (env: Env, run: StoredRun) => env.global_settings!.put(RUN_KEY, JSON.stringify(run), { httpMetadata: { contentType: 'application/json' } });

export async function startHdrCheck(env: Env, actorId: string, now = new Date()): Promise<{ started: boolean; run: HdrCheckRun }> {
	const last = await readRun(env);
	if (last?.status === 'running' && now.getTime() - Date.parse(last.updatedAt) < HDR_CHECK_STALE_MS) return { started: false, run: publicRun(last) };
	if (!env.PROCESSING_CHECK_QUEUE) throw new Error('PROCESSING_CHECK_QUEUE is not bound');
	const at = now.toISOString();
	const run: StoredRun = { runId: crypto.randomUUID(), status: 'running', startedAt: at, updatedAt: at, startedBy: actorId, counts: { scanned: 0, checked: 0, hdr: 0, skipped: 0, unreadable: 0 }, items: [], nextPage: 0 };
	// Queued first: a send that fails leaves no run that says it is running. The first page waits for the
	// record if it comes before it (handleHdrCheckMessage). Two starts at once: the later record wins, and
	// the other run's pages find another run and stop
	await env.PROCESSING_CHECK_QUEUE.send({ kind: HDR_CHECK_KIND, runId: run.runId, page: 0, cursor: null } satisfies HdrCheckMessage);
	await writeRun(env, run);
	logger.info('[HdrCheck] Started', { runId: run.runId, actorId });
	return { started: true, run: publicRun(run) };
}

function publicRun({ nextPage: _page, ...run }: StoredRun): HdrCheckRun {
	return run;
}

/**
 * The latest run. `live`: the figures alone, while it runs (the panel polls them). Otherwise every listed
 * video with where it is now (one record read each, a few at a time); one that is gone or under a hold or
 * takedown loses its title.
 */
export async function readHdrCheck(env: Env, opts: { live?: boolean } = {}): Promise<HdrCheckRun | null> {
	const stored = await readRun(env);
	if (!stored) return null;
	if (opts.live) return publicRun({ ...stored, items: [] });
	const repo = new R2Repository<Video>(env.videos);
	const items: HdrCheckItem[] = new Array(stored.items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(NOW_CONCURRENCY, stored.items.length) }, async () => {
			for (let i = next++; i < stored.items.length; i = next++) {
				const item = stored.items[i]!;
				const video = await repo.getObject(item.id);
				const r2 = video?.r2;
				if (outOfReach(video)) items[i] = { ...item, title: null, now: 'gone' };
				else items[i] = { ...item, now: r2?.status === 'queued' || r2?.status === 'transcoding' ? 'encoding' : r2?.status === 'ready' && r2.rev !== item.rev ? 'replaced' : 'same' };
			}
		}),
	);
	return publicRun({ ...stored, items });
}

/** One page of media_jobs. */
export async function checkHdrPage(env: Env, cursor: string | null): Promise<{ counts: HdrCheckCounts; items: HdrCheckItem[]; nextCursor: string | null }> {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	// Primary-key range: reads only this page's rows
	const { results } = await env.SEARCH_DB.prepare('SELECT video_id FROM media_jobs WHERE video_id > ? ORDER BY video_id LIMIT ?').bind(cursor ?? '', PAGE).all<{ video_id: string }>();
	const ids = (results ?? []).map((r) => r.video_id);
	const repo = new R2Repository<Video>(env.videos);
	const counts: HdrCheckCounts = { scanned: 0, checked: 0, hdr: 0, skipped: 0, unreadable: 0 };
	const items: HdrCheckItem[] = [];
	for (const id of ids) {
		counts.scanned++;
		const video = await repo.getObject(id);
		const shown = !outOfReach(video) ? shownRendition(video!.r2) : null;
		if (!video || !shown) {
			counts.skipped++;
			continue;
		}
		const kind = await renditionHdr(env, { id }, shown);
		if (kind === 'unreadable') {
			counts.unreadable++;
			continue;
		}
		counts.checked++;
		if (!kind) continue;
		counts.hdr++;
		items.push({ id, title: typeof video.title === 'string' ? video.title.slice(0, 120) : null, kind, rev: shown.rev });
	}
	return { counts, items, nextCursor: ids.length === PAGE ? ids[ids.length - 1]! : null };
}

interface QueueMessageLike {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** Consumer for one page (index.ts queue()). A page of another run, or already counted, is dropped. */
export async function handleHdrCheckMessage(env: Env, msg: QueueMessageLike, now = new Date()): Promise<void> {
	const body = msg.body as HdrCheckMessage;
	try {
		const run = await readRun(env);
		// The first page can come before its run is recorded (it is queued first): it waits a little
		if ((!run || run.runId !== body.runId) && body.page === 0 && msg.attempts < 4) {
			msg.retry({ delaySeconds: 5 });
			return;
		}
		if (!run || run.runId !== body.runId || run.status === 'done' || body.page < run.nextPage) {
			msg.ack();
			return;
		}
		// The page before is still being recorded
		if (body.page > run.nextPage) {
			msg.retry({ delaySeconds: 10 });
			return;
		}
		const page = await checkHdrPage(env, body.cursor);
		for (const key of Object.keys(page.counts) as Array<keyof HdrCheckCounts>) run.counts[key] += page.counts[key];
		const items = [...run.items, ...page.items];
		run.items = items.slice(0, HDR_CHECK_MAX_ITEMS);
		if (items.length > HDR_CHECK_MAX_ITEMS) run.truncated = true;
		run.nextPage = body.page + 1;
		run.updatedAt = now.toISOString();
		if (!page.nextCursor) {
			run.status = 'done';
			run.finishedAt = run.updatedAt;
		} else {
			// Queued before this page is recorded: a failure between the two runs this page again and sends a
			// second copy, which finds its page done. A copy that comes before the record waits (above)
			await env.PROCESSING_CHECK_QUEUE!.send({ ...body, page: body.page + 1, cursor: page.nextCursor } satisfies HdrCheckMessage, { delaySeconds: PAGE_DELAY_SECONDS });
		}
		await writeRun(env, run);
		logger.info('[HdrCheck] Page done', { runId: run.runId, page: body.page, counts: page.counts, done: run.status === 'done' });
		msg.ack();
	} catch (error) {
		logger.warn('[HdrCheck] Page failed; retrying', { runId: body.runId, page: body.page, attempts: msg.attempts, error: error instanceof Error ? error.message : String(error) });
		msg.retry({ delaySeconds: Math.min(300, 30 * 2 ** Math.max(0, msg.attempts - 1)) });
	}
}
