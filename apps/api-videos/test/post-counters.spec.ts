/**
 * Community post like / poll totals come from the processor's D1 counters
 * (SCALABILITY-AUDIT PR-2/3/4): the post document is never rewritten for them,
 * and a post whose legacy records are not moved into D1 yet keeps the totals
 * its document carries.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CommunityPost } from '@al-ummah/shared-types';
import { applyPostCounts, pollResultsFromCounts, readPostCounts, withPostCounts } from '../src/lib/post-counters';
import { likeStatements, voteStatements } from '../../processor/src/lib/post-counters';
import { createSqliteD1 } from './sqlite-d1';

const markDone = (db: ReturnType<typeof createSqliteD1>, postId: string, kind: string) =>
	db.raw
		.prepare("INSERT INTO post_counter_imports (post_id, kind, cursor, done, updated_at) VALUES (?, ?, NULL, 1, 'x')")
		.run(postId, kind);

/** Applies a processor batch the way D1 does: one transaction, batches never interleave. */
let queue: Promise<unknown> = Promise.resolve();
function apply(db: ReturnType<typeof createSqliteD1>, statements: any[]): Promise<void> {
	const run = queue.then(async () => {
		db.raw.exec('BEGIN');
		try {
			for (const s of statements) await s.run();
			db.raw.exec('COMMIT');
		} catch (error) {
			db.raw.exec('ROLLBACK');
			throw error;
		}
	});
	queue = run.catch(() => undefined);
	return run;
}

function post(id: string, extra: Partial<CommunityPost> = {}): CommunityPost {
	return { id, channelId: 'c1', likes: 7, ...extra } as CommunityPost;
}

describe('post counters', () => {
	it('500 parallel likes, unlikes and duplicates through the processor statements read back exactly', async () => {
		const db = createSqliteD1();
		markDone(db, 'p1', 'likes');
		const ops: Array<[string, boolean]> = [];
		for (let u = 0; u < 300; u++) {
			ops.push([`u${u}`, true]);
			if (u % 4 === 0) ops.push([`u${u}`, false]);
		}
		// Final state per user: the last op in this list; duplicates of each op are harmless
		const final = new Map(ops.map(([u, liked]) => [u, liked]));
		const deliveries = [...ops, ...ops.slice(0, 125)];
		await Promise.all(
			deliveries.map(async ([u]) => {
				await new Promise((r) => setTimeout(r, Math.random() * 3));
				await apply(db, likeStatements(db as never, 'p1', u, final.get(u)!, '2026-11-09'));
			}),
		);
		const counts = await readPostCounts(db as never, ['p1']);
		assert.equal(counts.get('p1')?.likes, [...final.values()].filter(Boolean).length);
		assert.equal(counts.get('p1')?.likes, 225);
	});

	it('poll totals and percentages, from parallel votes', async () => {
		const db = createSqliteD1();
		markDone(db, 'poll', 'votes');
		await Promise.all(
			Array.from({ length: 200 }, (_, u) =>
				apply(db, voteStatements(db as never, 'poll', `u${u}`, u < 150 ? ['a'] : ['b'], '2026-11-09')),
			),
		);
		const counts = (await readPostCounts(db as never, ['poll'])).get('poll')!;
		const p = applyPostCounts(
			post('poll', { poll: { options: [{ id: 'a', text: 'A', votes: 0 }, { id: 'b', text: 'B', votes: 0 }], totalVotes: 0 } } as never),
			counts,
		);
		assert.equal(p.poll!.totalVotes, 200);
		assert.deepEqual(p.poll!.options.map((o: any) => [o.id, o.votes, o.percentage]), [['a', 150, 75], ['b', 50, 25]]);
		assert.deepEqual(pollResultsFromCounts('poll', counts.poll!).options.a, { count: 150, percentage: 75 });
	});

	it('a post not moved into D1 yet keeps its document totals, even with new D1 rows', async () => {
		const db = createSqliteD1();
		await apply(db, likeStatements(db as never, 'legacy', 'u1', true, '2026-11-09'));
		const [p] = await withPostCounts(db as never, [post('legacy')]);
		assert.equal(p.likes, 7);
	});

	it('reads many posts in chunks and leaves out posts without counters', async () => {
		const db = createSqliteD1();
		const ids = Array.from({ length: 95 }, (_, i) => `p${i}`);
		for (const id of ids) {
			markDone(db, id, 'likes');
			await apply(db, likeStatements(db as never, id, 'u', true, '2026-11-09'));
		}
		const posts = await withPostCounts(db as never, [...ids.map((id) => post(id)), post('other')]);
		assert.ok(posts.slice(0, 95).every((p) => p.likes === 1));
		assert.equal(posts[95].likes, 7);
	});

	it('without D1 the document totals stand', async () => {
		const [p] = await withPostCounts(undefined, [post('x')]);
		assert.equal(p.likes, 7);
		const broken = { prepare: () => { throw new Error('D1 down'); } };
		const [q] = await withPostCounts(broken as never, [post('y')]);
		assert.equal(q.likes, 7);
	});
});
