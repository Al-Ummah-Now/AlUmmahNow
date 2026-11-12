import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CfApiError, type CfClient } from '../cf-api.ts';
import { ensureResources, resourcesFor } from '../ensure-resources.ts';

function fakeCf(queues: string[], buckets: string[]) {
	const calls: string[] = [];
	const cf: CfClient = {
		accountId: 'a',
		async request<T>(method: string, path: string, body?: unknown): Promise<T> {
			calls.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`);
			if (method === 'GET' && path.startsWith('/queues')) return queues.map((queue_name) => ({ queue_name })) as T;
			if (method === 'GET' && path.startsWith('/r2/buckets/')) {
				if (buckets.includes(decodeURIComponent(path.slice('/r2/buckets/'.length)))) return {} as T;
				throw new CfApiError(404, 'not found');
			}
			return {} as T;
		},
	};
	return { cf, calls };
}

describe('ensure-resources', () => {
	it('names each environment', () => {
		assert.deepEqual(resourcesFor('production'), {
			queues: ['al-ummah-now-errors', 'al-ummah-now-errors-dlq', 'al-ummah-now-transcode', 'al-ummah-now-transcode-dlq'],
			buckets: ['al-ummah-now-sourcemaps', 'al-ummah-now-media', 'al-ummah-now-media-private'],
		});
		assert.deepEqual(resourcesFor('qa').queues, ['al-ummah-now-errors-qa', 'al-ummah-now-errors-dlq-qa', 'al-ummah-now-transcode-qa', 'al-ummah-now-transcode-dlq-qa']);
		assert.deepEqual(resourcesFor('stage').buckets, ['al-ummah-now-sourcemaps-stage', 'al-ummah-now-media-stage', 'al-ummah-now-media-private-stage']);
	});

	it('creates only what is missing', async () => {
		const { cf, calls } = fakeCf(['al-ummah-now-errors-qa', 'al-ummah-now-transcode-qa', 'al-ummah-now-transcode-dlq-qa'], ['al-ummah-now-media-qa', 'al-ummah-now-media-private-qa']);
		const { created } = await ensureResources(cf, resourcesFor('qa'), () => undefined);
		assert.deepEqual(created, ['queue al-ummah-now-errors-dlq-qa', 'bucket al-ummah-now-sourcemaps-qa']);
		assert.ok(calls.includes('POST /queues {"queue_name":"al-ummah-now-errors-dlq-qa"}'));
		assert.ok(calls.includes('POST /r2/buckets {"name":"al-ummah-now-sourcemaps-qa"}'));
	});

	it('changes nothing when everything exists', async () => {
		const { cf, calls } = fakeCf(resourcesFor('stage').queues, resourcesFor('stage').buckets);
		const { created } = await ensureResources(cf, resourcesFor('stage'), () => undefined);
		assert.deepEqual(created, []);
		assert.equal(calls.filter((c) => c.startsWith('POST')).length, 0);
	});
});
