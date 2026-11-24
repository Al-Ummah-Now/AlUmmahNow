/**
 * Admin job 'profiles.repair-emails' (lib/admin/profile-emails.ts): profile and channel emails compared
 * with the sign-in accounts, over in-memory R2, a real SQLite search DB and Auth's users table.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import type { AdminJob, ProfileEmailsReportPage, ProfileEmailsResult } from '@al-ummah/shared-types';
import adminRouter from '../src/routers/admin.router';
import { logger } from '../src/lib/logger';
import { withSearchSync } from '../src/lib/search/sync';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { PROFILE_EMAILS_PAGE } from '../src/lib/admin/profile-emails';
import { REPORT_PREFIX, SWEEP_CURSOR_KEY, eraseProfileEmailReports, parseReportKey, sweepProfileEmailPointers, sweepProfileEmailReports } from '../src/lib/admin/profile-email-reports';
import { eraseRunUserData } from '../src/lib/privacy/run-user-erase';
import { OperationBudget } from '../src/lib/privacy/scan';
import { eraseUserData } from '../src/lib/privacy/user-data';
import { AuthDb } from './auth-db';
import { MemoryBucket, MemoryQueue } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const profile = (id: string, email: string | undefined, channels: string[] = []) => ({ id, ...(email === undefined ? {} : { email }), displayName: `Name ${id}`, channels, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' });
const channel = (id: string, userId: string, email: string | undefined) => ({ id, userId, ...(email === undefined ? {} : { email }), name: `Channel ${id}`, isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', playlists: [], subscribers: [] });

const SEED = {
	profiles: {
		usr_same: profile('usr_same', 'Same@Example.com', ['ch_same']),
		usr_differs: profile('usr_differs', 'copy@example.com', ['ch_own', 'ch_not_theirs']),
		usr_none: profile('usr_none', 'unknown'),
		usr_noacct: profile('usr_noacct', 'noacct@example.com', ['ch_noacct']),
		usr_gone: profile('usr_gone', 'gone@example.com'),
	},
	channels: {
		ch_same: channel('ch_same', 'usr_same', 'old@example.com'),
		ch_own: channel('ch_own', 'usr_differs', 'copy@example.com'),
		ch_not_theirs: channel('ch_not_theirs', 'usr_else', 'else@example.com'),
		// Not on its owner's profile: found through the index
		ch_indexed: channel('ch_indexed', 'usr_differs', 'copy@example.com'),
		// Channels carry no email any more
		ch_none: channel('ch_none', 'usr_differs', undefined),
		ch_noacct: channel('ch_noacct', 'usr_noacct', 'noacct@example.com'),
	},
	auth: { usr_same: 'same@example.com', usr_differs: 'Account@Example.com', usr_none: 'none@example.com' },
};

class JobsQueue {
	pending: { body: unknown; attempts: number }[] = [];
	async send(body: unknown) {
		this.pending.push({ body, attempts: 1 });
	}
	async drain(env: unknown) {
		for (let guard = 0; this.pending.length && guard < 200; guard++) {
			const delivery = this.pending.shift()!;
			let retried = false;
			const msg: JobMessage = { body: delivery.body, attempts: delivery.attempts, ack: () => {}, retry: () => { retried = true; } };
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS);
			if (retried && delivery.attempts <= 5) this.pending.push({ ...delivery, attempts: delivery.attempts + 1 });
		}
	}
}

async function setup(seed: { profiles: Record<string, unknown>; channels: Record<string, unknown>; auth: Record<string, string> } = SEED) {
	const pending: Promise<unknown>[] = [];
	const db = new SqliteD1();
	const raw = {
		SEARCH_DB: db,
		AUTH_DB: new AuthDb(seed.auth).add('usr_gone', 'gone@example.com', { deletedAt: 1 }),
		ADMIN_BACKUPS: new MemoryBucket(),
		profiles: new MemoryBucket(seed.profiles),
		channels: new MemoryBucket(seed.channels),
		videos: new MemoryBucket(),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		queue: new MemoryQueue(),
		ADMIN_JOBS_QUEUE: new JobsQueue(),
	};
	for (const kind of ['channel', 'profile'] as const) await runOwnershipPass(raw as never, kind, { maxPages: 10 });
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => void pending.push(p) });
	const app = new Hono();
	app.route('/internal/admin', adminRouter);
	const call = async (method: string, path: string, body?: unknown, opts: { hold?: boolean } = {}) => {
		const res = await app.request(`/internal/admin${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': 'usr_admin' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
		if (!opts.hold) await raw.ADMIN_JOBS_QUEUE.drain(env);
		await Promise.all(pending.splice(0));
		return { status: res.status, body: (await res.json()) as any };
	};
	const jobOf = async (id: string) => (await call('GET', `/jobs/${id}`)).body.result as AdminJob;
	const run = async (body: Record<string, unknown>) => {
		const res = await call('POST', '/profile-emails/jobs', body);
		assert.equal(res.status, 200, JSON.stringify(res.body));
		return jobOf(res.body.result.job.id);
	};
	const report = async (jobId: string, page = 0) => (await call('GET', `/profile-emails/jobs/${jobId}/report?page=${page}`)).body.result as ProfileEmailsReportPage;
	return { raw, db, env, call, run, jobOf, report };
}

const result = (job: AdminJob) => job.result as unknown as ProfileEmailsResult;
const brief = (r: ProfileEmailsReportPage) => r.entries.map((e) => [e.kind, e.id, e.stored, e.account]).sort();

const keysOf = (t: { raw: { ADMIN_BACKUPS: MemoryBucket } }) => {
	const keys = [...t.raw.ADMIN_BACKUPS.store.keys()];
	return { records: keys.filter((k) => k.startsWith(`${REPORT_PREFIX}reports/`)), pointers: keys.filter((k) => k.startsWith(`${REPORT_PREFIX}by-user/`)) };
};
const pointerOf = (record: string) => {
	const [, , day, jobId, page, file] = record.split('/');
	return `${REPORT_PREFIX}by-user/${file.replace('.json', '')}/${day}/${jobId}/${page}`;
};

const realInfo = logger.info;
afterEach(() => {
	logger.info = realInfo;
});

describe('profile emails: check', () => {
	it('compares profiles and their channels with the accounts and writes nothing but the private report', async () => {
		const t = await setup();
		const before = [JSON.stringify([...t.raw.profiles.store]), JSON.stringify([...t.raw.channels.store])];
		const logged: unknown[] = [];
		logger.info = ((...args: unknown[]) => void logged.push(args)) as typeof logger.info;
		const job = await t.run({ mode: 'check' });
		assert.equal(job.status, 'succeeded', job.lastError ?? '');
		assert.deepEqual(result(job), {
			mode: 'check', scanned: 5, matching: 1, differs: 1, missing: 1, channels: 3, noAccount: 2, unreadable: 0, profilesWritten: 0, channelsWritten: 0, reportPages: [0],
		});
		const r = await t.report(job.id);
		assert.deepEqual(brief(r), [
			['channel', 'ch_indexed', 'copy@example.com', 'account@example.com'],
			['channel', 'ch_own', 'copy@example.com', 'account@example.com'],
			['channel', 'ch_same', 'old@example.com', 'same@example.com'],
			['profile', 'usr_differs', 'copy@example.com', 'account@example.com'],
			['profile', 'usr_none', null, 'none@example.com'],
		]);
		assert.deepEqual(r.noAccount.map((n) => n.userId).sort(), ['usr_gone', 'usr_noacct'], 'no account, or a deleted one: listed');
		assert.deepEqual([JSON.stringify([...t.raw.profiles.store]), JSON.stringify([...t.raw.channels.store])], before, 'nothing written');
		assert.doesNotMatch(JSON.stringify(logged), /@example\.com/, 'no email in the logs');
		assert.doesNotMatch(JSON.stringify({ params: job.params, result: job.result, log: job.log }), /@example\.com/, 'no email in the job row');
	});

	it('reads Auth by primary key only, in batches, and the index by owner', async () => {
		const profiles = Object.fromEntries(Array.from({ length: PROFILE_EMAILS_PAGE * 2 + 5 }, (_, i) => [`usr_${String(i).padStart(4, '0')}`, profile(`usr_${String(i).padStart(4, '0')}`, `u${i}@example.com`)]));
		const t = await setup({ profiles, channels: {}, auth: Object.fromEntries(Object.keys(profiles).map((id, i) => [id, i === 103 ? 'other@example.com' : `u${i}@example.com`])) });
		const job = await t.run({ mode: 'check' });
		assert.equal(result(job).scanned, PROFILE_EMAILS_PAGE * 2 + 5);
		assert.equal(result(job).matching, PROFILE_EMAILS_PAGE * 2 + 4);
		assert.deepEqual(result(job).reportPages, [2], 'only pages with something in them');
		assert.equal((await t.report(job.id, 2)).entries[0].id, 'usr_0103');
		assert.equal(t.raw.AUTH_DB.queries.length, 3, 'one lookup per page');
		assert.deepEqual(t.raw.AUTH_DB.plans().filter((p) => !/^SEARCH users USING INDEX sqlite_autoindex_users_1 \(id=\?\)/.test(p)), []);
		const plan = t.db.db.prepare("EXPLAIN QUERY PLAN SELECT id FROM content_ownership WHERE kind = 'channel' AND owner_id IN (SELECT value FROM json_each(?))").all('["a"]') as { detail: string }[];
		assert.ok(plan.some((p) => /^SEARCH content_ownership USING .*INDEX .*\(kind=\? AND owner_id=\?\)/.test(p.detail)), JSON.stringify(plan));
	});

	it('fails (and can be retried) while Auth cannot be read, and needs the report bucket', async () => {
		const t = await setup();
		t.raw.AUTH_DB.fail = true;
		const job = await t.run({ mode: 'check' });
		assert.equal(job.status, 'failed');
		assert.equal(job.result, null, 'nobody is listed as having no account');
		t.raw.AUTH_DB.fail = false;
		await t.call('POST', `/jobs/${job.id}/retry`);
		assert.equal((await t.jobOf(job.id)).status, 'succeeded');
	});
});

describe('profile emails: repair', () => {
	it('needs a finished check from the last 24 hours, and one runs at a time', async () => {
		const t = await setup();
		assert.equal((await t.call('POST', '/profile-emails/jobs', { mode: 'repair' })).body.code, 'check_needed');
		const held = await t.call('POST', '/profile-emails/jobs', { mode: 'check' }, { hold: true });
		assert.equal((await t.call('POST', '/profile-emails/jobs', { mode: 'check' }, { hold: true })).body.code, 'already_running');
		await t.raw.ADMIN_JOBS_QUEUE.drain(t.env);
		const id = held.body.result.job.id;
		t.db.db.prepare('UPDATE admin_jobs SET finished_at = ? WHERE id = ?').run(new Date(Date.now() - 25 * 3_600_000).toISOString(), id);
		assert.equal((await t.call('POST', '/profile-emails/jobs', { mode: 'repair', checkJobId: id })).body.code, 'check_needed');
		assert.equal((await t.call('POST', '/profile-emails/jobs', { mode: 'rewrite' })).status, 400);
	});

	it('writes the account email on the profiles that differ, removes it from the channels that do, keeps the rest, and the index follows', async () => {
		const t = await setup();
		const check = await t.run({ mode: 'check' });
		const job = await t.run({ mode: 'repair', checkJobId: check.id });
		assert.equal(job.status, 'succeeded', job.lastError ?? '');
		assert.equal(result(job).profilesWritten, 2);
		assert.equal(result(job).channelsWritten, 3);
		const p = (id: string) => t.raw.profiles.read(id);
		const ch = (id: string) => t.raw.channels.read(id);
		assert.deepEqual({ ...p('usr_differs'), email: 'x' }, { ...SEED.profiles.usr_differs, email: 'x' }, 'only the email changes');
		assert.equal(p('usr_differs').email, 'account@example.com');
		assert.equal(p('usr_none').email, 'none@example.com');
		assert.equal(p('usr_same').email, 'Same@Example.com', 'the same address is left as it is');
		assert.equal(p('usr_noacct').email, 'noacct@example.com', 'no account: left as it is');
		assert.equal(p('usr_gone').email, 'gone@example.com');
		assert.deepEqual(['ch_same', 'ch_own', 'ch_indexed', 'ch_none', 'ch_not_theirs', 'ch_noacct'].map((id) => ch(id).email ?? null), [null, null, null, null, 'else@example.com', 'noacct@example.com']);
		const indexed = t.db.db.prepare("SELECT email FROM content_ownership WHERE kind = 'profile' AND id = 'usr_differs'").get() as { email: string };
		assert.equal(indexed.email, 'account@example.com');
		const { email: _removed, ...own } = SEED.channels.ch_own as Record<string, unknown>;
		assert.deepEqual(ch('ch_own'), own, 'only the email goes');
		assert.equal((t.db.db.prepare("SELECT email FROM content_ownership WHERE kind = 'channel' AND id = 'ch_own'").get() as { email: string | null }).email, null);
		// The report keeps what was there
		assert.deepEqual((await t.report(job.id)).entries.filter((e) => e.kind === 'profile').map((e) => [e.id, e.stored, e.outcome]).sort(), [['usr_differs', 'copy@example.com', 'written'], ['usr_none', null, 'written']]);
		// A second check finds nothing left to write
		const after = await t.run({ mode: 'check' });
		assert.deepEqual([result(after).differs, result(after).missing, result(after).channels, result(after).matching], [0, 0, 0, 3]);
	});

	it('a profile changed while the job writes keeps that change; a channel moved meanwhile is left alone', async () => {
		const t = await setup();
		const check = await t.run({ mode: 'check' });
		const put = t.raw.profiles.put.bind(t.raw.profiles);
		let raced = false;
		t.raw.profiles.put = (async (key: string, value: string, options?: any) => {
			if (key === 'usr_differs' && !raced) {
				raced = true;
				await put(key, JSON.stringify({ ...t.raw.profiles.read(key), bio: 'edited meanwhile' }));
				// The channel moves to someone else in between
				await t.raw.channels.put('ch_own', JSON.stringify({ ...t.raw.channels.read('ch_own'), userId: 'usr_else' }));
			}
			return put(key, value, options);
		}) as never;
		const job = await t.run({ mode: 'repair', checkJobId: check.id });
		assert.equal(raced, true);
		assert.equal(t.raw.profiles.read('usr_differs').bio, 'edited meanwhile');
		assert.equal(t.raw.profiles.read('usr_differs').email, 'account@example.com');
		assert.equal(t.raw.channels.read('ch_own').email, 'copy@example.com');
		assert.equal((await t.report(job.id)).entries.find((e) => e.id === 'ch_own')?.outcome, 'gone');
	});

	it('a step that fails half way is retried: the report keeps what was there before the first write', async () => {
		const t = await setup();
		const check = await t.run({ mode: 'check' });
		const put = t.raw.channels.put.bind(t.raw.channels);
		let failures = 1;
		t.raw.channels.put = (async (key: string, value: string, options?: any) => {
			if (failures-- > 0) throw new Error('R2 unavailable');
			return put(key, value, options);
		}) as never;
		const job = await t.run({ mode: 'repair', checkJobId: check.id });
		assert.equal(job.status, 'succeeded', job.lastError ?? '');
		const r = await t.report(job.id);
		assert.equal(r.entries.length, 5);
		assert.equal(r.entries.find((e) => e.id === 'usr_differs')?.stored, 'copy@example.com');
		assert.deepEqual([result(job).profilesWritten, result(job).channelsWritten], [2, 3]);
		assert.deepEqual([result(job).matching, result(job).differs, result(job).missing], [1, 1, 1], 'a retry counts its own earlier writes as differing');
	});
});

describe('profile emails: reports', () => {
	it('a missing page is 404; the runs are listed', async () => {
		const t = await setup();
		const job = await t.run({ mode: 'check' });
		assert.equal((await t.call('GET', `/profile-emails/jobs/${job.id}/report?page=7`)).status, 404);
		assert.equal((await t.call('GET', `/profile-emails/jobs/${job.id}/report?page=x`)).status, 400);
		assert.equal((await t.call('GET', '/profile-emails/jobs/no-such-job/report')).status, 404);
		assert.deepEqual((await t.call('GET', '/profile-emails/jobs')).body.result.items.map((j: AdminJob) => j.id), [job.id]);
	});

	it('every record has its pointer, and emails are only in the records', async () => {
		const t = await setup();
		await t.run({ mode: 'check' });
		const { records, pointers } = keysOf(t);
		assert.deepEqual(records.map((k) => k.split('/').at(-1)).sort(), ['usr_differs.json', 'usr_gone.json', 'usr_noacct.json', 'usr_none.json', 'usr_same.json']);
		assert.deepEqual(pointers.sort(), records.map(pointerOf).sort());
		for (const key of pointers) assert.equal(t.raw.ADMIN_BACKUPS.store.get(key), '');
		assert.doesNotMatch(JSON.stringify([...t.raw.ADMIN_BACKUPS.store.keys()]), /@/);
	});

	it('the daily sweep deletes records older than 30 days with their pointers, and reads no others', async () => {
		const t = await setup();
		const job = await t.run({ mode: 'check' });
		const kept = keysOf(t);
		const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
		for (const n of [31, 45]) {
			await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}reports/${day(n)}/old-job/000000/usr_differs.json`, '{"entries":[]}');
			await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}by-user/usr_differs/${day(n)}/old-job/000000`, '');
		}
		await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}reports/${day(30)}/edge-job/000000/usr_differs.json`, '{"entries":[]}');
		await t.raw.ADMIN_BACKUPS.put('legacy-restore/keep.json', '{}');
		t.raw.ADMIN_BACKUPS.calls = 0;
		assert.deepEqual(await sweepProfileEmailReports(t.raw.ADMIN_BACKUPS as never, new Date(), new OperationBudget(10)), { deleted: 2, paused: false });
		assert.equal(t.raw.ADMIN_BACKUPS.calls, 2, 'one list, one delete');
		const left = keysOf(t);
		assert.deepEqual(left.records.filter((k) => k.includes('old-job')), []);
		assert.deepEqual(left.pointers.sort(), kept.pointers.sort());
		assert.equal(left.records.length, kept.records.length + 1, 'the 30th day is kept');
		assert.equal(t.raw.ADMIN_BACKUPS.store.has('legacy-restore/keep.json'), true);
		assert.ok((await t.report(job.id)).entries.length);
	});

	it('the sweep works through more than one batch', async () => {
		const t = await setup({ profiles: {}, channels: {}, auth: {} });
		for (let n = 0; n < 1200; n++) {
			const id = `usr_${String(n).padStart(5, '0')}`;
			await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}reports/2020-01-01/old-job/000000/${id}.json`, '{"entries":[]}');
			await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}by-user/${id}/2020-01-01/old-job/000000`, '');
		}
		assert.deepEqual(await sweepProfileEmailReports(t.raw.ADMIN_BACKUPS as never, new Date(), new OperationBudget(20)), { deleted: 1200, paused: false });
		assert.equal(t.raw.ADMIN_BACKUPS.store.size, 0);
	});

	it('a paused record sweep keeps what it deleted and goes on next time', async () => {
		const t = await setup({ profiles: {}, channels: {}, auth: {} });
		for (let n = 0; n < 1200; n++) {
			const id = `usr_${String(n).padStart(5, '0')}`;
			await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}reports/2020-01-01/old-job/000000/${id}.json`, '{"entries":[]}');
			await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}by-user/${id}/2020-01-01/old-job/000000`, '');
		}
		const sweep = (budget: number) => sweepProfileEmailReports(t.raw.ADMIN_BACKUPS as never, new Date(), new OperationBudget(budget));
		assert.deepEqual(await sweep(5), { deleted: 1000, paused: true });
		assert.equal(t.raw.ADMIN_BACKUPS.store.size, 400);
		assert.deepEqual(await sweep(5), { deleted: 200, paused: false });
		assert.equal(t.raw.ADMIN_BACKUPS.store.size, 0);
	});

	it('keys are parsed strictly: anything else is never swept', async () => {
		assert.deepEqual(parseReportKey(`${REPORT_PREFIX}by-user/usr_a/2020-01-01/job/000003`), { userId: 'usr_a', day: '2020-01-01', step: '2020-01-01/job/000003' });
		assert.deepEqual(parseReportKey(`${REPORT_PREFIX}reports/2020-01-01/job/000003/usr_a.json`), { userId: 'usr_a', day: '2020-01-01', step: '2020-01-01/job/000003' });
		const malformed = ['by-user/usr_a', 'by-user/usr_a/', 'by-user/usr_a//job/000000', 'by-user/usr_a/2020-13-45/job/000000', 'by-user/usr_a/2020-01-01/job/0', 'by-user/usr_a/2020-01-01/job/000000/x', 'reports/2020-01-01/job/000000/.json', 'reports/x/job/000000/usr_a.json', 'reports/2020-01-01/job/000000/usr_a', 'pointer-sweep.json'].map((k) => `${REPORT_PREFIX}${k}`);
		const t = await setup({ profiles: {}, channels: {}, auth: {} });
		for (const key of malformed) {
			assert.equal(parseReportKey(key), null, key);
			await t.raw.ADMIN_BACKUPS.put(key, '{}');
		}
		assert.deepEqual(await sweepProfileEmailReports(t.raw.ADMIN_BACKUPS as never, new Date(), new OperationBudget(20)), { deleted: 0, paused: false });
		assert.deepEqual(await sweepProfileEmailPointers(t.raw.ADMIN_BACKUPS as never, new Date(), new OperationBudget(20)), { deleted: 0, paused: false });
		assert.deepEqual([...t.raw.ADMIN_BACKUPS.store.keys()].sort(), malformed.filter((k) => k !== SWEEP_CURSOR_KEY).sort(), 'only the sweep\'s own cursor is cleared');
	});

	it('an expired pointer whose record is gone is deleted; one whose record exists stays, and so do newer ones', async () => {
		const t = await setup();
		await t.run({ mode: 'check' });
		const kept = keysOf(t).pointers;
		const pointer = (id: string) => `${REPORT_PREFIX}by-user/${id}/2020-01-01/old-job/000000`;
		for (const id of ['usr_orphan', 'usr_recorded']) await t.raw.ADMIN_BACKUPS.put(pointer(id), '');
		await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}reports/2020-01-01/old-job/000000/usr_recorded.json`, '{"entries":[]}');
		const sweep = () => sweepProfileEmailPointers(t.raw.ADMIN_BACKUPS as never, new Date(), new OperationBudget(20));
		assert.deepEqual(await sweep(), { deleted: 1, paused: false });
		assert.deepEqual(keysOf(t).pointers.sort(), [...kept, pointer('usr_recorded')].sort());
		// The erasure still finds that record
		assert.equal(await eraseProfileEmailReports(t.raw.ADMIN_BACKUPS as never, 'usr_recorded', new OperationBudget(10)), 1);
		assert.equal(t.raw.ADMIN_BACKUPS.store.has(`${REPORT_PREFIX}reports/2020-01-01/old-job/000000/usr_recorded.json`), false);
	});

	it('under a tight limit it deletes what it found, pauses, and goes on from there; live pointers in front starve nothing', async () => {
		const t = await setup({ profiles: {}, channels: {}, auth: {} });
		const today = new Date().toISOString().slice(0, 10);
		for (let n = 0; n < 2500; n++) await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}by-user/usr_a${String(n).padStart(5, '0')}/${today}/job/000000`, '');
		for (let n = 0; n < 40; n++) await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}by-user/usr_z${String(n).padStart(5, '0')}/2020-01-01/old-job/000000`, '');
		const sweep = async (limit: number) => {
			const budget = new OperationBudget(limit);
			const out = await sweepProfileEmailPointers(t.raw.ADMIN_BACKUPS as never, new Date(), budget);
			assert.ok(budget.spent <= limit);
			return out;
		};
		const cursor = () => t.raw.ADMIN_BACKUPS.read<{ after: string }>(SWEEP_CURSOR_KEY)?.after;
		// Read the cursor, one list, then the reserve: only live pointers seen
		assert.deepEqual(await sweep(4), { deleted: 0, paused: true });
		assert.match(cursor()!, /usr_a00999\//);
		assert.deepEqual(await sweep(4), { deleted: 0, paused: true });
		assert.match(cursor()!, /usr_a01999\//);
		// Reaches the expired ones and deletes the few it could check before pausing
		assert.deepEqual(await sweep(14), { deleted: 10, paused: true });
		assert.match(cursor()!, /usr_z00009\//);
		assert.deepEqual(await sweep(100), { deleted: 30, paused: false });
		assert.equal(cursor(), undefined, 'the end was reached: it starts over');
		assert.equal(keysOf(t).pointers.length, 2500);
	});

	it('flushes more than one full delete call', async () => {
		const t = await setup({ profiles: {}, channels: {}, auth: {} });
		for (let n = 0; n < 2300; n++) await t.raw.ADMIN_BACKUPS.put(`${REPORT_PREFIX}by-user/usr_${String(n).padStart(5, '0')}/2020-01-01/old-job/000000`, '');
		const sizes: number[] = [];
		const del = t.raw.ADMIN_BACKUPS.delete.bind(t.raw.ADMIN_BACKUPS);
		t.raw.ADMIN_BACKUPS.delete = async (keys: string | string[]) => {
			sizes.push(Array.isArray(keys) ? keys.length : 1);
			return del(keys);
		};
		assert.deepEqual(await sweepProfileEmailPointers(t.raw.ADMIN_BACKUPS as never, new Date(), new OperationBudget(3000)), { deleted: 2300, paused: false });
		assert.ok(sizes.every((n) => n <= 1000), String(sizes));
		assert.equal(t.raw.ADMIN_BACKUPS.store.size, 0);
	});

	it("account erasure deletes the user's records and pointers in every report, and nobody else's", async () => {
		const t = await setup();
		const first = await t.run({ mode: 'check' });
		const second = await t.run({ mode: 'check' });
		const others = keysOf(t).records.filter((k) => !k.endsWith('/usr_differs.json'));
		t.raw.ADMIN_BACKUPS.calls = 0;
		assert.equal(await eraseProfileEmailReports(t.raw.ADMIN_BACKUPS as never, 'usr_differs', new OperationBudget(10)), 2);
		assert.equal(t.raw.ADMIN_BACKUPS.calls, 4, 'one list of their own prefix, two deletes, the sweep cursor');
		const left = keysOf(t);
		assert.deepEqual(left.records.sort(), others.sort());
		assert.equal(left.pointers.some((k) => k.includes('usr_differs')), false);
		for (const job of [first, second]) {
			const r = await t.report(job.id);
			assert.equal(JSON.stringify(r).includes('usr_differs'), false);
			assert.ok(r.entries.length, 'the rest of the report stays');
		}
		// A user id that is the start of another one takes nothing of theirs
		assert.equal(await eraseProfileEmailReports(t.raw.ADMIN_BACKUPS as never, 'usr_no', new OperationBudget(10)), 0);
	});

	it('the erasure clears a paused sweep that stopped at the user, and no other', async () => {
		const t = await setup({ profiles: {}, channels: {}, auth: {} });
		const stopAt = (id: string) => t.raw.ADMIN_BACKUPS.put(SWEEP_CURSOR_KEY, JSON.stringify({ after: `${REPORT_PREFIX}by-user/${id}/2020-01-01/old-job/000000` }));
		const erase = () => eraseProfileEmailReports(t.raw.ADMIN_BACKUPS as never, 'usr_a', new OperationBudget(10));
		await stopAt('usr_ab');
		await erase();
		assert.equal(t.raw.ADMIN_BACKUPS.store.has(SWEEP_CURSOR_KEY), true);
		await stopAt('usr_a');
		await erase();
		assert.deepEqual(t.raw.ADMIN_BACKUPS.read(SWEEP_CURSOR_KEY), {});
		// No cursor: none is made
		await t.raw.ADMIN_BACKUPS.delete(SWEEP_CURSOR_KEY);
		await erase();
		assert.equal(t.raw.ADMIN_BACKUPS.store.has(SWEEP_CURSOR_KEY), false);
	});

	it('a cursor a sweep moves on to another user between the read and the clear stays', async () => {
		const t = await setup({ profiles: {}, channels: {}, auth: {} });
		const at = (id: string) => JSON.stringify({ after: `${REPORT_PREFIX}by-user/${id}/2020-01-01/old-job/000000` });
		await t.raw.ADMIN_BACKUPS.put(SWEEP_CURSOR_KEY, at('usr_a'));
		const get = t.raw.ADMIN_BACKUPS.get.bind(t.raw.ADMIN_BACKUPS);
		let reads = 0;
		t.raw.ADMIN_BACKUPS.get = (async (key: string) => {
			const object = await get(key);
			if (key === SWEEP_CURSOR_KEY && ++reads === 1) await t.raw.ADMIN_BACKUPS.put(SWEEP_CURSOR_KEY, at('usr_b'));
			return object;
		}) as never;
		await eraseProfileEmailReports(t.raw.ADMIN_BACKUPS as never, 'usr_a', new OperationBudget(20));
		assert.equal(reads, 2, 'the lost write is tried again on the fresh cursor');
		assert.equal(t.raw.ADMIN_BACKUPS.store.get(SWEEP_CURSOR_KEY), at('usr_b'));
	});

	it('a cleared cursor starts the sweep over, and the sweep deletes it at the end', async () => {
		const t = await setup({ profiles: {}, channels: {}, auth: {} });
		const pointer = (id: string) => `${REPORT_PREFIX}by-user/${id}/2020-01-01/old-job/000000`;
		for (const id of ['usr_a', 'usr_b', 'usr_c', 'usr_d']) await t.raw.ADMIN_BACKUPS.put(pointer(id), '');
		const sweep = (limit: number) => sweepProfileEmailPointers(t.raw.ADMIN_BACKUPS as never, new Date(), new OperationBudget(limit));
		// Cursor read, list, two checks, then the reserve: stopped at usr_b
		assert.deepEqual(await sweep(6), { deleted: 2, paused: true });
		assert.equal(t.raw.ADMIN_BACKUPS.read(SWEEP_CURSOR_KEY).after, pointer('usr_b'));
		await t.raw.ADMIN_BACKUPS.put(pointer('usr_a'), '');
		await eraseProfileEmailReports(t.raw.ADMIN_BACKUPS as never, 'usr_b', new OperationBudget(20));
		assert.deepEqual(t.raw.ADMIN_BACKUPS.read(SWEEP_CURSOR_KEY), {});
		assert.deepEqual(await sweep(50), { deleted: 3, paused: false }, 'usr_a again, from the start');
		assert.deepEqual([...t.raw.ADMIN_BACKUPS.store.keys()], [], 'the cursor goes at the end');
	});

	it('both erasures (the account and an E2E run account) include the reports', async () => {
		const full = await setup();
		await full.run({ mode: 'check' });
		const env = { ...full.raw, watch_history: new MemoryBucket(), channel_sections: new MemoryBucket(), channel_tabs: new MemoryBucket(), 'upload-defaults': new MemoryBucket(), reports: new MemoryBucket() };
		const summary = await eraseUserData(env as never, 'usr_none', new OperationBudget(2000));
		assert.equal(summary.complete, true);
		assert.equal(summary.deleted.profileEmailReports, 1);
		assert.equal(keysOf(full).records.some((k) => k.includes('usr_none')), false);

		const run = await setup();
		await run.run({ mode: 'check' });
		for (const kind of ['video'] as const) await runOwnershipPass(run.raw as never, kind, { maxPages: 10 });
		const runEnv = { ...run.raw, watch_history: new MemoryBucket(), channel_sections: new MemoryBucket(), channel_tabs: new MemoryBucket(), 'upload-defaults': new MemoryBucket(), reports: new MemoryBucket() };
		const erased = await eraseRunUserData(runEnv as never, 'usr_none', new OperationBudget(2000));
		assert.equal(erased.complete, true);
		assert.equal(erased.deleted.profileEmailReports, 1);
		assert.equal(keysOf(run).records.some((k) => k.includes('usr_none')), false);
	});

	it('an erasure while a step runs leaves nothing behind: before the emails are written, or between them and the outcome', async () => {
		for (const when of ['before', 'after'] as const) {
			const t = await setup();
			const check = await t.run({ mode: 'check' });
			const erase = async () => {
				await t.raw.profiles.delete('usr_differs');
				await eraseProfileEmailReports(t.raw.ADMIN_BACKUPS as never, 'usr_differs', new OperationBudget(50));
			};
			const put = t.raw.ADMIN_BACKUPS.put.bind(t.raw.ADMIN_BACKUPS);
			let fired = false;
			t.raw.ADMIN_BACKUPS.put = (async (key: string, value: string, options?: any) => {
				const emails = key.endsWith('/usr_differs.json') && value.includes('@');
				if (when === 'before' && emails && !fired) {
					fired = true;
					await erase();
				}
				const out = await put(key, value, options);
				if (when === 'after' && emails && !fired) {
					fired = true;
					// The job is past its own check of the profile only once this put returned
					queueMicrotask(() => void erase());
				}
				return out;
			}) as never;
			const job = await t.run({ mode: 'repair', checkJobId: check.id });
			assert.equal(fired, true);
			assert.equal(job.status, 'succeeded', job.lastError ?? '');
			assert.equal(result(job).matching, 1, 'an erased profile is not counted as matching');
			assert.equal([...t.raw.ADMIN_BACKUPS.store.keys()].some((k) => k.includes('usr_differs')), false, when);
			assert.equal(t.raw.profiles.read('usr_differs'), null, 'the profile does not come back');
		}
	});

	it('a profile repaired by the first attempt and erased during the retry is not counted as matching', async () => {
		const t = await setup();
		const check = await t.run({ mode: 'check' });
		const put = t.raw.channels.put.bind(t.raw.channels);
		let failures = 1;
		t.raw.channels.put = (async (key: string, value: string, options?: any) => {
			if (failures-- > 0) throw new Error('R2 unavailable');
			return put(key, value, options);
		}) as never;
		// The first attempt wrote usr_none's email; the retry lists it, then the account is erased
		const head = t.raw.profiles.head.bind(t.raw.profiles);
		let heads = 0;
		t.raw.profiles.head = (async (key: string) => {
			if (key === 'usr_none' && ++heads === 2) {
				await t.raw.profiles.delete('usr_none');
				await eraseProfileEmailReports(t.raw.ADMIN_BACKUPS as never, 'usr_none', new OperationBudget(50));
			}
			return head(key);
		}) as never;
		const job = await t.run({ mode: 'repair', checkJobId: check.id });
		assert.equal(job.status, 'succeeded', job.lastError ?? '');
		assert.equal(heads, 2);
		assert.equal(result(job).matching, 1, 'only usr_same');
		assert.equal([...t.raw.ADMIN_BACKUPS.store.keys()].some((k) => k.includes('usr_none')), false);
	});

	it('a record another delivery changed meanwhile fails the step (it retries) and is not deleted', async () => {
		const t = await setup();
		const put = t.raw.ADMIN_BACKUPS.put.bind(t.raw.ADMIN_BACKUPS);
		let raced = 0;
		t.raw.ADMIN_BACKUPS.put = (async (key: string, value: string, options?: any) => {
			if (key.endsWith('/usr_none.json') && value.includes('@') && raced++ === 0) await put(key, JSON.stringify({ entries: [{ kind: 'profile', id: 'usr_none', userId: 'usr_none', stored: 'first@example.com', account: 'none@example.com' }] }));
			return put(key, value, options);
		}) as never;
		const job = await t.run({ mode: 'check' });
		assert.equal(job.status, 'succeeded', job.lastError ?? '');
		assert.equal(job.attempts > 1, true, 'retried');
		assert.equal((await t.report(job.id)).entries.find((e) => e.id === 'usr_none')?.stored, 'first@example.com', 'what was there first stays');
	});
});
