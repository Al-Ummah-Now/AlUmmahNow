/**
 * Privacy footprints (#1073; migrations/search/0028_privacy_footprints.sql).
 *
 * Account erasure (./user-data.ts) must reach the user's data inside records
 * keyed by someone else: likes and comments embedded in other people's
 * videos, legacy subscriptions[] of other channels, community comments,
 * likes, votes and comment likes under other people's posts, posts written
 * on channels the user does not own, playlists and reports. None of those
 * keys start with the user id, so the erase used to list whole buckets.
 *
 * Every write to those buckets now records who it names (withFootprints,
 * applied by lib/search/sync.ts withSearchSync), and a one-time pass per
 * bucket (runFootprintBackfillStep, chained on PROCESSING_CHECK_QUEUE)
 * records what was written before. Rows are only added: a later unlike or a
 * deleted comment leaves the row, so the erase reads a superset and changes
 * only what still names the user.
 *
 * Trust rule: a bucket's rows are used only when its last apply pass finished
 * (search_meta `privacy:footprints:complete:<bucket>` = the pass's start
 * time) and no footprint write failed since (`privacy:footprints:invalid:<bucket>`
 * updated after that start). Otherwise the erase scans the bucket as before.
 */
import type { SearchDb, SearchStatement } from '@al-ummah/shared-types';
import { logger } from '../logger';

export const FOOTPRINT_BUCKETS = ['videos', 'channels', 'community_posts', 'playlists', 'reports'] as const;
export type FootprintBucket = (typeof FOOTPRINT_BUCKETS)[number];

export type FootprintKind = 'video' | 'channel' | 'post' | 'post-author' | 'playlist' | 'report';

/** Who a stored object names. `whole`: derived from the entire record (all of its users). */
export interface Footprint {
	kind: FootprintKind;
	targetId: string;
	userIds: string[];
	whole: boolean;
}

/** Tombstone of erased users (lib/privacy/user-data.ts DELETED_USER_ID): never recorded. */
const ERASED_USER_ID = 'deleted-user';

const VIDEO_INTERNAL_PREFIXES = ['index:', 'metadata:', 'livestream:'];

type Json = Record<string, any>;

export function isFootprintBucket(name: string): name is FootprintBucket {
	return (FOOTPRINT_BUCKETS as readonly string[]).includes(name);
}

function userIdOf(value: unknown): string | null {
	return typeof value === 'string' && value && value !== ERASED_USER_ID ? value : null;
}

function uniqueSorted(ids: Iterable<string | null>): string[] {
	return [...new Set([...ids].filter((id): id is string => !!id))].sort();
}

/** A community post document key: posts/{channelId}/{postId}.json (not the channel's index.json). */
export function isCommunityPostKey(key: string): boolean {
	const parts = key.split('/');
	return parts.length === 3 && parts[0] === 'posts' && !!parts[1] && parts[2].endsWith('.json') && parts[2] !== 'index.json';
}

/** A community comment document (not an index, the pinned pointer or a reply-parent pointer). */
export function isCommunityCommentKey(key: string): boolean {
	return key.startsWith('comments/') && key.endsWith('.json') && !key.endsWith('/index.json') && !key.endsWith('/pinned.json') && !key.includes('/reply-parents/');
}

/** Whether footprintsOf needs the stored value for this key (otherwise the key alone says who). */
export function footprintNeedsValue(bucket: FootprintBucket, key: string): boolean {
	switch (bucket) {
		case 'videos':
			return !VIDEO_INTERNAL_PREFIXES.some((prefix) => key.startsWith(prefix));
		case 'channels':
		case 'playlists':
			return true;
		case 'community_posts':
			return isCommunityPostKey(key) || isCommunityCommentKey(key);
		default:
			return false;
	}
}

/** Users named in a video record: likes, dislikes, comments at any depth and their reactions. */
export function videoUserIds(video: unknown): string[] {
	const ids: Array<string | null> = [];
	const v = (video ?? {}) as Json;
	for (const kind of ['likes', 'dislikes']) {
		if (Array.isArray(v[kind])) for (const r of v[kind]) ids.push(userIdOf(r?.userId));
	}
	const visit = (comments: unknown) => {
		if (!Array.isArray(comments)) return;
		for (const c of comments) {
			if (!c || typeof c !== 'object') continue;
			ids.push(userIdOf(c.userId));
			for (const kind of ['likes', 'dislikes']) {
				if (Array.isArray(c[kind])) for (const r of c[kind]) ids.push(userIdOf(r?.userId));
			}
			visit(c.replies);
		}
	};
	visit(v.comments);
	return uniqueSorted(ids);
}

/**
 * Footprints of one stored object. `value` is the decoded JSON when
 * footprintNeedsValue says so (null/undefined: nothing to record).
 */
export function footprintsOf(bucket: FootprintBucket, key: string, value?: unknown): Footprint[] {
	if (!key) return [];
	const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
	switch (bucket) {
		case 'videos':
			if (!footprintNeedsValue(bucket, key) || !v) return [];
			return [{ kind: 'video', targetId: key, userIds: videoUserIds(v), whole: true }];
		case 'channels': {
			if (!v) return [];
			const subs = Array.isArray(v.subscriptions) ? v.subscriptions : [];
			return [{ kind: 'channel', targetId: key, userIds: uniqueSorted(subs.map((s: Json) => userIdOf(s?.userId))), whole: true }];
		}
		case 'playlists': {
			const owner = userIdOf(v?.userId);
			return owner ? [{ kind: 'playlist', targetId: key, userIds: [owner], whole: false }] : [];
		}
		case 'community_posts': {
			if (isCommunityPostKey(key)) {
				const author = userIdOf(v?.userId);
				return author ? [{ kind: 'post-author', targetId: key, userIds: [author], whole: false }] : [];
			}
			const parts = key.split('/');
			const postId = parts[1];
			if (!postId) return [];
			if (isCommunityCommentKey(key)) {
				const author = userIdOf(v?.userId);
				return author ? [{ kind: 'post', targetId: postId, userIds: [author], whole: false }] : [];
			}
			// likes/{postId}/{userId}.json, votes/{postId}/{userId}.json, comment-likes/{postId}/{commentId}/{userId}.json
			const tree = parts[0];
			const file = parts[parts.length - 1];
			const minParts = tree === 'comment-likes' ? 4 : 3;
			if ((tree === 'likes' || tree === 'votes' || tree === 'comment-likes') && parts.length >= minParts && file.endsWith('.json')) {
				const userId = userIdOf(file.slice(0, -'.json'.length));
				return userId ? [{ kind: 'post', targetId: postId, userIds: [userId], whole: false }] : [];
			}
			return [];
		}
		case 'reports': {
			// report:{entityId}:{reportId}:{userId} and claims/{entityId}/{userId} (lib/report-claims.ts)
			if (key.startsWith('report:')) {
				const parts = key.split(':');
				if (parts.length < 4) return [];
				const userId = userIdOf(parts[parts.length - 1]);
				const entityId = parts.slice(1, -2).join(':');
				return userId && entityId ? [{ kind: 'report', targetId: entityId, userIds: [userId], whole: false }] : [];
			}
			if (key.startsWith('claims/')) {
				const parts = key.split('/');
				if (parts.length < 3) return [];
				const userId = userIdOf(parts[parts.length - 1]);
				const entityId = parts.slice(1, -1).join('/');
				return userId && entityId ? [{ kind: 'report', targetId: entityId, userIds: [userId], whole: false }] : [];
			}
			return [];
		}
	}
	return [];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Rows per INSERT (3 bound parameters each; D1 allows 100). */
const ROWS_PER_INSERT = 30;
const STATEMENTS_PER_BATCH = 50;

function insertStatements(db: SearchDb, rows: Array<[string, FootprintKind, string]>): SearchStatement[] {
	const statements: SearchStatement[] = [];
	for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
		const chunk = rows.slice(i, i + ROWS_PER_INSERT);
		statements.push(
			db
				.prepare(`INSERT OR IGNORE INTO privacy_footprints (user_id, kind, target_id) VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}`)
				.bind(...chunk.flat()),
		);
	}
	return statements;
}

async function runBatches(db: SearchDb, statements: SearchStatement[]): Promise<void> {
	for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) await db.batch(statements.slice(i, i + STATEMENTS_PER_BATCH));
}

/** FNV-1a of the user set. */
function signature(userIds: string[]): string {
	let hash = 0x811c9dc5;
	const text = userIds.join('\n');
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${userIds.length}:${hash.toString(16)}`;
}

/**
 * Record footprints of one write. A whole-record footprint whose user set is
 * unchanged costs one read; otherwise only the users not recorded yet are inserted.
 * Throws on a D1 failure (the caller marks the bucket incomplete).
 */
export async function recordFootprints(db: SearchDb, footprints: Footprint[]): Promise<void> {
	const rows: Array<[string, FootprintKind, string]> = [];
	const sigs: SearchStatement[] = [];
	for (const fp of footprints) {
		if (!fp.whole) {
			for (const userId of fp.userIds) rows.push([userId, fp.kind, fp.targetId]);
			continue;
		}
		const sig = signature(fp.userIds);
		const current = await db.prepare('SELECT sig FROM privacy_footprint_sigs WHERE kind = ? AND target_id = ?').bind(fp.kind, fp.targetId).first<{ sig: string }>();
		if (current?.sig === sig) continue;
		if (fp.userIds.length) {
			const { results } = await db
				.prepare('SELECT user_id FROM privacy_footprints WHERE kind = ? AND target_id = ?')
				.bind(fp.kind, fp.targetId)
				.all<{ user_id: string }>();
			const known = new Set((results ?? []).map((r) => r.user_id));
			for (const userId of fp.userIds) if (!known.has(userId)) rows.push([userId, fp.kind, fp.targetId]);
		}
		sigs.push(
			db
				.prepare('INSERT INTO privacy_footprint_sigs (kind, target_id, sig) VALUES (?, ?, ?) ON CONFLICT (kind, target_id) DO UPDATE SET sig = excluded.sig')
				.bind(fp.kind, fp.targetId, sig),
		);
	}
	// Rows before signatures: a failure part-way never leaves a signature for rows that were not written
	await runBatches(db, insertStatements(db, rows));
	await runBatches(db, sigs);
}

/** Inserts for a backfill page (no signatures: the next write of a target compares against its rows). */
async function insertFootprints(db: SearchDb, footprints: Footprint[]): Promise<number> {
	const rows: Array<[string, FootprintKind, string]> = [];
	for (const fp of footprints) for (const userId of fp.userIds) rows.push([userId, fp.kind, fp.targetId]);
	await runBatches(db, insertStatements(db, rows));
	return rows.length;
}

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

export const footprintCompleteKey = (bucket: FootprintBucket) => `privacy:footprints:complete:${bucket}`;
export const footprintInvalidKey = (bucket: FootprintBucket) => `privacy:footprints:invalid:${bucket}`;
/** Pass state; a dry run keeps its own, so it never hides the apply pass from the cron. */
export const footprintPassKey = (bucket: FootprintBucket, dryRun = false) => `privacy:footprints:${dryRun ? 'dry-run' : 'pass'}:${bucket}`;

async function setMeta(db: SearchDb, key: string, value: string, now: number): Promise<void> {
	await db
		.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
		.bind(key, value, now)
		.run();
}

/** A footprint write failed: the bucket's rows are not trusted until the next complete pass. */
export async function invalidateFootprints(db: SearchDb, bucket: FootprintBucket, now = Date.now()): Promise<void> {
	await setMeta(db, footprintInvalidKey(bucket), String(now), now);
}

/** The bucket's footprints cover every object it holds (see the trust rule above). */
export async function footprintsComplete(db: SearchDb, bucket: FootprintBucket): Promise<boolean> {
	const row = await db
		.prepare('SELECT (SELECT value FROM search_meta WHERE key = ?1) AS complete, (SELECT updated_at FROM search_meta WHERE key = ?2) AS invalid')
		.bind(footprintCompleteKey(bucket), footprintInvalidKey(bucket))
		.first<{ complete: string | null; invalid: number | null }>();
	if (!row?.complete) return false;
	const since = Number(row.complete);
	return Number.isFinite(since) && (row.invalid == null || Number(row.invalid) < since);
}

// ---------------------------------------------------------------------------
// Reads (the erase)
// ---------------------------------------------------------------------------

/** Targets of one kind that name the user, sorted. */
export async function footprintTargets(db: SearchDb, userId: string, kind: FootprintKind): Promise<string[]> {
	const { results } = await db
		.prepare('SELECT target_id FROM privacy_footprints WHERE user_id = ? AND kind = ? ORDER BY target_id')
		.bind(userId, kind)
		.all<{ target_id: string }>();
	return (results ?? []).map((r) => r.target_id);
}

/** The erased user's rows go once everything they pointed at is erased. */
export async function forgetFootprints(db: SearchDb, userId: string): Promise<void> {
	await db.prepare('DELETE FROM privacy_footprints WHERE user_id = ?').bind(userId).run();
}

// ---------------------------------------------------------------------------
// Write-time recording (R2 binding wrapper)
// ---------------------------------------------------------------------------

function decodeValue(value: unknown): unknown | undefined {
	try {
		if (typeof value === 'string') return JSON.parse(value);
		if (value instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(value));
		if (ArrayBuffer.isView(value)) return JSON.parse(new TextDecoder().decode(value as ArrayBufferView));
	} catch {
		return null;
	}
	return undefined;
}

/**
 * Wrap an R2 binding so each successful put records the footprints it
 * creates, before the put resolves. A failed recording marks the bucket
 * incomplete (the erase scans it again) instead of failing the request.
 * Deletes record nothing: rows only ever over-approximate.
 */
export function withFootprints<B extends object>(bucket: B, name: FootprintBucket, db: SearchDb): B {
	const target = bucket as unknown as R2Bucket;
	return new Proxy(bucket, {
		get(obj, prop) {
			if (prop === 'put') {
				return async (key: string, value: unknown, options?: R2PutOptions) => {
					const result = await target.put(key, value as Parameters<R2Bucket['put']>[1], options);
					if (result === null) return result;
					try {
						let decoded: unknown = undefined;
						if (footprintNeedsValue(name, key)) {
							decoded = decodeValue(value);
							if (decoded === undefined) {
								const stored = await target.get(key);
								decoded = stored ? await stored.json().catch(() => null) : null;
							}
						}
						const footprints = footprintsOf(name, key, decoded);
						if (footprints.length) await recordFootprints(db, footprints);
					} catch (error) {
						logger.warn('[PrivacyFootprints] Footprint write failed; bucket marked for a new pass', {
							bucket: name,
							key,
							error: error instanceof Error ? error.message : String(error),
						});
						await invalidateFootprints(db, name).catch((invalidateError) =>
							logger.error('[PrivacyFootprints] Could not mark the bucket incomplete', {
								bucket: name,
								error: invalidateError instanceof Error ? invalidateError.message : String(invalidateError),
							}),
						);
					}
					return result;
				};
			}
			const value = Reflect.get(obj, prop, obj);
			return typeof value === 'function' ? value.bind(obj) : value;
		},
	});
}

// ---------------------------------------------------------------------------
// Backfill pass
// ---------------------------------------------------------------------------

export const FOOTPRINT_BACKFILL_KIND = 'privacy-footprint-backfill';
/** Objects per message: one list call, up to this many gets, a few D1 batches. */
export const FOOTPRINT_PAGE_SIZE = 100;
/** A running pass whose last page is older than this is resumed by the hourly cron. */
export const FOOTPRINT_STALL_MS = 60 * 60 * 1000;

export interface FootprintBackfillMessage {
	kind: typeof FOOTPRINT_BACKFILL_KIND;
	bucket: FootprintBucket;
	runId: string;
	dryRun: boolean;
	/** Pages done when this message was sent: only the message for the next page does work */
	page: number;
}

export interface FootprintPassState {
	runId: string;
	dryRun: boolean;
	status: 'running' | 'done';
	cursor: string | null;
	page: number;
	startedAt: number;
	updatedAt: number;
	finishedAt?: number;
	objects: number;
	/** Footprint rows found (dry run) or written (apply), by kind */
	rows: Partial<Record<FootprintKind, number>>;
	/** Objects that could not be read */
	failed: number;
}

export interface FootprintEnv {
	SEARCH_DB?: SearchDb;
	PROCESSING_CHECK_QUEUE?: { send(body: unknown, options?: unknown): Promise<unknown> };
	videos?: unknown;
	channels?: unknown;
	community_posts?: unknown;
	playlists?: unknown;
	reports?: unknown;
}

export function isFootprintBackfillMessage(body: unknown): body is FootprintBackfillMessage {
	const b = body as Partial<FootprintBackfillMessage> | null;
	return !!b && b.kind === FOOTPRINT_BACKFILL_KIND && typeof b.bucket === 'string' && isFootprintBucket(b.bucket) && typeof b.runId === 'string' && typeof b.page === 'number' && typeof b.dryRun === 'boolean';
}

export async function readFootprintPass(db: SearchDb, bucket: FootprintBucket, dryRun = false): Promise<FootprintPassState | null> {
	const row = await db.prepare('SELECT value FROM search_meta WHERE key = ?').bind(footprintPassKey(bucket, dryRun)).first<{ value: string }>();
	if (!row) return null;
	try {
		return JSON.parse(row.value) as FootprintPassState;
	} catch {
		return null;
	}
}

/** Start (or restart) a pass over one bucket and queue its first page. */
export async function startFootprintPass(env: FootprintEnv, bucket: FootprintBucket, options: { dryRun: boolean; now?: number }): Promise<FootprintPassState> {
	const db = env.SEARCH_DB;
	if (!db) throw new Error('SEARCH_DB is not bound');
	if (!env.PROCESSING_CHECK_QUEUE) throw new Error('PROCESSING_CHECK_QUEUE is not bound');
	const now = options.now ?? Date.now();
	const state: FootprintPassState = {
		runId: crypto.randomUUID(),
		dryRun: options.dryRun,
		status: 'running',
		cursor: null,
		page: 0,
		startedAt: now,
		updatedAt: now,
		objects: 0,
		rows: {},
		failed: 0,
	};
	await setMeta(db, footprintPassKey(bucket, options.dryRun), JSON.stringify(state), now);
	const message: FootprintBackfillMessage = { kind: FOOTPRINT_BACKFILL_KIND, bucket, runId: state.runId, dryRun: options.dryRun, page: 0 };
	await env.PROCESSING_CHECK_QUEUE.send(message);
	logger.info('[PrivacyFootprints] Pass started', { bucket, runId: state.runId, dryRun: options.dryRun });
	return state;
}

/**
 * One page of a pass. Returns the next message to send, or null (pass done,
 * or this message is stale: another run replaced it, or a duplicate already
 * did this page). A D1 failure throws, so the queue retries the page.
 */
export async function runFootprintBackfillStep(env: FootprintEnv, message: FootprintBackfillMessage, now = Date.now()): Promise<FootprintBackfillMessage | null> {
	const db = env.SEARCH_DB;
	const bucket = env[message.bucket] as R2Bucket | undefined;
	if (!db || !bucket) throw new Error(`Footprint backfill unavailable: missing ${db ? message.bucket : 'SEARCH_DB'} binding`);
	const state = await readFootprintPass(db, message.bucket, message.dryRun);
	if (!state || state.runId !== message.runId || state.status !== 'running' || state.page !== message.page) return null;

	const page = await bucket.list({ limit: FOOTPRINT_PAGE_SIZE, ...(state.cursor ? { cursor: state.cursor } : {}) });
	const footprints: Footprint[] = [];
	let failed = 0;
	await Promise.all(
		page.objects.map(async (object) => {
			try {
				let value: unknown;
				if (footprintNeedsValue(message.bucket, object.key)) {
					const stored = await bucket.get(object.key);
					value = stored ? await stored.json().catch(() => null) : null;
				}
				footprints.push(...footprintsOf(message.bucket, object.key, value));
			} catch (error) {
				failed++;
				logger.warn('[PrivacyFootprints] Could not read an object during the pass', {
					bucket: message.bucket,
					key: object.key,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}),
	);
	if (!state.dryRun) await insertFootprints(db, footprints);

	const next: FootprintPassState = { ...state, rows: { ...state.rows }, page: state.page + 1, updatedAt: now };
	next.objects += page.objects.length;
	next.failed += failed;
	for (const fp of footprints) next.rows[fp.kind] = (next.rows[fp.kind] ?? 0) + fp.userIds.length;
	next.cursor = page.truncated ? ((page as { cursor?: string }).cursor ?? null) : null;
	if (!next.cursor) {
		next.status = 'done';
		next.finishedAt = now;
	}
	// Only the message for this page moves the pass on (a duplicate delivery changes nothing)
	const moved = (await db
		.prepare(`UPDATE search_meta SET value = ?, updated_at = ? WHERE key = ? AND json_extract(value, '$.runId') = ? AND json_extract(value, '$.page') = ?`)
		.bind(JSON.stringify(next), now, footprintPassKey(message.bucket, message.dryRun), state.runId, state.page)
		.run()) as { meta?: { changes?: number } };
	if (Number(moved?.meta?.changes ?? 0) !== 1) return null;

	if (next.status === 'done') {
		if (!next.dryRun && next.failed === 0) await setMeta(db, footprintCompleteKey(message.bucket), String(next.startedAt), now);
		logger.info('[PrivacyFootprints] Pass finished', { bucket: message.bucket, runId: next.runId, dryRun: next.dryRun, objects: next.objects, rows: next.rows, failed: next.failed });
		return null;
	}
	return { ...message, page: next.page };
}

/** Queue consumer: one page, then the next message. */
export async function handleFootprintBackfillMessage(env: FootprintEnv, message: FootprintBackfillMessage): Promise<void> {
	const next = await runFootprintBackfillStep(env, message);
	if (next) await env.PROCESSING_CHECK_QUEUE?.send(next);
}

/**
 * Hourly: keep apply passes going once ops started them. A running pass whose
 * chain stalled is re-queued; a bucket that was complete but had a footprint
 * write fail since gets a new pass. Buckets never started are left alone.
 */
export async function maintainFootprintPasses(env: FootprintEnv, now = Date.now()): Promise<{ resumed: string[]; restarted: string[] }> {
	const out = { resumed: [] as string[], restarted: [] as string[] };
	const db = env.SEARCH_DB;
	if (!db || !env.PROCESSING_CHECK_QUEUE) return out;
	for (const bucket of FOOTPRINT_BUCKETS) {
		const state = await readFootprintPass(db, bucket);
		if (!state) continue;
		if (state.status === 'running') {
			if (now - state.updatedAt >= FOOTPRINT_STALL_MS) {
				await env.PROCESSING_CHECK_QUEUE.send({ kind: FOOTPRINT_BACKFILL_KIND, bucket, runId: state.runId, dryRun: false, page: state.page } satisfies FootprintBackfillMessage);
				out.resumed.push(bucket);
			}
			continue;
		}
		if (!(await footprintsComplete(db, bucket))) {
			await startFootprintPass(env, bucket, { dryRun: false, now });
			out.restarted.push(bucket);
		}
	}
	return out;
}
