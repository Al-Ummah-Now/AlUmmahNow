import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isIndexPageCursor, legacyOffset, MAX_LEGACY_OFFSET, pageFromIndex } from '../src/lib/search/indexPage';
import type { KeysetPage, KeysetPosition } from '../src/lib/search/ownership';

/** 100 rows newest first (created = 100 - i), as keysetPage would return them. */
const ROWS = Array.from({ length: 100 }, (_, i) => ({ id: `p${String(i).padStart(3, '0')}`, created: 100 - i }));

function fakeFetch(calls: Array<{ after: KeysetPosition | null; limit: number; offset: number }>) {
	return async (after: KeysetPosition | null, limit: number, offset: number): Promise<KeysetPage> => {
		calls.push({ after, limit, offset });
		const start = after ? ROWS.findIndex((r) => r.id === after.values[1]) + 1 : offset;
		const rows = ROWS.slice(start, start + limit);
		const positions = rows.map((r) => ({ sort: 'latest' as const, values: [r.created, r.id] }));
		return { ids: rows.map((r) => r.id), positions, last: positions[positions.length - 1] ?? null, hasMore: start + limit < ROWS.length };
	};
}

describe('pageFromIndex (playlists, live streams)', () => {
	it('stops at the row that fills the page; the next page starts right after it', async () => {
		const calls: Array<{ after: KeysetPosition | null; limit: number; offset: number }> = [];
		// Every third row is dropped on load (a stale index row)
		const opts = { sort: 'latest' as const, limit: 5, fetch: fakeFetch(calls), load: async (id: string) => ({ id }), isListed: (p: { id: string } | null): p is { id: string } => !!p && Number(p.id.slice(1)) % 3 !== 2 };
		const first = await pageFromIndex({ ...opts, cursor: null });
		assert.deepEqual(first!.items.map((p) => p.id), ['p000', 'p001', 'p003', 'p004', 'p006']);
		assert.match(first!.cursor, /^ks:/);
		assert.equal(first!.examined, 9, 'loads in small batches: at most a few rows past the one that fills the page');
		const second = await pageFromIndex({ ...opts, cursor: first!.cursor });
		assert.deepEqual(second!.items.map((p) => p.id), ['p007', 'p009', 'p010', 'p012', 'p013']);
	});

	it('accepts offset cursors from before keyset paging (capped) and answers with a keyset cursor', async () => {
		const calls: Array<{ after: KeysetPosition | null; limit: number; offset: number }> = [];
		const opts = { sort: 'latest' as const, limit: 3, fetch: fakeFetch(calls), load: async (id: string) => ({ id }), isListed: (p: { id: string } | null): p is { id: string } => !!p };
		for (const cursor of ['10', 'idx:10']) {
			const page = await pageFromIndex({ ...opts, cursor });
			assert.deepEqual(page!.items.map((p) => p.id), ['p010', 'p011', 'p012'], cursor);
			assert.match(page!.cursor, /^ks:/);
		}
		assert.equal(legacyOffset(String(MAX_LEGACY_OFFSET * 5)), MAX_LEGACY_OFFSET);
		assert.equal(legacyOffset('sa:abc'), null);
		assert.ok(isIndexPageCursor('ks:x') && isIndexPageCursor('12') && !isIndexPageCursor('sa:abc') && !isIndexPageCursor(''));
	});

	it('a bucket-scan cursor ends the list (null only without an index); the end of the list is reported', async () => {
		const calls: Array<{ after: KeysetPosition | null; limit: number; offset: number }> = [];
		const opts = { sort: 'latest' as const, limit: 50, fetch: fakeFetch(calls), load: async (id: string) => ({ id }), isListed: (p: { id: string } | null): p is { id: string } => !!p };
		assert.deepEqual(await pageFromIndex({ ...opts, cursor: 'sa:abc' }), { items: [], cursor: '', examined: 0 });
		assert.equal(await pageFromIndex({ ...opts, fetch: async () => null, cursor: 'sa:abc' }), null);
		assert.equal(calls.length, 1, 'only whether there is an index');
		calls.length = 0;
		const first = await pageFromIndex({ ...opts, cursor: null });
		const last = await pageFromIndex({ ...opts, cursor: first!.cursor });
		assert.equal(last!.items.length, 50);
		assert.equal(last!.cursor, '', 'no next page after the last row');
	});
});
