/**
 * Query plan checks for the scale tests: a list read must seek an index,
 * never sort the table, and a continued page must seek to its cursor.
 */
import assert from 'node:assert/strict';
import type { SqliteD1, TracedQuery } from './search-sqlite-d1';

export interface SeekOptions {
	/** The page continues after a cursor: every search must reach the position. */
	continued?: boolean;
	/** Table whose reads are checked (default content_ownership). */
	table?: string;
	/** Name the plan uses for it (the query's alias; default the table). */
	alias?: string;
}

/**
 * Plans of the traced reads of `table` (statements with ORDER BY): each must
 * use an index and never a temp b-tree for ORDER BY. With `continued`, every
 * index search of the table ends on a range of the sort key and one of them
 * reaches the row id: a plan that seeks only the equalities (`kind=?`) walks
 * every row before the position, so a deep page would cost as much as the
 * catalogue.
 */
export function assertSeeks(db: SqliteD1, traced: TracedQuery[], options: SeekOptions = {}) {
	const table = options.table ?? 'content_ownership';
	const alias = options.alias ?? table;
	const reads = traced.filter((q) => /^\s*SELECT/i.test(q.sql) && q.sql.includes(table) && /ORDER BY/i.test(q.sql));
	assert.ok(reads.length > 0, `the request read ${table}`);
	let continuedReads = 0;
	for (const q of reads) {
		const steps = db.plan(q);
		const plan = steps.join(' | ');
		assert.match(plan, /USING (COVERING )?INDEX|USING PRIMARY KEY/, `${q.sql}\n${plan}`);
		assert.doesNotMatch(plan, /TEMP B-TREE FOR ORDER BY/, `sorts instead of seeking:\n${q.sql}\n${plan}`);
		assert.doesNotMatch(plan, new RegExp(`SCAN ${alias}(?![\\w])(?! USING)`), `scans the table:\n${q.sql}\n${plan}`);
		if (!options.continued) continue;
		const searches = steps.filter((s) => s.startsWith(`SEARCH ${alias} `) && !/\(rowid=\?\)$/.test(s));
		if (!searches.length) continue;
		continuedReads++;
		for (const s of searches) {
			const constraints = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(s)?.[1] ?? '';
			assert.match(constraints, /[<>]\?$|[<>]\(\?/, `seeks the equalities only, not the position:\n${q.sql}\n${plan}`);
		}
		assert.ok(searches.some((s) => /\b(id|channel_id|comment_id|user_id)[<>]\?/.test(s)), `no arm seeks to the cursor's id:\n${q.sql}\n${plan}`);
	}
	if (options.continued) assert.ok(continuedReads > 0, 'a continued page read the index from its position');
}

/**
 * Plans of a search: matching rows are read by rowid (or key) and sorted;
 * the table is never walked in full.
 */
export function assertNoTableWalk(db: SqliteD1, traced: TracedQuery[], alias: string, table = 'content_ownership') {
	const reads = traced.filter((q) => /^\s*SELECT/i.test(q.sql) && q.sql.includes(table));
	assert.ok(reads.length > 0, `the request read ${table}`);
	for (const q of reads) {
		const plan = db.plan(q).join(' | ');
		assert.doesNotMatch(plan, new RegExp(`SCAN ${alias}(?![\\w])(?! USING)`), `walks the table:\n${q.sql}\n${plan}`);
		assert.doesNotMatch(plan, new RegExp(`SCAN ${alias}(?![\\w]) USING (COVERING )?INDEX`), `walks an index:\n${q.sql}\n${plan}`);
	}
}
