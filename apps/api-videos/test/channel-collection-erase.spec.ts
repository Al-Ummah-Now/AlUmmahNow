/**
 * #1085: every channel has Bunny collections (lib/channelCollection.ts). The
 * erasures and the owner's channel delete remove the channel record, so they
 * must remove its collections too: nothing could find them afterwards.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { eraseRunUserData } from '../src/lib/privacy/run-user-erase';
import { eraseUserData } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { recordDeletion } from '../src/lib/admin/deletions';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { PrivacyErase } from '../src/endpoints/privacy/privacy';
import { ChannelDelete } from '../src/endpoints/channel/channelDelete';

const LIB = '498994';
const OWNER = 'run1';

const realFetch = globalThis.fetch;
/** Bunny collections in the test library; DELETE calls recorded */
let cols: Set<string>;
let deletes: string[];

beforeEach(() => {
	cols = new Set(['col-ch1', 'col-ch2', 'col-other', 'col-user']);
	deletes = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const m = /^\/library\/(\d+)\/collections\/([^/]+)$/.exec(url.pathname);
		if (url.hostname === 'video.bunnycdn.com' && m && init?.method === 'DELETE') {
			deletes.push(m[2]);
			if (!cols.delete(m[2])) return new Response('{}', { status: 404 });
			return Response.json({ success: true });
		}
		return new Response('{}', { status: 200 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const channel = (id: string, userId: string, collectionId: string, extra: Record<string, unknown> = {}) => ({
	id,
	name: id,
	userId,
	dateCreated: '2026-01-01T00:00:00.000Z',
	subscriptions: [],
	bunnyCollections: { [LIB]: collectionId },
	...extra,
});

function env() {
	return {
		SEARCH_DB: new SqliteD1(),
		profiles: new MemoryBucket({ [OWNER]: { id: OWNER, bunnyCollections: { [LIB]: 'col-user' } }, other: { id: 'other' } }),
		channels: new MemoryBucket({
			ch1: channel('ch1', OWNER, 'col-ch1', { isMain: true }),
			ch2: channel('ch2', OWNER, 'col-ch2'),
			chX: channel('chX', 'other', 'col-other'),
		}),
		channel_sections: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		videos: new MemoryBucket({ v1: videoFixture({ id: 'v1', userId: OWNER, channelId: 'ch1' }) }),
		watch_history: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		playlists: new MemoryBucket(),
		'upload-defaults': new MemoryBucket(),
		reports: new MemoryBucket(),
		subtitles: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		queue: new MemoryQueue(),
		'bunny-stream-key': 'test-key',
		bunny_stream_library_id: LIB,
		bunny_hostname: 'vz-25839d05-80d.b-cdn.net',
	} as any;
}

/** Records each onChannelDeleted call and whether the record was still there when it ran */
function channelHook(e: any) {
	const calls: { id: string; collections: unknown; recordPresent: boolean }[] = [];
	const onChannelDeleted = async (id: string, ch: any) => {
		calls.push({ id, collections: ch?.bunnyCollections, recordPresent: e.channels.store.has(id) });
	};
	return { calls, onChannelDeleted };
}

describe('channel collections on erasure (#1085)', () => {
	it('eraseRunUserData calls onChannelDeleted for each owned channel, before its record is deleted', async () => {
		const e = env();
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(e, kind, { maxPages: 10 });
		const { calls, onChannelDeleted } = channelHook(e);
		const result = await eraseRunUserData(e, OWNER, new OperationBudget(900), { onChannelDeleted });
		assert.equal(result.complete, true);
		assert.deepEqual(
			calls.sort((a, b) => a.id.localeCompare(b.id)),
			[
				{ id: 'ch1', collections: { [LIB]: 'col-ch1' }, recordPresent: true },
				{ id: 'ch2', collections: { [LIB]: 'col-ch2' }, recordPresent: true },
			],
		);
		assert.deepEqual([...e.channels.store.keys()], ['chX']);
	});

	it('eraseUserData calls onChannelDeleted for each owned channel, once even across resumed passes', async () => {
		const e = env();
		const { calls, onChannelDeleted } = channelHook(e);
		let token: string | undefined;
		let complete = false;
		let passes = 0;
		while (!complete && passes < 100) {
			const summary = await eraseUserData(e, OWNER, new OperationBudget(12), { onChannelDeleted }, { resumeToken: token, pageSize: 2 });
			complete = summary.complete;
			token = summary.resumeToken;
			passes++;
		}
		assert.equal(complete, true);
		assert.ok(passes > 1, 'needed several passes');
		assert.deepEqual(calls.map((c) => c.id).sort(), ['ch1', 'ch2']);
		assert.ok(calls.every((c) => c.recordPresent));
		assert.deepEqual([...e.channels.store.keys()], ['chX']);
	});

	it('the run-account erase job (user.erase-run) removes its channels\' and profile\'s collections', async () => {
		const e = env();
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(e, kind, { maxPages: 10 });
		await recordDeletion(e.SEARCH_DB, { kind: 'user', id: OWNER, deletedBy: 'e2e-run-sweep' });
		const outcome = await ADMIN_JOB_HANDLERS['user.erase-run'](e, { id: 'j1', kind: 'user.erase-run', targetId: OWNER, params: {} } as never);
		assert.equal(outcome.done, true);
		assert.deepEqual([...cols].sort(), ['col-other']);
	});

	it('the full erase job (user.delete-data) removes its channels\' and profile\'s collections', async () => {
		const e = env();
		await recordDeletion(e.SEARCH_DB, { kind: 'user', id: OWNER, deletedBy: 'admin1' });
		let params: Record<string, unknown> = {};
		for (let step = 0; step < 50; step++) {
			const outcome = await ADMIN_JOB_HANDLERS['user.delete-data'](e, { id: 'j2', kind: 'user.delete-data', targetId: OWNER, params } as never);
			if (outcome.done) break;
			params = outcome.params ?? {};
		}
		assert.deepEqual([...cols].sort(), ['col-other']);
	});

	it('DELETE /api/privacy/data removes the caller\'s channels\' and profile\'s collections', async () => {
		const e = env();
		const app = buildApp((r: any) => r.delete('/api/privacy/data', PrivacyErase), { userId: OWNER });
		const res = await app.request('/api/privacy/data', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }), headers: { 'content-type': 'application/json' } }, e);
		assert.equal(res.status, 200);
		assert.equal((await res.json()).complete, true);
		assert.deepEqual([...cols].sort(), ['col-other']);
	});

	it('a Bunny failure never fails the erase', async () => {
		const e = env();
		globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
		const app = buildApp((r: any) => r.delete('/api/privacy/data', PrivacyErase), { userId: OWNER });
		const res = await app.request('/api/privacy/data', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }), headers: { 'content-type': 'application/json' } }, e);
		assert.equal(res.status, 200);
		assert.equal(e.channels.store.has('ch1'), false);
	});
});

describe('owner channel delete removes its collections (#1085)', () => {
	const routes = (r: any) => r.delete('/api/channels/:id', ChannelDelete);

	it('DELETE /api/channels/:id removes the record and its collections before responding', async () => {
		const e = env();
		const app = buildApp(routes, { userId: OWNER });
		const res = await app.request('/api/channels/ch2', { method: 'DELETE' }, e);
		assert.equal(res.status, 200);
		assert.equal(e.channels.store.has('ch2'), false);
		assert.deepEqual(deletes, ['col-ch2']);
		assert.deepEqual([...cols].sort(), ['col-ch1', 'col-other', 'col-user']);
	});

	it('another user cannot delete the channel; its collections stay', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'other' });
		const res = await app.request('/api/channels/ch2', { method: 'DELETE' }, e);
		assert.equal(res.status, 403);
		assert.equal(e.channels.store.has('ch2'), true);
		assert.deepEqual(deletes, []);
	});

	it('a Bunny failure is logged and the channel is still deleted', async () => {
		const e = env();
		globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
		const app = buildApp(routes, { userId: OWNER });
		const res = await app.request('/api/channels/ch2', { method: 'DELETE' }, e);
		assert.equal(res.status, 200);
		assert.equal(e.channels.store.has('ch2'), false);
	});
});
