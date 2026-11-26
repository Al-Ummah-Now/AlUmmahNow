import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { eraseRunUserData, OwnershipIndexIncomplete } from '../src/lib/privacy/run-user-erase';
import { OperationBudget } from '../src/lib/privacy/scan';
import { jobQueueFor } from '../src/lib/admin/jobs';
import { ADMIN_BACKUPS_UNBOUND_ERROR, LEGACY_RESTORE_POINTERS_PREFIX, backupKey, backupPointerKey } from '../src/lib/admin/legacy-restore';
import { logger } from '../src/lib/logger';
import { MemoryBucket, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

const channel = (id: string, userId: string, extra: Record<string, unknown> = {}) => ({ id, name: id, userId, dateCreated: '2026-01-01T00:00:00.000Z', subscriptions: [], ...extra });

/** Buckets whose list() calls are recorded: a full scan is a list without a prefix. */
function buckets() {
	const scans: string[] = [];
	const backupListPrefixes: Array<string | undefined> = [];
	const make = (name: string, initial: Record<string, unknown> = {}) => {
		const b = new MemoryBucket(initial);
		const list = b.list.bind(b);
		b.list = (async (opts: { prefix?: string } = {}) => {
			if (!opts.prefix) scans.push(name);
			if (name === 'ADMIN_BACKUPS') backupListPrefixes.push(opts.prefix);
			return list(opts as never);
		}) as never;
		return b;
	};
	return {
		scans,
		backupListPrefixes,
		env: {
			videos: make('videos', {
				v1: videoFixture({ id: 'v1', userId: 'run1', channelId: 'ch1' }),
				v2: videoFixture({ id: 'v2', userId: 'run1', channelId: 'ch1', isDeleted: true }),
				v3: videoFixture({ id: 'v3', userId: 'other', channelId: 'chX' }),
			}),
			channels: make('channels', { ch1: channel('ch1', 'run1', { handle: 'RunOne' }), chX: channel('chX', 'other') }),
			profiles: make('profiles', { run1: { id: 'run1', userName: 'run1' }, other: { id: 'other' } }),
			watch_history: make('watch_history', { 'run1:v3': { at: 1 }, 'other:v1': { at: 1 } }),
			'upload-defaults': make('upload-defaults', { 'run1/t1': { title: 't' } }),
			channel_sections: make('channel_sections', { 'ch1/s1': { id: 's1' } }),
			channel_tabs: make('channel_tabs', { 'channel-handles/runone': { channelId: 'ch1' }, 'channel-tabs/ch1': {} }),
			community_posts: make('community_posts', { 'posts/ch1/p1.json': { id: 'p1' }, 'post-locations/p1': { channelId: 'ch1' }, 'likes/p1/u9.json': {}, 'posts/chX/p2.json': { id: 'p2' } }),
			playlists: make('playlists'),
			reports: make('reports'),
			ADMIN_BACKUPS: make('ADMIN_BACKUPS', {
				[backupKey('job1', 'run1', 'v1')]: { id: 'run1', email: 'run1@test.local' },
				[backupPointerKey('run1', 'job1', 'v1')]: '',
				[backupKey('job1', 'other', 'v1')]: { id: 'other', email: 'other@test.local' },
				[backupPointerKey('other', 'job1', 'v1')]: '',
			}),
		},
	};
}

describe('run-account erasure through the indexes (#887)', () => {
	it('erases what the account owns, never lists a whole bucket, and leaves other users alone', async () => {
		const db = new SqliteD1();
		const { env, scans, backupListPrefixes } = buckets();
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		scans.length = 0;
		backupListPrefixes.length = 0;

		const deletedMedia: string[] = [];
		const result = await eraseRunUserData(full as never, 'run1', new OperationBudget(900), { onVideoDeleted: async (id) => { deletedMedia.push(id); } });

		assert.equal(result.complete, true);
		assert.deepEqual(scans, [], 'no bucket was listed without a prefix');
		assert.ok(backupListPrefixes.includes(`${LEGACY_RESTORE_POINTERS_PREFIX}run1/`), 'ADMIN_BACKUPS lists the user legacy-restore pointer prefix');
		assert.ok(
			backupListPrefixes.every((p) => p === `${LEGACY_RESTORE_POINTERS_PREFIX}run1/` || p === 'profile-emails/by-user/run1/'),
			`ADMIN_BACKUPS only lists per-user pointer prefixes (got ${JSON.stringify(backupListPrefixes)})`,
		);
		assert.equal(result.deleted.legacyRestoreBackups, 1);
		assert.deepEqual(result.deletedVideoIds.sort(), ['v1', 'v2'], 'its soft-deleted video too');
		assert.deepEqual(deletedMedia.sort(), ['v1', 'v2']);
		assert.deepEqual([...env.videos.store.keys()], ['v3']);
		assert.deepEqual([...env.channels.store.keys()], ['chX']);
		assert.deepEqual([...env.profiles.store.keys()], ['other']);
		assert.deepEqual([...env.watch_history.store.keys()], ['other:v1']);
		assert.equal(env['upload-defaults'].store.size, 0);
		assert.equal(env.channel_sections.store.size, 0);
		assert.deepEqual([...env.channel_tabs.store.keys()], [], 'its tabs and @handle are freed');
		assert.deepEqual([...env.community_posts.store.keys()], ['posts/chX/p2.json']);
		assert.deepEqual([...env.ADMIN_BACKUPS.store.keys()].sort(), [backupPointerKey('other', 'job1', 'v1'), backupKey('job1', 'other', 'v1')].sort());
	});

	it('preserves a transferred channel and its content when the ownership index and video still name the run account', async () => {
		const db = new SqliteD1();
		const { env, scans } = buckets();
		const subtitles = new MemoryBucket({ 'v1/en.vtt': 'private captions', 'v2/en.vtt': 'private captions', 'v4/en.vtt': 'run captions' });
		const full = { ...env, subtitles, SEARCH_DB: db };
		await env.videos.put('v4', JSON.stringify(videoFixture({ id: 'v4', userId: 'run1', channelId: '' })));
		await env.playlists.put('p1', JSON.stringify({ id: 'p1', channelId: 'ch1', userId: 'run1' }));
		db.db.prepare("INSERT INTO search_playlists (id, channel_id, payload) VALUES ('p1', 'ch1', '{}')").run();
		db.db.prepare("INSERT INTO privacy_footprints (user_id, kind, target_id) VALUES ('run1', 'playlist', 'p1')").run();
		for (const kind of ['channel', 'video'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		await env.channels.put('ch1', JSON.stringify(channel('ch1', 'other', { handle: 'RunOne' })));
		// v1 is found through owner_id and v2 only through the stale channel candidate.
		db.db.prepare("UPDATE content_ownership SET owner_id = 'other' WHERE kind = 'video' AND id = 'v2'").run();
		scans.length = 0;

		const result = await eraseRunUserData(full as never, 'run1', new OperationBudget(900), {
			onVideoDeleted: async (id) => assert.equal(id, 'v4'),
			onChannelDeleted: async () => assert.fail('the transferred channel must survive'),
			onPostDeleted: async () => assert.fail('the transferred post must survive'),
		});

		assert.equal(result.complete, true);
		assert.deepEqual(result.deletedVideoIds, ['v4']);
		assert.deepEqual(scans, []);
		assert.deepEqual([...env.videos.store.keys()], ['v1', 'v2', 'v3']);
		assert.deepEqual([...subtitles.store.keys()], ['v1/en.vtt', 'v2/en.vtt']);
		assert.ok(env.channels.store.has('ch1'));
		assert.ok(env.playlists.store.has('p1'));
		assert.ok(env.channel_sections.store.has('ch1/s1'));
		assert.ok(env.channel_tabs.store.has('channel-tabs/ch1'));
		assert.ok(env.channel_tabs.store.has('channel-handles/runone'));
		assert.ok(env.community_posts.store.has('posts/ch1/p1.json'));
		assert.ok(env.community_posts.store.has('post-locations/p1'));
		assert.equal(env.profiles.store.has('run1'), false);
	});

	it('erases its playlists without a channel (Watch later, personal) and its footprints, not someone else\'s', async () => {
		const db = new SqliteD1();
		const { env } = buckets();
		await env.playlists.put('watch-later-run1', JSON.stringify({ id: 'watch-later-run1', userId: 'run1', channelId: '', systemType: 'watch_later' }));
		await env.playlists.put('pl-mine', JSON.stringify({ id: 'pl-mine', userId: 'run1', channelId: '' }));
		await env.playlists.put('pl-other', JSON.stringify({ id: 'pl-other', userId: 'other', channelId: '' }));
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		for (const [user, target] of [['run1', 'pl-mine'], ['run1', 'pl-other'], ['other', 'pl-other']]) {
			db.db.prepare("INSERT INTO privacy_footprints (user_id, kind, target_id) VALUES (?, 'playlist', ?)").run(user, target);
		}
		const result = await eraseRunUserData(full as never, 'run1', new OperationBudget(900));
		assert.equal(result.complete, true);
		assert.deepEqual([...env.playlists.store.keys()], ['pl-other']);
		assert.deepEqual(db.db.prepare('SELECT user_id, target_id FROM privacy_footprints').all().map((r) => ({ ...(r as object) })), [{ user_id: 'other', target_id: 'pl-other' }]);
	});

	it('cancels its channel invitations and takes its id out of the team activity log', async () => {
		const db = new SqliteD1();
		const { env } = buckets();
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		const ins = db.db.prepare(`INSERT INTO channel_invites (id, channel_id, role, invitee_user_id, invitee_email, by_email, invited_by, status, created_at, expires_at) VALUES (?, 'chX', 'editor', ?, NULL, 0, ?, ?, '2026-11-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`);
		ins.run('i-open', 'run1', 'other', 'pending');
		ins.run('i-done', 'run1', 'other', 'accepted');
		db.db.prepare(`INSERT INTO channel_audit (id, channel_id, actor_id, action, target_user_id, created_at) VALUES ('a1', 'chX', 'other', 'invite_sent', 'run1', '2026-11-01T00:00:00.000Z'), ('a2', 'chX', 'run1', 'invite_accepted', 'run1', '2026-11-01T00:00:01.000Z')`).run();
		const result = await eraseRunUserData(full as never, 'run1', new OperationBudget(900));
		assert.equal(result.complete, true);
		const rows = [...db.db.prepare('SELECT * FROM channel_invites').all(), ...db.db.prepare('SELECT * FROM channel_audit').all()];
		assert.equal(JSON.stringify(rows).includes('run1'), false, 'no row names the run account');
		assert.equal((db.db.prepare(`SELECT status FROM channel_invites WHERE id = 'i-open'`).get() as { status: string }).status, 'cancelled');
	});

	it('stops its channel moves that are under way and takes its id out of the offers (CC-6 review)', async () => {
		const db = new SqliteD1();
		const { env } = buckets();
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		const ins = db.db.prepare(`INSERT INTO channel_move_offers (id, channel_id, from_user_id, to_user_id, status, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, 'accepting', '2026-11-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`);
		ins.run('o-in', 'chX', 'other', 'run1');
		ins.run('o-out', 'ch1', 'run1', 'other');
		const result = await eraseRunUserData(full as never, 'run1', new OperationBudget(900));
		assert.equal(result.complete, true);
		const kept = JSON.parse(env.channels.store.get('chX')!);
		assert.deepEqual([kept.userId, kept.moveStopped], ['other', 'o-in'], 'the channel stays with its owner, and the move finds the mark');
		const rows = db.db.prepare('SELECT * FROM channel_move_offers ORDER BY id').all() as Array<{ status: string }>;
		assert.deepEqual(rows.map((r) => r.status), ['cancelled', 'cancelled']);
		assert.equal(JSON.stringify(rows).includes('run1'), false);
	});

	it('a channel a move brings while its profile goes starts the steps over (CC-6 review)', async () => {
		const db = new SqliteD1();
		const { env } = buckets();
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		const remove = env.profiles.delete.bind(env.profiles);
		env.profiles.delete = (async (key: string) => {
			db.db.prepare(`INSERT OR IGNORE INTO admin_jobs (id, kind, target_kind, target_id, actor_id, status, params, created_at, updated_at) VALUES ('j1', 'channel.transfer', 'channel', 'chX', 'other', 'succeeded', '{}', '2026', '2026')`).run();
			db.db.prepare(`INSERT OR IGNORE INTO channel_move_offers (id, channel_id, from_user_id, to_user_id, status, job_id, created_at, expires_at, updated_at) VALUES ('o-late', 'chX', 'other', 'run1', 'moved', 'j1', '2026', '2099', '2026')`).run();
			env.channels.store.set('chX', JSON.stringify({ ...JSON.parse(env.channels.store.get('chX')!), userId: 'run1' }));
			db.db.prepare(`UPDATE content_ownership SET owner_id = 'run1' WHERE kind = 'channel' AND id = 'chX'`).run();
			return remove(key);
		}) as typeof remove;
		const first = await eraseRunUserData(full as never, 'run1', new OperationBudget(900));
		assert.deepEqual([first.complete, first.step], [false, 0]);
		const second = await eraseRunUserData(full as never, 'run1', new OperationBudget(900), {}, first.step);
		assert.equal(second.complete, true);
		assert.equal(env.channels.store.has('chX'), false);
		assert.equal(JSON.stringify(db.db.prepare('SELECT * FROM channel_move_offers').all()).includes('run1'), false);
	});

	it('a channel a move brought before the index followed goes too, and no subscription a move brought stays (CC-6 review)', async () => {
		const db = new SqliteD1();
		const notifications = createSqliteD1();
		const { env } = buckets();
		const full = { ...env, SEARCH_DB: db, NOTIFICATIONS_DB: notifications };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		db.db.prepare(`INSERT INTO channel_move_offers (id, channel_id, from_user_id, to_user_id, status, created_at, expires_at, updated_at) VALUES ('o', 'chX', 'other', 'run1', 'moved', '2026', '2099', '2026')`).run();
		db.db.prepare(`INSERT INTO channel_move_offers (id, channel_id, from_user_id, to_user_id, status, created_at, expires_at, updated_at) VALUES ('open', 'ch1', 'run1', 'other', 'offered', '2026', '2099', '2026')`).run();
		env.channels.store.set('chX', JSON.stringify({ ...JSON.parse(env.channels.store.get('chX')!), userId: 'run1' }));
		const remove = env.profiles.delete.bind(env.profiles);
		env.profiles.delete = (async (key: string) => {
			notifications.raw.prepare(`INSERT INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at) VALUES ('chY', 'chX', 'run1', 's1', 1)`).run();
			return remove(key);
		}) as typeof remove;
		// A pass with no room for the first look goes on in the next
		const none = await eraseRunUserData(full as never, 'run1', new OperationBudget(0));
		assert.deepEqual([none.complete, none.step], [false, 0]);
		assert.equal((db.db.prepare(`SELECT status FROM channel_move_offers WHERE id = 'open'`).get() as { status: string }).status, 'offered', 'nothing was done without room for it');
		assert.equal((await eraseRunUserData(full as never, 'run1', new OperationBudget(900))).complete, true);
		assert.equal(env.channels.store.has('chX'), false);
		assert.equal((notifications.raw.prepare('SELECT COUNT(*) AS n FROM channel_subscriptions').get() as { n: number }).n, 0);
		assert.equal(JSON.stringify(db.db.prepare('SELECT * FROM channel_move_offers').all()).includes('run1'), false);
	});

	it('clears it as the tier owner of its live sessions, not someone else\'s', async () => {
		const db = new SqliteD1();
		const { env } = buckets();
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		for (const [id, owner] of [['s1', 'run1'], ['s2', 'other']]) {
			db.db
				.prepare("INSERT INTO live_sessions (id, stream_id, provider, reason, created_at, owner_id) VALUES (?, 'st', 'selfhosted', 'round_robin', 1, ?)")
				.run(id, owner);
		}
		const result = await eraseRunUserData(full as never, 'run1', new OperationBudget(900));
		assert.equal(result.complete, true);
		assert.deepEqual(db.db.prepare('SELECT id, owner_id FROM live_sessions ORDER BY id').all().map((r) => ({ ...(r as object) })), [
			{ id: 's1', owner_id: null },
			{ id: 's2', owner_id: 'other' },
		]);
	});

	it('resumes from the step where its budget ran out', async () => {
		const db = new SqliteD1();
		const { env } = buckets();
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		const first = await eraseRunUserData(full as never, 'run1', new OperationBudget(3));
		assert.equal(first.complete, false);
		const rest = await eraseRunUserData(full as never, 'run1', new OperationBudget(900), {}, first.step);
		assert.equal(rest.complete, true);
		assert.equal(env.profiles.store.has('run1'), false);
	});

	it('refuses (to be retried) instead of scanning while the index is incomplete', async () => {
		const { env, scans } = buckets();
		await assert.rejects(eraseRunUserData({ ...env, SEARCH_DB: new SqliteD1() } as never, 'run1', new OperationBudget(900)), OwnershipIndexIncomplete);
		assert.deepEqual(scans, []);
		assert.equal(env.videos.store.size, 3);
	});

	it('run-account erasure jobs go to their own queue; every other job to the admin-jobs queue', () => {
		const admin = { send: async () => undefined };
		const runErase = { send: async () => undefined };
		assert.equal(jobQueueFor({ ADMIN_JOBS_QUEUE: admin, RUN_ERASE_QUEUE: runErase }, 'user.erase-run'), runErase);
		assert.equal(jobQueueFor({ ADMIN_JOBS_QUEUE: admin, RUN_ERASE_QUEUE: runErase }, 'user.delete-data'), admin);
		assert.equal(jobQueueFor({ ADMIN_JOBS_QUEUE: admin }, 'user.erase-run'), admin, 'without the binding (stage) it shares the admin-jobs queue');
	});

	it('logs a warning and reports an error when ADMIN_BACKUPS is unbound', async () => {
		const db = new SqliteD1();
		const { env } = buckets();
		delete (env as { ADMIN_BACKUPS?: unknown }).ADMIN_BACKUPS;
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });

		const warnings: unknown[][] = [];
		const realWarn = logger.warn.bind(logger);
		logger.warn = ((...args: unknown[]) => {
			warnings.push(args);
		}) as never;
		try {
			const result = await eraseRunUserData(full as never, 'run1', new OperationBudget(900));
			assert.equal(result.complete, true);
			assert.deepEqual(result.errors, [ADMIN_BACKUPS_UNBOUND_ERROR]);
			assert.ok(warnings.some((args) => String(args[0]).includes('ADMIN_BACKUPS is not bound')));
		} finally {
			logger.warn = realWarn;
		}
	});
});
