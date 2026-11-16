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
export const OTHER_DIM = 'other';

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

export class CounterBatch {
	private rows = new Map<string, CounterIncrement>();

	/**
	 * `onInvalid` hears every refused increment. A hand-written type list here once dropped every
	 * 'site' counter without a word (site visits, short links; #1476): refusals are bugs, so the
	 * processor logs them as errors.
	 */
	constructor(private readonly onInvalid?: (inc: CounterIncrement, reason: InvalidIncrementReason) => void) {}

	/** Queues an increment; zero increments are ignored, invalid ones refused and reported. */
	add(inc: CounterIncrement): boolean {
		if (!(ENTITY_TYPES as readonly string[]).includes(inc.entityType)) return this.refuse(inc, 'unknown_entity_type');
		if (!inc.entityId || !DAY.test(inc.day) || !inc.metric) return this.refuse(inc, 'invalid_key');
		if (!Number.isFinite(inc.value)) return this.refuse(inc, 'invalid_value');
		if (inc.value === 0) return false;
		const key = rowKey(inc);
		const existing = this.rows.get(key);
		if (existing) existing.value += inc.value;
		else this.rows.set(key, { ...inc, dim: inc.dim ?? '' });
		return true;
	}

	private refuse(inc: CounterIncrement, reason: InvalidIncrementReason): false {
		this.onInvalid?.(inc, reason);
		return false;
	}

	get size(): number {
		return this.rows.size;
	}

	clear(): void {
		this.rows.clear();
	}

	/** The statements that apply everything queued: one bulk upsert plus one per bounded dimension. */
	statements(db: D1Database): D1PreparedStatement[] {
		const rows = [...this.rows.values()];
		const bounded = rows.filter((r) => r.maxDims && r.dim !== OTHER_DIM);
		const plain = rows.filter((r) => !(r.maxDims && r.dim !== OTHER_DIM));
		return [
			...bulkUpsertStatements(db, plain),
			...bounded.map((inc) =>
				db.prepare(BOUNDED_UPSERT).bind(inc.entityType, inc.entityId, inc.day, inc.metric, inc.dim, inc.maxDims, OTHER_DIM, inc.value),
			),
		];
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
	async flush(db: D1Database, attempts = 3): Promise<number> {
		const statements = this.statements(db);
		this.rows.clear();
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
