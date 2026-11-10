import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { holderMessage, isStale, Lock, lockRef, parseHolder, ZERO, type Gh, type Holder } from '../../ci/qa-lock.ts';

/** In-memory GitHub: refs with compare-and-swap, commits, run statuses. */
function fakeGh() {
	const refs = new Map<string, string>();
	const commits = new Map<string, string>();
	const runs = new Map<string, string>();
	let n = 0;
	const gh: Gh = {
		async rest<T>(method: string, path: string, body?: unknown) {
			let m = /\/git\/ref\/(.+)$/.exec(path);
			if (method === 'GET' && m) {
				const sha = refs.get(`refs/${m[1]}`);
				return { status: sha ? 200 : 404, data: (sha ? { object: { sha } } : {}) as T };
			}
			m = /\/git\/commits\/(\w+)$/.exec(path);
			if (method === 'GET' && m) return { status: commits.has(m[1]) ? 200 : 404, data: { message: commits.get(m[1]) } as T };
			if (method === 'POST' && path.endsWith('/git/commits')) {
				const sha = (++n).toString(16).padStart(40, 'a');
				commits.set(sha, (body as { message: string }).message);
				return { status: 201, data: { sha } as T };
			}
			m = /\/actions\/runs\/(\d+)$/.exec(path);
			if (m) return runs.has(m[1]) ? { status: 200, data: { status: runs.get(m[1]) } as T } : { status: 404, data: {} as T };
			throw new Error(`unexpected ${method} ${path}`);
		},
		async graphql<T>(query: string, variables: Record<string, unknown>) {
			if (query.includes('repository(')) return { data: { repository: { id: 'R_1' } } as T };
			for (const u of variables.u as Array<{ name: string; beforeOid: string; afterOid: string }>) {
				const cur = refs.get(u.name) ?? ZERO;
				if (cur !== u.beforeOid) return { errors: ['Something went wrong'] };
				if (u.afterOid === ZERO) refs.delete(u.name);
				else refs.set(u.name, u.afterOid);
			}
			return { data: {} as T };
		},
	};
	return { gh, refs, runs };
}

const H = (runId: string, expiresAt = Date.now() + 3_600_000): Holder => ({ runId, attempt: '1', job: 'e2e', expiresAt });

describe('qa-lock', () => {
	it('names and holder records', () => {
		assert.equal(lockRef('qa-global'), 'refs/ci-locks/qa-global');
		assert.throws(() => lockRef('../heads/main'));
		assert.deepEqual(parseHolder(holderMessage(H('7', 5))), H('7', 5));
		assert.equal(parseHolder('hello'), null);
	});

	it('stale when expired, when the holder run completed, or when unreadable', () => {
		assert.equal(isStale(H('1', 10), 11, 'in_progress'), true);
		assert.equal(isStale(H('1', 100), 11, 'completed'), true);
		assert.equal(isStale(null, 11, null), true);
		assert.equal(isStale(H('1', 100), 11, 'in_progress'), false);
	});

	it('exactly one of two contenders gets the lock; the other waits until it is released', async () => {
		const { gh, runs } = fakeGh();
		runs.set('1', 'in_progress');
		runs.set('2', 'in_progress');
		const a = new Lock(gh, 'o/r', 'qa-global');
		const b = new Lock(gh, 'o/r', 'qa-global');
		const mk = (l: Lock, id: string) => () => l.makeHolder(H(id), 'tree');
		const [ga, gb] = await Promise.all([a.tryAcquire(mk(a, '1'), Date.now()), b.tryAcquire(mk(b, '2'), Date.now())]);
		assert.equal([ga, gb].filter(Boolean).length, 1);
		const [winner, loser, loserId] = ga ? [a, b, '2'] : [b, a, '1'];
		assert.equal(await loser.tryAcquire(mk(loser, loserId), Date.now()), null);
		assert.equal(await winner.release((ga ?? gb)!), true);
		assert.ok(await loser.tryAcquire(mk(loser, loserId), Date.now()));
	});

	it('takes over a lock whose holder run has completed, and never releases a lock it lost', async () => {
		const { gh, runs } = fakeGh();
		runs.set('1', 'in_progress');
		const a = new Lock(gh, 'o/r', 'qa-global');
		const mineA = (await a.tryAcquire(() => a.makeHolder(H('1'), 't'), Date.now()))!;
		runs.set('1', 'completed');
		const b = new Lock(gh, 'o/r', 'qa-global');
		const mineB = await b.tryAcquire(() => b.makeHolder(H('2'), 't'), Date.now());
		assert.ok(mineB);
		assert.equal(await a.release(mineA), false);
		assert.equal(await b.current(), mineB);
	});
});
