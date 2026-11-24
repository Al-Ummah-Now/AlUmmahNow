/**
 * Admin job "Restore legacy profile fields" (lib/admin/legacy-restore.ts): the
 * dry run, the backup, the conditional apply and the job through the admin-jobs
 * queue, over in-memory R2, a SQLite search DB (admin_jobs) and a SQLite stand-in
 * for the auth service's users table.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import adminRouter from '../src/routers/admin.router';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import {
	ADMIN_BACKUPS_UNBOUND_ERROR,
	LEGACY_RESTORE_POINTERS_PREFIX,
	approvedFromPlan,
	backupKey,
	backupKeyFromPointer,
	backupPointerKey,
	eraseLegacyRestoreBackups,
	planLegacyRestore,
	runLegacyRestore,
	type AuthUsersDb,
} from '../src/lib/admin/legacy-restore';
import { recordDeletion } from '../src/lib/admin/deletions';
import { logger } from '../src/lib/logger';
import { eraseUserData } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const LEGACY = '4b623aeb45eb610c8c72cca719e0f6c7';
const USR = 'usr_3a7c71348b164b84a3a4acb3962937e6';
const INTRUDER = 'usr_00000000000000000000000000000009';

/** The auth service's users table (only what the job reads). */
class AuthDb implements AuthUsersDb {
	db = new DatabaseSync(':memory:');
	queries: string[] = [];
	constructor(rows: { id: string; email: string; deleted?: boolean }[]) {
		this.db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, deleted_at TEXT)');
		for (const r of rows) this.db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(r.id, r.email, r.deleted ? '2026-01-01' : null);
	}
	prepare(sql: string) {
		this.queries.push(sql);
		const db = this.db;
		return { bind: (...values: unknown[]) => ({ all: async <T>() => ({ results: db.prepare(sql).all(...(values as string[])) as T[] }) }) };
	}
}

const legacyRecord = {
	id: LEGACY,
	email: 'owner@example.com',
	firstName: 'محمود',
	lastName: 'درويش',
	avatarUrl: `https://images.alummahnow.net//${LEGACY}_avatar.jpeg`,
	coverUrl: 'https://images.alummahnow.net/d591332e_cover.jpeg',
};
const currentProfile = {
	id: USR,
	email: 'Owner@Example.com',
	firstName: 'Mahmoud',
	firstNameLocalized: { en: 'Mahmoud', ar: '' },
	lastName: 'Darwish',
	lastNameLocalized: { en: 'Darwish', ar: '' },
	avatarUrl: 'https://images.alummahnow.net/bbaaa5e7_avatar.jpeg',
	coverUrl: 'https://images.alummahnow.net/5f09f3bb_cover.jpeg',
	channels: ['ch1'],
};

function setup(opts: { profiles?: Record<string, unknown>; users?: { id: string; email: string; deleted?: boolean }[] } = {}) {
	const jobs: { body: unknown; attempts: number }[] = [];
	const env = {
		SEARCH_DB: new SqliteD1(),
		profiles: new MemoryBucket(opts.profiles ?? { [LEGACY]: legacyRecord, [USR]: currentProfile, usr_ffffffffffffffffffffffffffffffff: { id: 'x', email: 'other@example.com' } }),
		ADMIN_BACKUPS: new MemoryBucket(),
		AUTH_DB: new AuthDb(opts.users ?? [{ id: USR, email: 'OWNER@example.com' }]),
		ADMIN_JOBS_QUEUE: { send: async (body: unknown) => { jobs.push({ body, attempts: 1 }); } },
	};
	const app = new Hono();
	app.route('/internal/admin', adminRouter);
	const call = async (method: string, path: string, body?: unknown) => {
		const res = await app.request(`/internal/admin${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': 'usr_admin' },
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		}, env);
		return { status: res.status, body: (await res.json()) as any };
	};
	/** Runs queued job messages like the consumer, retrying failures up to 5 times. */
	const drain = async () => {
		for (let guard = 0; jobs.length && guard < 50; guard++) {
			const d = jobs.shift()!;
			let retried = false;
			const msg: JobMessage = { body: d.body, attempts: d.attempts, ack: () => undefined, retry: () => { retried = true; } };
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS);
			if (retried && d.attempts <= 5) jobs.push({ ...d, attempts: d.attempts + 1 });
		}
	};
	return { env, call, drain, jobs };
}

const stored = (env: ReturnType<typeof setup>['env'], key: string) => JSON.parse((env.profiles as any).store.get(key)) as Record<string, any>;

describe('restore legacy profile fields: dry run', () => {
	it('plans only the empty Arabic name slots, paired on the verified email, and writes nothing', async () => {
		const { env, call } = setup();
		const before = JSON.stringify([...(env.profiles as any).store]);
		const res = await call('GET', '/legacy-profiles/plan');
		assert.equal(res.status, 200);
		assert.deepEqual(res.body.result, {
			legacyCount: 1,
			pairedCount: 1,
			items: [{ id: USR, legacyId: LEGACY, email: 'owner@example.com', changes: [
				{ field: 'firstNameLocalized.ar', from: '', to: 'محمود' },
				{ field: 'lastNameLocalized.ar', from: '', to: 'درويش' },
			] }],
			unmatched: [],
			ambiguousCount: 0,
		});
		assert.equal(JSON.stringify([...(env.profiles as any).store]), before);
		assert.equal((env.ADMIN_BACKUPS as any).store.size, 0);
	});

	it('never pairs on the editable profile email: a profile claiming the legacy email gets nothing', async () => {
		const { call } = setup({
			profiles: { [LEGACY]: legacyRecord, [INTRUDER]: { id: INTRUDER, email: 'owner@example.com' } },
			users: [{ id: INTRUDER, email: 'intruder@example.com' }],
		});
		const plan = (await call('GET', '/legacy-profiles/plan')).body.result;
		assert.deepEqual(plan.items, []);
		assert.deepEqual(plan.unmatched, [LEGACY]);
	});

	it('leaves deleted accounts and ambiguous emails alone (counted, not listed)', async () => {
		const deleted = await planLegacyRestore(setup({ users: [{ id: USR, email: 'owner@example.com', deleted: true }] }).env as never);
		assert.deepEqual(deleted.items, []);
		const second = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
		const dup = await planLegacyRestore(setup({ profiles: { [LEGACY]: legacyRecord, [second]: { ...legacyRecord, id: second }, [USR]: currentProfile } }).env as never);
		assert.deepEqual(dup.items, []);
		assert.equal(dup.ambiguousCount, 1);
	});

	it('refuses without the auth database (no verified emails, no pairing)', async () => {
		const { env, call } = setup();
		delete (env as any).AUTH_DB;
		const res = await call('GET', '/legacy-profiles/plan');
		assert.equal(res.status, 503);
		assert.equal(res.body.code, 'auth_db_unbound');
	});
});

describe('restore legacy profile fields: run', () => {
	it('queues a job that backs up the profile, then fills only the approved, still-empty fields', async () => {
		const { env, call, drain } = setup();
		const plan = (await call('GET', '/legacy-profiles/plan')).body.result;
		const start = await call('POST', '/legacy-profiles/restore', { approved: [{ id: USR, legacyId: LEGACY, fields: plan.items[0].changes.map((c: any) => c.field) }] });
		assert.equal(start.status, 200);
		const { job } = start.body.result;
		assert.equal(job.kind, 'profiles.restore-legacy');
		assert.equal(job.actorId, 'usr_admin');
		const etagBefore = (env.profiles as any).etag(USR);
		await drain();

		const after = stored(env, USR);
		assert.equal(after.firstNameLocalized.ar, 'محمود');
		assert.equal(after.lastNameLocalized.ar, 'درويش');
		// nothing else changed: photos, plain names, channels
		assert.equal(after.avatarUrl, currentProfile.avatarUrl);
		assert.equal(after.coverUrl, currentProfile.coverUrl);
		assert.equal(after.firstName, 'Mahmoud');
		assert.deepEqual(after.channels, ['ch1']);

		// the pre-change copy, byte for byte, under the job's prefix, plus its per-user pointer
		const key = backupKey(job.id, USR, etagBefore);
		const pointer = backupPointerKey(USR, job.id, etagBefore);
		assert.deepEqual(JSON.parse((env.ADMIN_BACKUPS as any).store.get(key)), currentProfile);
		assert.equal((env.ADMIN_BACKUPS as any).store.has(pointer), true);

		const done = (await call('GET', `/jobs/${job.id}`)).body.result;
		assert.equal(done.status, 'succeeded');
		assert.deepEqual(done.result, { written: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar', 'lastNameLocalized.ar'], backupKey: key }], skipped: [] });

		// idempotent: the dry run is now empty and a second run is refused
		assert.deepEqual((await call('GET', '/legacy-profiles/plan')).body.result.items, []);
		const again = await call('POST', '/legacy-profiles/restore', { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] });
		assert.equal(again.status, 409);
		assert.equal(again.body.code, 'nothing_to_restore');
	});

	it('an admin cannot approve a field the rules would not fill', () => {
		const plan = { legacyCount: 1, pairedCount: 1, unmatched: [], ambiguousCount: 0, items: [{ id: USR, legacyId: LEGACY, email: 'owner@example.com', changes: [{ field: 'firstNameLocalized.ar', from: '', to: 'x' }] }] };
		assert.deepEqual(approvedFromPlan(plan, [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar', 'avatarUrl', 'email'] }]), [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }]);
		assert.deepEqual(approvedFromPlan(plan, [{ id: USR, legacyId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', fields: ['firstNameLocalized.ar'] }]), []);
		assert.deepEqual(approvedFromPlan(plan, [{ id: INTRUDER, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }]), []);
	});

	it('a field the user fills after the dry run is kept, and only approved fields are written', async () => {
		const { env } = setup();
		// approved only the first name; meanwhile the user typed their own Arabic first name
		await (env.profiles as any).put(USR, JSON.stringify({ ...currentProfile, firstNameLocalized: { en: 'Mahmoud', ar: 'مَحمود' } }));
		const job = { id: 'job1', kind: 'profiles.restore-legacy', actorId: 'usr_admin', params: { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] }, result: null } as any;
		const out = await runLegacyRestore(env as never, job);
		assert.deepEqual(out, { done: true, result: { written: [], skipped: [{ id: USR, reason: 'nothing left to fill' }] } });
		assert.equal(stored(env, USR).firstNameLocalized.ar, 'مَحمود');
		assert.equal(stored(env, USR).lastNameLocalized.ar, '');
		assert.equal((env.ADMIN_BACKUPS as any).store.size, 0);
	});

	it('re-checks the verified email when it runs', async () => {
		const { env } = setup({ users: [{ id: USR, email: 'someone-else@example.com' }] });
		const job = { id: 'job2', kind: 'profiles.restore-legacy', actorId: 'a', params: { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] }, result: null } as any;
		const out = await runLegacyRestore(env as never, job);
		assert.deepEqual((out.result as any).skipped, [{ id: USR, reason: 'verified email no longer matches the legacy record' }]);
		assert.equal(stored(env, USR).firstNameLocalized.ar, '');
	});

	it('a concurrent profile write is not lost: it re-reads, backs up the new copy and fills on it', async () => {
		const { env } = setup();
		const bucket = env.profiles as any;
		const realPut = bucket.put.bind(bucket);
		let raced = false;
		bucket.put = async (key: string, value: string, options?: any) => {
			if (key === USR && options?.onlyIf?.etagMatches && !raced) {
				raced = true; // the user saves their bio between our read and our write
				await realPut(USR, JSON.stringify({ ...JSON.parse(bucket.store.get(USR)), bio: 'Mine' }));
			}
			return realPut(key, value, options);
		};
		const job = { id: 'job3', kind: 'profiles.restore-legacy', actorId: 'a', params: { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] }, result: null } as any;
		const out = await runLegacyRestore(env as never, job);
		assert.equal((out.result as any).written.length, 1);
		const after = stored(env, USR);
		assert.equal(after.bio, 'Mine');
		assert.equal(after.firstNameLocalized.ar, 'محمود');
		// one backup and one per-user pointer per copy it tried to replace; the first is the untouched original
		const entries = [...(env.ADMIN_BACKUPS as any).store.entries()] as [string, string][];
		const backups = entries.filter(([k]) => !k.startsWith(LEGACY_RESTORE_POINTERS_PREFIX));
		const pointers = entries.filter(([k]) => k.startsWith(LEGACY_RESTORE_POINTERS_PREFIX));
		assert.equal(backups.length, 2);
		assert.equal(pointers.length, 2);
		assert.ok(backups.some(([, v]) => !JSON.parse(v).bio));
	});

	it('never writes without its backup bucket; the job fails, flags the admin, and Retry resumes it', async () => {
		const { env, call, drain } = setup();
		const backups = env.ADMIN_BACKUPS;
		delete (env as any).ADMIN_BACKUPS;
		const plan = (await call('GET', '/legacy-profiles/plan')).body.result;
		const { job } = (await call('POST', '/legacy-profiles/restore', { approved: [{ id: USR, legacyId: LEGACY, fields: plan.items[0].changes.map((c: any) => c.field) }] })).body.result;
		await drain();
		const failed = (await call('GET', `/jobs/${job.id}`)).body.result;
		assert.equal(failed.status, 'failed');
		assert.match(failed.lastError, /ADMIN_BACKUPS is not bound/);
		assert.equal(stored(env, USR).firstNameLocalized.ar, '');
		assert.equal((await call('GET', '/jobs/counts')).body.result.failed, 1);

		(env as any).ADMIN_BACKUPS = backups;
		assert.equal((await call('POST', `/jobs/${job.id}/retry`)).status, 200);
		await drain();
		assert.equal((await call('GET', `/jobs/${job.id}`)).body.result.status, 'succeeded');
		assert.equal(stored(env, USR).firstNameLocalized.ar, 'محمود');
	});

	it('several profiles run one per step and the result keeps every step', async () => {
		const LEGACY2 = 'cccccccccccccccccccccccccccccccc';
		const USR2 = 'usr_cccccccccccccccccccccccccccccccc';
		const { env, call, drain } = setup({
			profiles: { [LEGACY]: legacyRecord, [USR]: currentProfile, [LEGACY2]: { id: LEGACY2, email: 'b@example.com', bioLocalized: { ar: 'نبذة' } }, [USR2]: { id: USR2, bio: '' } },
			users: [{ id: USR, email: 'owner@example.com' }, { id: USR2, email: 'b@example.com' }],
		});
		const plan = (await call('GET', '/legacy-profiles/plan')).body.result;
		assert.equal(plan.items.length, 2);
		const approved = plan.items.map((i: any) => ({ id: i.id, legacyId: i.legacyId, fields: i.changes.map((c: any) => c.field) }));
		const { job } = (await call('POST', '/legacy-profiles/restore', { approved })).body.result;
		await drain();
		const done = (await call('GET', `/jobs/${job.id}`)).body.result;
		assert.equal(done.status, 'succeeded');
		assert.deepEqual(done.result.written.map((w: any) => w.id).sort(), [USR, USR2].sort());
		assert.equal(stored(env, USR2).bioLocalized.ar, 'نبذة');
	});

	it('rejects malformed requests', async () => {
		const { call } = setup();
		assert.equal((await call('POST', '/legacy-profiles/restore', { approved: [] })).status, 400);
		assert.equal((await call('POST', '/legacy-profiles/restore', { approved: [{ id: 'usr_x', legacyId: LEGACY, fields: ['a'] }] })).status, 400);
	});
});

function erasureBuckets(profiles: MemoryBucket, backups: MemoryBucket) {
	return {
		profiles,
		channels: new MemoryBucket(),
		channel_sections: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		videos: new MemoryBucket(),
		watch_history: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		playlists: new MemoryBucket(),
		'upload-defaults': new MemoryBucket(),
		reports: new MemoryBucket(),
		ADMIN_BACKUPS: backups,
	};
}

describe('restore legacy profile fields: account erasure', () => {
	it('eraseUserData deletes a user\'s legacy-restore copies and pointers without listing the whole prefix', async () => {
		const LEGACY2 = 'cccccccccccccccccccccccccccccccc';
		const USR2 = 'usr_cccccccccccccccccccccccccccccccc';
		const { env, call, drain } = setup({
			profiles: {
				[LEGACY]: legacyRecord,
				[USR]: currentProfile,
				[LEGACY2]: { id: LEGACY2, email: 'b@example.com', bioLocalized: { ar: 'نبذة' } },
				[USR2]: { id: USR2, email: 'b@example.com', bio: '' },
			},
			users: [{ id: USR, email: 'owner@example.com' }, { id: USR2, email: 'b@example.com' }],
		});
		const plan = (await call('GET', '/legacy-profiles/plan')).body.result;
		const approved = plan.items.map((i: any) => ({ id: i.id, legacyId: i.legacyId, fields: i.changes.map((c: any) => c.field) }));
		await call('POST', '/legacy-profiles/restore', { approved });
		await drain();

		// Add a second backup copy + pointer for USR from another job to prove multi-copy deletion
		const secondKey = backupKey('job-earlier', USR, 'v99');
		const secondPtr = backupPointerKey(USR, 'job-earlier', 'v99');
		await env.ADMIN_BACKUPS.put(secondPtr, '');
		await env.ADMIN_BACKUPS.put(secondKey, JSON.stringify(currentProfile));

		const listPrefixes: Array<string | undefined> = [];
		const realList = env.ADMIN_BACKUPS.list.bind(env.ADMIN_BACKUPS);
		env.ADMIN_BACKUPS.list = (async (opts: { prefix?: string } = {}) => {
			listPrefixes.push(opts.prefix);
			return realList(opts as never);
		}) as never;

		const summary = await eraseUserData(erasureBuckets(env.profiles, env.ADMIN_BACKUPS), USR, new OperationBudget(10_000));
		assert.equal(summary.complete, true);
		assert.equal(summary.deleted.legacyRestoreBackups, 2);
		assert.equal(env.profiles.store.has(USR), false);
		assert.ok(listPrefixes.includes(`${LEGACY_RESTORE_POINTERS_PREFIX}${USR}/`), 'listed the user legacy-restore pointer prefix');
		assert.ok(
			listPrefixes.every((p) => p === `${LEGACY_RESTORE_POINTERS_PREFIX}${USR}/` || p === `profile-emails/by-user/${USR}/`),
			`only per-user pointer prefixes may be listed (got ${JSON.stringify(listPrefixes)})`,
		);

		const remainingKeys = [...env.ADMIN_BACKUPS.store.keys()];
		assert.equal(remainingKeys.some((k) => k.includes(USR)), false, 'no backup or pointer remains for the erased user');
		assert.equal(remainingKeys.filter((k) => k.includes(USR2)).length, 2, 'other user backup and pointer are untouched');
	});

	it('eraseLegacyRestoreBackups deletes copies before pointers across resumable small budgets', async () => {
		const backups = new MemoryBucket();
		for (const jobId of ['j1', 'j2']) {
			await backups.put(backupPointerKey(USR, jobId, 'v1'), '');
			await backups.put(backupKey(jobId, USR, 'v1'), JSON.stringify(currentProfile));
		}
		// Budget of 2: enough for 1 list + 1 delete (the backup copies), exhausts before deleting pointers
		await assert.rejects(eraseLegacyRestoreBackups(backups as never, USR, new OperationBudget(2)));
		assert.equal(backups.store.has(backupKey('j1', USR, 'v1')), false, 'backup copies deleted before pointers');
		assert.equal(backups.store.has(backupKey('j2', USR, 'v1')), false);
		assert.equal(backups.store.has(backupPointerKey(USR, 'j1', 'v1')), true, 'pointers still present so retry finishes cleanly');

		// Retry with enough budget clears the pointers idempotently
		await eraseLegacyRestoreBackups(backups as never, USR, new OperationBudget(10));
		assert.equal(backups.store.size, 0);
	});

	it('a queued restore running after erasure does not recreate the profile or write backups', async () => {
		const { env, call, drain } = setup();
		const plan = (await call('GET', '/legacy-profiles/plan')).body.result;
		const { job } = (await call('POST', '/legacy-profiles/restore', {
			approved: [{ id: USR, legacyId: LEGACY, fields: plan.items[0].changes.map((c: any) => c.field) }],
		})).body.result;

		// User is erased before the queued restore job executes
		const erased = await eraseUserData(erasureBuckets(env.profiles, env.ADMIN_BACKUPS), USR, new OperationBudget(10_000));
		assert.equal(erased.complete, true);
		assert.equal(env.profiles.store.has(USR), false);

		await drain();
		const done = (await call('GET', `/jobs/${job.id}`)).body.result;
		assert.equal(done.status, 'succeeded');
		assert.deepEqual(done.result, { written: [], skipped: [{ id: USR, reason: 'profile is gone' }] });
		assert.equal(env.profiles.store.has(USR), false, 'erased profile was not brought back');
		assert.equal(env.ADMIN_BACKUPS.store.size, 0, 'no backup or pointer was written');
	});

	it('after a restore and subsequent erasure, re-planning and re-running cannot bring the profile back', async () => {
		const { env, call, drain } = setup();
		const plan = (await call('GET', '/legacy-profiles/plan')).body.result;
		const approved = [{ id: USR, legacyId: LEGACY, fields: plan.items[0].changes.map((c: any) => c.field) }];
		await call('POST', '/legacy-profiles/restore', { approved });
		await drain();
		assert.equal(env.ADMIN_BACKUPS.store.size, 2);

		await eraseUserData(erasureBuckets(env.profiles, env.ADMIN_BACKUPS), USR, new OperationBudget(10_000));
		assert.equal(env.profiles.store.has(USR), false);
		assert.equal(env.ADMIN_BACKUPS.store.size, 0);

		const afterPlan = await planLegacyRestore(env as never);
		assert.deepEqual(afterPlan.items, []);
		const replay = await runLegacyRestore(env as never, { id: 'job-replay', kind: 'profiles.restore-legacy', actorId: 'a', params: { approved }, result: null } as any);
		assert.deepEqual(replay, { done: true, result: { written: [], skipped: [{ id: USR, reason: 'profile is gone' }] } });
		assert.equal(env.profiles.store.has(USR), false);
		assert.equal(env.ADMIN_BACKUPS.store.size, 0);
	});

	it('concurrent erasure mid-restore neither resurrects the profile nor leaves a backup behind', async () => {
		const { env } = setup();
		const realPut = env.profiles.put.bind(env.profiles);
		let raced = false;
		env.profiles.put = (async (key: string, value: string, options?: any) => {
			if (key === USR && options?.onlyIf?.etagMatches && !raced) {
				raced = true;
				// Erasure completes between restoreOne reading the profile (and writing its backup) and its conditional put
				await eraseUserData(erasureBuckets(env.profiles, env.ADMIN_BACKUPS), USR, new OperationBudget(10_000));
			}
			return realPut(key, value, options);
		}) as never;

		const job = { id: 'job-race', kind: 'profiles.restore-legacy', actorId: 'a', params: { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] }, result: null } as any;
		const out = await runLegacyRestore(env as never, job);
		assert.deepEqual(out, { done: true, result: { written: [], skipped: [{ id: USR, reason: 'profile is gone' }] } });
		assert.equal(env.profiles.store.has(USR), false, 'conditional put did not recreate the erased profile');
		assert.equal(env.ADMIN_BACKUPS.store.size, 0, 'no backup or pointer left behind');
	});

	it('erasure between pointer write and backup write cleans up the just-written backup even if a fresh profile exists', async () => {
		const { env } = setup();
		const realBackupsPut = env.ADMIN_BACKUPS.put.bind(env.ADMIN_BACKUPS);
		let raced = false;
		env.ADMIN_BACKUPS.put = (async (key: string, value: string, options?: any) => {
			const res = await realBackupsPut(key, value, options);
			if (key.startsWith(LEGACY_RESTORE_POINTERS_PREFIX) && !raced) {
				raced = true;
				// Erasure deletes the profile and pointer BEFORE the backup object is written; then a fresh profile is created
				await eraseUserData(erasureBuckets(env.profiles, env.ADMIN_BACKUPS), USR, new OperationBudget(10_000));
				await env.profiles.put(USR, JSON.stringify({ id: USR, email: 'owner@example.com' }));
			}
			return res;
		}) as never;

		const job = { id: 'job-ptr-race', kind: 'profiles.restore-legacy', actorId: 'a', params: { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] }, result: null } as any;
		const out = await runLegacyRestore(env as never, job);
		assert.deepEqual(out, { done: true, result: { written: [], skipped: [{ id: USR, reason: 'profile is gone' }] } });
		assert.equal(env.ADMIN_BACKUPS.store.size, 0, 'pre-erasure backup written after pointer sweep is removed');
		assert.equal(stored(env, USR).firstNameLocalized, undefined, 'new profile was not overwritten with pre-erasure plan');
	});

	it('skips soft-deleted profiles (pending deletion) in both planning and execution', async () => {
		const { env } = setup({
			profiles: {
				[LEGACY]: legacyRecord,
				[USR]: { ...currentProfile, adminDeletion: { at: '2026-11-20T00:00:00.000Z', by: 'usr_admin' } },
			},
		});
		const plan = await planLegacyRestore(env as never);
		assert.deepEqual(plan.items, []);
		const job = { id: 'job-soft', kind: 'profiles.restore-legacy', actorId: 'a', params: { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] }, result: null } as any;
		const out = await runLegacyRestore(env as never, job);
		assert.deepEqual(out, { done: true, result: { written: [], skipped: [{ id: USR, reason: 'profile is pending deletion' }] } });
		assert.equal(env.ADMIN_BACKUPS.store.size, 0);
	});

	it('cleans up backup and pointer in catch when profiles.put throws after erasure', async () => {
		const { env } = setup();
		env.profiles.put = (async () => {
			// Erasure completes between backup write and profiles.put, then profiles.put throws
			await eraseUserData(erasureBuckets(env.profiles, env.ADMIN_BACKUPS), USR, new OperationBudget(10_000));
			throw new Error('R2 write failed');
		}) as never;

		const job = { id: 'job-throw', kind: 'profiles.restore-legacy', actorId: 'a', params: { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] }, result: null } as any;
		await assert.rejects(runLegacyRestore(env as never, job), /R2 write failed/);
		assert.equal(env.profiles.store.has(USR), false);
		assert.equal(env.ADMIN_BACKUPS.store.size, 0, 'catch removed uncommitted backup and pointer');
	});

	it('keeps pre-change backup in catch when profiles.put committed before throwing', async () => {
		const { env } = setup();
		const realPut = env.profiles.put.bind(env.profiles);
		const etagBefore = env.profiles.etag(USR);
		env.profiles.put = (async (key: string, value: string, options?: any) => {
			await realPut(key, value, options);
			throw new Error('ambiguous network timeout after commit');
		}) as never;

		const job = { id: 'job-commit-throw', kind: 'profiles.restore-legacy', actorId: 'a', params: { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] }, result: null } as any;
		await assert.rejects(runLegacyRestore(env as never, job), /ambiguous network timeout/);
		assert.equal(stored(env, USR).firstNameLocalized.ar, 'محمود', 'profile write committed');
		assert.equal(env.ADMIN_BACKUPS.store.has(backupKey(job.id, USR, etagBefore)), true, 'pre-change backup kept when profile etag changed');
		assert.equal(env.ADMIN_BACKUPS.store.has(backupPointerKey(USR, job.id, etagBefore)), true, 'pointer kept so future erasure removes it');
	});

	it('cleans up the pointer in catch when the backup copy put throws', async () => {
		const { env } = setup();
		const realPut = env.ADMIN_BACKUPS.put.bind(env.ADMIN_BACKUPS);
		env.ADMIN_BACKUPS.put = (async (key: string, value: string, options?: any) => {
			if (!key.startsWith(LEGACY_RESTORE_POINTERS_PREFIX)) throw new Error('R2 backup put failed');
			return realPut(key, value, options);
		}) as never;

		const job = { id: 'job-bthrow', kind: 'profiles.restore-legacy', actorId: 'a', params: { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] }, result: null } as any;
		await assert.rejects(runLegacyRestore(env as never, job), /R2 backup put failed/);
		assert.equal(env.ADMIN_BACKUPS.store.size, 0, 'pointer written before failed backup put is removed');
	});

	it('a retry after a crash sweeps leftover backups on gone and pending-deletion exits', async () => {
		const { env } = setup();
		// Simulate a prior crashed attempt that left a backup + pointer after the profile disappeared
		await env.profiles.delete(USR);
		await env.ADMIN_BACKUPS.put(backupPointerKey(USR, 'job-crash', 'v0'), '');
		await env.ADMIN_BACKUPS.put(backupKey('job-crash', USR, 'v0'), JSON.stringify(currentProfile));
		await env.ADMIN_BACKUPS.put(backupPointerKey(INTRUDER, 'job-crash', 'v0'), '');
		await env.ADMIN_BACKUPS.put(backupKey('job-crash', INTRUDER, 'v0'), JSON.stringify({ id: INTRUDER }));

		const job = { id: 'job-crash', kind: 'profiles.restore-legacy', actorId: 'a', params: { approved: [{ id: USR, legacyId: LEGACY, fields: ['firstNameLocalized.ar'] }] }, result: null } as any;
		const out = await runLegacyRestore(env as never, job);
		assert.deepEqual(out, { done: true, result: { written: [], skipped: [{ id: USR, reason: 'profile is gone' }] } });
		assert.deepEqual(
			[...env.ADMIN_BACKUPS.store.keys()].sort(),
			[backupPointerKey(INTRUDER, 'job-crash', 'v0'), backupKey('job-crash', INTRUDER, 'v0')].sort(),
			'erased user leftovers swept on retry; other user untouched',
		);

		// Same sweep on pending-deletion exit
		await env.profiles.put(USR, JSON.stringify({ ...currentProfile, adminDeletion: { at: '2026-11-20T00:00:00.000Z', by: 'usr_admin' } }));
		await env.ADMIN_BACKUPS.put(backupPointerKey(USR, 'job-soft-retry', 'v1'), '');
		await env.ADMIN_BACKUPS.put(backupKey('job-soft-retry', USR, 'v1'), JSON.stringify(currentProfile));
		const softOut = await runLegacyRestore(env as never, { ...job, id: 'job-soft-retry' });
		assert.deepEqual(softOut, { done: true, result: { written: [], skipped: [{ id: USR, reason: 'profile is pending deletion' }] } });
		assert.equal([...env.ADMIN_BACKUPS.store.keys()].some((k) => k.includes(USR)), false);
	});

	it('eraseLegacyRestoreBackups flushes > 500 pointers across multiple list pages without listing the whole prefix', async () => {
		const backups = new MemoryBucket();
		const total = 1050;
		for (let i = 0; i < total; i++) {
			const jobId = `job-${String(i).padStart(4, '0')}`;
			backups.store.set(backupPointerKey(USR, jobId, 'v1'), '');
			backups.store.set(backupKey(jobId, USR, 'v1'), JSON.stringify({ id: USR }));
		}
		backups.store.set(backupPointerKey(INTRUDER, 'job-keep', 'v1'), '');
		backups.store.set(backupKey('job-keep', INTRUDER, 'v1'), JSON.stringify({ id: INTRUDER }));

		const listCalls: Array<{ prefix?: string; cursor?: string }> = [];
		const realList = backups.list.bind(backups);
		backups.list = (async (opts: { prefix?: string; cursor?: string; limit?: number } = {}) => {
			listCalls.push({ prefix: opts.prefix, cursor: opts.cursor });
			return realList(opts as never);
		}) as never;

		const deleted = await eraseLegacyRestoreBackups(backups as never, USR, new OperationBudget(100));
		assert.equal(deleted, total);
		assert.ok(listCalls.length >= 2, 'paged across multiple list responses');
		assert.ok(listCalls.every((c) => c.prefix === `${LEGACY_RESTORE_POINTERS_PREFIX}${USR}/`), 'every list call stayed under the user pointer prefix');
		assert.deepEqual(
			[...backups.store.keys()].sort(),
			[backupPointerKey(INTRUDER, 'job-keep', 'v1'), backupKey('job-keep', INTRUDER, 'v1')].sort(),
		);
	});

	it('backupKeyFromPointer rejects malformed keys and eraseLegacyRestoreBackups skips them safely', async () => {
		assert.equal(backupKeyFromPointer(USR, backupPointerKey(USR, 'job-1', 'v1')), backupKey('job-1', USR, 'v1'));
		assert.equal(backupKeyFromPointer(USR, `legacy-restore/other/${USR}/job-1/v1`), null);
		assert.equal(backupKeyFromPointer(USR, `${LEGACY_RESTORE_POINTERS_PREFIX}${USR}/no-slash`), null);
		assert.equal(backupKeyFromPointer(USR, `${LEGACY_RESTORE_POINTERS_PREFIX}${USR}//v1`), null);
		assert.equal(backupKeyFromPointer(USR, `${LEGACY_RESTORE_POINTERS_PREFIX}${USR}/by-user/v1`), null);
		assert.equal(backupKeyFromPointer(USR, `${LEGACY_RESTORE_POINTERS_PREFIX}${USR}/a/b/v1`), null);
		assert.equal(backupKeyFromPointer(USR, `${LEGACY_RESTORE_POINTERS_PREFIX}${USR}/job-1/`), null);
		assert.equal(backupKeyFromPointer(USR, `${LEGACY_RESTORE_POINTERS_PREFIX}${USR}/job-1/..`), null);
		assert.equal(backupKeyFromPointer(USR, `${LEGACY_RESTORE_POINTERS_PREFIX}${INTRUDER}/job-1/v1`), null);
		assert.equal(backupKeyFromPointer('bad/id', `${LEGACY_RESTORE_POINTERS_PREFIX}bad/id/job-1/v1`), null);

		const backups = new MemoryBucket();
		await backups.put(`${LEGACY_RESTORE_POINTERS_PREFIX}${USR}/malformed-no-etag`, '');
		await backups.put(backupPointerKey(USR, 'job-ok', 'v2'), '');
		await backups.put(backupKey('job-ok', USR, 'v2'), JSON.stringify(currentProfile));
		await backups.put('unrelated/object.json', JSON.stringify({ keep: true }));

		const deleted = await eraseLegacyRestoreBackups(backups as never, USR, new OperationBudget(20));
		assert.equal(deleted, 1);
		assert.deepEqual([...backups.store.keys()], ['unrelated/object.json']);
	});

	it('logs a warning and reports an error in erasure summary and user.delete-data job result when ADMIN_BACKUPS is unbound', async () => {
		const warnings: unknown[][] = [];
		const realWarn = logger.warn.bind(logger);
		logger.warn = ((...args: unknown[]) => {
			warnings.push(args);
		}) as never;
		try {
			const { env } = setup();
			const unbound = erasureBuckets(env.profiles, env.ADMIN_BACKUPS);
			delete (unbound as { ADMIN_BACKUPS?: unknown }).ADMIN_BACKUPS;
			const summary = await eraseUserData(unbound, USR, new OperationBudget(10_000));
			assert.equal(summary.complete, true);
			assert.deepEqual(summary.errors, [ADMIN_BACKUPS_UNBOUND_ERROR]);
			assert.ok(warnings.some((args) => String(args[0]).includes('ADMIN_BACKUPS is not bound')));

			// Admin job user.delete-data propagates the error into the job result
			const jobEnv = { ...erasureBuckets(new MemoryBucket({ [USR]: currentProfile }), new MemoryBucket()), SEARCH_DB: new SqliteD1() };
			delete (jobEnv as { ADMIN_BACKUPS?: unknown }).ADMIN_BACKUPS;
			await recordDeletion(jobEnv.SEARCH_DB as never, { kind: 'user', id: USR, title: USR, ownerId: USR, deletedBy: 'usr_admin', deletedAt: '2026-11-20T00:00:00.000Z' });
			const outcome = await ADMIN_JOB_HANDLERS['user.delete-data'](jobEnv as never, {
				id: 'job-del',
				kind: 'user.delete-data',
				targetKind: 'user',
				targetId: USR,
				params: {},
				result: null,
			} as never);
			assert.equal(outcome.done, true);
			assert.deepEqual(outcome.result?.errors, [ADMIN_BACKUPS_UNBOUND_ERROR]);
		} finally {
			logger.warn = realWarn;
		}
	});
});
