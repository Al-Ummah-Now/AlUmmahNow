/**
 * #716: a revoked invite's videos-side data (provisioned profile, channels made for it, its creator
 * tier) once auth purged the invited account. admin-api's trash cleanup calls
 * POST /api/admin/users/:id/erase-revoked-invite (lib/admin/service.ts eraseRevokedInviteUser).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eraseRevokedInviteUser } from '../src/lib/admin/service';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const ACTOR = 'system:trash-cleanup';

class JobQueue {
	sent: any[] = [];
	async send(body: unknown) {
		this.sent.push(body);
	}
	async sendBatch(messages: { body: unknown }[]) {
		for (const m of messages) this.sent.push(m.body);
	}
}

function env() {
	return {
		SEARCH_DB: new SqliteD1(),
		ADMIN_JOBS_QUEUE: new JobQueue(),
		profiles: new MemoryBucket(),
		channels: new MemoryBucket(),
		videos: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		queue: new JobQueue(),
	} as any;
}

async function seedTier(db: SqliteD1, userId: string) {
	await db.prepare("INSERT INTO creator_tiers (id, name, unlimited, per_hour, per_day, max_concurrent) VALUES ('t1', 'Creator', 0, 5, 20, 2)").run();
	await db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES (?, 't1', 'admin', 'usr_admin', '2026-11-01T00:00:00.000Z')").bind(userId).run();
}

const deletions = async (db: SqliteD1) =>
	(await db.prepare("SELECT target_id, deleted_by, purge_requested_at IS NOT NULL AS queued, purge_started_at IS NOT NULL AS started FROM admin_deletions WHERE kind = 'user'").all()).results as any[];
const eraseJobs = async (db: SqliteD1) => (await db.prepare("SELECT target_id FROM admin_jobs WHERE kind = 'user.delete-data'").all()).results as any[];

describe('revoked invite erase (#716)', () => {
	it('erases the provisioned profile and the channels made for the invite, and removes its tier', async () => {
		const e = env();
		await e.profiles.put('usr_inv', JSON.stringify({ id: 'usr_inv', displayName: 'Invited creator' }));
		await e.SEARCH_DB.prepare("INSERT INTO content_ownership (kind, id, owner_id, channel_id, handle) VALUES ('channel', 'ch_inv', 'usr_inv', 'ch_inv', 'invited')").run();
		await seedTier(e.SEARCH_DB, 'usr_inv');

		assert.deepEqual(await eraseRevokedInviteUser(e, 'usr_inv', ACTOR), { erased: true, tierRemoved: true });
		// The admin erase path: soft delete by the cleanup, purge started at once, user.delete-data queued
		assert.deepEqual((await deletions(e.SEARCH_DB)).map((d) => [d.target_id, d.deleted_by, d.queued, d.started]), [['usr_inv', ACTOR, 1, 1]]);
		assert.deepEqual((await eraseJobs(e.SEARCH_DB)).map((j) => j.target_id), ['usr_inv']);
		assert.equal(await e.SEARCH_DB.prepare('SELECT 1 FROM creator_tier_assignments WHERE user_id = ?').bind('usr_inv').first(), null);
	});

	it('erases channels made for an invite that never got a profile', async () => {
		const e = env();
		await e.SEARCH_DB.prepare("INSERT INTO content_ownership (kind, id, owner_id, channel_id) VALUES ('channel', 'ch_only', 'usr_noprof', 'ch_only')").run();
		assert.deepEqual(await eraseRevokedInviteUser(e, 'usr_noprof', ACTOR), { erased: true, tierRemoved: false });
		assert.equal((await deletions(e.SEARCH_DB)).length, 1);
	});

	it('is idempotent: a second run finds the purge started and queues nothing new', async () => {
		const e = env();
		await e.profiles.put('usr_inv', JSON.stringify({ id: 'usr_inv' }));
		await eraseRevokedInviteUser(e, 'usr_inv', ACTOR);
		assert.deepEqual(await eraseRevokedInviteUser(e, 'usr_inv', ACTOR), { erased: true, tierRemoved: false });
		assert.equal((await deletions(e.SEARCH_DB)).length, 1);
		assert.equal((await eraseJobs(e.SEARCH_DB)).length, 1);
	});

	it('records nothing when the invite left nothing behind (only removes a tier)', async () => {
		const e = env();
		assert.deepEqual(await eraseRevokedInviteUser(e, 'usr_none', ACTOR), { erased: false, tierRemoved: false });
		await seedTier(e.SEARCH_DB, 'usr_tier');
		assert.deepEqual(await eraseRevokedInviteUser(e, 'usr_tier', ACTOR), { erased: false, tierRemoved: true });
		assert.deepEqual(await deletions(e.SEARCH_DB), []);
		assert.equal(e.ADMIN_JOBS_QUEUE.sent.length, 0);
	});
});
