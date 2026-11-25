/** Live admin events go to every admin: what only super admins see goes on admin:restricted (docs/admin/LIVE_OPS.md). */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { restrictedAdminLiveEvent, unrestrictedAdminLiveEvent } from '@al-ummah/shared-types';
import { jobLiveEvent, listJobs, countJobs } from '../src/lib/admin/jobs';
import { pushMediaLive } from '../src/lib/media/r2-delivery';

const VIDEO = '00000000-0000-4000-8000-000000000001';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** The broadcasts sent, as `channel of:key`. */
function capture(): string[] {
	const out: string[] = [];
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		for (const item of JSON.parse(String(init?.body)).items) out.push(...item.message.data.events.map((e: any) => `${item.channel} ${e.of ?? '-'}:${e.key}`));
		return new Response('{}', { status: 200 });
	}) as typeof fetch;
	return out;
}

describe('admin:jobs events', () => {
	it('say which job and how it is doing, not what it is about', () => {
		const e = jobLiveEvent({ id: 'job-1', kind: 'user.delete-data', targetKind: 'user', targetId: VIDEO }, 'running', 2);
		assert.deepEqual(e, { kind: 'job', key: 'job:job-1', id: 'job-1', jobKind: 'user.delete-data', status: 'running', attempts: 2 });
	});
});

describe('admin:restricted', () => {
	it('carries a topic\'s event and gives it back as that topic\'s', () => {
		const e = restrictedAdminLiveEvent('media', { kind: 'job', key: `job:${VIDEO}`, status: 'failed' });
		assert.deepEqual(e, { kind: 'job', key: `media|job:${VIDEO}`, of: 'media', status: 'failed' });
		assert.deepEqual(unrestrictedAdminLiveEvent(e), { topic: 'media', event: { kind: 'job', key: `job:${VIDEO}`, status: 'failed' } });
		assert.equal(unrestrictedAdminLiveEvent({ kind: 'x', of: 'moderation' }), null);
	});

	it('a video under a takedown: its R2 job goes to super admins only', async () => {
		const sent = capture();
		const env = { WEBSOCKET_URL: 'https://realtime.test', INTERNAL_API_KEY: 'k' } as never;
		const r2 = { status: 'failed', jobId: 'j', rev: 'r', access: 'pub', attempts: 3, queuedAt: 'q' } as never;
		const waits: Promise<unknown>[] = [];
		const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
		pushMediaLive(env, ctx as never, { id: VIDEO, r2, csamTakedown: { caseId: 'c', at: 'x' } } as never);
		pushMediaLive(env, ctx as never, { id: '00000000-0000-4000-8000-000000000002', r2 } as never);
		await Promise.all(waits);
		assert.deepEqual(sent, [`admin:restricted media:media|job:${VIDEO}`, 'admin:media -:job:00000000-0000-4000-8000-000000000002']);
	});
});

describe('jobs only super admins see', () => {
	it('are not in an admin\'s list or counts, and their events go on admin:restricted', async () => {
		const { SqliteD1 } = await import('./search-sqlite-d1');
		const { createJob } = await import('../src/lib/admin/jobs');
		const db = new SqliteD1();
		const sent = capture();
		const env = { SEARCH_DB: db, ADMIN_JOBS_QUEUE: { send: async () => undefined }, WEBSOCKET_URL: 'https://realtime.test', INTERNAL_API_KEY: 'k' } as never;
		const takedown = await createJob(env, { kind: 'csam.contain', targetKind: 'video', targetId: VIDEO, actorId: 'usr_super' });
		const other = await createJob(env, { kind: 'user.delete-data', targetKind: 'user', targetId: 'usr_1', actorId: 'usr_admin' });
		assert.deepEqual((await listJobs(env, { shown: 'admins' })).map((j) => j.id), [other.id]);
		assert.deepEqual((await listJobs(env, {})).map((j) => j.id).sort(), [takedown.id, other.id].sort());
		assert.equal(await countJobs(env, 'queued', 'admins'), 1);
		assert.equal(await countJobs(env, 'queued'), 2);
		assert.deepEqual(sent, [`admin:restricted jobs:jobs|job:${takedown.id}`, `admin:jobs -:job:${other.id}`]);
	});
});
