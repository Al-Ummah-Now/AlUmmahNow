/**
 * Invited creators (lib/admin/invites.ts, /internal/admin/*): an invited user
 * is a videos user at once (profile, search, channel owner, transfer target),
 * written exactly as for a normal owner, over in-memory R2 and a real SQLite
 * search DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import adminRouter from '../src/routers/admin.router';
import { withSearchSync } from '../src/lib/search/sync';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { MemoryBucket, MemoryQueue } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const OWNER = 'usr_owner';
const INVITED = `usr_${'a1'.repeat(16)}`;

class JobsQueue {
	pending: unknown[] = [];
	async send(body: unknown) {
		this.pending.push(body);
	}
	async drain(env: unknown) {
		while (this.pending.length) {
			const body = this.pending.shift();
			const msg: JobMessage = { body, attempts: 1, ack: () => {}, retry: () => {} };
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS);
		}
	}
}

async function setup(authUsers: Array<{ id: string; email: string; name: string | null; status: string }> = []) {
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const queue = new MemoryQueue();
	const raw = {
		SEARCH_DB: db,
		AUTH_DB: {
			prepare: () => ({
				bind: (email: string) => ({ all: async () => ({ results: authUsers.filter((u) => u.email === email) }) }),
			}),
		},
		profiles: new MemoryBucket({ [OWNER]: { id: OWNER, email: 'owner@example.com', displayName: 'Owner', channels: ['ch1'] } }),
		channels: new MemoryBucket({
			ch1: { id: 'ch1', userId: OWNER, email: 'owner@example.com', name: 'Existing', handle: 'existing', isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', playlists: [], subscribers: [] },
		}),
		videos: new MemoryBucket(),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		watch_history: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		channel_sections: new MemoryBucket(),
		reports: new MemoryBucket(),
		queue,
		ADMIN_JOBS_QUEUE: new JobsQueue(),
	};
	for (const kind of ['video', 'channel', 'profile'] as const) await runOwnershipPass(raw as never, kind, { maxPages: 10 });
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => void pending.push(p) });
	const app = new Hono();
	app.route('/internal/admin', adminRouter);
	const call = async (method: string, path: string, body?: unknown) => {
		const res = await app.request(
			`/internal/admin${path}`,
			{ method, headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': 'usr_admin' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
			env,
		);
		await Promise.all(pending.splice(0));
		await raw.ADMIN_JOBS_QUEUE.drain(env);
		await Promise.all(pending.splice(0));
		return { status: res.status, body: (await res.json()) as any };
	};
	return { raw, db, call, queue };
}

describe('invited users in videos', () => {
	it('provisioning makes a searchable profile once, keeping it on a retry', async () => {
		const { call, raw } = await setup();
		const first = await call('POST', '/users/provision', { userId: INVITED, email: ' New@Example.com ', displayName: 'New Creator' });
		assert.equal(first.status, 200);
		assert.equal(first.body.result.created, true);
		assert.equal(first.body.result.profile.email, 'new@example.com');
		const again = await call('POST', '/users/provision', { userId: INVITED, email: 'new@example.com', displayName: 'Changed' });
		assert.equal(again.body.result.created, false);
		assert.equal((await (await raw.profiles.get(INVITED))!.json<any>()).displayName, 'New Creator');

		const found = await call('GET', '/users?q=new%40example');
		assert.deepEqual(found.body.result.items.map((u: { id: string }) => u.id), [INVITED]);
		const byId = await call('GET', `/users?q=${INVITED}`);
		assert.equal(byId.body.result.items.length, 1);
	});

	it('refuses ids that are not usr_ + 32 hex', async () => {
		const { call } = await setup();
		assert.equal((await call('POST', '/users/provision', { userId: 'usr_x', email: 'x@example.com' })).status, 400);
	});

	it('a channel made for them is theirs exactly like a normal owner: R2 object, ownership index, main, handle', async () => {
		const { call, db } = await setup();
		await call('POST', '/users/provision', { userId: INVITED, email: 'new@example.com' });
		const res = await call('POST', `/users/${INVITED}/channels`, { name: 'Tafsir Daily', handle: 'tafsir-daily' });
		assert.equal(res.status, 200);
		const ch = res.body.result.channel;
		assert.equal(ch.userId, INVITED);
		assert.equal(ch.isMain, true);
		assert.equal(ch.handle, 'tafsir-daily');
		const row = await db.prepare(`SELECT owner_id FROM content_ownership WHERE kind = 'channel' AND id = ?`).bind(ch.id).first<{ owner_id: string }>();
		assert.equal(row?.owner_id, INVITED);
		const listed = await call('GET', `/channels?ownerId=${INVITED}`);
		assert.deepEqual(listed.body.result.items.map((c: { id: string }) => c.id), [ch.id]);
		const detail = await call('GET', `/users/${INVITED}`);
		assert.deepEqual(detail.body.result.channels.map((c: { id: string }) => c.id), [ch.id]);

		const second = await call('POST', `/users/${INVITED}/channels`, { name: 'Second' });
		assert.equal(second.body.result.channel.isMain, false);
		assert.ok(second.body.result.channel.handle, 'gets a default handle');
		assert.equal((await call('POST', `/users/${INVITED}/channels`, { name: 'tafsir daily' })).body.code, 'duplicate_channel_name');
		assert.equal((await call('POST', `/users/${INVITED}/channels`, { name: 'Other', handle: 'tafsir-daily' })).body.code, 'handle_taken');
	});

	it('needs the profile first', async () => {
		const { call } = await setup();
		assert.equal((await call('POST', `/users/${INVITED}/channels`, { name: 'X' })).body.code, 'user_not_found');
	});

	it('an existing channel can be transferred to them before they ever sign in', async () => {
		const { call } = await setup();
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: INVITED })).body.code, 'new_owner_not_found');
		await call('POST', '/users/provision', { userId: INVITED, email: 'new@example.com' });
		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: INVITED });
		assert.equal(res.status, 200);
		const ch = await call('GET', '/channels/ch1');
		assert.equal(ch.body.result.ownerId, INVITED);
	});

	it('looks an email up in Auth (read-only) and in videos profiles', async () => {
		const { call } = await setup([{ id: 'usr_member', email: 'member@example.com', name: 'M', status: 'active' }]);
		const known = await call('GET', '/accounts?email=%20Member%40Example.com');
		assert.deepEqual(known.body.result.authUser, { id: 'usr_member', email: 'member@example.com', name: 'M', status: 'active' });
		const owner = await call('GET', '/accounts?email=owner%40example.com');
		assert.equal(owner.body.result.authUser, null);
		assert.equal(owner.body.result.profile.id, OWNER);
		const none = await call('GET', '/accounts?email=nobody%40example.com');
		assert.deepEqual(none.body.result, { authUser: null, profile: null });
	});
});
