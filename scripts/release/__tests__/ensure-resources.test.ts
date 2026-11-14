import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CfApiError, type CfClient } from '../cf-api.ts';
import { ensureResources, resourcesFor } from '../ensure-resources.ts';

function fakeCf(queues: string[], buckets: string[], lifecycle: Record<string, unknown[]> = {}) {
	const calls: string[] = [];
	const cf: CfClient = {
		accountId: 'a',
		async request<T>(method: string, path: string, body?: unknown): Promise<T> {
			calls.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`);
			if (method === 'GET' && path.startsWith('/queues')) return queues.map((queue_name) => ({ queue_name })) as T;
			if (method === 'GET' && path.endsWith('/lifecycle')) return { rules: lifecycle[decodeURIComponent(path.split('/')[3])] ?? [] } as T;
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
			buckets: ['al-ummah-now-sourcemaps', 'al-ummah-now-media', 'al-ummah-now-media-private', 'al-ummah-now-media-originals', 'al-ummah-now-csam-evidence'],
		});
		assert.deepEqual(resourcesFor('qa').queues, ['al-ummah-now-errors-qa', 'al-ummah-now-errors-dlq-qa', 'al-ummah-now-transcode-qa', 'al-ummah-now-transcode-dlq-qa']);
		assert.deepEqual(resourcesFor('stage').buckets, ['al-ummah-now-sourcemaps-stage', 'al-ummah-now-media-stage', 'al-ummah-now-media-private-stage', 'al-ummah-now-media-originals-stage', 'al-ummah-now-csam-evidence-stage']);
	});

	it('creates only what is missing', async () => {
		const { cf, calls } = fakeCf(['al-ummah-now-errors-qa', 'al-ummah-now-transcode-qa', 'al-ummah-now-transcode-dlq-qa'], ['al-ummah-now-media-qa', 'al-ummah-now-media-private-qa', 'al-ummah-now-media-originals-qa', 'al-ummah-now-csam-evidence-qa']);
		const { created } = await ensureResources(cf, resourcesFor('qa'), () => undefined);
		assert.deepEqual(created, ['queue al-ummah-now-errors-dlq-qa', 'bucket al-ummah-now-sourcemaps-qa', 'lifecycle al-ummah-now-sourcemaps-qa 14d']);
		assert.ok(calls.includes('POST /queues {"queue_name":"al-ummah-now-errors-dlq-qa"}'));
		assert.ok(calls.includes('POST /r2/buckets {"name":"al-ummah-now-sourcemaps-qa"}'));
	});

	it('changes nothing when everything exists', async () => {
		const expiry = { id: 'al-ummah-expire', enabled: true, conditions: { prefix: '' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 30 * 86_400 } } };
		const { cf, calls } = fakeCf(resourcesFor('stage').queues, resourcesFor('stage').buckets, { 'al-ummah-now-sourcemaps-stage': [expiry] });
		const { created } = await ensureResources(cf, resourcesFor('stage'), () => undefined);
		assert.deepEqual(created, []);
		assert.equal(calls.filter((c) => c.startsWith('POST')).length, 0);
	});

	it('expires QA and stage source maps (14 and 30 days), never production ones', async () => {
		assert.deepEqual(resourcesFor('qa').expireAfterDays, { 'al-ummah-now-sourcemaps-qa': 14 });
		assert.deepEqual(resourcesFor('stage').expireAfterDays, { 'al-ummah-now-sourcemaps-stage': 30 });
		assert.equal(resourcesFor('production').expireAfterDays, undefined);
		const other = { id: 'someone-else', enabled: true, conditions: { prefix: 'tmp/' } };
		const { cf, calls } = fakeCf(resourcesFor('qa').queues, resourcesFor('qa').buckets, { 'al-ummah-now-sourcemaps-qa': [other] });
		const { created } = await ensureResources(cf, resourcesFor('qa'), () => undefined);
		assert.deepEqual(created, ['lifecycle al-ummah-now-sourcemaps-qa 14d']);
		const put = calls.find((c) => c.startsWith('PUT /r2/buckets/al-ummah-now-sourcemaps-qa/lifecycle'))!;
		const body = JSON.parse(put.slice(put.indexOf('{')));
		assert.deepEqual(body.rules[0], other, 'an existing rule is kept');
		assert.deepEqual(body.rules[1], { id: 'al-ummah-expire', enabled: true, conditions: { prefix: '' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 14 * 86_400 } } });
	});

	it('leaves a matching rule alone', async () => {
		const rule = { id: 'al-ummah-expire', enabled: true, conditions: { prefix: '' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 30 * 86_400 } } };
		const { cf, calls } = fakeCf(resourcesFor('stage').queues, resourcesFor('stage').buckets, { 'al-ummah-now-sourcemaps-stage': [rule] });
		await ensureResources(cf, resourcesFor('stage'), () => undefined);
		assert.equal(calls.filter((c) => c.startsWith('PUT')).length, 0);
	});

	it('refuses a lifecycle rule on CSAM evidence', async () => {
		const { cf } = fakeCf([], ['al-ummah-now-csam-evidence-qa']);
		await assert.rejects(ensureResources(cf, { queues: [], buckets: [], expireAfterDays: { 'al-ummah-now-csam-evidence-qa': 1 } }, () => undefined), /never gets a lifecycle rule/);
	});
});
