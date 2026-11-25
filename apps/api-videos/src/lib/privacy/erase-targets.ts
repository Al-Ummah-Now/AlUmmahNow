/**
 * What an account erasure wrote down to delete, by target (SEARCH_DB `media_erase_targets`, one row per
 * target and job): where the erasure's media job (lib/privacy/erase-media.ts) and a takedown
 * (lib/csam/contain.ts) meet, so that nothing under a case is deleted and a case always knows what
 * became of the media.
 *
 *   erase     → a row before each record goes: what its media is (ids and paths, no text)
 *   job       → takes a part of the media only while no case of its targets is open and none of them is
 *               held: one statement that marks the rows (claimed_at, the delivery's own token); then
 *               deletes the part, writes down when, and takes its own mark back. The purges of deleted
 *               records (lib/admin/service.ts) take theirs the same way
 *   takedown  → its own job row and its hold come first, so no part is taken from then on; waits for a part
 *               being deleted at that moment; works from the rows where the record is gone
 *
 * A mark counts while its job is at work, for STUCK_MS at most: no delivery runs that long. Rows that name an account go when its images are done, the others keep what
 * was deleted when (no list) for as long as the job's own row is kept.
 */
import type { AdminJob } from '@al-ummah/shared-types';

type Json = Record<string, any>;

/** video: streams too. post: `<channelId>/<postId>`. user: profile images. comment: a case's own, `<video|post>:<id>/<commentId>` (holdComment). */
export type TargetKind = 'video' | 'channel' | 'user' | 'post' | 'comment';
export interface EraseTarget {
	kind: TargetKind;
	id: string;
}

const OPEN_CASE = (kind: string, id: string) => `EXISTS (SELECT 1 FROM admin_jobs c WHERE c.target_kind = ${kind} AND c.target_id = ${id} AND c.kind = 'csam.contain' AND c.status <> 'succeeded')`;
const HELD = (kind: string, id: string) =>
	`EXISTS (SELECT 1 FROM media_erase_targets h JOIN admin_jobs c ON c.id = h.held_by WHERE h.target_kind = ${kind} AND h.target_id = ${id} AND c.status <> 'succeeded')`;

/** Binds ?2 job, ?4 token, ?5 stale: another delivery's live mark on a target of json_each `o`. */
const TAKEN = `EXISTS (SELECT 1 FROM media_erase_targets m WHERE m.target_kind = json_extract(o.value, '$[0]') AND m.target_id = json_extract(o.value, '$[1]') AND m.job_id = ?2
  AND m.claim_token IS NOT NULL AND m.claim_token <> ?4 AND m.claimed_at > ?5)`;
const pairs = (targets: readonly EraseTarget[]) => JSON.stringify(targets.map((t) => [t.kind, t.id]));

/** Writes down what a record's media is, before the record is deleted. */
export async function writeTarget(db: D1Database, target: EraseTarget, jobId: string, media: Json, now = new Date()): Promise<void> {
	await db
		.prepare(
			`INSERT INTO media_erase_targets (target_kind, target_id, job_id, erased_at, media) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (target_kind, target_id, job_id) DO UPDATE SET erased_at = excluded.erased_at, media = excluded.media`,
		)
		.bind(target.kind, target.id, jobId, now.toISOString(), JSON.stringify(media))
		.run();
}

/** No delivery runs this long (a queue consumer gets minutes): a mark older than this is nobody's. */
export const STUCK_MS = 60 * 60_000;
const stale = (now: Date) => new Date(now.getTime() - STUCK_MS).toISOString();

/** Another delivery of the same job is deleting a part of the same media. */
export class PartTaken extends Error {
	constructor() {
		super('another delivery of this job is deleting a part of it');
	}
}

/**
 * Takes a part: all of its targets or none. False while a case of one is open or one is held; throws
 * PartTaken while another delivery (token) of the job has one.
 */
export async function takePart(db: D1Database, jobId: string, token: string, targets: readonly EraseTarget[], now = new Date()): Promise<boolean> {
	const out = await db
		.prepare(
			`INSERT INTO media_erase_targets (target_kind, target_id, job_id, claimed_at, claim_token)
			 SELECT json_extract(t.value, '$[0]'), json_extract(t.value, '$[1]'), ?2, ?3, ?4 FROM json_each(?1) t
			  WHERE NOT EXISTS (SELECT 1 FROM json_each(?1) o
			    WHERE ${OPEN_CASE("json_extract(o.value, '$[0]')", "json_extract(o.value, '$[1]')")}
			       OR ${HELD("json_extract(o.value, '$[0]')", "json_extract(o.value, '$[1]')")}
			       OR ${TAKEN})
			 ON CONFLICT (target_kind, target_id, job_id) DO UPDATE SET
			   stopped_at = CASE WHEN claim_token <> excluded.claim_token THEN claimed_at ELSE stopped_at END,
			   claimed_at = excluded.claimed_at, claim_token = excluded.claim_token`,
		)
		.bind(pairs(targets), jobId, now.toISOString(), token, stale(now))
		.run();
	if (Number(out.meta?.changes ?? 0) > 0) return true;
	const taken = await db.prepare(`SELECT 1 AS n FROM json_each(?1) o WHERE ${TAKEN} AND ?3 IS NOT NULL LIMIT 1`).bind(pairs(targets), jobId, now.toISOString(), token, stale(now)).first();
	if (taken) throw new PartTaken();
	return false;
}

/** Whether another delivery of the job may be at work: it has a part that is not stale. */
export async function otherDelivery(db: D1Database, jobId: string, token: string, now = new Date()): Promise<boolean> {
	return !!(await db.prepare('SELECT 1 AS n FROM media_erase_targets WHERE job_id = ? AND claim_token IS NOT NULL AND claim_token <> ? AND claimed_at > ? LIMIT 1').bind(jobId, token, stale(now)).first());
}

/** The job's marks nobody has any more: what they deleted cannot be told. */
export async function endStaleParts(db: D1Database, jobId: string, now = new Date()): Promise<void> {
	await db.prepare('UPDATE media_erase_targets SET stopped_at = claimed_at, claimed_at = NULL, claim_token = NULL WHERE job_id = ? AND claim_token IS NOT NULL AND claimed_at <= ?').bind(jobId, stale(now)).run();
}

/** How a part ended: nothing deleted, something, or stopped where it cannot be told. */
export type PartEnd = 'none' | 'deleted' | 'stopped';

/** A delivery's own marks are taken back; what the part deleted is written down on its targets. */
export async function endParts(db: D1Database, jobId: string, token: string, end: PartEnd, now = new Date()): Promise<void> {
	const note = end === 'deleted' ? ', first_deleted_at = COALESCE(first_deleted_at, claimed_at), last_deleted_at = ?3' : end === 'stopped' ? ', stopped_at = claimed_at' : '';
	await db
		.prepare(`UPDATE media_erase_targets SET claimed_at = NULL, claim_token = NULL${note} WHERE job_id = ?1 AND claim_token = ?2`)
		.bind(jobId, token, ...(end === 'deleted' ? [now.toISOString()] : []))
		.run();
}

/** The account's images are done: nothing names it any more. */
export async function forgetAccounts(db: D1Database, jobId: string): Promise<void> {
	await db.prepare(`DELETE FROM media_erase_targets WHERE job_id = ? AND target_kind = 'user'`).bind(jobId).run();
}

/** The job is done: its rows keep what was deleted when, not the list. `all`: none of them (a run account's). */
export async function closeTargets(db: D1Database, jobId: string, opts: { all?: boolean } = {}): Promise<void> {
	if (opts.all) {
		await db.prepare('DELETE FROM media_erase_targets WHERE job_id = ?').bind(jobId).run();
		return;
	}
	await db.batch([
		db.prepare(`DELETE FROM media_erase_targets WHERE job_id = ? AND (target_kind IN ('user', 'post') OR (erased_at IS NULL AND first_deleted_at IS NULL AND stopped_at IS NULL))`).bind(jobId),
		db.prepare('UPDATE media_erase_targets SET media = NULL WHERE job_id = ?').bind(jobId),
	]);
}

/** When a record of this target was last written down for erasure, by any job. */
export async function lastErased(db: D1Database, target: EraseTarget): Promise<string | null> {
	const row = await db.prepare('SELECT MAX(erased_at) AS at FROM media_erase_targets WHERE target_kind = ? AND target_id = ?').bind(target.kind, target.id).first<{ at: string | null }>();
	return row?.at ?? null;
}

/**
 * Deletes something of `targets` as one part, unless a case of one is open or one is held (false): for
 * the purges of deleted records, which the cases must come before as well.
 */
export async function unlessUnderCase(db: D1Database, jobId: string, targets: readonly EraseTarget[], run: () => Promise<void>): Promise<boolean> {
	const token = crypto.randomUUID();
	if (!(await takePart(db, jobId, token, targets))) return false;
	let end: PartEnd = 'stopped';
	try {
		await run();
		end = 'deleted';
	} finally {
		await endParts(db, jobId, token, end);
	}
	return true;
}

/** Which of these accounts are under a takedown of their profile images. */
export async function uploadersUnderTakedown(db: D1Database, uploaders: readonly string[]): Promise<Set<string>> {
	if (!uploaders.length) return new Set();
	const { results } = await db.prepare(`SELECT u.value AS id FROM json_each(?) u WHERE ${OPEN_CASE("'user'", 'u.value')} OR ${HELD("'user'", 'u.value')}`).bind(JSON.stringify(uploaders)).all<{ id: string }>();
	return new Set((results ?? []).map((r) => r.id));
}

// ---------------------------------------------------------------------------
// For a takedown
// ---------------------------------------------------------------------------

export interface ErasedTarget extends EraseTarget {
	jobId: string;
	erasedAt: string | null;
	media: Json | null;
	/** A part of it is being deleted now */
	live: boolean;
	firstDeletedAt: string | null;
	lastDeletedAt: string | null;
	/** A part that stopped: some of it may be gone since then */
	stoppedAt: string | null;
}

/** Parts of the cleanup, which is no job (lib/admin/service.ts purgeDeletion). */
export const CLEANUP = 'cleanup:';

/** What erasures wrote down about a target, the newest first. */
export async function erasedTargets(db: D1Database | undefined, target: EraseTarget, now = new Date()): Promise<ErasedTarget[]> {
	if (!db) return [];
	const { results } = await db
		.prepare(
			`SELECT t.job_id, t.erased_at, t.media, t.claimed_at, t.first_deleted_at, t.last_deleted_at, t.stopped_at, j.status
			   FROM media_erase_targets t LEFT JOIN admin_jobs j ON j.id = t.job_id
			  WHERE t.target_kind = ? AND t.target_id = ?`,
		)
		.bind(target.kind, target.id)
		.all<Record<string, string | null>>();
	return (results ?? [])
		.map((r) => {
			const live = !!r.claimed_at && r.claimed_at > stale(now) && (['queued', 'running', 'retrying'].includes(r.status ?? '') || String(r.job_id).startsWith(CLEANUP));
			return {
				...target,
				jobId: String(r.job_id),
				erasedAt: r.erased_at,
				media: r.media ? (JSON.parse(r.media) as Json) : null,
				live,
				firstDeletedAt: r.first_deleted_at,
				lastDeletedAt: r.last_deleted_at,
				stoppedAt: r.stopped_at ?? (r.claimed_at && !live ? r.claimed_at : null),
			};
		})
		.sort((a, b) => (b.erasedAt ?? '').localeCompare(a.erasedAt ?? ''));
}

/** What stands in for a record an erasure deleted: its ids and media paths, as the record named them. */
export async function erasedRecord(db: D1Database | undefined, target: EraseTarget): Promise<Json | null> {
	return (await erasedTargets(db, target)).find((t) => t.media)?.media ?? null;
}

/** Holds the targets' media for a case, written down or not yet: no part of it is taken until the case's job is done. */
export async function holdTargets(db: D1Database, targets: readonly EraseTarget[], caseJob: Pick<AdminJob, 'id'>): Promise<void> {
	if (!targets.length) return;
	await db.batch(
		targets.map((t) =>
			db.prepare('INSERT INTO media_erase_targets (target_kind, target_id, job_id, held_by) VALUES (?1, ?2, ?3, ?3) ON CONFLICT (target_kind, target_id, job_id) DO UPDATE SET held_by = excluded.held_by').bind(t.kind, t.id, caseJob.id),
		),
	);
}

/**
 * A comment as the case found it, until the evidence has it: a comment is text in a record, which its author's
 * or the record's erasure (or any other removal) takes away at once. The first one written stays.
 */
export async function holdComment(db: D1Database, id: string, caseJob: Pick<AdminJob, 'id'>, comment: Json): Promise<void> {
	await db
		.prepare(
			`INSERT INTO media_erase_targets (target_kind, target_id, job_id, held_by, media) VALUES ('comment', ?1, ?2, ?2, ?3)
			 ON CONFLICT (target_kind, target_id, job_id) DO NOTHING`,
		)
		.bind(id, caseJob.id, JSON.stringify(comment))
		.run();
}

/** The evidence has it. */
export async function releaseComment(db: D1Database, caseJobId: string): Promise<void> {
	await db.prepare("DELETE FROM media_erase_targets WHERE job_id = ? AND target_kind = 'comment'").bind(caseJobId).run();
}

/** The case's job is done. */
export async function releaseHolds(db: D1Database, caseJobId: string): Promise<void> {
	await db.prepare('DELETE FROM media_erase_targets WHERE job_id = ? AND held_by IS NOT NULL').bind(caseJobId).run();
}

/** What a case's evidence says of an erased record, or null when there is nothing to say. */
export function erasureNote(target: EraseTarget, rows: readonly ErasedTarget[], recordGone: boolean): { name: string; source: string; reason: string } | null {
	const erased = rows.map((r) => r.erasedAt).filter((at): at is string => !!at).sort()[0];
	const first = rows.map((r) => r.firstDeletedAt).filter((at): at is string => !!at).sort()[0];
	const last = rows.map((r) => r.lastDeletedAt).filter((at): at is string => !!at).sort().at(-1);
	const stopped = rows.map((r) => r.stoppedAt).filter((at): at is string => !!at).sort()[0];
	const gone = recordGone && !!erased;
	if (!gone && !first && !stopped) return null;
	const what = [
		...(first ? [`some or all of its media was deleted between ${first} and ${last}`] : []),
		...(stopped ? [`a deletion that stopped at ${stopped} may have removed part of its media`] : []),
	];
	const parts = [...(gone ? [`the record was erased on ${erased} by account deletion`] : []), ...(what.length ? what : ['its media was kept'])];
	// An erased account is not named
	return { name: gone ? 'record' : 'media', source: target.kind === 'user' && recordGone ? 'profile' : `${target.kind} ${target.id}`, reason: parts.join('; ') };
}
