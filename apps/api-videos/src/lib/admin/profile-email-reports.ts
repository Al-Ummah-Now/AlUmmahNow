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
import { deleteKeys, listKeys, readJson, writeJson, type BucketLike, type OperationBudget } from '../privacy/scan';
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

/** Where a paused pointer sweep goes on (a key, no email). */
export const SWEEP_CURSOR_KEY = `${REPORT_PREFIX}pointer-sweep.json`;

/** Account erasure: deletes every report record that names the user, then their pointers (a prefix of their own). */
export async function eraseProfileEmailReports(bucket: BucketLike, userId: string, budget: OperationBudget): Promise<number> {
	const prefix = `${POINTERS}${userId}/`;
	const steps: string[] = [];
	for await (const { key } of listKeys(bucket, budget, prefix)) steps.push(key.slice(prefix.length));
	const deleted = await deleteKeys(bucket, steps.map((step) => recordKey(step, userId)), budget);
	await deleteKeys(bucket, steps.map((step) => pointerKey(userId, step)), budget);
	// A paused pointer sweep may have stopped at one of them: it starts over instead of naming the user
	const cursor = await readJson<{ after?: unknown }>(bucket, SWEEP_CURSOR_KEY, budget);
	if (typeof cursor?.after === 'string' && cursor.after.startsWith(prefix)) await deleteKeys(bucket, [SWEEP_CURSOR_KEY], budget);
	return deleted;
}

/** The first day whose reports are kept. */
const keptFrom = (now: Date) => new Date(now.getTime() - REPORT_DAYS * 86_400_000).toISOString().slice(0, 10);

const DAY = String.raw`(\d{4}-\d{2}-\d{2})`;
const RECORD_KEY = new RegExp(`^${RECORDS}${DAY}/([^/]+)/(\\d{6})/([^/]+)\\.json$`);
const POINTER_KEY = new RegExp(`^${POINTERS}([^/]+)/${DAY}/([^/]+)/(\\d{6})$`);

interface ReportKey {
	userId: string;
	day: string;
	/** `{day}/{jobId}/{page}` */
	step: string;
}

/** The parts of a record or pointer key; null for a key that is not exactly one (never deleted). */
export function parseReportKey(key: string): ReportKey | null {
	const record = RECORD_KEY.exec(key);
	const [day, jobId, page, userId] = record ? record.slice(1) : (([, u, d, j, n]) => [d, j, n, u])(POINTER_KEY.exec(key) ?? []);
	if (!day || !jobId || !page || !userId || Number.isNaN(Date.parse(day))) return null;
	return { userId, day, step: `${day}/${jobId}/${page}` };
}

/** What the sweeps need of the bucket (R2Bucket, the test MemoryBucket). */
export interface SweepBucket extends BucketLike {
	head(key: string): Promise<unknown>;
	list(options?: { prefix?: string; cursor?: string; limit?: number; startAfter?: string }): ReturnType<BucketLike['list']>;
}

export interface SweepResult {
	deleted: number;
	/** The operation limit was reached; the next run goes on from there */
	paused: boolean;
}

/** Records (and as many pointers) per page and delete call. */
const SWEEP_PAGE = 500;

/**
 * Daily: deletes the records older than 30 days with their pointers. Keys sort by day, so it stops at the
 * first one to keep, and a paused run goes on by itself: what it deleted is gone.
 */
export async function sweepProfileEmailReports(bucket: SweepBucket, now: Date, budget: OperationBudget): Promise<SweepResult> {
	const keepFrom = keptFrom(now);
	let deleted = 0;
	let startAfter: string | undefined;
	for (;;) {
		// One page: the list and the delete of what it found
		if (budget.remaining < 2) return { deleted, paused: true };
		budget.spend();
		const page = await bucket.list({ prefix: RECORDS, limit: SWEEP_PAGE, ...(startAfter ? { startAfter } : {}) });
		const keys: string[] = [];
		let records = 0;
		let reachedKept = false;
		for (const { key } of page.objects) {
			const parsed = parseReportKey(key);
			if (!parsed) continue;
			if (parsed.day >= keepFrom) {
				reachedKept = true;
				break;
			}
			// One delete call: the pointers never outlive their records
			keys.push(key, pointerKey(parsed.userId, parsed.step));
			records++;
		}
		if (keys.length) await deleteKeys(bucket, keys, budget);
		deleted += records;
		startAfter = page.objects[page.objects.length - 1]?.key;
		if (reachedKept || !page.truncated || !startAfter) return { deleted, paused: false };
	}
}

const HEADS = 8;
/** Kept back for the last delete and the cursor. */
const RESERVE = 2;

/**
 * Daily, after the records: deletes expired pointers whose record is gone (a crash while the account was
 * being erased). A pointer whose record is still there stays, or an erasure could not find the record.
 * Pointers are empty and sort by user, so it lists the pointer prefix (about 30 days of them) and, when
 * its operation limit is reached, stores where the next run goes on.
 */
export async function sweepProfileEmailPointers(bucket: SweepBucket, now: Date, budget: OperationBudget): Promise<SweepResult> {
	const keepFrom = keptFrom(now);
	const stored = await readJson<{ after?: string }>(bucket, SWEEP_CURSOR_KEY, budget);
	let after = typeof stored?.after === 'string' && stored.after.startsWith(POINTERS) ? stored.after : undefined;
	const orphans: string[] = [];
	let deleted = 0;
	const flush = async () => {
		if (orphans.length) deleted += await deleteKeys(bucket, orphans.splice(0), budget);
	};
	let paused = false;
	for (let more = true; more && !paused; ) {
		if (budget.remaining <= RESERVE) {
			paused = true;
			break;
		}
		budget.spend();
		const page = await bucket.list({ prefix: POINTERS, limit: 1000, ...(after ? { startAfter: after } : {}) });
		const keys = page.objects.map((o) => o.key);
		for (let i = 0; i < keys.length; ) {
			const parsed = parseReportKey(keys[i]);
			if (!parsed || parsed.day >= keepFrom) {
				after = keys[i++];
				continue;
			}
			// The next few expired pointers, each with its record's HEAD
			const batch: { key: string; record: string }[] = [];
			const room = Math.min(HEADS, budget.remaining - RESERVE - (orphans.length + HEADS > 1000 ? 1 : 0));
			if (room <= 0) {
				paused = true;
				break;
			}
			for (; i < keys.length && batch.length < room; i++) {
				const next = parseReportKey(keys[i]);
				if (!next || next.day >= keepFrom) break;
				batch.push({ key: keys[i], record: recordKey(next.step, next.userId) });
			}
			if (orphans.length + batch.length > 1000) await flush();
			budget.spend(batch.length);
			const found = await Promise.all(batch.map((b) => bucket.head(b.record)));
			batch.forEach((b, n) => {
				if (!found[n]) orphans.push(b.key);
			});
			after = batch[batch.length - 1].key;
		}
		more = page.truncated && keys.length > 0;
	}
	await flush();
	// A run that reached the end starts over next time
	if (paused && after) await writeJson(bucket, SWEEP_CURSOR_KEY, { after }, budget);
	else if (stored) await deleteKeys(bucket, [SWEEP_CURSOR_KEY], budget);
	return { deleted, paused };
}
