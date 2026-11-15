/**
 * Backfill estimate: one page of the scope per queue message. Each video becomes an item with what
 * it needs (copy our original from Bunny, transcode) and its estimated cost, from real sizes:
 * Bunny's Content-Range for the copy and this environment's finished transcodes (media_jobs) for
 * the transcode time, the rendition bytes and the R2 writes.
 */
import { backfillCost, underHold, type BackfillEstimate, type BackfillScope, type BackfillSkipReason, type VideoR2State } from '@al-ummah/shared-types';
import R2Repository from '../../r2Repo';
import { bunnyRef } from '../providers';
import type { LibraryHints } from '../../bunny/libraries';
import { BACKFILL_PRICES, type Db } from './store';
import { bunnyFacts, probeSource } from './source';
import type { BackfillEnv } from './types';

export const ESTIMATE_PAGE = 20;
/** Copy part size: one R2 object (and one Bunny range request) per 64 MiB */
export const PART_BYTES = 64 * 1024 * 1024;

export interface ScopeRow {
	id: string;
	channel_id: string | null;
	duration: number | null;
	is_live: number | null;
}

/** One page of video ids in the scope, from the ownership index (never a scan of the videos bucket). */
export async function scopePage(db: Db, scope: BackfillScope, cursor: string | null, limit = ESTIMATE_PAGE): Promise<{ rows: ScopeRow[]; next: string | null }> {
	if (scope.kind === 'videos') {
		const ids = scope.videoIds ?? [];
		const start = cursor ? Number(cursor) : 0;
		const slice = ids.slice(start, start + limit);
		const rows: ScopeRow[] = [];
		if (slice.length) {
			const marks = slice.map((_, i) => `?${i + 1}`).join(', ');
			const { results } = await db.prepare(`SELECT id, channel_id, duration, is_live FROM content_ownership WHERE kind = 'video' AND id IN (${marks})`).bind(...slice).all<ScopeRow>();
			const byId = new Map((results ?? []).map((r) => [r.id, r]));
			// An id the index does not know is still looked up in the bucket (it reports not_found there)
			for (const id of slice) rows.push(byId.get(id) ?? { id, channel_id: null, duration: null, is_live: null });
		}
		return { rows, next: start + limit < ids.length ? String(start + limit) : null };
	}
	const where = ["c.kind = 'video'", 'c.is_deleted = 0', 'c.id > ?1'];
	const binds: unknown[] = [cursor ?? ''];
	if (scope.kind === 'channel') {
		binds.push(scope.channelId);
		where.push(`c.channel_id = ?${binds.length}`);
	}
	if (scope.kind === 'dates') {
		if (scope.from) {
			binds.push(Date.parse(`${scope.from}T00:00:00Z`));
			where.push(`c.created_at >= ?${binds.length}`);
		}
		if (scope.to) {
			binds.push(Date.parse(`${scope.to}T00:00:00Z`) + 86_400_000);
			where.push(`c.created_at < ?${binds.length}`);
		}
	}
	let join = '';
	if (scope.onlyMissing) {
		join = 'LEFT JOIN media_jobs j ON j.video_id = c.id';
		where.push("(j.status IS NULL OR j.status != 'ready')");
	}
	binds.push(limit);
	const { results } = await db
		.prepare(`SELECT c.id, c.channel_id, c.duration, c.is_live FROM content_ownership c ${join} WHERE ${where.join(' AND ')} ORDER BY c.id LIMIT ?${binds.length}`)
		.bind(...binds)
		.all<ScopeRow>();
	const rows = results ?? [];
	return { rows, next: rows.length === limit ? rows[rows.length - 1]!.id : null };
}

/** Ratios from this environment's finished transcodes; assumed (and flagged) when there are none. */
export async function measuredBasis(db: Db): Promise<BackfillEstimate['basis']> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS n, COALESCE(SUM(container_seconds), 0) AS c, COALESCE(SUM(duration_seconds), 0) AS d, COALESCE(SUM(bytes), 0) AS b, COALESCE(SUM(objects), 0) AS o
			 FROM media_jobs WHERE status = 'ready' AND duration_seconds > 0 AND container_seconds > 0 AND bytes > 0`,
		)
		.first<{ n: number; c: number; d: number; b: number; o: number }>();
	const n = Number(row?.n) || 0;
	const d = Number(row?.d) || 0;
	if (!n || !(d > 0)) {
		// No history: the transcode is taken as real time, the renditions as large as the source, and one
		// R2 write per 6 s segment of four rungs. Shown as assumed on the page.
		return { jobs: 0, containerPerVideoSecond: 1, renditionBytesPerVideoSecond: 0, objectsPerVideoSecond: 4 / 6, assumed: true };
	}
	const r = (v: number) => Math.round(v * 1e4) / 1e4;
	return { jobs: n, containerPerVideoSecond: r(Number(row!.c) / d), renditionBytesPerVideoSecond: Math.round(Number(row!.b) / d), objectsPerVideoSecond: r(Number(row!.o) / d), assumed: false };
}

interface PlanVideo extends LibraryHints {
	suspensionHolds?: unknown;
	id: string;
	title?: string;
	channelId?: string | null;
	isDeleted?: boolean;
	isLive?: boolean;
	uploadStatus?: string;
	duration?: number;
	r2?: VideoR2State;
	media?: unknown;
	bunnyRemoved?: unknown;
}

export interface PlannedItem {
	videoId: string;
	state: 'pending' | 'skipped';
	skipReason: BackfillSkipReason | null;
	title: string | null;
	channelId: string | null;
	libraryId: number | null;
	durationSeconds: number | null;
	sourceBytes: number | null;
	sourceFile: string | null;
	hasOriginal: boolean;
	needsTranscode: boolean;
	estUsd: number;
}

/** Is our own original kept (an upload's copy, or an earlier backfill's)? */
export async function hasKeptOriginal(env: BackfillEnv, videoId: string): Promise<boolean> {
	const row = await env.SEARCH_DB!.prepare('SELECT bytes FROM media_originals WHERE video_id = ?1 AND deleted_at IS NULL').bind(videoId).first<{ bytes: number }>();
	return !!row;
}

/** What one video needs, and what it costs. */
export async function planItem(env: BackfillEnv, row: ScopeRow, scope: BackfillScope, basis: BackfillEstimate['basis'], fetchImpl: typeof fetch = fetch): Promise<PlannedItem> {
	const video = await new R2Repository<PlanVideo>(env.videos).getObject(row.id);
	const base: PlannedItem = {
		videoId: row.id,
		state: 'skipped',
		skipReason: null,
		title: typeof video?.title === 'string' ? video.title.slice(0, 200) : null,
		channelId: (video?.channelId as string | undefined) ?? row.channel_id ?? null,
		libraryId: null,
		durationSeconds: video?.duration || row.duration || null,
		sourceBytes: null,
		sourceFile: null,
		hasOriginal: false,
		needsTranscode: false,
		estUsd: 0,
	};
	if (!video) return { ...base, skipReason: 'not_found' };
	if (video.isDeleted) return { ...base, skipReason: 'deleted' };
	if (video.isLive || row.is_live) return { ...base, skipReason: 'live' };
	// CSAM containment or a suspension: never copied or transcoded (the Bunny copy may be evidence)
	if (underHold(video)) return { ...base, skipReason: 'held' };
	const r2Ready = video.r2?.status === 'ready' && !!video.r2.result;
	if (scope.onlyMissing && r2Ready) return { ...base, skipReason: 'has_rendition' };
	if (r2Ready) {
		const verified = await env.SEARCH_DB!.prepare('SELECT rev FROM media_r2_verified WHERE video_id = ?1').bind(row.id).first<{ rev: string }>();
		if (verified?.rev === video.r2!.rev) return { ...base, skipReason: 'already_verified' };
	}
	const hasOriginal = await hasKeptOriginal(env, row.id);
	const guid = bunnyRef({ ...video, id: row.id } as never);
	const facts = guid ? await bunnyFacts(env, guid, video).catch(() => null) : null;
	const durationSeconds = base.durationSeconds ?? facts?.lengthSeconds ?? null;
	const out: PlannedItem = { ...base, hasOriginal, needsTranscode: !r2Ready, libraryId: facts?.library.libraryId ?? null, durationSeconds };
	if (!hasOriginal) {
		// The copy needs Bunny's file
		if (!guid || !facts) return { ...out, state: 'skipped', skipReason: guid ? 'not_ready' : 'no_source' };
		const probed = await probeSource(facts.library, guid, facts.files, fetchImpl);
		if (!probed) return { ...out, state: 'skipped', skipReason: 'no_source' };
		out.sourceBytes = probed.bytes;
		out.sourceFile = probed.file;
	}
	if (out.needsTranscode && !out.durationSeconds) return { ...out, state: 'skipped', skipReason: 'not_ready' };
	out.state = 'pending';
	out.estUsd = itemEstimate(out, basis);
	return out;
}

/** One item's estimated cost (the same model as the run summary). */
export function itemEstimate(item: Pick<PlannedItem, 'hasOriginal' | 'needsTranscode' | 'sourceBytes' | 'durationSeconds'>, basis: BackfillEstimate['basis']): number {
	const copyBytes = item.hasOriginal ? 0 : item.sourceBytes ?? 0;
	const secs = item.needsTranscode ? item.durationSeconds ?? 0 : 0;
	const renditionBytes = item.needsTranscode ? (basis.assumed ? item.sourceBytes ?? 0 : secs * basis.renditionBytesPerVideoSecond) : 0;
	return backfillCost(BACKFILL_PRICES, {
		egressBytes: copyBytes,
		transcodeSeconds: secs * basis.containerPerVideoSecond,
		storageBytes: copyBytes + renditionBytes,
		classAOps: (copyBytes ? Math.ceil(copyBytes / PART_BYTES) + 2 : 0) + secs * basis.objectsPerVideoSecond,
	}).totalUsd;
}

export async function insertPlanned(db: Db, runId: string, items: PlannedItem[], now = new Date()): Promise<void> {
	if (!items.length) return;
	const at = now.toISOString();
	await db.batch(
		items.map((p) =>
			db
				.prepare(
					`INSERT OR IGNORE INTO media_backfill_items (run_id, video_id, state, skip_reason, title, channel_id, library_id, duration_seconds, source_bytes, source_file,
					   has_original, needs_transcode, est_usd, updated_at)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
				)
				.bind(runId, p.videoId, p.state, p.skipReason, p.title, p.channelId, p.libraryId, p.durationSeconds, p.sourceBytes, p.sourceFile, p.hasOriginal ? 1 : 0, p.needsTranscode ? 1 : 0, p.estUsd, at),
		),
	);
}
