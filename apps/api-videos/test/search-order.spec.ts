/**
 * Search and ownership index order guard (SCALABILITY-AUDIT PR-8).
 *
 * Hundreds of versions of the same items are indexed in random order with
 * random delays, the way api-videos inline syncs, processor messages and
 * retries interleave across isolates. The index must end up exactly as the
 * newest version says: a video made private stays out of search, a deleted
 * item does not come back.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncOwnership, syncSearchDocument } from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { videoFixture } from './helpers';

const pause = () => new Promise<void>((r) => setTimeout(r, Math.random() * 3));
const shuffle = <T,>(a: T[]) => a.sort(() => Math.random() - 0.5);

function searchable(db: SqliteD1, id: string): boolean {
	const row = db.db
		.prepare('SELECT 1 FROM search_videos_fts f JOIN search_videos b ON b.rowid = f.rowid WHERE b.id = ?')
		.get(id);
	return row !== undefined;
}

describe('search index order guard', () => {
	it('300 versions of 10 videos indexed in random order: each ends at its newest version', async () => {
		const db = new SqliteD1();
		type Write = { id: string; version: number; object: Record<string, unknown> | null };
		const writes: Write[] = [];
		const newest = new Map<string, Write>();
		for (let v = 1; v <= 300; v++) {
			const id = `v${v % 10}`;
			// Writes flip privacy and title; v0..v2 are deleted by their last write (a delete is final)
			const object = v > 290 && v % 10 < 3 ? null : videoFixture({ id, title: `Title ${v}`, isPublic: v % 3 !== 0 });
			const w = { id, version: 1_000_000 + v, object };
			writes.push(w);
			newest.set(id, w);
		}
		await Promise.all(
			shuffle([...writes, ...writes.slice(0, 60)]).map(async (w) => {
				await pause();
				await syncSearchDocument(db as never, 'video', w.id, w.object, { version: w.version });
				await syncOwnership(db as never, 'video', w.id, w.object, Date.now(), w.version);
			}),
		);

		for (const [id, w] of newest) {
			const row = db.db.prepare('SELECT payload, source_version FROM search_videos WHERE id = ?').get(id) as
				| { payload: string; source_version: number }
				| undefined;
			const own = db.db.prepare("SELECT is_public, source_version FROM content_ownership WHERE kind = 'video' AND id = ?").get(id) as
				| { is_public: number; source_version: number }
				| undefined;
			if (!w.object) {
				assert.equal(searchable(db, id), false, `${id} was deleted last`);
				assert.equal(own, undefined, `${id} ownership row gone`);
				continue;
			}
			assert.equal(own?.source_version, w.version);
			assert.equal(own?.is_public, w.object.isPublic === false ? 0 : 1);
			if (w.object.isPublic === false) {
				assert.equal(searchable(db, id), false, `${id} is private in its newest version`);
			} else {
				assert.equal(searchable(db, id), true, `${id} is public in its newest version`);
				assert.equal(JSON.parse(row!.payload).title, w.object.title);
				assert.equal(Number(row!.source_version), w.version);
			}
		}
	});

	it('an older snapshot after a delete does not bring the item back; a newer one does', async () => {
		const db = new SqliteD1();
		await syncSearchDocument(db as never, 'video', 'x', videoFixture({ id: 'x' }), { version: 10 });
		assert.equal(await syncSearchDocument(db as never, 'video', 'x', null, { version: 20 }), 'removed');
		assert.equal(await syncSearchDocument(db as never, 'video', 'x', videoFixture({ id: 'x' }), { version: 15 }), 'stale');
		assert.equal(searchable(db, 'x'), false);
		assert.equal(await syncSearchDocument(db as never, 'video', 'x', videoFixture({ id: 'x' }), { version: 25 }), 'indexed');
		assert.equal(searchable(db, 'x'), true);
	});

	it('a delete applies even when its clock trails the indexed version, and stays deleted', async () => {
		const db = new SqliteD1();
		await syncSearchDocument(db as never, 'video', 'd', videoFixture({ id: 'd' }), { version: 1000 });
		assert.equal(await syncSearchDocument(db as never, 'video', 'd', null, { version: 995 }), 'removed');
		assert.equal(searchable(db, 'd'), false);
		assert.equal(await syncSearchDocument(db as never, 'video', 'd', videoFixture({ id: 'd' }), { version: 1000 }), 'stale');
		assert.equal(searchable(db, 'd'), false);
	});

	it('a message without a version (0) fills an empty row but never overrides a versioned one', async () => {
		const db = new SqliteD1();
		assert.equal(await syncSearchDocument(db as never, 'video', 'y', videoFixture({ id: 'y', title: 'Old' }), { version: 0 }), 'indexed');
		await syncSearchDocument(db as never, 'video', 'y', videoFixture({ id: 'y', title: 'Private', isPublic: false }), { version: 5 });
		assert.equal(await syncSearchDocument(db as never, 'video', 'y', videoFixture({ id: 'y', title: 'Old' }), { version: 0 }), 'stale');
		assert.equal(searchable(db, 'y'), false);
	});

	it('same content at a newer version records the version, so an older change cannot slip in', async () => {
		const db = new SqliteD1();
		await syncSearchDocument(db as never, 'video', 'z', videoFixture({ id: 'z', title: 'A' }), { version: 1 });
		assert.equal(await syncSearchDocument(db as never, 'video', 'z', videoFixture({ id: 'z', title: 'A' }), { version: 3 }), 'unchanged');
		assert.equal(await syncSearchDocument(db as never, 'video', 'z', videoFixture({ id: 'z', title: 'B' }), { version: 2 }), 'stale');
	});
});
