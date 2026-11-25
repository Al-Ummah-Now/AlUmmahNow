/** GET /internal/uploads/stale: the counts of every status over all items, whatever the filter shows (the page's tabs). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createUploadsInternalRouter } from '../src/endpoints/video/uploadsInternal';
import { itemKey } from '../src/lib/uploads/reaper';
import { MemoryBucket } from './helpers';

const item = (n: number, status: string) => ({ videoId: `00000000-0000-4000-8000-00000000000${n}`, target: 'record', status, checks: 1, firstSeenAt: 'x', updatedAt: `2026-11-2${n}` });

describe('stale uploads counts', () => {
	it('count every status, also under a filter', async () => {
		const settings = new MemoryBucket();
		for (const [n, status] of [[1, 'would_delete'], [2, 'would_delete'], [3, 'failed'], [4, 'deleted']] as const) await settings.put(itemKey(item(n, status).videoId), JSON.stringify(item(n, status)));
		const app = createUploadsInternalRouter();
		for (const q of ['', '?status=failed', '?status=open']) {
			const r = ((await (await app.request(`/stale${q}`, {}, { global_settings: settings } as never)).json()) as any).result;
			assert.deepEqual(r.counts, { would_delete: 2, failed: 1, deleted: 1 }, q);
		}
		const failed = ((await (await app.request('/stale?status=failed', {}, { global_settings: settings } as never)).json()) as any).result;
		assert.deepEqual(failed.items.map((i: any) => i.status), ['failed']);
	});
});
