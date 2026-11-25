/**
 * Transient R2 reads (10001) are retried, two more times, in one layer; writes never are: their outcome may be unknown.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withStorageRetry } from '@al-ummah/shared-types';
import R2Repository from '../src/lib/r2Repo';
import { publishDuePosts } from '../src/lib/scheduled-posts';
import { HEALTH_KEY, readHealth } from '../src/lib/media/health';
import { MemoryBucket } from './helpers';

type Op = 'get' | 'put' | 'list' | 'delete';

/** A bucket whose next `times` calls of `op` fail as R2 does; `calls` counts every call of it. */
function flaky(op: Op, times: number, initial: Record<string, unknown> = { a: { n: 1 } }, message = 'We encountered an internal error. Please try again. (10001)') {
	const bucket = new MemoryBucket(initial);
	const real = (bucket[op] as (...args: unknown[]) => Promise<unknown>).bind(bucket);
	const state = { calls: 0 };
	let left = times;
	(bucket as unknown as Record<Op, unknown>)[op] = async (...args: unknown[]) => {
		state.calls++;
		if (left-- > 0) throw new Error(`${op}: ${message}`);
		return real(...args);
	};
	return { bucket: bucket as never, state };
}
const repo = (bucket: never) => new R2Repository<{ n: number }>(bucket);

describe('R2Repository reads', () => {
	it('getObject and updateObject read again after a transient error', async () => {
		const one = flaky('get', 2);
		assert.deepEqual(await repo(one.bucket).getObject('a'), { n: 1 });
		assert.equal(one.state.calls, 3);
		const two = flaky('get', 2);
		assert.deepEqual(await repo(two.bucket).updateObject('a', (d) => { d.n = 2; }), { n: 2 });
		assert.equal(two.state.calls, 3);
	});

	it('give up after three reads with a transient error, also when the caller retries', async () => {
		for (const read of [(b: never) => repo(b).getObject('a'), (b: never) => repo(b).updateObject('a', () => true), (b: never) => withStorageRetry('get', () => repo(b).getObject('a'))]) {
			const f = flaky('get', 99);
			await assert.rejects(read(f.bucket), { name: 'TransientStorageError' });
			assert.equal(f.state.calls, 3);
		}
	});

	it('any other error is not retried', async () => {
		const f = flaky('get', 99, undefined, 'The specified bucket does not exist. (10006)');
		await assert.rejects(repo(f.bucket).getObject('a'), /10006/);
		assert.equal(f.state.calls, 1);
	});
});

describe('R2Repository writes', () => {
	it('are never retried', async () => {
		const writes: [Op, (b: never) => Promise<unknown>][] = [
			['put', (b) => repo(b).putObject('a', { n: 2 })],
			['put', (b) => repo(b).createObject('new', { n: 2 })],
			['put', (b) => repo(b).updateObject('a', (d) => { d.n = 2; })],
			['delete', (b) => repo(b).deleteObject('a')],
		];
		for (const [op, write] of writes) {
			const f = flaky(op, 1);
			await assert.rejects(write(f.bucket), /10001/);
			assert.equal(f.state.calls, 1, op);
		}
	});
});

describe('the other reads', () => {
	it('scheduled posts list again', async () => {
		const f = flaky('list', 2, {});
		assert.deepEqual(await publishDuePosts({ community_posts: f.bucket } as never), { published: 0, dropped: 0 });
		assert.equal(f.state.calls, 3);
	});

	it('provider health reads again, and is null when storage stays down', async () => {
		const f = flaky('get', 2, { [HEALTH_KEY]: { at: 'x' } });
		assert.deepEqual(await readHealth({ global_settings: f.bucket } as never, true), { at: 'x' });
		assert.equal(f.state.calls, 3);
		const down = flaky('get', 99, {});
		assert.equal(await readHealth({ global_settings: down.bucket } as never, true), null);
		assert.equal(down.state.calls, 3);
	});
});
