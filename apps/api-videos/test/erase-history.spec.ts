import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_TITLES_VERSION, archiveSubjectKey, MessageType } from '@al-ummah/shared-types';
import { createJob, handleAdminJobBatch, jobUserIds, type JobMessage } from '../src/lib/admin/jobs';
import { runArchiveTitlesPage } from '../src/lib/archivePrivacyRewrite';
import { MemoryBucket, MemoryQueue } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

/**
 * #1253: admin jobs record the users they name (the erasure's indexed lookup), and an erasure job
 * stops naming its account once it succeeds. #1254: the titles pass links older archive entries to
 * their content's owners, and replaces the titles of content that no longer exists.
 */

const CREATOR = 'usr_0123456789abcdef0123456789abcdef';
const ADMIN = 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function message(jobId: string): JobMessage & { acked: boolean } {
	const m = { body: { payload: { jobId } }, attempts: 1, acked: false, ack() { m.acked = true; }, retry() {} };
	return m as never;
}

describe('admin jobs name their users (#1253)', () => {
	it('links the actor, a user target and user ids in params', async () => {
		const db = new SqliteD1();
		const env = { SEARCH_DB: db, ADMIN_JOBS_QUEUE: new MemoryQueue() };
		const job = await createJob(env as never, { kind: 'video.purge', targetKind: 'video', targetId: 'vid_1', params: { userId: CREATOR, channelId: 'ch_1' }, actorId: ADMIN });
		assert.deepEqual(jobUserIds(job).sort(), [ADMIN, CREATOR].sort());
		const links = db.db.prepare('SELECT user_id FROM admin_job_users WHERE job_id = ? ORDER BY user_id').all(job.id).map((r) => r.user_id);
		assert.deepEqual(links, [CREATOR, ADMIN].sort());
	});

	it('an erasure job that succeeds keeps the action but not the account id', async () => {
		const db = new SqliteD1();
		const env = { SEARCH_DB: db, ADMIN_JOBS_QUEUE: new MemoryQueue() };
		const job = await createJob(env as never, { kind: 'user.delete-data', targetKind: 'user', targetId: CREATOR, actorId: ADMIN });
		const m = message(job.id);
		await handleAdminJobBatch({ messages: [m] }, env as never, { 'user.delete-data': async () => ({ done: true, result: { deletedVideos: 2 } }) });
		assert.ok(m.acked);
		const row = db.db.prepare('SELECT status, target_id, actor_id FROM admin_jobs WHERE id = ?').get(job.id);
		assert.deepEqual({ ...row }, { status: 'succeeded', target_id: 'deleted-user', actor_id: ADMIN });
		assert.deepEqual(db.db.prepare('SELECT user_id FROM admin_job_users WHERE job_id = ?').all(job.id).map((r) => r.user_id), [ADMIN]);
	});
});

describe('archive titles pass (#1254)', () => {
	class Archive extends MemoryBucket {
		meta = new Map<string, Record<string, string> | undefined>();
		async put(key: string, body: unknown, options?: { customMetadata?: Record<string, string> }) {
			this.meta.set(key, options?.customMetadata);
			return super.put(key, body as never);
		}
		async list(opts: { prefix?: string; limit?: number }) {
			const listed = await super.list(opts as never);
			return { ...listed, objects: listed.objects.map((o: { key: string }) => ({ ...o, customMetadata: this.meta.get(o.key) })) };
		}
	}

	async function seed() {
		const archive = new Archive();
		const put = (key: string, record: unknown, customMetadata?: Record<string, string>) => archive.put(key, JSON.stringify(record), { customMetadata });
		await put('2026-11-01T10-00-00.a', { type: MessageType.VideoView, payload: { videoId: 'vid_1', videoTitle: 'Kept title', viewerId: 'ps_1' } });
		await put('2026-11-01T10-00-01.b', { type: MessageType.VideoView, payload: { videoId: 'vid_gone', videoTitle: 'Gone title' } });
		await put('2026-11-01T10-00-02.c', { type: MessageType.VideoLike, payload: { videoId: 'vid_1' } });
		await put('2026-11-01T10-00-03.d', { type: MessageType.VideoView, payload: { videoId: 'vid_1', videoTitle: 'New' } }, { titles: ARCHIVE_TITLES_VERSION });
		const env = {
			videos: new MemoryBucket({ vid_1: { id: 'vid_1', userId: CREATOR, channelId: 'ch_1' } }),
			channels: new MemoryBucket({}),
			NOTIFICATIONS_DB: undefined as unknown,
		};
		return { archive, env };
	}

	it('dry run counts and writes nothing', async () => {
		const { archive, env } = await seed();
		const { counts } = await runArchiveTitlesPage(archive as never, env as never, { dryRun: true, limit: 100 }, '2026-11-01', null);
		assert.deepEqual(counts, { listed: 4, stamped: 1, clean: 1, rewritten: 1, deleted: 0, unreadable: 0, indexed: 1 });
		assert.equal(JSON.parse((await (await archive.get('2026-11-01T10-00-01.b'))!.text())).payload.videoTitle, 'Gone title');
	});

	it('applied: links titles to the owner and replaces those of content that is gone', async () => {
		const { archive, env } = await seed();
		const refs: unknown[][] = [];
		env.NOTIFICATIONS_DB = {
			prepare: () => ({ bind: (...args: unknown[]) => ({ args }) }),
			batch: async (statements: Array<{ args: unknown[] }>) => void refs.push(...statements.map((s) => s.args)),
		};
		await runArchiveTitlesPage(archive as never, env as never, { dryRun: false, limit: 100 }, '2026-11-01', null, 5);
		assert.deepEqual(refs, [[await archiveSubjectKey(CREATOR), '2026-11-01T10-00-00.a', 5]]);
		const read = async (k: string) => JSON.parse(await (await archive.get(k))!.text());
		assert.equal((await read('2026-11-01T10-00-00.a')).payload.videoTitle, 'Kept title');
		assert.equal((await read('2026-11-01T10-00-01.b')).payload.videoTitle, 'erased video');
		assert.equal(archive.meta.get('2026-11-01T10-00-00.a')?.titles, ARCHIVE_TITLES_VERSION);
		assert.equal(archive.meta.get('2026-11-01T10-00-01.b')?.titles, ARCHIVE_TITLES_VERSION);
		// Entries without titles are not rewritten
		assert.equal(archive.meta.get('2026-11-01T10-00-02.c'), undefined);
	});
});
