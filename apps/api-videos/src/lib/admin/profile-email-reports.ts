/**
 * The private reports of the job 'profiles.repair-emails' (profile-emails.ts): one object per user and
 * step, so they are found by age and by person through their keys, without a scan.
 *
 *   profile-emails/reports/{day}/{jobId}/{page}/{userId}.json   the record
 *   profile-emails/by-user/{userId}/{day}/{jobId}/{page}        its pointer (empty)
 *
 * Records are deleted after 30 days (daily cron, sweepProfileEmailReports: keys sort by day, so it reads
 * only expired ones; sweepProfileEmailPointers removes a pointer left alone) and with the account (eraseProfileEmailReports: the user's own pointers). An email is
 * written only after its pointer exists, and a record of a profile erased meanwhile is removed again.
 */
import type { AdminJob, ProfileEmailEntry } from '@al-ummah/shared-types';
import { deleteKeys, listKeys, type BucketLike, type OperationBudget } from '../privacy/scan';
import { CREATE_ONLY } from '../r2Repo';

export const REPORT_PREFIX = 'profile-emails/';
export const REPORT_DAYS = 30;
const CONCURRENCY = 8;

const RECORDS = `${REPORT_PREFIX}reports/`;
const POINTERS = `${REPORT_PREFIX}by-user/`;
/** The step a report record belongs to: the job's day, its id and the page. */
export const stepPath = (job: Pick<AdminJob, 'id' | 'createdAt'>, page: number) => `${job.createdAt.slice(0, 10)}/${job.id}/${String(page).padStart(6, '0')}`;
export const recordKey = (step: string, userId: string) => `${RECORDS}${step}/${userId}.json`;
const pointerKey = (userId: string, step: string) => `${POINTERS}${userId}/${step}`;

/** One user's part of a report page. */
export interface UserRecord {
	entries: ProfileEmailEntry[];
	/** Set when the user id has no account: what the profile has stored */
	noAccount?: { stored: string | null };
}

/** Runs `work` over the items, eight at a time. */
export async function inParallel<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
			while (next < items.length) await work(items[next++]);
		}),
	);
}

/** The records of a step, by user (one list of the step's own prefix). */
export async function readStep(bucket: R2Bucket, step: string): Promise<Map<string, { record: UserRecord; etag: string }>> {
	const out = new Map<string, { record: UserRecord; etag: string }>();
	const prefix = `${RECORDS}${step}/`;
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, limit: 1000, cursor });
		keys.push(...page.objects.map((o) => o.key));
		cursor = page.truncated ? (page as { cursor?: string }).cursor : undefined;
	} while (cursor);
	await inParallel(keys, async (key) => {
		const object = await bucket.get(key);
		if (!object) return;
		out.set(key.slice(prefix.length, -'.json'.length), { record: JSON.parse(await object.text()) as UserRecord, etag: object.etag });
	});
	return out;
}

export const JSON_META = { httpMetadata: { contentType: 'application/json' } };

/**
 * Stores a user's record: an empty one first (so the sweep finds the step), then its pointer (so an
 * erasure finds it), then the emails. Resolves to its etag; null when the profile was erased meanwhile:
 * the erasure deletes the profile before the pointers, so one of the two always sees the other.
 */
export async function storeRecord(env: { profiles: R2Bucket; ADMIN_BACKUPS?: R2Bucket }, step: string, userId: string, record: UserRecord, etag: string | undefined): Promise<string | null> {
	const bucket = env.ADMIN_BACKUPS!;
	const key = recordKey(step, userId);
	let current = etag ?? (await bucket.put(key, JSON.stringify({ entries: [] }), { ...JSON_META, onlyIf: CREATE_ONLY }))?.etag;
	if (!current) throw new Error('A report record appeared while this step ran; retrying');
	await bucket.put(pointerKey(userId, step), '', JSON_META);
	current = (await bucket.put(key, JSON.stringify(record), { ...JSON_META, onlyIf: { etagMatches: current } }))?.etag;
	if (!(await env.profiles.head(userId))) {
		await bucket.delete([key, pointerKey(userId, step)]);
		return null;
	}
	// Not an erasure: another delivery of this step changed it. The retry reads what is there
	if (!current) throw new Error('A report record changed while this step ran; retrying');
	return current;
}

/** Account erasure: deletes every report record that names the user, then their pointers (a prefix of their own). */
export async function eraseProfileEmailReports(bucket: BucketLike, userId: string, budget: OperationBudget): Promise<number> {
	const prefix = `${POINTERS}${userId}/`;
	const steps: string[] = [];
	for await (const { key } of listKeys(bucket, budget, prefix)) steps.push(key.slice(prefix.length));
	const deleted = await deleteKeys(bucket, steps.map((step) => recordKey(step, userId)), budget);
	await deleteKeys(bucket, steps.map((step) => pointerKey(userId, step)), budget);
	return deleted;
}

/** The first day whose reports are kept. */
const keptFrom = (now: Date) => new Date(now.getTime() - REPORT_DAYS * 86_400_000).toISOString().slice(0, 10);

/** Daily: deletes the records older than 30 days with their pointers. Keys sort by day, so it stops at the first one to keep. */
export async function sweepProfileEmailReports(bucket: BucketLike, now: Date, budget: OperationBudget): Promise<number> {
	const keepFrom = keptFrom(now);
	let deleted = 0;
	const expired: string[] = [];
	const flush = async () => {
		const records = expired.splice(0);
		const pointers = records.map((key) => {
			const path = key.slice(RECORDS.length, -'.json'.length);
			const cut = path.lastIndexOf('/');
			return pointerKey(path.slice(cut + 1), path.slice(0, cut));
		});
		// One delete call: the pointers never outlive their records
		await deleteKeys(bucket, [...records, ...pointers], budget);
		deleted += records.length;
	};
	for await (const { key } of listKeys(bucket, budget, RECORDS)) {
		if (key.slice(RECORDS.length, RECORDS.length + 10) >= keepFrom) break;
		expired.push(key);
		if (expired.length >= 500) await flush();
	}
	if (expired.length) await flush();
	return deleted;
}

/**
 * Daily, after the records: deletes expired pointers whose record is gone already (a crash while the
 * account was being erased). Pointers are empty and sort by user, so it lists the pointer prefix, which
 * holds about 30 days of them.
 */
export async function sweepProfileEmailPointers(bucket: BucketLike, now: Date, budget: OperationBudget): Promise<number> {
	const keepFrom = keptFrom(now);
	const expired: string[] = [];
	let deleted = 0;
	for await (const { key } of listKeys(bucket, budget, POINTERS)) {
		const day = key.slice(POINTERS.length).split('/')[1] ?? '';
		if (day >= keepFrom) continue;
		expired.push(key);
		if (expired.length >= 1000) deleted += await deleteKeys(bucket, expired.splice(0), budget);
	}
	if (expired.length) deleted += await deleteKeys(bucket, expired, budget);
	return deleted;
}
