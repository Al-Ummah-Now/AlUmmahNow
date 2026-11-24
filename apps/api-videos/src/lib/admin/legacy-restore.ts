/**
 * Admin job "Restore legacy profile fields" ('profiles.restore-legacy').
 *
 * Before SSO, video profiles were stored under a 32-hex user id; SSO gave
 * every user a usr_ id and a new profile, and fields set on the old record (an
 * Arabic name, photos) were not carried over. The planning rules are shared
 * with the CLI (shared-types legacy-profiles.ts): only EMPTY fields are filled,
 * nothing a user set is replaced.
 *
 *   dry run  planLegacyRestore(): reads, never writes. A legacy record is paired
 *            with the usr_ profile whose auth-service email (AUTH_DB users.email,
 *            the address the user verified with a code) is the legacy email;
 *            the profile's own `email` is user-editable and never decides it.
 *   run      the admin approves the plan; the job (runLegacyRestore) fills only
 *            the approved fields, on a fresh copy of each profile: it saves that
 *            copy to the private ADMIN_BACKUPS bucket first, then writes with a
 *            conditional put on the copy's etag (a concurrent change re-plans).
 *            Running it again changes nothing (filled fields are no longer empty).
 *
 * admin-api checks users:manage and writes one audit row per profile before
 * the job is queued; the job's result lists what it wrote and the backup keys.
 */
import {
	isLegacyId,
	isUsrId,
	pairProfiles,
	planProfile,
	type AdminJob,
	type LegacyRestoreItem,
	type LegacyRestorePlan,
	type LegacyRestoreResult,
	type StoredProfile,
} from '@al-ummah/shared-types';
import { CREATE_ONLY } from '../r2Repo';
import { logger } from '../logger';
import { DEFAULT_OPERATION_BUDGET, OperationBudget, asBucket, deleteKeys, listKeys, type BucketLike } from '../privacy/scan';

/** The auth service's D1 (read only: `SELECT id, email FROM users`). */
export interface AuthUsersDb {
	prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } };
}

export interface LegacyRestoreEnv {
	profiles: R2Bucket;
	/** Auth service D1, bound read-only by convention: only SELECTs on users. */
	AUTH_DB?: AuthUsersDb;
	/** Private bucket for pre-change copies (never public, never listed by an API). */
	ADMIN_BACKUPS?: R2Bucket;
}

export class LegacyRestoreError extends Error {
	constructor(readonly status: 409 | 503, readonly code: string, message: string) {
		super(message);
	}
}

/** Legacy records are few and nothing writes them any more; past this, use the CLI. */
export const LEGACY_SCAN_LIMIT = 300;
const READ_CONCURRENCY = 8;
const WRITE_ATTEMPTS = 5;
const norm = (email: unknown) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

function authDb(env: LegacyRestoreEnv): AuthUsersDb {
	if (!env.AUTH_DB) throw new LegacyRestoreError(503, 'auth_db_unbound', 'AUTH_DB is not bound: verified emails cannot be read');
	return env.AUTH_DB;
}

async function readProfiles(bucket: R2Bucket, keys: string[]): Promise<StoredProfile[]> {
	const out: StoredProfile[] = [];
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(READ_CONCURRENCY, keys.length) }, async () => {
			while (next < keys.length) {
				const key = keys[next++];
				const object = await bucket.get(key);
				if (!object) continue;
				try {
					out.push({ ...(JSON.parse(await object.text()) as StoredProfile), id: key });
				} catch {
					logger.warn('[LegacyRestore] Profile is not JSON; left alone', { key });
				}
			}
		}),
	);
	return out;
}

async function legacyKeys(bucket: R2Bucket): Promise<string[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ limit: 1000, cursor });
		keys.push(...page.objects.map((o) => o.key).filter(isLegacyId));
		cursor = page.truncated ? (page as { cursor?: string }).cursor : undefined;
	} while (cursor);
	return keys;
}

/** Auth users (id → verified email) with one of these emails, or with one of these ids. */
async function authUsers(db: AuthUsersDb, by: { emails?: string[]; ids?: string[] }): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const [column, values] = by.emails ? ['lower(email)', by.emails] : ['id', by.ids ?? []];
	for (let i = 0; i < values.length; i += 50) {
		const chunk = values.slice(i, i + 50);
		const { results } = await db
			.prepare(`SELECT id, email FROM users WHERE deleted_at IS NULL AND ${column} IN (${chunk.map(() => '?').join(',')})`)
			.bind(...chunk)
			.all<{ id: string; email: string }>();
		for (const row of results ?? []) out.set(row.id, row.email);
	}
	return out;
}

/** The dry run: what the job would fill. Reads only. */
export async function planLegacyRestore(env: LegacyRestoreEnv): Promise<LegacyRestorePlan> {
	const db = authDb(env);
	const keys = await legacyKeys(env.profiles);
	if (keys.length > LEGACY_SCAN_LIMIT) {
		throw new LegacyRestoreError(409, 'too_many_legacy_records', `${keys.length} legacy records (more than ${LEGACY_SCAN_LIMIT}): use scripts/data/backfill-legacy-profiles.ts`);
	}
	const legacy = await readProfiles(env.profiles, keys);
	const emails = [...new Set(legacy.map((p) => norm(p.email)).filter(Boolean))];
	const authEmails = emails.length ? await authUsers(db, { emails }) : new Map<string, string>();
	const usrIds = [...authEmails.keys()].filter(isUsrId);
	// Soft-deleted profiles (pending 30-day purge) are never restored or backed up
	const current = (await readProfiles(env.profiles, usrIds)).filter((p) => !p.adminDeletion);

	const { pairs, unmatched, ambiguous } = pairProfiles([...legacy, ...current], authEmails);
	const items: LegacyRestoreItem[] = [];
	for (const { current: profile, legacy: record } of pairs) {
		if (!record) continue;
		const plan = planProfile(profile, record);
		if (plan.changes.length) items.push({ id: profile.id, legacyId: record.id, email: norm(authEmails.get(profile.id)), changes: plan.changes });
	}
	return {
		legacyCount: legacy.length,
		pairedCount: pairs.filter((p) => p.legacy).length,
		items: items.sort((a, b) => a.id.localeCompare(b.id)),
		unmatched: unmatched.sort(),
		ambiguousCount: ambiguous.length,
	};
}

export interface ApprovedRestore {
	id: string;
	legacyId: string;
	fields: string[];
}

/**
 * The approved items the job will run: each must still be in a fresh plan, and
 * only its fields that are still planned are kept (an admin cannot approve a
 * field the rules would not fill).
 */
export function approvedFromPlan(plan: LegacyRestorePlan, requested: ApprovedRestore[]): ApprovedRestore[] {
	const byId = new Map(plan.items.map((item) => [item.id, item]));
	const out: ApprovedRestore[] = [];
	for (const want of requested) {
		const item = byId.get(want.id);
		if (!item || item.legacyId !== want.legacyId) continue;
		const planned = new Set(item.changes.map((c) => c.field));
		const fields = [...new Set(want.fields)].filter((f) => planned.has(f));
		if (fields.length) out.push({ id: item.id, legacyId: item.legacyId, fields });
	}
	return out;
}

export const LEGACY_RESTORE_PREFIX = 'legacy-restore/';
/** Per-user pointer index so account erasure finds a user's copies without listing legacy-restore/. */
export const LEGACY_RESTORE_POINTERS_PREFIX = `${LEGACY_RESTORE_PREFIX}by-user/`;
const JSON_META = { httpMetadata: { contentType: 'application/json' } };
const cleanEtag = (etag: string) => etag.replace(/[^A-Za-z0-9_-]/g, '');

/** Backup key of the copy a write replaces: one per job, profile and stored version. */
export const backupKey = (jobId: string, profileId: string, etag: string) =>
	`${LEGACY_RESTORE_PREFIX}${jobId}/${profileId}/${cleanEtag(etag)}.json`;

/** Per-user pointer to a backup copy: legacy-restore/by-user/{profileId}/{jobId}/{etag}. */
export const backupPointerKey = (profileId: string, jobId: string, etag: string) =>
	`${LEGACY_RESTORE_POINTERS_PREFIX}${profileId}/${jobId}/${cleanEtag(etag)}`;

/** Error recorded on erasure summaries/job results when ADMIN_BACKUPS is unbound. */
export const ADMIN_BACKUPS_UNBOUND_ERROR = 'ADMIN_BACKUPS is not bound: legacy-restore backups were not erased';

/** Derive the backup object key from one of a user's pointer keys; null if malformed. */
export function backupKeyFromPointer(userId: string, pointerKey: string): string | null {
	if (!userId || userId.includes('/')) return null;
	const prefix = `${LEGACY_RESTORE_POINTERS_PREFIX}${userId}/`;
	if (!pointerKey.startsWith(prefix)) return null;
	const parts = pointerKey.slice(prefix.length).split('/');
	if (parts.length !== 2) return null;
	const [jobId, etag] = parts;
	if (!jobId || jobId === 'by-user' || !etag || !/^[A-Za-z0-9_-]+$/.test(etag)) return null;
	return `${LEGACY_RESTORE_PREFIX}${jobId}/${userId}/${etag}.json`;
}

/**
 * Account erasure: deletes every legacy-restore profile backup belonging to `userId`,
 * found strictly through the user's own pointer prefix (never lists legacy-restore/).
 * Deletes backup copies before pointers so a budget cutoff or retry never orphans a copy.
 */
export async function eraseLegacyRestoreBackups(bucket: BucketLike, userId: string, budget: OperationBudget): Promise<number> {
	if (!userId || userId.includes('/')) return 0;
	const prefix = `${LEGACY_RESTORE_POINTERS_PREFIX}${userId}/`;
	let deleted = 0;
	const pending: string[] = [];
	const flush = async () => {
		const pointers = pending.splice(0);
		const backups = pointers
			.map((key) => backupKeyFromPointer(userId, key))
			.filter((key): key is string => key !== null);
		deleted += await deleteKeys(bucket, backups, budget);
		await deleteKeys(bucket, pointers, budget);
	};
	for await (const { key } of listKeys(bucket, budget, prefix)) {
		pending.push(key);
		if (pending.length >= 500) await flush();
	}
	if (pending.length) await flush();
	return deleted;
}

/** Fills one approved profile. Returns what it wrote, or why it skipped. */
async function restoreOne(env: LegacyRestoreEnv, job: AdminJob, item: ApprovedRestore): Promise<LegacyRestoreResult['written'][number] | { id: string; reason: string }> {
	const backups = env.ADMIN_BACKUPS;
	if (!backups) throw new Error('ADMIN_BACKUPS is not bound: no write without a backup');
	const [legacy] = await readProfiles(env.profiles, [item.legacyId]);
	if (!legacy) return { id: item.id, reason: 'legacy record is gone' };

	const created: Array<{ key: string; pointer: string }> = [];
	const cleanupBackups = async () => {
		if (!created.length) return;
		const batch = created.splice(0);
		await backups.delete(batch.map((b) => b.key));
		await backups.delete(batch.map((b) => b.pointer));
	};
	/** Deletes tracked copies and sweeps the user's pointer prefix (covering crashed prior attempts on retry). */
	const sweepUserBackups = async () => {
		await cleanupBackups();
		await eraseLegacyRestoreBackups(asBucket(backups), item.id, new OperationBudget(DEFAULT_OPERATION_BUDGET));
	};

	// Pairing is checked again on the verified email: an account may have changed since the dry run
	const auth = await authUsers(authDb(env), { ids: [item.id] });
	if (!norm(legacy.email) || norm(auth.get(item.id)) !== norm(legacy.email)) {
		if (!auth.has(item.id) && !(await env.profiles.head(item.id))) await sweepUserBackups();
		return { id: item.id, reason: 'verified email no longer matches the legacy record' };
	}

	const only = new Set(item.fields);
	for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
		const object = await env.profiles.get(item.id);
		if (!object) {
			await sweepUserBackups();
			return { id: item.id, reason: 'profile is gone' };
		}
		const raw = await object.text();
		const stored = JSON.parse(raw) as StoredProfile;
		if (stored.adminDeletion) {
			await sweepUserBackups();
			return { id: item.id, reason: 'profile is pending deletion' };
		}
		const plan = planProfile({ ...stored, id: item.id }, legacy, { only });
		if (!plan.changes.length) return { id: item.id, reason: 'nothing left to fill' };

		// Per-user pointer first (so a concurrent erasure always finds the copy), then the
		// pre-change copy (create-only: a retry never overwrites the original). Track before
		// the first write so a throw during either backup put or profiles.put cleans them up.
		const key = backupKey(job.id, item.id, object.etag);
		const pointer = backupPointerKey(item.id, job.id, object.etag);
		created.push({ key, pointer });

		let written: R2Object | null;
		try {
			await backups.put(pointer, '', JSON_META);
			await backups.put(key, raw, {
				onlyIf: CREATE_ONLY,
				...JSON_META,
				customMetadata: { jobId: job.id, profileId: item.id, legacyId: item.legacyId, actorId: job.actorId },
			});
			const next: Record<string, unknown> = { ...plan.next };
			if (!('id' in stored)) delete next.id;
			written = await env.profiles.put(item.id, JSON.stringify(next), {
				...JSON_META,
				onlyIf: { etagMatches: object.etag },
			});
		} catch (error) {
			await cleanupBackups().catch(() => undefined);
			const gone = await env.profiles.head(item.id).then((h) => !h, () => false);
			if (gone) await eraseLegacyRestoreBackups(asBucket(backups), item.id, new OperationBudget(DEFAULT_OPERATION_BUDGET)).catch(() => undefined);
			throw error;
		}
		if (written) {
			const fields = plan.changes.map((c) => c.field);
			logger.info('[LegacyRestore] Filled profile fields', { jobId: job.id, profileId: item.id, legacyId: item.legacyId, fields, backupKey: key });
			return { id: item.id, legacyId: item.legacyId, fields, backupKey: key };
		}
		// Conditional put failed: either another writer updated the profile, or an erasure removed it.
		// If the profile is gone or erasure already removed our pointer, sweep and stop so neither
		// the profile nor its backup survives erasure.
		if (!(await env.profiles.head(item.id)) || !(await backups.head(pointer))) {
			await sweepUserBackups();
			return { id: item.id, reason: 'profile is gone' };
		}
		logger.warn('[LegacyRestore] Profile changed meanwhile; re-planning', { jobId: job.id, profileId: item.id, attempt });
	}
	throw new Error(`Profile ${item.id} kept changing; gave up after ${WRITE_ATTEMPTS} attempts`);
}

/**
 * The job handler: one profile per step (the job queues itself for the next),
 * so a retry resumes where it stopped and the result keeps every step. A step
 * is idempotent: a profile already filled is skipped as "nothing left to fill".
 */
export async function runLegacyRestore(
	env: LegacyRestoreEnv,
	job: AdminJob,
): Promise<{ done: true; result: Record<string, unknown> } | { done: false; params: Record<string, unknown>; result: Record<string, unknown> }> {
	const approved = Array.isArray(job.params.approved) ? (job.params.approved as ApprovedRestore[]) : [];
	const index = Math.max(0, Number(job.params.next) || 0);
	const prior = job.result as Partial<LegacyRestoreResult> | null;
	const result: LegacyRestoreResult = { written: [...(prior?.written ?? [])], skipped: [...(prior?.skipped ?? [])] };
	const item = approved[index];
	if (item) {
		if (typeof item.id !== 'string' || !isUsrId(item.id) || typeof item.legacyId !== 'string' || !isLegacyId(item.legacyId) || !Array.isArray(item.fields)) {
			result.skipped.push({ id: String(item?.id ?? '?'), reason: 'malformed item' });
		} else {
			const outcome = await restoreOne(env, job, item);
			if ('reason' in outcome) result.skipped.push(outcome);
			else result.written.push(outcome);
		}
	}
	const out = result as unknown as Record<string, unknown>;
	if (index + 1 < approved.length) return { done: false, params: { ...job.params, next: index + 1 }, result: out };
	return { done: true, result: out };
}
