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
import { approvedFromPlan, backupKey, planLegacyRestore, runLegacyRestore, type AuthUsersDb } from '../src/lib/admin/legacy-restore';
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
			items: [{ id: USR, legacyId: LEGACY, changes: [
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

		// the pre-change copy, byte for byte, under the job's prefix
		const key = backupKey(job.id, USR, etagBefore);
		assert.deepEqual(JSON.parse((env.ADMIN_BACKUPS as any).store.get(key)), currentProfile);

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
		const plan = { legacyCount: 1, pairedCount: 1, unmatched: [], ambiguousCount: 0, items: [{ id: USR, legacyId: LEGACY, changes: [{ field: 'firstNameLocalized.ar', from: '', to: 'x' }] }] };
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
		// one backup per copy it tried to replace; the first is the untouched original
		const backups = [...(env.ADMIN_BACKUPS as any).store.entries()];
		assert.equal(backups.length, 2);
		assert.ok(backups.some(([, v]: [string, string]) => !JSON.parse(v).bio));
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
