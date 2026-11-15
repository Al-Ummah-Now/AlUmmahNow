/**
 * D1 rows of the R2 backfill (migrations/search/0042_media_backfill.sql): runs, items, the latest
 * verification per video, and Bunny removals. Every write here is idempotent on redelivery.
 */
import {
	addCosts,
	backfillCost,
	emptyCost,
	emptyCounts,
	type BackfillChecks,
	type BackfillCounts,
	type BackfillCost,
	type BackfillEstimate,
	type BackfillItem,
	type BackfillItemState,
	type BackfillRun,
	type BackfillRunStatus,
	type BackfillScope,
	type BackfillSettings,
	type BackfillSkipReason,
} from '@al-ummah/shared-types';
import { PRICES } from '../costs';

export type Db = D1Database;

export interface RunRow {
	id: string;
	status: BackfillRunStatus;
	scope: string;
	settings: string;
	estimate: string | null;
	cursor: string | null;
	created_by: string;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	finished_at: string | null;
	stop_reason: string | null;
	tick_at: string | null;
	last_start_at: string | null;
}

export interface ItemRow {
	run_id: string;
	video_id: string;
	state: BackfillItemState;
	skip_reason: BackfillSkipReason | null;
	title: string | null;
	channel_id: string | null;
	library_id: number | null;
	duration_seconds: number | null;
	source_bytes: number | null;
	source_file: string | null;
	has_original: number;
	needs_transcode: number;
	est_usd: number;
	upload_id: string | null;
	copied_bytes: number;
	parts: string | null;
	job_id: string | null;
	egress_bytes: number;
	container_seconds: number;
	stored_bytes: number;
	class_a_ops: number;
	spent_usd: number;
	attempts: number;
	error: string | null;
	error_step: string | null;
	checks: string | null;
	started_at: string | null;
	verified_at: string | null;
	updated_at: string;
}

export const BACKFILL_PRICES = {
	containerInstanceSecond: PRICES.containerInstanceSecond,
	r2GbMonth: PRICES.r2GbMonth,
	r2ClassAPerMillion: PRICES.r2ClassAPerMillion,
	bunnyEgressGb: PRICES.bunnyEgressGb,
};

const parse = <T>(text: string | null, fallback: T): T => {
	if (!text) return fallback;
	try {
		return JSON.parse(text) as T;
	} catch {
		return fallback;
	}
};

export async function getRunRow(db: Db, id: string): Promise<RunRow | null> {
	return (await db.prepare('SELECT * FROM media_backfill_runs WHERE id = ?1').bind(id).first<RunRow>()) ?? null;
}

export async function countsOf(db: Db, runId: string): Promise<BackfillCounts> {
	const { results } = await db.prepare('SELECT state, COUNT(*) AS n FROM media_backfill_items WHERE run_id = ?1 GROUP BY state').bind(runId).all<{ state: BackfillItemState; n: number }>();
	const counts = emptyCounts();
	for (const r of results ?? []) {
		if (r.state in counts) counts[r.state] = Number(r.n) || 0;
		counts.total += Number(r.n) || 0;
	}
	return counts;
}

export async function spentOf(db: Db, runId: string): Promise<BackfillCost> {
	const row = await db
		.prepare(
			`SELECT COALESCE(SUM(egress_bytes), 0) AS e, COALESCE(SUM(container_seconds), 0) AS c, COALESCE(SUM(stored_bytes), 0) AS s, COALESCE(SUM(class_a_ops), 0) AS o
			 FROM media_backfill_items WHERE run_id = ?1`,
		)
		.bind(runId)
		.first<{ e: number; c: number; s: number; o: number }>();
	if (!row) return emptyCost();
	return backfillCost(BACKFILL_PRICES, { egressBytes: Number(row.e), transcodeSeconds: Number(row.c), storageBytes: Number(row.s), classAOps: Number(row.o) });
}

export async function readRun(db: Db, id: string): Promise<BackfillRun | null> {
	const row = await getRunRow(db, id);
	if (!row) return null;
	return runView(row, await countsOf(db, id), await spentOf(db, id));
}

export function runView(row: RunRow, counts: BackfillCounts, spent: BackfillCost): BackfillRun {
	return {
		id: row.id,
		status: row.status,
		scope: parse<BackfillScope>(row.scope, { kind: 'all', onlyMissing: false }),
		settings: parse<BackfillSettings>(row.settings, { concurrency: 1, spacingSeconds: 60, budgetUsd: 0 }),
		estimate: parse<BackfillEstimate | null>(row.estimate, null),
		spent,
		counts,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		stopReason: row.stop_reason,
	};
}

export async function listRuns(db: Db, limit = 20): Promise<BackfillRun[]> {
	const { results } = await db.prepare('SELECT * FROM media_backfill_runs ORDER BY created_at DESC LIMIT ?1').bind(Math.min(Math.max(limit, 1), 50)).all<RunRow>();
	const out: BackfillRun[] = [];
	for (const row of results ?? []) out.push(runView(row, await countsOf(db, row.id), await spentOf(db, row.id)));
	return out;
}

export function itemView(r: ItemRow): BackfillItem {
	return {
		runId: r.run_id,
		videoId: r.video_id,
		state: r.state,
		title: r.title,
		channelId: r.channel_id,
		libraryId: r.library_id,
		durationSeconds: r.duration_seconds,
		sourceBytes: r.source_bytes,
		sourceFile: r.source_file,
		copiedBytes: r.copied_bytes,
		hasOriginal: !!r.has_original,
		estUsd: r.est_usd,
		spentUsd: r.spent_usd,
		skipReason: r.skip_reason,
		error: r.error,
		errorStep: r.error_step,
		attempts: r.attempts,
		checks: parse<BackfillChecks | null>(r.checks, null),
		startedAt: r.started_at,
		verifiedAt: r.verified_at,
		updatedAt: r.updated_at,
	};
}

export async function getItem(db: Db, runId: string, videoId: string): Promise<ItemRow | null> {
	return (await db.prepare('SELECT * FROM media_backfill_items WHERE run_id = ?1 AND video_id = ?2').bind(runId, videoId).first<ItemRow>()) ?? null;
}

export async function listItems(db: Db, runId: string, opts: { state?: BackfillItemState; cursor?: string | null; limit?: number }): Promise<{ items: BackfillItem[]; cursor: string | null }> {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const binds: unknown[] = [runId, opts.cursor ?? ''];
	let where = 'run_id = ?1 AND video_id > ?2';
	if (opts.state) {
		where += ' AND state = ?3';
		binds.push(opts.state);
	}
	binds.push(limit);
	const { results } = await db
		.prepare(`SELECT * FROM media_backfill_items WHERE ${where} ORDER BY video_id LIMIT ?${binds.length}`)
		.bind(...binds)
		.all<ItemRow>();
	const rows = results ?? [];
	return { items: rows.map(itemView), cursor: rows.length === limit ? rows[rows.length - 1]!.video_id : null };
}

export async function itemsInStates(db: Db, runId: string, states: BackfillItemState[], limit: number): Promise<ItemRow[]> {
	const marks = states.map((_, i) => `?${i + 2}`).join(', ');
	const { results } = await db
		.prepare(`SELECT * FROM media_backfill_items WHERE run_id = ?1 AND state IN (${marks}) ORDER BY updated_at LIMIT ?${states.length + 2}`)
		.bind(runId, ...states, limit)
		.all<ItemRow>();
	return results ?? [];
}

/** Recompute the item's spend from its inputs and save the given fields. */
export async function updateItem(db: Db, runId: string, videoId: string, fields: Partial<Omit<ItemRow, 'run_id' | 'video_id'>>, now = new Date()): Promise<void> {
	const entries = Object.entries({ ...fields, updated_at: now.toISOString() });
	const sets = entries.map(([k], i) => `${k} = ?${i + 3}`).join(', ');
	await db
		.prepare(`UPDATE media_backfill_items SET ${sets} WHERE run_id = ?1 AND video_id = ?2`)
		.bind(runId, videoId, ...entries.map(([, v]) => (v === undefined ? null : v)))
		.run();
	if ('egress_bytes' in fields || 'container_seconds' in fields || 'stored_bytes' in fields || 'class_a_ops' in fields) {
		const row = await getItem(db, runId, videoId);
		if (row) {
			const cost = backfillCost(BACKFILL_PRICES, { egressBytes: row.egress_bytes, transcodeSeconds: row.container_seconds, storageBytes: row.stored_bytes, classAOps: row.class_a_ops });
			await db.prepare('UPDATE media_backfill_items SET spent_usd = ?3 WHERE run_id = ?1 AND video_id = ?2').bind(runId, videoId, cost.totalUsd).run();
		}
	}
}

/** Move an item from one state to another; false when it was not in `from` (someone else moved it). */
export async function transition(db: Db, runId: string, videoId: string, from: BackfillItemState[], to: BackfillItemState, fields: Partial<ItemRow> = {}, now = new Date()): Promise<boolean> {
	const entries = Object.entries({ ...fields, state: to, updated_at: now.toISOString() });
	const sets = entries.map(([k], i) => `${k} = ?${i + 3}`).join(', ');
	const marks = from.map((_, i) => `?${entries.length + 3 + i}`).join(', ');
	const res = await db
		.prepare(`UPDATE media_backfill_items SET ${sets} WHERE run_id = ?1 AND video_id = ?2 AND state IN (${marks})`)
		.bind(runId, videoId, ...entries.map(([, v]) => (v === undefined ? null : v)), ...from)
		.run();
	return (res.meta?.changes ?? 0) > 0;
}

export async function updateRun(db: Db, id: string, fields: Partial<Omit<RunRow, 'id'>>, now = new Date()): Promise<void> {
	const entries = Object.entries({ ...fields, updated_at: now.toISOString() });
	const sets = entries.map(([k], i) => `${k} = ?${i + 2}`).join(', ');
	await db.prepare(`UPDATE media_backfill_runs SET ${sets} WHERE id = ?1`).bind(id, ...entries.map(([, v]) => (v === undefined ? null : v))).run();
}

/** Set the run status only when it is currently one of `from`. */
export async function setRunStatus(db: Db, id: string, from: BackfillRunStatus[], to: BackfillRunStatus, fields: Partial<RunRow> = {}, now = new Date()): Promise<boolean> {
	const entries = Object.entries({ ...fields, status: to, updated_at: now.toISOString() });
	const sets = entries.map(([k], i) => `${k} = ?${i + 2}`).join(', ');
	const marks = from.map((_, i) => `?${entries.length + 2 + i}`).join(', ');
	const res = await db
		.prepare(`UPDATE media_backfill_runs SET ${sets} WHERE id = ?1 AND status IN (${marks})`)
		.bind(id, ...entries.map(([, v]) => (v === undefined ? null : v)), ...from)
		.run();
	return (res.meta?.changes ?? 0) > 0;
}

/** The estimate summary from the run's items. */
export async function summariseEstimate(db: Db, runId: string, basis: BackfillEstimate['basis'], now = new Date()): Promise<BackfillEstimate> {
	const { results } = await db
		.prepare('SELECT state, skip_reason, COUNT(*) AS n, COALESCE(SUM(duration_seconds * needs_transcode), 0) AS secs FROM media_backfill_items WHERE run_id = ?1 GROUP BY state, skip_reason')
		.bind(runId)
		.all<{ state: string; skip_reason: BackfillSkipReason | null; n: number; secs: number }>();
	const parts = await db
		.prepare(
			`SELECT COALESCE(SUM(CASE WHEN has_original = 0 THEN source_bytes ELSE 0 END), 0) AS egress,
			   COALESCE(SUM(needs_transcode * duration_seconds), 0) AS secs,
			   COALESCE(SUM(CASE WHEN has_original = 0 THEN (source_bytes + 67108863) / 67108864 + 2 ELSE 0 END), 0) AS copyOps,
			   COALESCE(SUM(CASE WHEN has_original = 0 AND needs_transcode = 1 THEN source_bytes ELSE 0 END), 0) AS assumedBytes
			 FROM media_backfill_items WHERE run_id = ?1 AND state = 'pending'`,
		)
		.bind(runId)
		.first<{ egress: number; secs: number; copyOps: number; assumedBytes: number }>();
	let videos = 0;
	let videoSeconds = 0;
	const skipped: BackfillEstimate['skipped'] = {};
	for (const r of results ?? []) {
		if (r.state === 'skipped' && r.skip_reason) skipped[r.skip_reason] = (skipped[r.skip_reason] ?? 0) + Number(r.n);
		else if (r.state === 'pending') {
			videos += Number(r.n);
			videoSeconds += Number(r.secs);
		}
	}
	const secs = Number(parts?.secs) || 0;
	const egress = Number(parts?.egress) || 0;
	const renditionBytes = basis.assumed ? Number(parts?.assumedBytes) || 0 : secs * basis.renditionBytesPerVideoSecond;
	const cost = backfillCost(BACKFILL_PRICES, {
		egressBytes: egress,
		transcodeSeconds: secs * basis.containerPerVideoSecond,
		storageBytes: egress + renditionBytes,
		classAOps: (Number(parts?.copyOps) || 0) + secs * basis.objectsPerVideoSecond,
	});
	return { ...cost, videos, skipped, videoSeconds: Math.round(videoSeconds), basis, at: now.toISOString() };
}

export { addCosts };
