/**
 * Admin job 'profiles.repair-emails': profile emails compared with the sign-in accounts.
 *
 *   check    pages through the profiles bucket and compares each profile (and the channels it owns)
 *            with Auth by user id (lib/admin/authUsers.ts: batched primary-key lookups). Writes nothing
 *            but the job's private report.
 *   repair   the same pass; where a profile's email differs, it writes the account's, and where a
 *            channel still holds another copy it removes it (channels carry none any more), each with
 *            a conditional put (R2Repository.updateObject). Needs a check that finished in the last 24
 *            hours. The report page is stored before the first write, so it always holds what was there.
 *
 * Profiles whose user id has no account are left as they are and listed. The result holds counts only;
 * the report (ADMIN_BACKUPS, private) holds the ids and emails, for super admins. One page of profiles
 * per step, idempotent, so a retry resumes where it stopped.
 * The report's layout, retention and erasure: profile-email-reports.ts.
 */
import {
	OWNERSHIP_TABLE,
	PROFILE_EMAILS_CHECK_MAX_AGE_HOURS,
	PROFILE_EMAILS_TARGET,
	type AdminJob,
	type ProfileEmailEntry,
	type ProfileEmailsMode,
	type ProfileEmailsReportPage,
	type ProfileEmailsResult,
	type SearchDb,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { authEmails, normalizeEmail } from './authUsers';
import { createJob, getJob, listJobs, type JobEnv, type JobOutcome } from './jobs';
import { JSON_META, inParallel, readStep, recordKey, stepPath, storeRecord, type UserRecord } from './profile-email-reports';
import { AdminError } from './service';

export interface ProfileEmailsEnv extends JobEnv {
	profiles: R2Bucket;
	channels: R2Bucket;
	SEARCH_DB?: SearchDb;
	AUTH_DB?: unknown;
	ADMIN_BACKUPS?: R2Bucket;
}

type Row = Record<string, unknown>;

export const PROFILE_EMAILS_PAGE = 50;
const READ_CONCURRENCY = 8;
/** Channel ids read from one profile's own list (the index gives the rest). */
const CHANNELS_PER_OWNER = 200;

/** What a record has stored as its email; placeholders ("unknown") count as none. */
const storedEmail = (row: Row): string | null => {
	const email = normalizeEmail(row.email);
	return email.includes('@') ? email : null;
};

async function readAll(bucket: R2Bucket, keys: string[]): Promise<{ rows: Map<string, Row>; unreadable: string[] }> {
	const rows = new Map<string, Row>();
	const unreadable: string[] = [];
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(READ_CONCURRENCY, keys.length) }, async () => {
			while (next < keys.length) {
				const key = keys[next++];
				const object = await bucket.get(key);
				if (!object) continue;
				try {
					rows.set(key, JSON.parse(await object.text()) as Row);
				} catch {
					unreadable.push(key);
				}
			}
		}),
	);
	return { rows, unreadable };
}

/** Channel ids per owner: the profile's own list and the ownership index ((kind, owner_id) index). */
async function channelsOf(env: ProfileEmailsEnv, owners: Map<string, Row>): Promise<string[]> {
	const ids = new Set<string>();
	for (const profile of owners.values()) {
		if (Array.isArray(profile.channels)) for (const id of profile.channels.slice(0, CHANNELS_PER_OWNER)) if (typeof id === 'string' && id) ids.add(id);
	}
	if (env.SEARCH_DB && owners.size) {
		const { results } = await env.SEARCH_DB.prepare(`SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = 'channel' AND owner_id IN (SELECT value FROM json_each(?))`)
			.bind(JSON.stringify([...owners.keys()]))
			.all<{ id: string }>();
		for (const row of results ?? []) ids.add(row.id);
	}
	return [...ids];
}

interface PagePlan {
	scanned: number;
	matching: number;
	missing: number;
	unreadable: number;
	entries: ProfileEmailEntry[];
	noAccount: ProfileEmailsReportPage['noAccount'];
	next: string | null;
}

/** Compares one page of profiles and their channels. Reads only. */
async function planPage(env: ProfileEmailsEnv, startAfter: string | undefined): Promise<PagePlan> {
	const page = await env.profiles.list({ limit: PROFILE_EMAILS_PAGE, ...(startAfter ? { startAfter } : {}) });
	const last = page.objects[page.objects.length - 1]?.key;
	// Profiles are stored under their user id; keys with a path or a prefix are other records
	const keys = page.objects.map((o) => o.key).filter((k) => !k.includes('/') && !k.includes(':'));
	const { rows, unreadable } = await readAll(env.profiles, keys);
	const accounts = await authEmails(env, [...rows.keys()]);
	const plan: PagePlan = { scanned: rows.size, matching: 0, missing: 0, unreadable: unreadable.length, entries: [], noAccount: [], next: page.truncated && last ? last : null };
	const owners = new Map<string, Row>();
	for (const [userId, profile] of rows) {
		const account = accounts.get(userId);
		const stored = storedEmail(profile);
		if (!account) {
			plan.noAccount.push({ userId, stored });
			continue;
		}
		owners.set(userId, profile);
		if (stored === account) plan.matching++;
		else {
			if (!stored) plan.missing++;
			plan.entries.push({ kind: 'profile', id: userId, userId, stored, account });
		}
	}
	const channels = await readAll(env.channels, await channelsOf(env, owners));
	for (const [id, channel] of channels.rows) {
		// Only its current owner's account; an id listed on another profile is not theirs
		const userId = typeof channel.userId === 'string' ? channel.userId : '';
		const account = owners.has(userId) ? accounts.get(userId) : undefined;
		const stored = storedEmail(channel);
		if (account && stored && stored !== account) plan.entries.push({ kind: 'channel', id, userId, stored, account });
	}
	return plan;
}

/** Sets a profile's email, or removes a channel's copy, only if it still differs (and a channel is still that owner's). */
async function repairOne(env: ProfileEmailsEnv, entry: ProfileEmailEntry): Promise<NonNullable<ProfileEmailEntry['outcome']>> {
	let outcome: NonNullable<ProfileEmailEntry['outcome']> = 'gone';
	const saved = await new R2Repository<Row>(entry.kind === 'profile' ? env.profiles : env.channels).updateObject(entry.id, (fresh) => {
		outcome = 'already';
		if (entry.kind === 'channel' && fresh.userId !== entry.userId) {
			outcome = 'gone';
			return false;
		}
		const stored = storedEmail(fresh);
		if (stored === entry.account || (entry.kind === 'channel' && !stored)) return false;
		outcome = 'written';
		if (entry.kind === 'channel') delete fresh.email;
		else fresh.email = entry.account;
		return true;
	});
	return saved ? outcome : 'gone';
}

const modeOf = (job: AdminJob): ProfileEmailsMode => (job.params.mode === 'repair' ? 'repair' : 'check');

/** The job handler: one page of profiles per step. */
export async function runProfileEmails(env: ProfileEmailsEnv, job: AdminJob): Promise<JobOutcome> {
	if (!env.ADMIN_BACKUPS) throw new Error('ADMIN_BACKUPS is not bound: no report, no run');
	const mode = modeOf(job);
	const page = Math.max(0, Number(job.params.page) || 0);
	const startAfter = typeof job.params.startAfter === 'string' ? job.params.startAfter : undefined;
	const prior = (job.result ?? {}) as Partial<ProfileEmailsResult>;

	const plan = await planPage(env, startAfter);
	const step = stepPath(job, page);
	// A retried step: what the first attempt found (and may already have written) stays in the report
	const before = await readStep(env.ADMIN_BACKUPS, step);
	const records = new Map<string, UserRecord>();
	const recordOf = (userId: string) => {
		let record = records.get(userId);
		if (!record) records.set(userId, (record = { entries: [...(before.get(userId)?.record.entries ?? [])] }));
		return record;
	};
	for (const userId of before.keys()) recordOf(userId);
	for (const entry of plan.entries) {
		const { entries } = recordOf(entry.userId);
		if (!entries.some((e) => e.kind === entry.kind && e.id === entry.id)) entries.push(entry);
	}
	for (const { userId, stored } of plan.noAccount) recordOf(userId).noAccount = { stored };

	await inParallel([...records], async ([userId, record]) => {
		const etag = await storeRecord(env, step, userId, record, before.get(userId)?.etag);
		if (!etag) {
			// Erased meanwhile: nothing to keep, nothing to write
			records.delete(userId);
			return;
		}
		if (mode !== 'repair' || !record.entries.length) return;
		for (const entry of record.entries) {
			const outcome = await repairOne(env, entry);
			// A retry finds its own earlier write in place: it was written by this job
			const known = before.get(userId)?.record.entries.some((e) => e.kind === entry.kind && e.id === entry.id);
			entry.outcome = outcome === 'already' && known ? 'written' : outcome;
		}
		// Only over the same record: one an erasure deleted meanwhile never comes back
		await env.ADMIN_BACKUPS!.put(recordKey(step, userId), JSON.stringify(record), { ...JSON_META, onlyIf: { etagMatches: etag } });
	});
	const entries = [...records.values()].flatMap((r) => r.entries);
	const filled = records.size > 0;

	const n = (key: keyof ProfileEmailsResult) => Number(prior[key]) || 0;
	const profiles = entries.filter((e) => e.kind === 'profile');
	const channels = entries.filter((e) => e.kind === 'channel');
	const written = (list: ProfileEmailEntry[]) => list.filter((e) => e.outcome === 'written').length;
	const missing = profiles.filter((e) => !e.stored).length;
	const result: ProfileEmailsResult = {
		mode,
		scanned: n('scanned') + plan.scanned,
		matching: n('matching') + (plan.scanned - profiles.length - plan.noAccount.length),
		differs: n('differs') + profiles.length - missing,
		missing: n('missing') + missing,
		channels: n('channels') + channels.length,
		noAccount: n('noAccount') + plan.noAccount.length,
		unreadable: n('unreadable') + plan.unreadable,
		profilesWritten: n('profilesWritten') + written(profiles),
		channelsWritten: n('channelsWritten') + written(channels),
		reportPages: [...(prior.reportPages ?? []), ...(filled ? [page] : [])],
	};
	logger.info('[ProfileEmails] Page done', { jobId: job.id, mode, page, scanned: plan.scanned, entries: entries.length, noAccount: plan.noAccount.length });
	const out = result as unknown as Row;
	if (plan.next) return { done: false, params: { ...job.params, page: page + 1, startAfter: plan.next }, result: out };
	return { done: true, result: out };
}

const ACTIVE = new Set(['queued', 'running', 'retrying']);

export const listProfileEmailJobs = (env: ProfileEmailsEnv) => listJobs(env, { targetKind: PROFILE_EMAILS_TARGET.kind, targetId: PROFILE_EMAILS_TARGET.id, limit: 20 });

/** Queues a check, or a repair after a check that finished in the last 24 hours. One at a time. */
export async function startProfileEmails(env: ProfileEmailsEnv, input: { mode: ProfileEmailsMode; checkJobId?: string }, actorId: string): Promise<{ job: AdminJob }> {
	if ((await listProfileEmailJobs(env)).some((j) => ACTIVE.has(j.status))) throw new AdminError(409, 'already_running', 'A check or repair is already running');
	if (input.mode === 'repair') {
		const check = input.checkJobId ? await getJob(env, input.checkJobId) : null;
		const done = check?.kind === 'profiles.repair-emails' && modeOf(check) === 'check' && check.status === 'succeeded';
		const age = check?.finishedAt ? Date.now() - Date.parse(check.finishedAt) : Infinity;
		if (!done || !(age <= PROFILE_EMAILS_CHECK_MAX_AGE_HOURS * 3_600_000)) throw new AdminError(409, 'check_needed', `Run a check first; a repair needs one from the last ${PROFILE_EMAILS_CHECK_MAX_AGE_HOURS} hours`);
	}
	const job = await createJob(env, {
		kind: 'profiles.repair-emails',
		targetKind: PROFILE_EMAILS_TARGET.kind,
		targetId: PROFILE_EMAILS_TARGET.id,
		params: { mode: input.mode, ...(input.mode === 'repair' ? { checkJobId: input.checkJobId } : {}) },
		actorId,
	});
	return { job };
}

/** One page of a job's private report. */
export async function profileEmailsReport(env: ProfileEmailsEnv, jobId: string, page: number): Promise<ProfileEmailsReportPage> {
	if (!/^[A-Za-z0-9-]{8,64}$/.test(jobId) || !Number.isInteger(page) || page < 0) throw new AdminError(400, 'invalid_request');
	const job = await getJob(env, jobId);
	const records = job?.kind === 'profiles.repair-emails' && env.ADMIN_BACKUPS ? await readStep(env.ADMIN_BACKUPS, stepPath(job, page)) : null;
	if (!job || !records?.size) throw new AdminError(404, 'report_not_found', 'No such report page (reports are kept 30 days)');
	const users = [...records].sort(([a], [b]) => a.localeCompare(b));
	return {
		jobId,
		mode: modeOf(job),
		page,
		entries: users.flatMap(([, { record }]) => record.entries),
		noAccount: users.flatMap(([userId, { record }]) => (record.noAccount ? [{ userId, stored: record.noAccount.stored }] : [])),
	};
}
