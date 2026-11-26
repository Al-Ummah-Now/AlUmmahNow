/**
 * Daily analytics counters in D1 (table analytics_daily, migration 0005).
 *
 * The write API for every analytics rollup. Writers never read-modify-write:
 * each increment is an atomic upsert (`value = value + excluded.value`), so
 * concurrent queue consumers in any number of isolates add up exactly.
 *
 *   const counters = new CounterBatch();
 *   counters.add({ entityType: 'video', entityId, day, metric: 'views', value: 1 });
 *   counters.add({ entityType: 'video', entityId, day, metric: 'embed_origin', dim: origin, value: 1, maxDims: 50 });
 *   await counters.flush(env.NOTIFICATIONS_DB);
 *
 * Increments to the same row are summed in memory first, and a flush writes
 * them in one D1 batch (a transaction) of a few statements (a JSON bulk
 * upsert), so a queue batch of N views of a hot video costs one `+N`, not N
 * writes, and D1 sees one write transaction per queue batch.
 *
 * `maxDims` bounds the distinct dimensions per (entity, day, metric): once the
 * cap is reached, new dimensions are counted under OTHER_DIM. The check runs
 * inside the same SQL statement as the insert, so concurrent writers cannot
 * overshoot it.
 */
import type { D1Database, D1PreparedStatement } from '../types';

export const ANALYTICS_TABLE = 'analytics_daily';
export const ANALYTICS_DEDUPE_TABLE = 'analytics_dedupe';
export const OTHER_DIM = 'other';

const DAY_MS = 86_400_000;

/**
 * How many UTC days a processed analytics message id stays in analytics_dedupe
 * (8 days: 2x Cloudflare Queues' default 4-day message retention). Rows older
 * than this are purged on the primary key prefix by the hourly cron.
 *
 * Note: dead letters live 30 days (DEAD_LETTER_RETENTION_MS), where duplicate
 * admin replays are blocked by `dead_letters.replayed_at`; this table covers
 * queue redeliveries and in-window replays.
 */
export const ANALYTICS_DEDUPE_TTL_DAYS = 8;
export const ANALYTICS_DEDUPE_TTL_MS = ANALYTICS_DEDUPE_TTL_DAYS * DAY_MS;
/** Rows deleted per purge statement (gentle on the single D1 writer). */
export const ANALYTICS_DEDUPE_PURGE_BATCH = 1000;
/** Max rounds per hourly run (200k rows/hour = 4.8M rows/day). */
export const ANALYTICS_DEDUPE_PURGE_MAX_ROUNDS = 200;
/** Wall-clock budget per hourly run so a large backlog yields and resumes next hour. */
export const ANALYTICS_DEDUPE_PURGE_TIME_BOX_MS = 15_000;

/** 'site': whole-site counters (visits, landing pages, sources; entity id = the site, e.g. 'videos') */
export const ENTITY_TYPES = ['video', 'channel', 'post', 'site'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Conflict clause of every counter write: the database adds, never the caller. */
export const ADD_ON_CONFLICT = 'ON CONFLICT (entity_type, entity_id, day, metric, dim) DO UPDATE SET value = value + excluded.value';

export interface CounterIncrement {
	entityType: EntityType;
	entityId: string;
	/** UTC day, YYYY-MM-DD */
	day: string;
	metric: string;
	/** Breakdown key ('' for none) */
	dim?: string;
	value: number;
	/** Cap on distinct dims for this entity/day/metric; overflow goes to OTHER_DIM */
	maxDims?: number;
}

/** Rows per bulk statement (one JSON parameter); keeps each statement small. */
const ROWS_PER_STATEMENT = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Many rows in one atomic statement: ?1 is a JSON array of
 * [entity_type, entity_id, day, metric, dim, value]. A row that repeats an
 * earlier one (in the table or in the same array) is added to it.
 */
const bulkUpsert = (where: string) => `INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'),
       json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'), json_extract(j.value, '$[5]')
FROM json_each(?1) AS j
WHERE ${where}
${ADD_ON_CONFLICT}`;
export const BULK_UPSERT = bulkUpsert('true');

// ?5 dim, ?6 cap, ?7 OTHER_DIM, ?8 value. WHERE true: SQLite needs it before ON CONFLICT after a SELECT.
const boundedUpsert = (where: string) => `INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
SELECT ?1, ?2, ?3, ?4,
  CASE WHEN EXISTS (SELECT 1 FROM ${ANALYTICS_TABLE} WHERE entity_type = ?1 AND entity_id = ?2 AND day = ?3 AND metric = ?4 AND dim = ?5)
         OR (SELECT COUNT(*) FROM ${ANALYTICS_TABLE} WHERE entity_type = ?1 AND entity_id = ?2 AND day = ?3 AND metric = ?4 AND dim <> ?7) < ?6
       THEN ?5 ELSE ?7 END,
  ?8
WHERE ${where}
${ADD_ON_CONFLICT}`;
const BOUNDED_UPSERT = boundedUpsert('true');

/**
 * A row whose presence means "already applied": statements built with `unless` write nothing when
 * it exists (a primary key lookup), and the batch inserts it last, in the same transaction. Used by
 * one-off replays (lib/site-replay.ts) so running one twice never counts twice.
 */
export interface CounterMarker {
	entityType: EntityType;
	entityId: string;
	day: string;
	metric: string;
	dim: string;
	/** Stored as the marker's value (e.g. how many events the replay added) */
	value: number;
}

const unlessClause = (first: number) =>
	`NOT EXISTS (SELECT 1 FROM ${ANALYTICS_TABLE} WHERE entity_type = ?${first} AND entity_id = ?${first + 1} AND day = ?${first + 2} AND metric = ?${first + 3} AND dim = ?${first + 4})`;
const BULK_UPSERT_UNLESS = bulkUpsert(unlessClause(2));
const BOUNDED_UPSERT_UNLESS = boundedUpsert(unlessClause(9));
const MARKER_INSERT = `INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (entity_type, entity_id, day, metric, dim) DO NOTHING`;
const markerKey = (m: CounterMarker) => [m.entityType, m.entityId, m.day, m.metric, m.dim] as const;

// Probe the (day_bucket, message_id) primary key once per candidate day. A date range
// predicate on day_bucket would scan unrelated markers before testing message_id.
function unseenMessage(idIndex: number, bucketsIndex: number): string {
	return `NOT EXISTS (
    SELECT 1 FROM ${ANALYTICS_DEDUPE_TABLE}
    WHERE day_bucket IN (SELECT value FROM json_each(j.value, '$[${bucketsIndex}]'))
      AND message_id = json_extract(j.value, '$[${idIndex}]')
  )`;
}

/**
 * Per-message deduplicated bulk upsert: ?1 is a JSON array of
 * [entity_type, entity_id, day, metric, dim, value, message_id, lookup_buckets].
 * Rows whose (day_bucket, message_id) already exists in analytics_dedupe (PK seek)
 * are skipped; the rest are summed per counter key so a hot batch still writes one row per key.
 */
export const BULK_UPSERT_DEDUPED = `INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
SELECT entity_type, entity_id, day, metric, dim, SUM(val)
FROM (
  SELECT json_extract(j.value, '$[0]') AS entity_type,
         json_extract(j.value, '$[1]') AS entity_id,
         json_extract(j.value, '$[2]') AS day,
         json_extract(j.value, '$[3]') AS metric,
         json_extract(j.value, '$[4]') AS dim,
         json_extract(j.value, '$[5]') AS val
  FROM json_each(?1) AS j
  WHERE ${unseenMessage(6, 7)}
)
GROUP BY entity_type, entity_id, day, metric, dim
HAVING SUM(val) <> 0
${ADD_ON_CONFLICT}`;

/**
 * Per-message deduplicated bounded upsert: ?1..4 key, ?5 dim, ?6 cap,
 * ?7 OTHER_DIM, ?8 JSON array of [message_id, value, bucket0, bucket1, bucket2].
 * Sums only unseen messages; writes nothing when every message in the batch was already seen.
 */
export const BOUNDED_UPSERT_DEDUPED = `INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
SELECT ?1, ?2, ?3, ?4,
  CASE WHEN EXISTS (SELECT 1 FROM ${ANALYTICS_TABLE} WHERE entity_type = ?1 AND entity_id = ?2 AND day = ?3 AND metric = ?4 AND dim = ?5)
         OR (SELECT COUNT(*) FROM ${ANALYTICS_TABLE} WHERE entity_type = ?1 AND entity_id = ?2 AND day = ?3 AND metric = ?4 AND dim <> ?7) < ?6
       THEN ?5 ELSE ?7 END,
  s.total
FROM (
  SELECT SUM(json_extract(j.value, '$[1]')) AS total
  FROM json_each(?8) AS j
  WHERE ${unseenMessage(0, 2)}
) AS s
WHERE s.total IS NOT NULL AND s.total <> 0
${ADD_ON_CONFLICT}`;

/** Records the batch's unseen messages last in the same transaction (no secondary index). */
export const DEDUPE_INSERT = `INSERT OR IGNORE INTO ${ANALYTICS_DEDUPE_TABLE} (day_bucket, message_id)
SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]')
FROM json_each(?1) AS j
WHERE ${unseenMessage(1, 2)}`;

function utcDayOf(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Normal messages write under their timestamp's UTC day. Clamped messages write under
 * today's UTC day and look back through the retained window, including the purge cutoff.
 * An in-window timestamp can also have an earlier marker if it was future on first
 * delivery, so check the retained days through its write bucket in that case too.
 */
export function resolveMessageBuckets(
	timestamp: number | string | undefined,
	now = Date.now(),
	ttlDays = ANALYTICS_DEDUPE_TTL_DAYS,
): { writeBucket: string; lookupBuckets: string[] } {
	const today = utcDayOf(now);
	const cutoffMs = Date.parse(`${utcDayOf(now - ttlDays * DAY_MS)}T00:00:00Z`);
	const minWriteDay = utcDayOf(now - Math.max(1, ttlDays - 1) * DAY_MS);
	const parsed = timestamp === undefined ? Number.NaN : new Date(timestamp).getTime();
	const rawDay = Number.isFinite(parsed) ? utcDayOf(parsed) : null;
	const writeBucket = rawDay && rawDay >= minWriteDay && rawDay <= today ? rawDay : today;
	const lookupBuckets: string[] = [];
	for (let ms = Date.parse(`${writeBucket}T00:00:00Z`); ms >= cutoffMs; ms -= DAY_MS) {
		lookupBuckets.push(utcDayOf(ms));
	}
	return { writeBucket, lookupBuckets };
}

/** Why CounterBatch.add refused an increment (a caller bug: logged, never silent). */
export type InvalidIncrementReason = 'unknown_entity_type' | 'invalid_key' | 'invalid_value';

/** Statements adding unbounded rows: one per ROWS_PER_STATEMENT rows. */
export function bulkUpsertStatements(db: D1Database, rows: CounterIncrement[]): D1PreparedStatement[] {
	const out: D1PreparedStatement[] = [];
	for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
		const json = JSON.stringify(rows.slice(i, i + ROWS_PER_STATEMENT).map((r) => [r.entityType, r.entityId, r.day, r.metric, r.dim ?? '', r.value]));
		out.push(db.prepare(BULK_UPSERT).bind(json));
	}
	return out;
}

function rowKey(inc: CounterIncrement): string {
	return JSON.stringify([inc.entityType, inc.entityId, inc.day, inc.metric, inc.dim ?? '', inc.maxDims ?? 0]);
}

export interface CounterFlushOptions {
	now?: number;
	ttlDays?: number;
	/** Additional statements committed in the same D1 batch transaction (e.g. discovery_viewers). */
	extraStatements?: D1PreparedStatement[];
}

export class CounterBatch {
	private rows = new Map<string, CounterIncrement>();
	private dedupedRows = new Map<string, { inc: CounterIncrement; byMessage: Map<string, number> }>();
	private messageTimestamps = new Map<string, number | string | undefined>();

	/**
	 * `onInvalid` hears every refused increment. A hand-written type list here once dropped every
	 * 'site' counter without a word (site visits, short links; #1476): refusals are bugs, so the
	 * processor logs them as errors.
	 */
	constructor(private readonly onInvalid?: (inc: CounterIncrement, reason: InvalidIncrementReason) => void) {}

	private validate(inc: CounterIncrement): boolean {
		if (!(ENTITY_TYPES as readonly string[]).includes(inc.entityType)) return this.refuse(inc, 'unknown_entity_type');
		if (!inc.entityId || !DAY.test(inc.day) || !inc.metric) return this.refuse(inc, 'invalid_key');
		if (!Number.isFinite(inc.value)) return this.refuse(inc, 'invalid_value');
		if (inc.value === 0) return false;
		return true;
	}

	/** Queues an increment; zero increments are ignored, invalid ones refused and reported. */
	add(inc: CounterIncrement): boolean {
		if (!this.validate(inc)) return false;
		const key = rowKey(inc);
		const existing = this.rows.get(key);
		if (existing) existing.value += inc.value;
		else this.rows.set(key, { ...inc, dim: inc.dim ?? '' });
		return true;
	}

	/**
	 * Queues all increments of one queue message, keyed by `messageId` for
	 * per-message deduplication in `analytics_dedupe`. A second call with the
	 * same `messageId` in the same batch is a no-op (returns false).
	 */
	addForMessage(messageId: string, increments: CounterIncrement[], messageTimestamp?: number | string): boolean {
		if (!messageId) {
			let any = false;
			for (const inc of increments) if (this.add(inc)) any = true;
			return any;
		}
		if (this.messageTimestamps.has(messageId)) return false;
		// Merge increments within this message first so one message contributes at most one tuple per key
		const merged = new Map<string, CounterIncrement>();
		for (const inc of increments) {
			if (!this.validate(inc)) continue;
			const key = rowKey(inc);
			const existing = merged.get(key);
			if (existing) existing.value += inc.value;
			else merged.set(key, { ...inc, dim: inc.dim ?? '' });
		}
		let added = false;
		for (const [key, inc] of merged) {
			if (inc.value === 0) continue;
			let entry = this.dedupedRows.get(key);
			if (!entry) {
				entry = { inc: { ...inc, value: 0 }, byMessage: new Map() };
				this.dedupedRows.set(key, entry);
			}
			entry.byMessage.set(messageId, inc.value);
			added = true;
		}
		if (added) this.messageTimestamps.set(messageId, messageTimestamp);
		return added;
	}

	hasMessage(messageId: string): boolean {
		return this.messageTimestamps.has(messageId);
	}

	private refuse(inc: CounterIncrement, reason: InvalidIncrementReason): false {
		this.onInvalid?.(inc, reason);
		return false;
	}

	get size(): number {
		return this.rows.size + this.dedupedRows.size;
	}

	clear(): void {
		this.rows.clear();
		this.dedupedRows.clear();
		this.messageTimestamps.clear();
	}

	/**
	 * The statements that apply everything queued: untagged rows, per-message
	 * deduplicated rows (merged per counter key in SQL), the dedupe markers
	 * inserted last, and any `extraStatements` sharing the transaction.
	 */
	statements(db: D1Database, opts: CounterFlushOptions = {}): D1PreparedStatement[] {
		const out: D1PreparedStatement[] = [];

		// 1. Untagged increments (direct CounterBatch.add callers)
		if (this.rows.size > 0) {
			const rows = [...this.rows.values()];
			const bounded = rows.filter((r) => r.maxDims && r.dim !== OTHER_DIM);
			const plain = rows.filter((r) => !(r.maxDims && r.dim !== OTHER_DIM));
			out.push(
				...bulkUpsertStatements(db, plain),
				...bounded.map((inc) =>
					db.prepare(BOUNDED_UPSERT).bind(inc.entityType, inc.entityId, inc.day, inc.metric, inc.dim, inc.maxDims, OTHER_DIM, inc.value),
				),
			);
		}

		// 2. Per-message deduplicated increments
		if (this.dedupedRows.size > 0) {
			const now = opts.now ?? Date.now();
			const ttlDays = opts.ttlDays ?? ANALYTICS_DEDUPE_TTL_DAYS;
			const bucketsByMessage = new Map<string, ReturnType<typeof resolveMessageBuckets>>();
			for (const [messageId, ts] of this.messageTimestamps) {
				bucketsByMessage.set(messageId, resolveMessageBuckets(ts, now, ttlDays));
			}

			const plainTuples: Array<[EntityType, string, string, string, string, number, string, string[]]> = [];
			const boundedEntries: Array<{ inc: CounterIncrement; entries: Array<[string, number, string[]]> }> = [];

			for (const { inc, byMessage } of this.dedupedRows.values()) {
				if (inc.maxDims && inc.dim !== OTHER_DIM) {
					const entries: Array<[string, number, string[]]> = [];
					for (const [messageId, value] of byMessage) {
						const { lookupBuckets } = bucketsByMessage.get(messageId)!;
						entries.push([messageId, value, lookupBuckets]);
					}
					boundedEntries.push({ inc, entries });
				} else {
					for (const [messageId, value] of byMessage) {
						const { lookupBuckets } = bucketsByMessage.get(messageId)!;
						plainTuples.push([inc.entityType, inc.entityId, inc.day, inc.metric, inc.dim ?? '', value, messageId, lookupBuckets]);
					}
				}
			}

			for (let i = 0; i < plainTuples.length; i += ROWS_PER_STATEMENT) {
				out.push(db.prepare(BULK_UPSERT_DEDUPED).bind(JSON.stringify(plainTuples.slice(i, i + ROWS_PER_STATEMENT))));
			}

			for (const { inc, entries } of boundedEntries) {
				for (let i = 0; i < entries.length; i += ROWS_PER_STATEMENT) {
					out.push(
						db
							.prepare(BOUNDED_UPSERT_DEDUPED)
							.bind(inc.entityType, inc.entityId, inc.day, inc.metric, inc.dim, inc.maxDims, OTHER_DIM, JSON.stringify(entries.slice(i, i + ROWS_PER_STATEMENT))),
					);
				}
			}

			// Dedupe markers must be inserted AFTER all counter upserts in the same batch (1 row/message, no secondary index)
			const markers = [...bucketsByMessage.entries()].map(([id, b]) => [b.writeBucket, id, b.lookupBuckets]);
			for (let i = 0; i < markers.length; i += ROWS_PER_STATEMENT) {
				out.push(db.prepare(DEDUPE_INSERT).bind(JSON.stringify(markers.slice(i, i + ROWS_PER_STATEMENT))));
			}
		}

		if (opts.extraStatements?.length) out.push(...opts.extraStatements);
		return out;
	}

	/**
	 * The statements of `statements()` that write nothing once `marker` exists, then the marker's
	 * insert: run as one batch (a transaction), the increments are applied exactly once however
	 * often the batch runs.
	 */
	statementsUnless(db: D1Database, marker: CounterMarker): D1PreparedStatement[] {
		const rows = [...this.rows.values()];
		const bounded = rows.filter((r) => r.maxDims && r.dim !== OTHER_DIM);
		const plain = rows.filter((r) => !(r.maxDims && r.dim !== OTHER_DIM));
		const key = markerKey(marker);
		const out: D1PreparedStatement[] = [];
		for (let i = 0; i < plain.length; i += ROWS_PER_STATEMENT) {
			const json = JSON.stringify(plain.slice(i, i + ROWS_PER_STATEMENT).map((r) => [r.entityType, r.entityId, r.day, r.metric, r.dim ?? '', r.value]));
			out.push(db.prepare(BULK_UPSERT_UNLESS).bind(json, ...key));
		}
		for (const inc of bounded) {
			out.push(db.prepare(BOUNDED_UPSERT_UNLESS).bind(inc.entityType, inc.entityId, inc.day, inc.metric, inc.dim, inc.maxDims, OTHER_DIM, inc.value, ...key));
		}
		out.push(db.prepare(MARKER_INSERT).bind(...key, marker.value));
		return out;
	}

	/**
	 * Writes everything queued in one D1 batch (one transaction: all or
	 * nothing), retrying a failed attempt, and empties the batch. Throws when
	 * every attempt failed; nothing was written then.
	 */
	async flush(db: D1Database, attempts = 3, opts: CounterFlushOptions = {}): Promise<number> {
		const statements = this.statements(db, opts);
		this.clear();
		if (statements.length === 0) return 0;
		for (let attempt = 1; ; attempt++) {
			try {
				await db.batch(statements);
				return statements.length;
			} catch (error) {
				if (attempt >= attempts) throw error;
			}
		}
	}
}

export interface AnalyticsDedupePurgeResult {
	deleted: number;
	/** Sum of D1's reported rows_written, or null if any chunk omitted the metric. */
	rowsWritten: number | null;
	rounds: number;
	/** True when no expired rows remain; false when maxRounds or timeBoxMs stopped the run. */
	caughtUp: boolean;
	timedOut: boolean;
	cutoffDay: string;
}

export interface AnalyticsDedupePurgeOptions {
	batchSize?: number;
	maxRounds?: number;
	timeBoxMs?: number;
	ttlDays?: number;
	clock?: () => number;
}

/**
 * Deletes expired analytics_dedupe rows in bounded PK-prefix chunks (1,000 rows per
 * statement, no secondary index, no full table scan).
 * Runs hourly and stops at maxRounds or timeBoxMs, resuming on the next hour if a
 * backlog remains.
 */
export async function purgeExpiredAnalyticsDedupe(
	db: D1Database,
	now = Date.now(),
	opts: AnalyticsDedupePurgeOptions = {},
): Promise<AnalyticsDedupePurgeResult> {
	const batchSize = opts.batchSize ?? ANALYTICS_DEDUPE_PURGE_BATCH;
	const maxRounds = opts.maxRounds ?? ANALYTICS_DEDUPE_PURGE_MAX_ROUNDS;
	const timeBoxMs = opts.timeBoxMs ?? ANALYTICS_DEDUPE_PURGE_TIME_BOX_MS;
	const ttlDays = opts.ttlDays ?? ANALYTICS_DEDUPE_TTL_DAYS;
	const clock = opts.clock ?? Date.now;
	const cutoffDay = utcDayOf(now - ttlDays * DAY_MS);
	const startedAt = clock();

	const sql = `DELETE FROM ${ANALYTICS_DEDUPE_TABLE}
WHERE (day_bucket, message_id) IN (
  SELECT day_bucket, message_id FROM ${ANALYTICS_DEDUPE_TABLE}
  WHERE day_bucket < ?1
  ORDER BY day_bucket, message_id
  LIMIT ?2
)`;

	let deleted = 0;
	let rowsWritten: number | null = 0;
	let rounds = 0;
	let caughtUp = false;
	let timedOut = false;

	for (let round = 0; round < maxRounds; round++) {
		if (round > 0 && clock() - startedAt >= timeBoxMs) {
			timedOut = true;
			break;
		}
		const result = await db.prepare(sql).bind(cutoffDay, batchSize).run();
		if (!result.success) throw new Error(result.error ?? 'Analytics dedupe purge failed');
		const meta = result.meta as { changes?: number; rows_written?: number } | undefined;
		const n = meta?.changes ?? 0;
		rowsWritten = rowsWritten !== null && meta?.rows_written !== undefined ? rowsWritten + meta.rows_written : null;
		deleted += n;
		rounds++;
		if (n < batchSize) {
			caughtUp = true;
			break;
		}
	}

	return { deleted, rowsWritten, rounds, caughtUp, timedOut, cutoffDay };
}

/** One-shot helper: add these increments atomically per row. */
export async function addCounters(
	db: D1Database,
	increments: CounterIncrement[],
	onInvalid: (inc: CounterIncrement, reason: InvalidIncrementReason) => void = (inc, reason) =>
		console.error('[analytics-counters] increment refused', { reason, entityType: inc.entityType, metric: inc.metric }),
): Promise<number> {
	const batch = new CounterBatch(onInvalid);
	for (const inc of increments) batch.add(inc);
	return batch.flush(db);
}

export interface CounterRow {
	entity_type: EntityType;
	entity_id: string;
	day: string;
	metric: string;
	dim: string;
	value: number;
}

/** Reads the counters of some entities over an inclusive day range. */
export async function readCounters(
	db: D1Database,
	entityType: EntityType,
	entityIds: string[],
	fromDay: string,
	toDay: string,
	metrics?: string[],
): Promise<CounterRow[]> {
	if (entityIds.length === 0) return [];
	const rows: CounterRow[] = [];
	// Stay well under D1's bound-parameter limit
	for (let i = 0; i < entityIds.length; i += 50) {
		const ids = entityIds.slice(i, i + 50);
		const metricFilter = metrics?.length ? ` AND metric IN (${metrics.map(() => '?').join(', ')})` : '';
		const result = await db
			.prepare(
				`SELECT entity_type, entity_id, day, metric, dim, value FROM ${ANALYTICS_TABLE}
				 WHERE entity_type = ? AND entity_id IN (${ids.map(() => '?').join(', ')}) AND day >= ? AND day <= ?${metricFilter}`,
			)
			.bind(entityType, ...ids, fromDay, toDay, ...(metrics ?? []))
			.all<CounterRow>();
		rows.push(...(result.results ?? []));
	}
	return rows;
}
