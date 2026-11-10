/**
 * Keyset paging over D1 for lists of any table (public lists in ownership.ts,
 * the admin lists in lib/admin): a page continues after the sort key of the
 * last row shown, so it is a bounded index seek however deep it is, and rows
 * inserted or removed meanwhile never shift the pages.
 */

import type { SearchDb } from '@al-ummah/shared-types';

export type KeyValue = number | string;
export type Direction = 'DESC' | 'ASC';

export interface KeysetArm {
	where: string;
	params: unknown[];
	orderBy: string;
}

/**
 * The keyset condition "after `values` in `columns` order", as one condition
 * per arm: arm i fixes the first i columns to the position's values and
 * takes column i past it. Every arm is a full seek of the list's index
 * (equalities, then one range), and the arms cover disjoint, consecutive
 * runs of the order, deepest first. One row-value comparison
 * `(c0, c1) < (?, ?)` would say the same, but SQLite only seeks a row value
 * on plain columns: over an expression index such as
 * (kind, COALESCE(created_at, 0), id) it seeks `kind = ?` alone and walks
 * every row before the position, so a deep page costs as much as the table.
 * Each arm orders by its free columns only: SQLite does not treat
 * `COALESCE(...) = ?` as a constant of the order and would sort the arm.
 */
export function keysetArms(columns: string[], direction: Direction, values: readonly unknown[]): KeysetArm[] {
	const op = direction === 'DESC' ? '<' : '>';
	const arms: KeysetArm[] = [];
	for (let i = columns.length - 1; i >= 0; i--) {
		const parts = columns.slice(0, i).map((c) => `${c} = ?`);
		parts.push(`${columns[i]} ${op} ?`);
		arms.push({ where: parts.join(' AND '), params: values.slice(0, i + 1), orderBy: columns.slice(i).map((c) => `${c} ${direction}`).join(', ') });
	}
	return arms;
}

export interface KeysetQuery {
	/** Table (with alias) and joins, e.g. `content_ownership v`. */
	from: string;
	/** Extra result columns, e.g. `v.*` (the sort key comes back as k0..kn). */
	select?: string;
	where: string[];
	params: unknown[];
	/** Sort key, unique per row (the row id last), one direction. */
	columns: string[];
	direction: Direction;
	/** Continue after this position (the k-values of the last row shown). */
	after?: readonly KeyValue[] | null;
	limit: number;
}

export interface KeysetResult<R> {
	rows: R[];
	/** The position of the last row returned (null: no row). */
	last: KeyValue[] | null;
	hasMore: boolean;
}

/** The sort key of a result row (k0..kn). */
function keyOf(row: Record<string, unknown>, n: number): KeyValue[] {
	return Array.from({ length: n }, (_, i) => {
		const v = row[`k${i}`];
		return typeof v === 'number' ? v : String(v ?? '');
	});
}

/**
 * One page of rows in `columns` order after `after`: limit + 1 rows are read
 * so the caller knows whether more exist. With a position the query is a
 * UNION ALL of keysetArms, each arm limited to limit + 1 rows: at most
 * columns × (limit + 1) index entries whatever the depth. Arms come back in
 * arm order (each one's rows precede every row of the next), no sort runs.
 */
export async function keysetQuery<R extends Record<string, unknown>>(db: SearchDb, q: KeysetQuery): Promise<KeysetResult<R>> {
	const select = [q.select, ...q.columns.map((c, i) => `${c} AS k${i}`)].filter(Boolean).join(', ');
	const n = q.columns.length;
	let all: Array<Record<string, unknown>>;
	if (q.after && q.after.length === n) {
		const arms = keysetArms(q.columns, q.direction, q.after);
		const sql = arms
			.map((arm, i) => `SELECT * FROM (SELECT ${i} AS arm__, ${select} FROM ${q.from} WHERE ${[...q.where, arm.where].join(' AND ')} ORDER BY ${arm.orderBy} LIMIT ?)`)
			.join(' UNION ALL ');
		const { results } = await db
			.prepare(sql)
			.bind(...arms.flatMap((arm) => [...q.params, ...arm.params, q.limit + 1]))
			.all<Record<string, unknown>>();
		// Array sort is stable: arm order, and index order within an arm
		all = (results ?? [])
			.map((row, i) => ({ row, i }))
			.sort((a, b) => Number(a.row.arm__) - Number(b.row.arm__) || a.i - b.i)
			.map((x) => x.row)
			.slice(0, q.limit + 1);
	} else {
		const { results } = await db
			.prepare(
				`SELECT ${select} FROM ${q.from} ${q.where.length ? `WHERE ${q.where.join(' AND ')}` : ''} ORDER BY ${q.columns.map((c) => `${c} ${q.direction}`).join(', ')} LIMIT ?`,
			)
			.bind(...q.params, q.limit + 1)
			.all<Record<string, unknown>>();
		all = results ?? [];
	}
	const rows = all.slice(0, q.limit);
	const lastRow = rows[rows.length - 1];
	return { rows: rows as R[], last: lastRow ? keyOf(lastRow, n) : null, hasMore: all.length > q.limit };
}

export const CURSOR_PREFIX = 'ks:';

/** Opaque, URL-safe cursor: the list's tag (its order) and the position. */
export function encodeCursor(tag: string, values: readonly KeyValue[]): string {
	const bytes = new TextEncoder().encode(JSON.stringify([tag, ...values]));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return CURSOR_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The position of a cursor of the list `tag` whose key has these value
 * types, or null (absent, malformed, or of another list or order).
 */
export function decodeCursor(cursor: string | null | undefined, tag: string, types: ReadonlyArray<'number' | 'string'>): KeyValue[] | null {
	if (!cursor?.startsWith(CURSOR_PREFIX)) return null;
	try {
		const b64 = cursor.slice(CURSOR_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
		const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
		const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)))) as unknown;
		if (!Array.isArray(parsed) || parsed[0] !== tag) return null;
		const values = parsed.slice(1);
		if (values.length !== types.length) return null;
		for (let i = 0; i < types.length; i++) {
			if (types[i] === 'number' ? !(typeof values[i] === 'number' && Number.isFinite(values[i])) : typeof values[i] !== 'string') return null;
		}
		return values as KeyValue[];
	} catch {
		return null;
	}
}

/**
 * Number of rows matching, counted up to `cap` (one bounded index walk):
 * lists show "cap+" past it rather than count the whole table per request.
 */
export async function cappedCount(db: SearchDb, from: string, where: string[], params: unknown[], cap: number): Promise<{ total: number; capped: boolean }> {
	const row = await db
		.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${from} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} LIMIT ?)`)
		.bind(...params, cap + 1)
		.first<{ n: number }>();
	const n = Number(row?.n) || 0;
	return n > cap ? { total: cap, capped: true } : { total: n, capped: false };
}

/** A trigram FTS5 phrase for a substring search (quotes doubled); null below 3 characters (trigram's minimum). */
export function trigramPhrase(q: string | undefined): string | null {
	const term = q?.trim();
	if (!term || [...term].length < 3) return null;
	return `"${term.replace(/"/g, '""')}"`;
}
