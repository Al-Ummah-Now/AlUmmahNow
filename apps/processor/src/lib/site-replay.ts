/**
 * One-off replay of the site counters lost before #1476 (issue #1477): from 2026-11-13 (D-SEO-9)
 * until the fixed processor was deployed, CounterBatch dropped every 'site' increment, so visits
 * and short link clicks never reached analytics_daily. The processor archived each message to R2
 * (MESSAGES_BUCKET) first, so the counts are rebuilt from there.
 *
 *  - Aggregates only: a record gives its allow-listed events (landing, source, referrer host; link
 *    type, source) to the same visitIncrements/shortLinkIncrements the live processor uses. Nothing
 *    else leaves the archive.
 *  - Erased users: a record that carries a user id (pseudonym or the erased marker) is skipped and
 *    counted; visits and short link clicks are sent server side without one.
 *  - Only ClientAnalyticsEvent records are read, chosen by the listing's customMetadata.messageType;
 *    other messages (prod archives everything) are never opened. Unlabelled keys are skipped.
 *  - Only messages received before `cutoff` (the fixed processor's deploy time, less a margin for
 *    messages still in the queue then) are replayed: later ones were counted live.
 *  - Idempotent: each (site, day) batch is guarded by a marker row (metric 'replay', dim
 *    REPLAY_MARKER_DIM) written in the same transaction; a batch whose marker exists writes nothing.
 *  - D1: primary key lookups and upserts only, one batch per site and day.
 */
import { CounterBatch, type CounterIncrement, type CounterMarker } from './analytics-counters';
import { SHORT_LINKS_ENTITY_ID, SITE_ENTITY_ID, shortLinkIncrements, visitIncrements } from './site-visits';
import type { D1Database } from '../types';

export const REPLAY_MARKER_METRIC = 'replay';
export const REPLAY_MARKER_DIM = 'aun-1477';
/** The first day with site counters (D-SEO-9 shipped 2026-11-13) */
export const REPLAY_FIRST_DAY = '2026-11-13';

interface R2ObjectLike {
	key: string;
	customMetadata?: Record<string, string>;
}
interface R2ListLike {
	objects: R2ObjectLike[];
	truncated: boolean;
	cursor?: string;
}
export interface ArchiveBucket {
	list(options: { prefix: string; cursor?: string | undefined; limit?: number; include?: ('customMetadata' | 'httpMetadata')[] }): Promise<R2ListLike>;
	get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export interface ReplayOptions {
	/** First day to read (YYYY-MM-DD) */
	from?: string;
	/** ISO time: messages received at or after it were counted live */
	cutoff: string;
	/** false: count only (dry run) */
	apply: boolean;
	/** Parallel R2 reads */
	concurrency?: number;
}

export interface ReplayDay {
	day: string;
	entityId: string;
	/** visits (site 'videos') or clicks (short links) found in the archive */
	events: number;
	/** The marker exists: replayed before, nothing written */
	alreadyReplayed: boolean;
	/** Written now (apply only) */
	applied: boolean;
}

export interface ReplayReport {
	from: string;
	cutoff: string;
	apply: boolean;
	keysListed: number;
	/** Listed keys of other message types, never read */
	otherTypes: number;
	/** Keys without a messageType label, never read */
	unlabelled: number;
	recordsRead: number;
	/** Records received at or after the cutoff (counted live) */
	afterCutoff: number;
	/** Records carrying a user id, skipped */
	skippedWithUser: number;
	unreadable: number;
	days: ReplayDay[];
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The days whose archive keys are listed: from `from` to the cutoff's day (keys are UTC-day prefixed). */
export function replayDays(from: string, cutoff: string): string[] {
	const start = Date.parse(`${from}T00:00:00Z`);
	const end = Date.parse(cutoff);
	if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('invalid from or cutoff');
	const out: string[] = [];
	for (let ms = start; isoDay(ms) <= isoDay(end); ms += DAY_MS) out.push(isoDay(ms));
	return out;
}

export interface ArchivedAnalytics {
	payload?: { kind?: unknown; events?: unknown; receivedAt?: unknown; userId?: unknown };
	timestamp?: unknown;
	timestampISO?: unknown;
}

/** What one archived record adds, or why it adds nothing. Never returns anything but counter increments. */
export function recordIncrements(record: ArchivedAnalytics, cutoffMs: number): { increments: CounterIncrement[]; skip?: 'after_cutoff' | 'with_user' | 'other_kind' } {
	const payload = record.payload ?? {};
	if (payload.kind !== 'visit' && payload.kind !== 'short_link') return { increments: [], skip: 'other_kind' };
	const receivedAt = String(payload.receivedAt ?? record.timestampISO ?? '');
	const at = Date.parse(receivedAt);
	if (!Number.isFinite(at) || at >= cutoffMs) return { increments: [], skip: 'after_cutoff' };
	if (payload.userId !== undefined && payload.userId !== null && payload.userId !== '') return { increments: [], skip: 'with_user' };
	const events = Array.isArray(payload.events) ? payload.events : [];
	return { increments: payload.kind === 'visit' ? visitIncrements(events, receivedAt) : shortLinkIncrements(events, receivedAt) };
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			while (next < items.length) await run(items[next++]!);
		}),
	);
}

const markerOf = (entityId: string, day: string, value: number): CounterMarker => ({
	entityType: 'site',
	entityId,
	day,
	metric: REPLAY_MARKER_METRIC,
	dim: REPLAY_MARKER_DIM,
	value,
});

async function markerExists(db: D1Database, entityId: string, day: string): Promise<boolean> {
	const row = await db
		.prepare(`SELECT 1 AS hit FROM analytics_daily WHERE entity_type = 'site' AND entity_id = ?1 AND day = ?2 AND metric = ?3 AND dim = ?4`)
		.bind(entityId, day, REPLAY_MARKER_METRIC, REPLAY_MARKER_DIM)
		.first<{ hit: number }>();
	return !!row;
}

export async function replaySiteCounters(env: { MESSAGES_BUCKET: ArchiveBucket; NOTIFICATIONS_DB: D1Database }, options: ReplayOptions): Promise<ReplayReport> {
	const from = options.from ?? REPLAY_FIRST_DAY;
	const cutoffMs = Date.parse(options.cutoff);
	if (!Number.isFinite(cutoffMs)) throw new Error('invalid cutoff');
	const report: ReplayReport = {
		from,
		cutoff: new Date(cutoffMs).toISOString(),
		apply: options.apply,
		keysListed: 0,
		otherTypes: 0,
		unlabelled: 0,
		recordsRead: 0,
		afterCutoff: 0,
		skippedWithUser: 0,
		unreadable: 0,
		days: [],
	};

	// 1. Keys of ClientAnalyticsEvent records, from the listing's metadata only
	const keys: string[] = [];
	for (const day of replayDays(from, report.cutoff)) {
		let cursor: string | undefined;
		do {
			const page = await env.MESSAGES_BUCKET.list({ prefix: `${day}T`, cursor, limit: 1000, include: ['customMetadata'] });
			for (const o of page.objects) {
				report.keysListed += 1;
				const type = o.customMetadata?.messageType;
				if (!type) report.unlabelled += 1;
				else if (type !== 'ClientAnalyticsEvent') report.otherTypes += 1;
				else keys.push(o.key);
			}
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
	}

	// 2. Increments per site and day (a batch per pair, so each has its own marker)
	const batches = new Map<string, { entityId: string; day: string; events: number; counters: CounterBatch }>();
	await pool(keys, options.concurrency ?? 8, async (key) => {
		let record: ArchivedAnalytics;
		try {
			const object = await env.MESSAGES_BUCKET.get(key);
			if (!object) throw new Error('gone');
			record = JSON.parse(await object.text()) as ArchivedAnalytics;
		} catch {
			report.unreadable += 1;
			return;
		}
		report.recordsRead += 1;
		const { increments, skip } = recordIncrements(record, cutoffMs);
		if (skip === 'after_cutoff') report.afterCutoff += 1;
		if (skip === 'with_user') report.skippedWithUser += 1;
		for (const inc of increments) {
			const id = `${inc.entityId}|${inc.day}`;
			let batch = batches.get(id);
			if (!batch) {
				batch = {
					entityId: inc.entityId,
					day: inc.day,
					events: 0,
					counters: new CounterBatch((bad, reason) => {
						throw new Error(`replay increment refused: ${reason} ${bad.entityType}/${bad.metric}`);
					}),
				};
				batches.set(id, batch);
			}
			if ((inc.entityId === SITE_ENTITY_ID && inc.metric === 'visits') || (inc.entityId === SHORT_LINKS_ENTITY_ID && inc.metric === 'clicks')) batch.events += inc.value;
			batch.counters.add(inc);
		}
	});

	// 3. One guarded transaction per site and day
	const ordered = [...batches.values()].sort((a, b) => a.day.localeCompare(b.day) || a.entityId.localeCompare(b.entityId));
	for (const b of ordered) {
		const alreadyReplayed = await markerExists(env.NOTIFICATIONS_DB, b.entityId, b.day);
		let applied = false;
		if (options.apply && !alreadyReplayed) {
			await env.NOTIFICATIONS_DB.batch(b.counters.statementsUnless(env.NOTIFICATIONS_DB, markerOf(b.entityId, b.day, b.events)));
			applied = true;
		}
		report.days.push({ day: b.day, entityId: b.entityId, events: b.events, alreadyReplayed, applied });
	}
	return report;
}
