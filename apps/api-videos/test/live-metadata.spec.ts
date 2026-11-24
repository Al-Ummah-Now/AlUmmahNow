/**
 * The upcoming model (SEARCH_DB.live_stream_metadata, wiki E17 §4): the projection of a live stream's
 * R2 record, its order guard, its hydration, and the purge, erasure and export of chat and reminders.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { liveMetadataStatements, projectLiveMetadata, syncLiveMetadata, syncOwnership } from '@al-ummah/shared-types';
import { withSearchSync } from '../src/lib/search/sync';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { repairObject } from '../src/lib/search/repairs';
import { LIVE_HYDRATED_KEY, eraseLiveChat, eraseLiveReminders, exportLiveChat, exportLiveReminders, maintainLiveMetadata, kickLivePurge } from '../src/lib/live/metadata';
import { createTier, saveTier } from '../src/lib/creatorTiers';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { JobsQueue, MemoryBucket, drainJobs } from './helpers';
import { OperationBudget } from '../src/lib/privacy/scan';
import { collectUserData, eraseUserData } from '../src/lib/privacy/user-data';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

const record = (id: string, over: Record<string, unknown> = {}) => ({ id, userId: 'usr_owner', channelId: 'ch1', title: 'Halqa', status: 'scheduled', isPrivate: false, dateCreated: '2026-11-20T10:00:00.000Z', scheduledStartTime: '2026-11-27T18:00:00.000Z', ...over });

type Row = Record<string, unknown>;
const rowOf = (db: SqliteD1, id: string) => db.db.prepare('SELECT * FROM live_stream_metadata WHERE stream_id = ?').get(id) as Row | undefined;

function setup() {
	const db = new SqliteD1();
	const ndb = createSqliteD1() as any;
	const pending: Promise<unknown>[] = [];
	const raw = { videos: new MemoryBucket(), channels: new MemoryBucket(), playlists: new MemoryBucket(), community_posts: new MemoryBucket(), SEARCH_DB: db, NOTIFICATIONS_DB: ndb, ADMIN_JOBS_QUEUE: new JobsQueue() } as any;
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => void pending.push(p) });
	return { db, ndb, raw, env, settle: async () => { while (pending.length) await pending.shift(); } };
}

const put = (env: any, value: { id: string }) => env.videos.put(`livestream:${value.id}`, JSON.stringify(value));

function chat(db: SqliteD1, id: string, stream: string, user: string, at: number, status = 'published', pinned = 0) {
	db.db.prepare('INSERT INTO live_chat_messages (id, stream_id, user_id, author_name, text, status, is_pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, stream, user, 'Name', 'text', status, pinned, at, at);
}

describe('projection', () => {
	it('follows every write of the record through the wrapped bucket', async () => {
		const { db, env } = setup();
		await put(env, record('s1', { eventType: 'halqa', slowModeSeconds: 10, subscribersOnly: true, madeForKids: true }));
		const row = rowOf(db, 's1')!;
		assert.equal(row.visibility, 'public');
		assert.equal(row.event_type, 'halqa');
		assert.equal(row.scheduled_start_at, Date.parse('2026-11-27T18:00:00.000Z'));
		assert.deepEqual([row.slow_mode_seconds, row.subscribers_only, row.made_for_kids, row.allow_chat], [10, 1, 1, 1]);
		await put(env, record('s1', { isPrivate: true, status: 'ended' }));
		assert.deepEqual([rowOf(db, 's1')!.visibility, rowOf(db, 's1')!.status, rowOf(db, 's1')!.event_type], ['private', 'ended', null]);
		// A held recording (VR9), until the stream is really on air again
		await put(env, record('s1', { status: 'ended', sessionId: 'x', review: { status: 'in_review' } }));
		assert.equal(rowOf(db, 's1')!.recording_withheld, 1);
		await put(env, record('s1', { status: 'live', sessionId: 'y', liveAgainSessionId: 'y', review: { status: 'in_review' } }));
		assert.equal(rowOf(db, 's1')!.recording_withheld, 0);
		await put(env, record('s1', { isHidden: true, isPrivate: true }));
		assert.equal(rowOf(db, 's1')!.visibility, 'hidden');
	});

	it('keeps the columns that belong to D1', async () => {
		const { db, env } = setup();
		await put(env, record('s1'));
		db.db.exec("UPDATE live_stream_metadata SET reminder_count = 7, heads_up_for = 5 WHERE stream_id = 's1'");
		await put(env, record('s1', { title: 'New', status: 'live' }));
		assert.deepEqual([rowOf(db, 's1')!.reminder_count, rowOf(db, 's1')!.heads_up_for], [7, 5]);
	});

	it('an older copy never overwrites a newer one, and a delete is final', async () => {
		const db = new SqliteD1() as any;
		await syncOwnership(db, 'stream', 's1', record('s1', { isPrivate: true }), 2000, 2000);
		await syncLiveMetadata(db, 's1', record('s1', { isPrivate: true }), 2000);
		// A rebuild page that read the stream while it was still public
		await syncLiveMetadata(db, 's1', record('s1'), 1000);
		assert.equal(rowOf(db, 's1')!.visibility, 'private');
		await syncOwnership(db, 'stream', 's1', null, 3000, 3000);
		await syncLiveMetadata(db, 's1', null, 3000);
		await syncLiveMetadata(db, 's1', record('s1'), 2500);
		assert.deepEqual([rowOf(db, 's1')!.visibility, rowOf(db, 's1')!.purge_pending], ['deleted', 1]);
		db.db.exec('DELETE FROM live_stream_metadata');
		await syncLiveMetadata(db, 's1', record('s1'), 2500);
		assert.equal(rowOf(db, 's1'), undefined, 'a late copy does not bring a purged stream back');
	});

	it('an unchanged record at the same version writes nothing', async () => {
		const db = new SqliteD1() as any;
		const run = async () => (await liveMetadataStatements(db, 's1', record('s1'), 1000)[0].run()) as { meta: { changes: number } };
		assert.equal((await run()).meta.changes, 1);
		assert.equal((await run()).meta.changes, 0);
	});

	it('no stored record can fail the write: missing owner, channel, dates and unknown values have fallbacks', async () => {
		const db = new SqliteD1() as any;
		for (const [i, raw] of [{}, { id: 'x1', userId: 5, channelId: null, status: 'weird', kind: 'x', eventType: 'circle', dateCreated: 'nope', slowModeSeconds: 3 }].entries()) {
			const id = `x${i}`;
			await syncLiveMetadata(db, id, raw, 1);
			assert.deepEqual([rowOf(db, id)!.owner_id, rowOf(db, id)!.status, rowOf(db, id)!.created_at], [null, 'scheduled', 0]);
		}
		assert.equal(projectLiveMetadata('s1', { id: 'other' }), null);
	});

	it('the rebuild pass fills the model, and one odd record does not stop the pass', async () => {
		const { db, raw } = setup();
		await raw.videos.put('livestream:s1', JSON.stringify(record('s1')));
		await raw.videos.put('livestream:s2', JSON.stringify({ id: 's2', title: 'no owner, no dates' }));
		const step = await runOwnershipPass(raw, 'stream', { maxPages: 5 });
		assert.equal(step.done, true);
		assert.equal(rowOf(db, 's1')!.scheduled_start_at, Date.parse('2026-11-27T18:00:00.000Z'));
		assert.ok(rowOf(db, 's2'));
	});

	it('a repair writes the row, above a tombstone when R2 says the stream exists', async () => {
		const { db, raw } = setup();
		await raw.videos.put('livestream:s1', JSON.stringify(record('s1')));
		db.db.prepare('INSERT INTO search_tombstones (entity, id, version) VALUES (?, ?, ?)').run('own:stream', 's1', Date.now() + 60_000);
		await repairObject(raw, { entity: 'stream', id: 's1', key: 'livestream:s1' });
		assert.equal(rowOf(db, 's1')!.visibility, 'public');
	});
});

describe('migration', () => {
	it('seeds existing streams with their visibility, at a version any real write beats', async () => {
		const db = new DatabaseSync(':memory:');
		const dir = join(__dirname, '..', 'migrations', 'search');
		const { readdirSync } = await import('node:fs');
		const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
		const at = files.findIndex((f) => f.includes('live_in_apps'));
		for (const f of files.slice(0, at)) db.exec(readFileSync(join(dir, f), 'utf8'));
		const add = db.prepare('INSERT INTO content_ownership (kind, id, owner_id, channel_id, is_public, is_hidden, is_deleted, is_live, views, created_at, updated_at, indexed_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, ?)');
		add.run('stream', 'pub', 'u', 'c', 1, 0, 0, 1, 2, 'live');
		add.run('stream', 'priv', 'u', null, 0, 0, 0, null, null, 'scheduled');
		add.run('stream', 'hid', null, null, 0, 1, 0, null, null, null);
		add.run('stream', 'del', 'u', 'c', 1, 1, 1, 1, 1, 'ended');
		add.run('video', 'vid', 'u', 'c', 1, 0, 0, 1, 1, null);
		db.exec(readFileSync(join(dir, files[at]), 'utf8'));
		const rows = db.prepare('SELECT stream_id, visibility, status, source_version FROM live_stream_metadata ORDER BY stream_id').all().map((r) => Object.values(r as Row));
		assert.deepEqual(rows, [['del', 'deleted', 'ended', 0], ['hid', 'hidden', 'scheduled', 0], ['priv', 'private', 'scheduled', 0], ['pub', 'public', 'live', 0]]);
	});
});

describe('upkeep', () => {
	it('queues one hydration, once', async () => {
		const { db, raw } = setup();
		assert.deepEqual(await maintainLiveMetadata(raw), { hydration: true, purge: false });
		assert.ok(db.db.prepare('SELECT 1 FROM search_meta WHERE key = ?').get(LIVE_HYDRATED_KEY));
		assert.deepEqual(await maintainLiveMetadata(raw), { hydration: false, purge: false });
	});

	it('a rebuild already under way is not counted as the hydration', async () => {
		const { raw } = setup();
		const { startOwnershipRebuild } = await import('../src/lib/search/ownershipRebuild');
		await startOwnershipRebuild(raw, 'stream', 'system');
		assert.equal((await maintainLiveMetadata(raw)).hydration, false);
	});

	it('a deleted stream is closed at once; the job removes its chat and reminders, then the row', async () => {
		const { db, ndb, raw, env, settle } = setup();
		await put(env, record('s1'));
		await put(env, record('s2'));
		for (let i = 0; i < 1203; i++) chat(db, `m${i}`, 's1', 'u1', i);
		chat(db, 'keep', 's2', 'u1', 1);
		await ndb.prepare('INSERT INTO live_reminders (stream_id, user_id, created_at) VALUES (?, ?, ?)').bind('s1', 'u1', 1).run();
		await ndb.prepare('INSERT INTO live_reminders (stream_id, user_id, created_at) VALUES (?, ?, ?)').bind('s2', 'u1', 1).run();
		await env.videos.delete('livestream:s1');
		assert.deepEqual([rowOf(db, 's1')!.visibility, rowOf(db, 's1')!.purge_pending], ['deleted', 1]);
		await settle();
		await drainJobs(raw);
		assert.equal(rowOf(db, 's1'), undefined);
		assert.deepEqual(db.db.prepare('SELECT id FROM live_chat_messages').all().map((r) => (r as Row).id), ['keep']);
		assert.deepEqual((await ndb.prepare('SELECT stream_id FROM live_reminders').all()).results, [{ stream_id: 's2' }]);
	});

	it('a lost kick is found by the hourly cron', async () => {
		const { db, raw } = setup();
		await syncLiveMetadata(db as never, 's1', record('s1'), 1);
		await syncLiveMetadata(db as never, 's1', null, 2);
		assert.equal((await maintainLiveMetadata(raw)).purge, true);
		await drainJobs(raw);
		assert.equal(rowOf(db, 's1'), undefined);
	});

	it('only one purge job is active at a time', async () => {
		const { raw } = setup();
		const first = await kickLivePurge(raw);
		assert.equal((await kickLivePurge(raw))!.id, first!.id);
		assert.ok(ADMIN_JOB_HANDLERS['live.purge-streams']);
	});
});

describe('the person’s own data', () => {
	it('exports every message and reminder, page by page, and erases all of them', async () => {
		const { db, ndb } = setup();
		// Two pages, with many messages in the same millisecond across the page edge
		for (let i = 0; i < 750; i++) chat(db, `m${String(i).padStart(4, '0')}`, 's1', 'me', 5, i % 3 ? 'published' : 'held');
		chat(db, 'other', 's1', 'them', 5);
		for (let i = 0; i < 3; i++) await ndb.prepare('INSERT INTO live_reminders (stream_id, user_id, created_at) VALUES (?, ?, ?)').bind(`s${i}`, 'me', 5).run();
		const seen = new Set<unknown>();
		let cursor: string | null = null;
		do {
			const page: { rows: Row[]; cursor: string | null } = await exportLiveChat(db as never, 'me', cursor);
			page.rows.forEach((r) => seen.add(r.id));
			cursor = page.cursor;
		} while (cursor);
		assert.equal(seen.size, 750);
		assert.equal((await exportLiveReminders(ndb, 'me', null)).rows.length, 3);
		while ((await eraseLiveChat(db as never, 'me')) > 0);
		while ((await eraseLiveReminders(ndb, 'me')) > 0);
		assert.equal(db.count('live_chat_messages'), 1);
		assert.deepEqual((await exportLiveReminders(ndb, 'me', null)).rows, []);
	});
});

describe('account export and erasure', () => {
	it('include live chat and reminders, resumed when the budget runs out; an owned stream goes with its chat', async () => {
		const { db, ndb, raw, env, settle } = setup();
		for (const b of ['watch_history', 'upload-defaults', 'channel_sections', 'channel_tabs', 'reports', 'profiles', 'subtitles', 'global_settings']) (env as any)[b] = new MemoryBucket();
		(env as any).INTERNAL_API_KEY = 'k'.repeat(40);
		await put(env, record('mine', { userId: 'me', channelId: null }));
		await put(env, record('theirs'));
		for (let i = 0; i < 1100; i++) chat(db, `m${String(i).padStart(4, '0')}`, 'theirs', 'me', i);
		chat(db, 'kept', 'theirs', 'them', 1);
		chat(db, 'guest', 'mine', 'them', 1);
		await ndb.prepare('INSERT INTO live_reminders (stream_id, user_id, created_at) VALUES (?, ?, ?)').bind('theirs', 'me', 1).run();
		const ids = new Set<unknown>();
		let exportToken: string | undefined;
		for (let round = 0; round < 60; round++) {
			const part = await collectUserData(env as never, 'me', new OperationBudget(6), { resumeToken: exportToken });
			part.liveChatMessages.forEach((m) => ids.add(m.id));
			if (part.complete) break;
			exportToken = part.resumeToken;
		}
		assert.equal(ids.size, 1100);
		let token: string | undefined;
		for (let round = 0; round < 60; round++) {
			const result = await eraseUserData(env as never, 'me', new OperationBudget(14), {}, { resumeToken: token } as never);
			if (result.complete) break;
			token = result.resumeToken;
		}
		await settle();
		await drainJobs(raw);
		assert.deepEqual(db.db.prepare('SELECT id FROM live_chat_messages').all().map((r) => (r as Row).id), ['kept']);
		assert.deepEqual((await ndb.prepare('SELECT * FROM live_reminders').all()).results, []);
		assert.equal(rowOf(db, 'mine'), undefined);
		assert.ok(rowOf(db, 'theirs'));
	});
});

describe('query plans: never a scan', () => {
	it('search D1', async () => {
		const { db, raw, env, settle } = setup();
		await put(env, record('s1'));
		chat(db, 'm1', 's1', 'me', 1);
		db.trace = [];
		await exportLiveChat(db as never, 'me', null);
		await eraseLiveChat(db as never, 'nobody');
		await env.videos.delete('livestream:s1');
		await settle();
		await maintainLiveMetadata(raw);
		await drainJobs(raw);
		const live = db.trace.filter((q) => /live_(chat_messages|stream_metadata)/.test(q.sql));
		const later = [
			// E17-2 chat, E17-2 retention, E17-3 crons, E22 calendar
			{ sql: "SELECT id FROM live_chat_messages WHERE stream_id = ? AND status = 'published' ORDER BY created_at DESC, id DESC LIMIT 100", params: ['s'] },
			{ sql: "SELECT id FROM live_chat_messages WHERE stream_id = ? AND status = 'published' AND (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT 100", params: ['s', 1, 'a'] },
			{ sql: "SELECT id FROM live_chat_messages WHERE stream_id = ? AND status = 'published' AND offset_ms BETWEEN ? AND ? ORDER BY offset_ms, id LIMIT 200", params: ['s', 0, 1] },
			{ sql: 'SELECT id FROM live_chat_messages WHERE stream_id = ? AND user_id = ? AND created_at > ?', params: ['s', 'u', 1] },
			{ sql: 'SELECT id FROM live_chat_messages WHERE stream_id = ? AND is_pinned = 1', params: ['s'] },
			{ sql: "SELECT id FROM live_chat_messages WHERE status IN ('held', 'removed') AND updated_at < ? LIMIT 500", params: [1] },
			{ sql: "SELECT stream_id FROM live_stream_metadata WHERE status = 'scheduled' AND scheduled_start_at <= ? AND kind = 'premiere' LIMIT 50", params: [1], index: 'idx_live_stream_meta_premiere_due' },
			{ sql: "SELECT stream_id FROM live_stream_metadata WHERE event_type = ? AND status IN ('live', 'scheduled') ORDER BY scheduled_start_at LIMIT 50", params: ['halqa'] },
			{ sql: "SELECT stream_id FROM live_stream_metadata WHERE channel_id = ? AND status IN ('live', 'scheduled') ORDER BY scheduled_start_at LIMIT 50", params: ['c'] },
			{ sql: 'SELECT stream_id FROM live_stream_metadata WHERE premiere_video_id = ?', params: ['v'] },
		];
		assert.ok(live.length >= 6);
		for (const query of [...live, ...later]) {
			if (/^\s*INSERT/i.test(query.sql)) continue;
			const plan = db.plan(query).join(' ; ');
			// purge_pending = 1 reads only the rows of its partial index
			const ok = !/\bSCAN\b/.test(plan) || /SCAN live_stream_metadata USING (COVERING )?INDEX idx_live_stream_meta_purge/.test(plan);
			assert.ok(ok, `${query.sql}\n${plan}`);
			const { index } = query as { index?: string };
			if (index) assert.ok(plan.includes(index), `${query.sql}\n${plan}`);
		}
	});
});

describe('tiers', () => {
	it('a capability left unset follows live when it is turned on later; a set one stays', async () => {
		const db = new SqliteD1() as any;
		const { tier } = await createTier(db, { name: 'Basic', uploads: true, channels: true, perHour: 5, perDay: 20, maxConcurrent: 2, live: false, liveEvents: false }, 'admin');
		assert.equal(tier.liveChat, undefined);
		const on = (await saveTier(db, tier.id, { live: true }, 'admin')).tier;
		assert.deepEqual([on.liveChat, on.livePremieres, on.liveEvents], [undefined, undefined, false]);
		const set = (await saveTier(db, tier.id, { liveChat: false }, 'admin')).tier;
		assert.equal(set.liveChat, false);
		const back = (await saveTier(db, tier.id, { liveChat: null, live: false }, 'admin')).tier;
		assert.equal(back.liveChat, undefined);
		await assert.rejects(saveTier(db, tier.id, { liveChat: 'yes' }, 'admin'));
	});
});
