import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backfillTarget, runBackfill, runCheck, type BackfillIo, type ColumnRow } from '../content-columns.ts';

interface Row { id: string; studio_status: string | null; title?: string | null }

function fakeIo(rows: Row[], objects: Record<string, unknown>, options: { failGets?: number; stuck?: boolean } = {}) {
	let failures = options.failGets ?? 0;
	const updates: ColumnRow[] = [];
	const removed: string[] = [];
	const io: BackfillIo = {
		pendingIds: async (limit) => rows.filter((r) => r.studio_status === null).slice(0, limit).map((r) => r.id),
		getObject: async (id) => {
			if (failures > 0) {
				failures--;
				throw new Error('R2 500');
			}
			return objects[id] ?? null;
		},
		setColumns: async (row) => {
			updates.push(row);
			if (options.stuck) return;
			const stored = rows.find((r) => r.id === row.id);
			if (stored) stored.studio_status = row.studioStatus;
		},
		removeRow: async (id) => {
			removed.push(id);
			if (options.stuck) return;
			rows.splice(rows.findIndex((r) => r.id === id), 1);
		},
		countMissing: async () => rows.filter((r) => r.studio_status === null).length,
	};
	return { io, updates, removed };
}

const quiet = { batch: 2, retryDelayMs: 0, log: () => {} };

describe('runBackfill', () => {
	it('fills every row in batches', async () => {
		const rows: Row[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, studio_status: null }));
		const objects = Object.fromEntries(rows.map((r) => [r.id, { id: r.id, title: `T ${r.id}`, category: 'tafsir', language: 'ar', isDraft: r.id === 'b' }]));
		const { io, updates } = fakeIo(rows, objects);
		assert.deepEqual(await runBackfill(io, quiet), { updated: 5, removed: 0 });
		assert.equal(updates.length, 5);
		assert.deepEqual(updates.find((u) => u.id === 'b'), { id: 'b', studioStatus: 'drafts', title: 'T b', category: 'tafsir', language: 'ar' });
		assert.equal(updates.find((u) => u.id === 'a')?.studioStatus, 'published');
	});

	it('is safe to run again, and resumes after a partial run', async () => {
		const rows: Row[] = [{ id: 'done', studio_status: 'published' }, { id: 'left', studio_status: null }];
		const { io, updates } = fakeIo(rows, { left: { id: 'left', title: 'x' } });
		assert.deepEqual(await runBackfill(io, quiet), { updated: 1, removed: 0 });
		assert.deepEqual(updates.map((u) => u.id), ['left']);
		assert.deepEqual(await runBackfill(io, quiet), { updated: 0, removed: 0 });
	});

	it('removes a row whose object is gone or isn\'t a video', async () => {
		const rows: Row[] = [{ id: 'gone', studio_status: null }, { id: 'other', studio_status: null }];
		const { io, removed } = fakeIo(rows, { other: { id: 'different' } });
		assert.deepEqual(await runBackfill(io, quiet), { updated: 0, removed: 2 });
		assert.deepEqual(removed.sort(), ['gone', 'other']);
	});

	it('retries a failed read', async () => {
		const { io } = fakeIo([{ id: 'a', studio_status: null }], { a: { id: 'a' } }, { failGets: 2 });
		assert.equal((await runBackfill(io, quiet)).updated, 1);
	});

	it('fails when a read keeps failing, leaving the row to resume', async () => {
		const rows: Row[] = [{ id: 'a', studio_status: null }];
		const { io } = fakeIo(rows, { a: { id: 'a' } }, { failGets: 10 });
		await assert.rejects(runBackfill(io, quiet), /R2 500/);
		assert.equal(rows[0].studio_status, null);
	});

	it('stops instead of looping when a batch makes no progress', async () => {
		const { io } = fakeIo([{ id: 'a', studio_status: null }], { a: { id: 'a' } }, { stuck: true });
		await assert.rejects(runBackfill(io, quiet), /no progress/);
	});
});

describe('runCheck', () => {
	it('passes with nothing missing', async () => {
		const { io } = fakeIo([{ id: 'a', studio_status: 'published' }], {});
		assert.deepEqual(await runCheck(io), { ok: true, missing: 0 });
	});

	it('fails when a row is missing the columns', async () => {
		const { io } = fakeIo([{ id: 'a', studio_status: 'published' }, { id: 'b', studio_status: null }], {});
		assert.deepEqual(await runCheck(io), { ok: false, missing: 1 });
	});
});

describe('backfillTarget', () => {
	const read = () => ({
		d1_databases: [{ binding: 'SEARCH_DB', database_id: 'prod-db' }],
		r2_buckets: [{ binding: 'videos', bucket_name: 'videos' }],
		env: { stage: { d1_databases: [{ binding: 'SEARCH_DB', database_id: 'stage-db' }], r2_buckets: [{ binding: 'videos', bucket_name: 'videos-stage' }] } },
	});

	it('reads each environment', () => {
		assert.deepEqual(backfillTarget('production', read), { databaseId: 'prod-db', bucket: 'videos' });
		assert.deepEqual(backfillTarget('stage', read), { databaseId: 'stage-db', bucket: 'videos-stage' });
	});

	it('reads the real configs', () => {
		for (const env of ['qa', 'stage', 'production'] as const) {
			const target = backfillTarget(env);
			assert.ok(target.databaseId && target.bucket, env);
		}
	});
});
