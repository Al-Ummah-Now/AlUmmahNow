/**
 * The release registers queue consumers that `wrangler versions upload` leaves out
 * (auth-moderation-requests on admin-api, docs/admin/AUTH_MODERATION_REQUESTS.md).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { consumersOf, ensureConsumers } from '../queue-consumers.ts';
import { parseJsonc } from '../jsonc.ts';
import type { CfClient } from '../cf-api.ts';

const config = parseJsonc(readFileSync(new URL('../../../apps/admin-api/wrangler.jsonc', import.meta.url), 'utf8')) as never;

describe('queue consumers', () => {
	it('reads admin-api\'s consumers for production (top level) and stage', () => {
		assert.deepEqual(consumersOf(config).map((c) => `${c.queue}->${c.worker}`), [
			'al-ummah-now-contact-mail->al-ummah-admin-api',
			'auth-moderation-requests->al-ummah-admin-api',
			'auth-moderation-requests-dlq->al-ummah-admin-api',
			'al-ummah-now-errors->al-ummah-admin-api',
			'al-ummah-now-errors-dlq->al-ummah-admin-api',
		]);
		assert.deepEqual(consumersOf(config, 'stage').map((c) => `${c.queue}->${c.worker}`), [
			'al-ummah-now-contact-mail-stage->al-ummah-admin-api-stage',
			'auth-moderation-requests-stage->al-ummah-admin-api-stage',
			'auth-moderation-requests-dlq-stage->al-ummah-admin-api-stage',
			'al-ummah-now-errors-stage->al-ummah-admin-api-stage',
			'al-ummah-now-errors-dlq-stage->al-ummah-admin-api-stage',
		]);
		assert.deepEqual(consumersOf(config).find((c) => c.queue === 'auth-moderation-requests'), {
			queue: 'auth-moderation-requests',
			worker: 'al-ummah-admin-api',
			dead_letter_queue: 'auth-moderation-requests-dlq',
			settings: { batch_size: 10, max_retries: 6, max_wait_time_ms: 5000, retry_delay: 30 },
		});
	});

	it('adds only missing consumers and fails on a missing queue', async () => {
		const specs = consumersOf(config).filter((c) => c.queue.startsWith('auth-moderation-requests'));
		const posted: string[] = [];
		const cf: CfClient = {
			accountId: 'a',
			async request<T>(method: string, path: string): Promise<T> {
				if (path.startsWith('/queues?')) return [{ queue_id: 'q1', queue_name: 'auth-moderation-requests' }, { queue_id: 'q2', queue_name: 'auth-moderation-requests-dlq' }] as T;
				if (method === 'GET') return (path === '/queues/q1/consumers' ? [{ script_name: 'al-ummah-admin-api' }] : []) as T;
				posted.push(path);
				return {} as T;
			},
		};
		assert.deepEqual(await ensureConsumers(cf, specs), [
			'ok       auth-moderation-requests -> al-ummah-admin-api',
			'added    auth-moderation-requests-dlq -> al-ummah-admin-api',
		]);
		assert.deepEqual(posted, ['/queues/q2/consumers']);
		const empty = { accountId: 'a', request: async () => [] } as unknown as CfClient;
		await assert.rejects(ensureConsumers(empty, specs), /does not exist/);
	});
});
