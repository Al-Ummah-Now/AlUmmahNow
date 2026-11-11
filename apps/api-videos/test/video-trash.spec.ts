/**
 * Creator soft deletes (lib/videoTrash.ts): DELETE /api/videos/:id and
 * bulk-delete keep the video restorable for 30 days; restore, bulk-restore,
 * the channel trash, "delete permanently now" and the cleanup that purges
 * (R2 record + Bunny Stream video) once the 30 days are up.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { errorHandler } from '../src/middleware/error-handler';
import { withSearchSync } from '../src/lib/search/sync';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS, purgeDeletion } from '../src/lib/admin/service';
import { runDeletionCleanup } from '../src/lib/admin/deletions';
import { memberMayActAs } from '../src/lib/channelAccess';
import { VideoDelete } from '../src/endpoints/video/videoDelete';
import { VideoBulkDelete } from '../src/endpoints/video/videoBulkDelete';
import { VideoRestore } from '../src/endpoints/video/videoRestore';
import { ChannelDeletedVideos, VideoBulkPurge, VideoBulkRestore } from '../src/endpoints/video/videoTrash';
import { VideoPermanentDelete } from '../src/endpoints/video/videoPermanentDelete';
import { ChannelDeletedVideosList } from '../src/endpoints/channel/channelDeletedVideosList';
import adminRouter from '../src/routers/admin.router';
import { MemoryBucket, MemoryQueue, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const OWNER = 'usr_owner';
const EDITOR = 'usr_editor';
const ADMIN_MEMBER = 'usr_chadmin';
const STRANGER = 'usr_stranger';
const DAY = 86_400_000;

/** Bunny Stream API stand-in: records the deletes the purge makes. */
const bunny = { calls: [] as string[] };
const realFetch = globalThis.fetch;
before(() => {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		if (!url.startsWith('https://video.bunnycdn.com/')) return realFetch(input, init);
		bunny.calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
		return new Response('{}', { status: 200 });
	}) as typeof fetch;
});
after(() => {
	globalThis.fetch = realFetch;
});

/** The admin-jobs queue: delivers its messages to the job consumer on drain(). */
class JobsQueue {
	pending: unknown[] = [];
	async send(body: unknown) {
		this.pending.push(body);
	}
	async drain(env: unknown) {
		for (let guard = 0; this.pending.length && guard < 50; guard++) {
			const body = this.pending.shift();
			const msg: JobMessage = { body, attempts: 1, ack: () => undefined, retry: () => undefined } as never;
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS);
		}
	}
}

function routes(r: any) {
	r.post('/api/videos/bulk-delete', VideoBulkDelete);
	r.post('/api/videos/bulk-restore', VideoBulkRestore);
	r.post('/api/videos/bulk-purge', VideoBulkPurge);
	r.get('/api/channels/:id/content/deleted', ChannelDeletedVideos);
	r.delete('/api/videos/:id', VideoDelete);
	r.post('/api/videos/:id/restore', VideoRestore);
	r.delete('/api/videos/:id/permanent', VideoPermanentDelete);
	r.get('/api/channels/:id/deleted-videos', ChannelDeletedVideosList);
}

async function setup(videos?: Record<string, unknown>) {
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const raw = {
		SEARCH_DB: db,
		profiles: new MemoryBucket(),
		channels: new MemoryBucket({
			ch1: {
				id: 'ch1',
				userId: OWNER,
				name: 'Channel',
				members: [
					{ userId: EDITOR, role: 'editor', addedAt: '2026-01-01T00:00:00.000Z', addedBy: OWNER },
					{ userId: ADMIN_MEMBER, role: 'admin', addedAt: '2026-01-01T00:00:00.000Z', addedBy: OWNER },
				],
			},
		}),
		videos: new MemoryBucket(
			videos ?? {
				v1: videoFixture({ id: 'v1', title: 'Tafsir', userId: OWNER, channelId: 'ch1' }),
				v2: videoFixture({ id: 'v2', title: 'Seerah', userId: OWNER, channelId: 'ch1', uploadedBy: EDITOR }),
				v3: videoFixture({ id: 'v3', title: 'Fiqh', userId: OWNER, channelId: 'ch1' }),
				theirs: videoFixture({ id: 'theirs', userId: STRANGER, channelId: 'other' }),
			},
		),
		playlists: new MemoryBucket(),
		queue: new MemoryQueue(),
		ADMIN_JOBS_QUEUE: new JobsQueue(),
		'bunny-stream-key': 'test-key',
		bunny_stream_library_id: '7',
	};
	for (const kind of ['video', 'channel'] as const) await runOwnershipPass(raw as never, kind, { maxPages: 10 });
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
	const flush = async () => {
		while (pending.length) await Promise.allSettled(pending.splice(0));
	};
	const call = async (userId: string | null, method: string, path: string, body?: unknown) => {
		const app = new Hono();
		app.onError(errorHandler);
		app.use('*', async (c, next) => {
			if (userId) {
				c.set('auth' as never, { userId, email: `${userId}@test.local`, payload: {} } as never);
				c.set('userId' as never, userId as never);
			}
			await next();
		});
		routes(fromHono(app));
		const res = await app.request(
			path,
			{ method, headers: { 'Content-Type': 'application/json', channelId: 'ch1' }, ...(body ? { body: JSON.stringify(body) } : {}) },
			env as never,
		);
		await flush();
		return { status: res.status, body: (await res.json().catch(() => null)) as any };
	};
	const adminCall = async (method: string, path: string) => {
		const app = new Hono();
		app.route('/internal/admin', adminRouter);
		const res = await app.request(`/internal/admin${path}`, { method, headers: { 'X-Admin-Actor': 'usr_admin', 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }, env as never);
		await flush();
		return { status: res.status, body: (await res.json().catch(() => null)) as any };
	};
	const ownership = (id: string) => db.db.prepare("SELECT is_deleted FROM content_ownership WHERE kind = 'video' AND id = ?").get(id) as { is_deleted: number } | undefined;
	const row = (id: string) => db.db.prepare("SELECT * FROM admin_deletions WHERE kind = 'video' AND target_id = ?").get(id) as Record<string, any> | undefined;
	const backdate = (id: string, days: number) => {
		const at = new Date(Date.now() - days * DAY).toISOString();
		db.db.prepare("UPDATE admin_deletions SET deleted_at = ? WHERE kind = 'video' AND target_id = ?").run(at, id);
	};
	return { raw, env, db, call, adminCall, ownership, row, backdate, flush };
}

describe('DELETE /api/videos/:id (soft delete)', () => {
	it('hides the video, keeps R2 and Bunny, and says until when it can be restored', async () => {
		const t = await setup();
		bunny.calls = [];
		const res = await t.call(OWNER, 'DELETE', '/api/videos/v1');
		assert.equal(res.status, 200);
		assert.equal(res.body.success, true);
		assert.equal(res.body.videoId, 'v1');
		const until = Date.parse(res.body.restorableUntil) - Date.parse(res.body.deletedAt);
		assert.equal(until, 30 * DAY);

		const stored = t.raw.videos.read('v1') as any;
		assert.ok(stored, 'the R2 record stays');
		assert.equal(stored.isDeleted, true);
		assert.equal(stored.deletedBy, OWNER);
		assert.equal(stored.deletedAt, res.body.deletedAt);
		assert.equal(stored.isHidden, true);
		assert.deepEqual(bunny.calls, [], 'nothing deleted at Bunny');
		assert.equal(t.raw.ADMIN_JOBS_QUEUE.pending.length, 0);
		assert.equal(t.ownership('v1')?.is_deleted, 1, 'the ownership index drops it');
		assert.equal(t.row('v1')?.reason, 'Deleted by the creator');
		assert.ok(!t.raw.queue.messages.some((m: any) => m.type === 'video-delete' || m.type === 'VideoDelete'), 'no hard-delete message yet');
	});

	it('refuses a stranger (403) and a missing video (404); deleting again is idempotent', async () => {
		const t = await setup();
		assert.equal((await t.call(STRANGER, 'DELETE', '/api/videos/v1')).status, 403);
		assert.equal((await t.call(OWNER, 'DELETE', '/api/videos/missing')).status, 404);
		const first = await t.call(OWNER, 'DELETE', '/api/videos/v1');
		assert.equal(first.status, 200);
		assert.equal(first.body.alreadyDeleted, false);
		const again = await t.call(OWNER, 'DELETE', '/api/videos/v1');
		assert.equal(again.status, 200);
		assert.equal(again.body.alreadyDeleted, true);
		assert.equal(again.body.deletedAt, first.body.deletedAt, 'the first delete\'s times, not a new 30 days');
		assert.equal(again.body.restorableUntil, first.body.restorableUntil);
		assert.equal((await t.call(null, 'DELETE', '/api/videos/v3')).status, 401);
	});

	it('an admin-removed video is not the creator\'s to delete again (403)', async () => {
		const t = await setup();
		await t.adminCall('DELETE', '/videos/v1');
		const res = await t.call(OWNER, 'DELETE', '/api/videos/v1');
		assert.equal(res.status, 403);
		assert.equal(res.body.code, 'deleted_by_admin');
	});

	it('lets an editor delete their own upload only', async () => {
		const t = await setup();
		assert.equal((await t.call(EDITOR, 'DELETE', '/api/videos/v1')).status, 403);
		assert.equal((await t.call(EDITOR, 'DELETE', '/api/videos/v2')).status, 200);
	});
});

describe('POST /api/videos/bulk-delete (soft delete)', () => {
	it('soft-deletes the caller\'s own videos with restorableUntil per item', async () => {
		const t = await setup();
		const res = await t.call(OWNER, 'POST', '/api/videos/bulk-delete', { videoIds: ['v1', 'v3', 'theirs', 'missing'] });
		assert.equal(res.status, 200);
		const byId = Object.fromEntries(res.body.results.map((r: any) => [r.videoId, r]));
		assert.equal(byId.v1.success, true);
		assert.ok(byId.v1.restorableUntil);
		assert.equal(byId.theirs.success, false);
		assert.match(byId.theirs.error, /^Forbidden/);
		assert.equal(byId.missing.code, 'video_not_found');
		assert.deepEqual(res.body.summary, { total: 4, succeeded: 2, failed: 2 });
		assert.equal((t.raw.videos.read('v3') as any).isDeleted, true);
		assert.equal((t.raw.videos.read('theirs') as any).isDeleted, undefined);

		const again = await t.call(OWNER, 'POST', '/api/videos/bulk-delete', { videoIds: ['v1'] });
		assert.equal(again.body.results[0].success, true, 'already in the trash counts as deleted');
		assert.equal(again.body.results[0].restorableUntil, byId.v1.restorableUntil);
	});

	it('follows channel roles: a channel admin may, a stranger may not', async () => {
		const t = await setup();
		assert.equal((await t.call(STRANGER, 'POST', '/api/videos/bulk-delete', { videoIds: ['v1'] })).body.summary.succeeded, 0);
		assert.equal((await t.call(ADMIN_MEMBER, 'POST', '/api/videos/bulk-delete', { videoIds: ['v1'] })).body.summary.succeeded, 1);
	});

	it('rejects more than 50 ids', async () => {
		const t = await setup();
		const res = await t.call(OWNER, 'POST', '/api/videos/bulk-delete', { videoIds: Array.from({ length: 51 }, (_, i) => `v${i}`) });
		assert.equal(res.status, 400);
	});
});

describe('POST /api/videos/:id/restore', () => {
	it('restores within 30 days and re-indexes the video', async () => {
		const t = await setup();
		await t.call(OWNER, 'DELETE', '/api/videos/v1');
		const res = await t.call(OWNER, 'POST', '/api/videos/v1/restore');
		assert.equal(res.status, 200);
		assert.equal(res.body.videoId, 'v1');
		const stored = t.raw.videos.read('v1') as any;
		assert.equal(stored.isDeleted, false);
		assert.equal(stored.isHidden, false);
		assert.equal(stored.deletedAt, undefined);
		assert.equal(stored.ownerDeletion, undefined);
		assert.equal(t.ownership('v1')?.is_deleted, 0, 'back in the ownership index');
		assert.equal(t.row('v1'), undefined, 'the trash row is gone');
	});

	it('a channel admin may restore; a stranger may not (403)', async () => {
		const t = await setup();
		await t.call(OWNER, 'DELETE', '/api/videos/v1');
		assert.equal((await t.call(STRANGER, 'POST', '/api/videos/v1/restore')).status, 403);
		assert.equal((await t.call(ADMIN_MEMBER, 'POST', '/api/videos/v1/restore')).status, 200);
		assert.equal(memberMayActAs('admin', 'POST', '/api/videos/v1/restore'), true);
		assert.equal(memberMayActAs('moderator', 'POST', '/api/videos/v1/restore'), false);
		assert.equal(memberMayActAs('admin', 'POST', '/api/videos/bulk-restore'), false, 'bulk restore stays owner only');
		assert.equal(memberMayActAs('admin', 'DELETE', '/api/videos/v1/permanent'), false, 'permanent delete stays owner only');
	});

	it('404 for a missing video, 409 for one that is not deleted', async () => {
		const t = await setup();
		assert.equal((await t.call(OWNER, 'POST', '/api/videos/missing/restore')).status, 404);
		const live = await t.call(OWNER, 'POST', '/api/videos/v1/restore');
		assert.equal(live.status, 409);
		assert.equal(live.body.code, 'not_deleted');
	});

	it('410 once the 30 days are up', async () => {
		const t = await setup();
		await t.call(OWNER, 'DELETE', '/api/videos/v1');
		t.backdate('v1', 31);
		const res = await t.call(OWNER, 'POST', '/api/videos/v1/restore');
		assert.equal(res.status, 410);
		assert.equal(res.body.code, 'restore_window_expired');
		assert.equal((t.raw.videos.read('v1') as any).isDeleted, true);
	});

	it('403 for a video an administrator removed', async () => {
		const t = await setup();
		assert.equal((await t.adminCall('DELETE', '/videos/v1')).status, 200);
		const res = await t.call(OWNER, 'POST', '/api/videos/v1/restore');
		assert.equal(res.status, 403);
		assert.equal(res.body.code, 'deleted_by_admin');
	});

	it('an admin can restore a creator delete', async () => {
		const t = await setup();
		await t.call(OWNER, 'DELETE', '/api/videos/v1');
		assert.equal((await t.adminCall('POST', '/deletions/video/v1/restore')).status, 200);
		const stored = t.raw.videos.read('v1') as any;
		assert.equal(stored.isDeleted, false);
		assert.equal(stored.isHidden, false);
	});
});

describe('POST /api/videos/bulk-restore', () => {
	it('restores the caller\'s own deleted videos, per item', async () => {
		const t = await setup();
		await t.call(OWNER, 'POST', '/api/videos/bulk-delete', { videoIds: ['v1', 'v3'] });
		t.backdate('v3', 40);
		const res = await t.call(OWNER, 'POST', '/api/videos/bulk-restore', { videoIds: ['v1', 'v3', 'v2', 'theirs', 'missing'] });
		assert.equal(res.status, 200);
		const byId = Object.fromEntries(res.body.results.map((r: any) => [r.videoId, r]));
		assert.equal(byId.v1.success, true);
		assert.equal(byId.v3.code, 'restore_window_expired');
		assert.equal(byId.v2.code, 'not_deleted');
		assert.equal(byId.theirs.code, 'forbidden');
		assert.equal(byId.missing.code, 'video_not_found');
		assert.deepEqual(res.body.summary, { total: 5, succeeded: 1, failed: 4 });
	});

	it('refuses a stranger and an admin removal', async () => {
		const t = await setup();
		await t.call(OWNER, 'DELETE', '/api/videos/v1');
		await t.adminCall('DELETE', '/videos/v3');
		const res = await t.call(STRANGER, 'POST', '/api/videos/bulk-restore', { videoIds: ['v1'] });
		assert.equal(res.body.results[0].code, 'forbidden');
		const admin = await t.call(OWNER, 'POST', '/api/videos/bulk-restore', { videoIds: ['v3'] });
		assert.equal(admin.body.results[0].code, 'deleted_by_admin');
		assert.equal((t.raw.videos.read('v3') as any).isDeleted, true);
	});

	it('a queued "Delete permanently" (bulk-purge) can still be undone; admin removals cannot be purged', async () => {
		const t = await setup();
		await t.call(OWNER, 'DELETE', '/api/videos/v1');
		const purge = await t.call(OWNER, 'POST', '/api/videos/bulk-purge', { videoIds: ['v1'] });
		assert.equal(purge.body.summary.succeeded, 1);
		assert.ok(t.row('v1')?.purge_requested_at);
		const listed = await t.call(OWNER, 'GET', '/api/channels/ch1/content/deleted');
		assert.deepEqual(listed.body.result.items.map((i: any) => [i.id, i.status]), [['v1', 'queued']]);
		assert.equal((await t.call(OWNER, 'POST', '/api/videos/v1/restore')).status, 200);

		await t.adminCall('DELETE', '/videos/v3');
		const refused = await t.call(OWNER, 'POST', '/api/videos/bulk-purge', { videoIds: ['v3'] });
		assert.equal(refused.body.results[0].code, 'deleted_by_admin');
		assert.equal(t.row('v3')?.purge_requested_at, null);
	});

	it('restores a delete made before this module (adminDeletion by the owner)', async () => {
		const t = await setup();
		// The first Studio creator deletes went through the admin soft delete with the creator as actor
		const { deleteVideo } = await import('../src/lib/admin/service');
		await deleteVideo(t.env as never, 'v1', OWNER);
		await t.flush();
		const res = await t.call(OWNER, 'POST', '/api/videos/bulk-restore', { videoIds: ['v1'] });
		assert.equal(res.body.results[0].success, true);
		const stored = t.raw.videos.read('v1') as any;
		assert.equal(stored.isDeleted, false);
		assert.equal(stored.isHidden, false);
		assert.equal(stored.adminDeletion, undefined);
	});
});

describe('GET /api/channels/:id/deleted-videos', () => {
	it('lists restorable creator deletes newest first with a cursor', async () => {
		const t = await setup();
		await t.call(OWNER, 'DELETE', '/api/videos/v1');
		t.backdate('v1', 2);
		await t.call(OWNER, 'DELETE', '/api/videos/v2');
		t.backdate('v2', 1);
		await t.call(OWNER, 'DELETE', '/api/videos/v3');
		t.backdate('v3', 35); // past the window: not listed
		const first = await t.call(OWNER, 'GET', '/api/channels/ch1/deleted-videos?limit=1');
		assert.equal(first.status, 200);
		assert.equal(first.body.success, true);
		assert.deepEqual(first.body.result.items.map((v: any) => v.id), ['v2']);
		const item = first.body.result.items[0];
		assert.equal(item.title, 'Seerah');
		assert.equal(Date.parse(item.restorableUntil) - Date.parse(item.deletedAt), 30 * DAY);
		assert.equal(item.ownerDeletion, undefined);
		assert.equal(item.suspensionHolds, undefined);
		assert.ok(first.body.result.cursor);
		const second = await t.call(OWNER, 'GET', `/api/channels/ch1/deleted-videos?limit=1&cursor=${encodeURIComponent(first.body.result.cursor)}`);
		assert.deepEqual(second.body.result.items.map((v: any) => v.id), ['v1']);
		assert.equal(second.body.result.cursor, null);
	});

	it('leaves out admin deletes; an editor sees only their own uploads', async () => {
		const t = await setup();
		await t.adminCall('DELETE', '/videos/v1');
		await t.call(OWNER, 'DELETE', '/api/videos/v2');
		await t.call(OWNER, 'DELETE', '/api/videos/v3');
		const owner = await t.call(OWNER, 'GET', '/api/channels/ch1/deleted-videos');
		assert.deepEqual(owner.body.result.items.map((v: any) => v.id).sort(), ['v2', 'v3']);
		const studio = await t.call(OWNER, 'GET', '/api/channels/ch1/content/deleted');
		assert.deepEqual(studio.body.result.items.map((v: any) => v.id).sort(), ['v2', 'v3'], 'the Studio list leaves admin removals out too');
		assert.ok(studio.body.result.items.every((v: any) => v.restorableUntil === v.purgeAfter && v.status === 'deleted'));
		const editor = await t.call(EDITOR, 'GET', '/api/channels/ch1/deleted-videos');
		assert.deepEqual(editor.body.result.items.map((v: any) => v.id), ['v2']);
	});

	it('403 without a role that may delete, 404 for a missing channel', async () => {
		const t = await setup();
		assert.equal((await t.call(STRANGER, 'GET', '/api/channels/ch1/deleted-videos')).status, 403);
		assert.equal((await t.call(OWNER, 'GET', '/api/channels/nope/deleted-videos')).status, 404);
	});
});

describe('DELETE /api/videos/:id/permanent and the 30-day purge', () => {
	it('purges a trashed video now: R2 record and Bunny video', async () => {
		const t = await setup();
		await t.call(OWNER, 'DELETE', '/api/videos/v1');
		bunny.calls = [];
		const res = await t.call(OWNER, 'DELETE', '/api/videos/v1/permanent');
		assert.equal(res.status, 200);
		assert.equal(res.body.purgeStarted, true);
		assert.ok(res.body.purgeRequestedAt);
		const refused = await t.call(OWNER, 'POST', '/api/videos/v1/restore');
		assert.equal(refused.status, 410, 'no restore once a permanent delete was asked');
		await t.raw.ADMIN_JOBS_QUEUE.drain(t.env);
		await t.flush();
		assert.equal(t.raw.videos.read('v1'), null);
		assert.deepEqual(bunny.calls, ['DELETE /library/7/videos/v1']);
		assert.equal((await t.call(OWNER, 'GET', '/api/channels/ch1/deleted-videos')).body.result.items.length, 0);
	});

	it('purges a live video directly', async () => {
		const t = await setup();
		const res = await t.call(OWNER, 'DELETE', '/api/videos/v3/permanent');
		assert.equal(res.status, 200);
		await t.raw.ADMIN_JOBS_QUEUE.drain(t.env);
		assert.equal(t.raw.videos.read('v3'), null);
	});

	it('is owner only (403), 404 when missing, 403 on an admin delete', async () => {
		const t = await setup();
		assert.equal((await t.call(ADMIN_MEMBER, 'DELETE', '/api/videos/v1/permanent')).status, 403);
		assert.equal((await t.call(OWNER, 'DELETE', '/api/videos/missing/permanent')).status, 404);
		await t.adminCall('DELETE', '/videos/v1');
		const res = await t.call(OWNER, 'DELETE', '/api/videos/v1/permanent');
		assert.equal(res.status, 403);
		assert.equal(res.body.code, 'deleted_by_admin');
		assert.ok(t.raw.videos.read('v1'));
	});

	it('the cleanup purges creator deletes after 30 days and leaves newer ones', async () => {
		const t = await setup();
		await t.call(OWNER, 'DELETE', '/api/videos/v1');
		await t.call(OWNER, 'DELETE', '/api/videos/v3');
		t.backdate('v1', 31);
		bunny.calls = [];
		const run = await runDeletionCleanup(t.env as never, (d) => purgeDeletion(t.env as never, d));
		assert.equal(run.due, 1);
		await t.raw.ADMIN_JOBS_QUEUE.drain(t.env);
		await runDeletionCleanup(t.env as never, (d) => purgeDeletion(t.env as never, d));
		assert.equal(t.raw.videos.read('v1'), null);
		assert.deepEqual(bunny.calls, ['DELETE /library/7/videos/v1']);
		assert.ok(t.row('v1')?.purged_at, 'row marked purged');
		assert.ok(t.raw.videos.read('v3'), 'a recent delete stays');
	});
});
