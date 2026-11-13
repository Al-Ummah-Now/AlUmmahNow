import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_COUNT_TTL_MS, adminCountKey, cachedCount } from '../src/lib/admin/directory';
import { SqliteD1 } from './search-sqlite-d1';

describe('admin list totals are cached (#891)', () => {
	it('counts once per filter within the TTL, again after it, and drops totals nobody asked for in an hour', async () => {
		const db = new SqliteD1();
		let counted = 0;
		const count = async () => ++counted * 10;
		const t0 = 1_800_000_000_000;
		assert.equal(await cachedCount(db as never, 'users::', count, t0), 10);
		assert.equal(await cachedCount(db as never, 'users::', count, t0 + ADMIN_COUNT_TTL_MS - 1), 10, 'reused');
		assert.equal(counted, 1);
		assert.equal(await cachedCount(db as never, 'users::tafsir', count, t0 + 1), 20, 'another filter has its own total');
		assert.equal(await cachedCount(db as never, 'users::', count, t0 + ADMIN_COUNT_TTL_MS + 1), 30, 'recounted after the TTL');
		await cachedCount(db as never, 'users:yes:', count, t0 + 2 * 3_600_000);
		const keys = (db.db.prepare("SELECT key FROM search_meta WHERE key LIKE 'admin-count:%' ORDER BY key").all() as Array<{ key: string }>).map((r) => r.key);
		assert.deepEqual(keys, [await adminCountKey('users:yes:')], 'stale totals are swept');
	});

	it('never stores the filter itself: a search for an email leaves only a hash', async () => {
		const db = new SqliteD1();
		const email = 'someone+tag@mail.test';
		assert.equal(await cachedCount(db as never, `users::${email}`, async () => 1, 1_800_000_000_000), 1);
		const rows = db.db.prepare('SELECT key, value FROM search_meta').all() as Array<{ key: string; value: string }>;
		assert.equal(rows.length, 1);
		assert.match(rows[0].key, /^admin-count:[0-9a-f]{24}$/);
		assert.ok(!JSON.stringify(rows).includes('someone+tag'), JSON.stringify(rows));
		assert.equal(await cachedCount(db as never, `users::${email}`, async () => 2, 1_800_000_000_001), 1, 'the same filter finds its total');
	});
});
