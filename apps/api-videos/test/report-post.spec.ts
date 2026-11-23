/**
 * Reporting a community post (#1515: the post card's ⋮ menu has Report for everyone signed in).
 * The admin reports queue already takes `post`; the API that files reports now does too.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType } from '@al-ummah/shared-types';
import { ReportCreate } from '../src/endpoints/moderation/reportCreate';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';

const routes = (r: any) => r.post('/api/reports', ReportCreate);

describe('reporting a post', () => {
	it('files a post report and queues it for the admin reports queue, once per user', async () => {
		const env = { reports: new MemoryBucket(), queue: new MemoryQueue() };
		const app = buildApp(routes, { userId: 'viewer' });
		const send = () =>
			app.request('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityType: 'post', entityId: 'p1', reason: 'spam' }) }, env);
		const res = await send();
		assert.ok(res.status < 300, await res.clone().text());
		const queued = env.queue.messages.filter((m: any) => m.type === MessageType.ReportCreate);
		assert.equal(queued.length, 1);
		assert.equal(queued[0].payload.entityType, 'post');
		assert.equal(queued[0].payload.entityId, 'p1');
		assert.equal((await send()).status, 409, 'a second report by the same user is refused');
	});

	it('still refuses a kind it does not know', async () => {
		const env = { reports: new MemoryBucket(), queue: new MemoryQueue() };
		const res = await buildApp(routes, { userId: 'viewer' }).request(
			'/api/reports',
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityType: 'banner', entityId: 'x', reason: 'spam' }) },
			env,
		);
		assert.equal(res.status, 400);
	});
});
