/**
 * Search index write cost (docs/architecture/SCALABILITY-AUDIT.md, AV-17).
 *
 * - A write that changes only counters (a like, a flushed view count) or
 *   display fields updates the base row with one UPDATE; the full-text entry
 *   is not deleted and re-inserted.
 * - That cheap update keeps the order guard: an older counter write never
 *   overwrites a newer edit, a newer one never loses the edit's text.
 * - A reader that falls back to a scan while a heal holds the lease costs a
 *   read, not a write.
 *
 * Real SQL on node:sqlite with the search migrations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncSearchDocument } from '@al-ummah/shared-types';
import { scheduleOwnershipHeal } from '../src/lib/search/ownership';
import { MemoryBucket, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

/** Records the SQL of every statement prepared. */
function recording(db: SqliteD1) {
	const sql: string[] = [];
	const prepare = db.prepare.bind(db);
	db.prepare = ((text: string) => {
		sql.push(text.replace(/\s+/g, ' ').trim());
		return prepare(text);
	}) as typeof db.prepare;
	return sql;
}

const ftsRow = (db: SqliteD1, id: string) =>
	db.db.prepare('SELECT f.rowid, f.title FROM search_videos_fts f JOIN search_videos b ON b.rowid = f.rowid WHERE b.id = ?').get(id) as
		| { rowid: number; title: string }
		| undefined;
const base = (db: SqliteD1, id: string) =>
	db.db.prepare('SELECT views, popularity, payload, source_version FROM search_videos WHERE id = ?').get(id) as {
		views: number; popularity: number; payload: string; source_version: number;
	};

describe('search writes when only counters change (AV-17)', () => {
	it('likes and view counts update the base row in one statement, the full-text entry stays', async () => {
		const db = new SqliteD1();
		assert.equal(await syncSearchDocument(db as never, 'video', 'v1', videoFixture({ id: 'v1', title: 'Tafsir' }), { version: 1 }), 'indexed');
		const before = ftsRow(db, 'v1');
		const sql = recording(db);
		for (let v = 2; v <= 21; v++) {
			const result = await syncSearchDocument(db as never, 'video', 'v1', videoFixture({ id: 'v1', title: 'Tafsir', views: v * 100, likes: v }), { version: v });
			assert.equal(result, 'indexed');
		}
		assert.ok(!sql.some((s) => /search_videos_fts/.test(s)), `no full-text writes: ${sql.filter((s) => /fts/.test(s)).join(' | ')}`);
		assert.equal(sql.filter((s) => /^UPDATE search_videos SET views/.test(s)).length, 20, 'one UPDATE per write');
		assert.deepEqual(ftsRow(db, 'v1'), before);
		const row = base(db, 'v1');
		assert.equal(row.views, 2100);
		assert.equal(JSON.parse(row.payload).views, 2100, 'the payload shows the new count');
		assert.ok(row.popularity > 0);
		assert.equal(row.source_version, 21);
	});

	it('a title edit still rewrites the full-text entry', async () => {
		const db = new SqliteD1();
		await syncSearchDocument(db as never, 'video', 'v1', videoFixture({ id: 'v1', title: 'Old title' }), { version: 1 });
		await syncSearchDocument(db as never, 'video', 'v1', videoFixture({ id: 'v1', title: 'New title', views: 5 }), { version: 2 });
		assert.equal(ftsRow(db, 'v1')?.title, 'new title', 'indexed text is normalised');
		assert.equal(base(db, 'v1').views, 5);
	});

	it('counter writes and an edit in any order: the newest version wins, text and counts together', async () => {
		for (let round = 0; round < 20; round++) {
			const db = new SqliteD1();
			await syncSearchDocument(db as never, 'video', 'v1', videoFixture({ id: 'v1', title: 'Original' }), { version: 1 });
			// v2..v9: likes on the original; v10: the edit; v11, v12: likes on the edited video
			const writes = [
				...Array.from({ length: 8 }, (_, i) => ({ v: i + 2, object: videoFixture({ id: 'v1', title: 'Original', likes: i + 1 }) })),
				{ v: 10, object: videoFixture({ id: 'v1', title: 'Edited', likes: 8 }) },
				{ v: 11, object: videoFixture({ id: 'v1', title: 'Edited', likes: 9 }) },
				{ v: 12, object: videoFixture({ id: 'v1', title: 'Edited', likes: 10, views: 7 }) },
			].sort(() => Math.random() - 0.5);
			await Promise.all(writes.map(async (w) => {
				await new Promise((r) => setTimeout(r, Math.random() * 3));
				await syncSearchDocument(db as never, 'video', 'v1', w.object, { version: w.v });
			}));
			assert.equal(ftsRow(db, 'v1')?.title, 'edited');
			const row = base(db, 'v1');
			assert.equal(row.source_version, 12);
			assert.equal(row.views, 7);
			assert.equal(JSON.parse(row.payload).likesCount, 10);
		}
	});

	it('an older counter write after a newer one changes nothing', async () => {
		const db = new SqliteD1();
		await syncSearchDocument(db as never, 'video', 'v1', videoFixture({ id: 'v1', views: 50 }), { version: 5 });
		assert.equal(await syncSearchDocument(db as never, 'video', 'v1', videoFixture({ id: 'v1', views: 10 }), { version: 3 }), 'stale');
		assert.equal(base(db, 'v1').views, 50);
	});
});

describe('ownership heal lease (AV-17)', () => {
	it('fallback readers while a heal runs cost one read each, no write', async () => {
		const db = new SqliteD1();
		db.db.prepare("INSERT INTO search_meta (key, value, updated_at) VALUES ('ownership:heal:video', 'lease', ?)").run(Date.now());
		const sql = recording(db);
		const env = { SEARCH_DB: db, videos: new MemoryBucket({}), channels: new MemoryBucket({}) };
		const tasks: Promise<unknown>[] = [];
		for (let i = 0; i < 50; i++) scheduleOwnershipHeal(env as never, (p) => tasks.push(p), 'video');
		await Promise.all(tasks);
		assert.equal(sql.length, 50);
		// One read covers the lease and a rebuild job's claim
		assert.ok(sql.every((s) => /^SELECT [\w, ]+ FROM search_meta/.test(s)), sql.find((s) => !s.startsWith('SELECT')));
		assert.equal(env.videos.calls, 0, 'no heal pass ran');
	});

	it('an expired lease is taken over', async () => {
		const db = new SqliteD1();
		db.db.prepare("INSERT INTO search_meta (key, value, updated_at) VALUES ('ownership:heal:video', 'lease', ?)").run(Date.now() - 10 * 60_000);
		const env = { SEARCH_DB: db, videos: new MemoryBucket({ v1: videoFixture({ id: 'v1' }) }), channels: new MemoryBucket({}) };
		await scheduleOwnershipHeal(env as never, null, 'video');
		assert.ok(env.videos.calls > 0, 'the heal pass ran');
	});
});
