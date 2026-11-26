/** POST /internal/uploads/stale: the videos to leave out come whole or the list is refused; never a list without them. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createUploadsInternalRouter, MAX_HIDE } from '../src/endpoints/video/uploadsInternal';
import { itemKey } from '../src/lib/uploads/reaper';
import { MemoryBucket } from './helpers';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const item = (videoId: string, status: string) => ({ videoId, target: 'record', status, checks: 1, firstSeenAt: 'x', updatedAt: '2026-11-25' });

async function setup() {
	const settings = new MemoryBucket();
	await settings.put(itemKey(A), JSON.stringify(item(A, 'would_delete')));
	await settings.put(itemKey(B), JSON.stringify(item(B, 'failed')));
	const app = createUploadsInternalRouter();
	const post = async (body: string) => app.request('/stale', { method: 'POST', body, headers: { 'content-type': 'application/json' } }, { global_settings: settings } as never);
	return { post };
}

describe('POST /stale', () => {
	it('leaves the given videos out of the list and the counts', async () => {
		const { post } = await setup();
		const res = await post(JSON.stringify({ hide: [A] }));
		assert.equal(res.status, 200);
		const r = ((await res.json()) as any).result;
		assert.deepEqual([r.items.map((i: any) => i.videoId), r.counts], [[B], { failed: 1 }]);
	});

	it('refuses what is not a list of ids, and a list too long to take whole', async () => {
		const { post } = await setup();
		for (const body of ['{not json', 'null', '[]', '{}', JSON.stringify({ hide: A }), JSON.stringify({ hide: null }), JSON.stringify({ hide: [A, 7] }), JSON.stringify({ hide: [{ id: A }] })]) {
			const res = await post(body);
			assert.equal(res.status, 400, body);
			assert.equal(((await res.json()) as any).success, false, body);
		}
		const tooMany = await post(JSON.stringify({ hide: Array.from({ length: MAX_HIDE + 1 }, (_, i) => `v${i}`) }));
		assert.equal(tooMany.status, 413);
		// As many as it takes is fine
		assert.equal((await post(JSON.stringify({ hide: Array.from({ length: MAX_HIDE }, (_, i) => `v${i}`) }))).status, 200);
	});
});
