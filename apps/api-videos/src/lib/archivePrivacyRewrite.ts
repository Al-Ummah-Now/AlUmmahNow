/**
 * One-off rewrite of the queue-message archive written before pseudonymisation (#1177).
 *
 * The processor now pseudonymises every archived message at write time (@al-ummah/shared-types
 * archive-privacy). This job brings the older entries in r2 al-ummah-now-messages (binding
 * `analytics_rollups`) to the same rules:
 *
 * - Person ids become `ps_…` pseudonyms made with a key that exists only for this run (run state)
 *   and is deleted when the run finishes: the old entries stay consistent among themselves (one
 *   person, one pseudonym) but no longer lead to anyone, erased or not. Erasure messages get the
 *   erased marker. Free text and device details are dropped, as at write time.
 * - `analytics/tabs/user-behavior/<userId>/…` (a per-person copy of the tab metrics, keyed by the
 *   raw id) is deleted: the same metric is kept per channel under analytics/tabs/popularity/.
 * - Objects the processor already stamped (customMetadata.privacy) are skipped from the listing,
 *   without a read. Rollups (analytics/rollups/) hold no person data and are not listed.
 *
 * A dry run by default: it counts, per prefix, what it would rewrite or delete and writes nothing.
 * The listing goes one prefix at a time (one day of the archive, or one analytics prefix), one
 * page per message on the processing-check queue, in a few parallel lanes. State lives in
 * global_settings `ops/archive-privacy/runs/<runId>/` (meta.json, lane-<n>.json).
 * Started and read by scripts/release/archive-privacy-rewrite.ts.
 */
import {
	ARCHIVE_PRIVACY_VERSION,
	archivePseudonym,
	archiveRecordNeedsScrub,
	collectArchiveUserIds,
	MessageType,
	newArchiveSecret,
	scrubArchiveRecord,
} from '@al-ummah/shared-types';
import { logger } from './logger';

export const ARCHIVE_PRIVACY_REWRITE_KIND = 'archive-privacy-rewrite';
const RUN_PREFIX = 'ops/archive-privacy/runs/';
/** The archive's retention (lib/privacy/retention.ts EVENT_ARCHIVE_RETENTION_DAYS) plus a margin */
const ARCHIVE_DAYS = 400;
const DELETE_PREFIXES = ['analytics/tabs/user-behavior/'];
/** Copies of messages and metrics that carried a person id outside the dated archive */
const EXTRA_PREFIXES = ['channel-sections/', 'channel-tabs/', 'analytics/sections/views/', 'analytics/tabs/popularity/', ...DELETE_PREFIXES];
const PARALLEL_READS = 10;
const ERASURE_TYPES = new Set<number>([MessageType.UserDataErased, MessageType.ContactDataErase]);

export interface ArchivePrivacyMessage {
	kind: typeof ARCHIVE_PRIVACY_REWRITE_KIND;
	runId: string;
	lane: number;
	/** Index into the run's prefixes; a lane takes lane, lane + lanes, lane + 2 * lanes, ... */
	prefixIndex: number;
	cursor: string | null;
	/** Only on the run's first message (lane 0, prefix 0): creates the run, then starts the other lanes */
	start?: { dryRun: boolean; lanes: number; limit?: number };
}

export interface PrefixCounts {
	listed: number;
	/** Stamped at write time: skipped without a read */
	stamped: number;
	/** Read, nothing to change */
	clean: number;
	/** Rewritten (or would be, in a dry run) */
	rewritten: number;
	/** Deleted (or would be): per-person copies */
	deleted: number;
	/** Not JSON: left alone and counted */
	unreadable: number;
}

export interface ArchivePrivacyMeta {
	runId: string;
	dryRun: boolean;
	lanes: number;
	limit: number;
	prefixes: string[];
	startedAt: string;
	/** The run's pseudonym key; null in a dry run and once every lane is done */
	key: string | null;
}

export interface ArchivePrivacyLane {
	lane: number;
	status: 'running' | 'done';
	updatedAt: string;
	finishedAt?: string;
	prefixes: Record<string, PrefixCounts>;
}

interface Env {
	analytics_rollups?: R2Bucket;
	global_settings?: R2Bucket;
	PROCESSING_CHECK_QUEUE?: Queue;
}

const EMPTY: PrefixCounts = { listed: 0, stamped: 0, clean: 0, rewritten: 0, deleted: 0, unreadable: 0 };

export function isArchivePrivacyMessage(body: unknown): body is ArchivePrivacyMessage {
	const m = body as Partial<ArchivePrivacyMessage> | null;
	return !!m && m.kind === ARCHIVE_PRIVACY_REWRITE_KIND && typeof m.runId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(m.runId)
		&& Number.isInteger(m.lane) && (m.lane as number) >= 0 && Number.isInteger(m.prefixIndex) && (m.prefixIndex as number) >= 0;
}

/** Day prefixes of the dated archive (`YYYY-MM-DD`), oldest first, then the extra prefixes. */
export function archivePrefixes(now: Date, days = ARCHIVE_DAYS): string[] {
	const out: string[] = [];
	for (let i = days; i >= 0; i--) out.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
	return [...out, ...EXTRA_PREFIXES];
}

/** The rewritten body of one archived record, or null when it needs nothing. */
export async function rewriteArchiveRecord(record: unknown, key: string): Promise<Record<string, unknown> | null> {
	if (!record || typeof record !== 'object' || !archiveRecordNeedsScrub(record)) return null;
	const erased = ERASURE_TYPES.has(Number((record as { type?: unknown }).type));
	const pseudonyms = new Map<string, string>();
	if (!erased) for (const id of collectArchiveUserIds(record)) pseudonyms.set(id, await archivePseudonym(key, id));
	return { ...scrubArchiveRecord(record as Record<string, unknown>, { pseudonyms, erased }), privacy: ARCHIVE_PRIVACY_VERSION };
}

/** One listing page of one prefix: counts, and (not a dry run) the rewrites and deletions. */
export async function runArchivePrivacyPage(
	bucket: R2Bucket,
	meta: Pick<ArchivePrivacyMeta, 'dryRun' | 'key' | 'limit'>,
	prefix: string,
	cursor: string | null
): Promise<{ counts: PrefixCounts; nextCursor: string | null }> {
	const listing = await bucket.list({ prefix, limit: meta.limit, include: ['customMetadata'], ...(cursor ? { cursor } : {}) });
	const counts = { ...EMPTY };
	const deleting = DELETE_PREFIXES.some((p) => prefix.startsWith(p));
	const work: R2Object[] = [];
	for (const object of listing.objects) {
		counts.listed++;
		if (deleting) {
			counts.deleted++;
			continue;
		}
		if (object.customMetadata?.privacy === ARCHIVE_PRIVACY_VERSION) {
			counts.stamped++;
			continue;
		}
		work.push(object);
	}
	if (deleting && !meta.dryRun && listing.objects.length > 0) await bucket.delete(listing.objects.map((o) => o.key));
	for (let i = 0; i < work.length; i += PARALLEL_READS) {
		await Promise.all(
			work.slice(i, i + PARALLEL_READS).map(async (object) => {
				const body = await bucket.get(object.key);
				if (!body) return;
				let record: unknown;
				try {
					record = JSON.parse(await body.text());
				} catch {
					counts.unreadable++;
					return;
				}
				// Dry run: a throwaway key, only to see whether anything changes
				const next = await rewriteArchiveRecord(record, meta.key ?? 'dry-run');
				if (!next) {
					counts.clean++;
					return;
				}
				counts.rewritten++;
				if (meta.dryRun) return;
				await bucket.put(object.key, JSON.stringify(next, null, 2), {
					httpMetadata: body.httpMetadata ?? { contentType: 'application/json' },
					customMetadata: { ...(body.customMetadata ?? {}), privacy: ARCHIVE_PRIVACY_VERSION },
				});
			})
		);
	}
	return { counts, nextCursor: listing.truncated ? (listing as { cursor?: string }).cursor ?? null : null };
}

const metaKey = (runId: string) => `${RUN_PREFIX}${runId}/meta.json`;
const laneKey = (runId: string, lane: number) => `${RUN_PREFIX}${runId}/lane-${lane}.json`;

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
	const object = await bucket.get(key);
	return object ? ((await object.json()) as T) : null;
}

const putJson = (bucket: R2Bucket, key: string, value: unknown) =>
	bucket.put(key, JSON.stringify(value, null, 2), { httpMetadata: { contentType: 'application/json' } });

interface QueueMessageLike {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** Consumer for one rewrite message (index.ts queue()). */
export async function handleArchivePrivacyMessage(env: Env, msg: QueueMessageLike, now = new Date()): Promise<void> {
	const body = msg.body as ArchivePrivacyMessage;
	try {
		const settings = env.global_settings;
		const bucket = env.analytics_rollups;
		if (!settings || !bucket) throw new Error('global_settings or the archive bucket (analytics_rollups) is not bound');
		let meta = await readJson<ArchivePrivacyMeta>(settings, metaKey(body.runId));
		if (!meta) {
			if (!body.start) throw new Error(`run ${body.runId} has no meta and this message does not start it`);
			const lanes = Math.min(Math.max(Math.floor(body.start.lanes), 1), 8);
			meta = {
				runId: body.runId,
				dryRun: body.start.dryRun !== false,
				lanes,
				limit: Math.min(Math.max(Math.floor(body.start.limit ?? 100), 1), 200),
				prefixes: archivePrefixes(now),
				startedAt: now.toISOString(),
				key: body.start.dryRun !== false ? null : newArchiveSecret(),
			};
			await putJson(settings, metaKey(body.runId), meta);
			// Lane 0 starts the run; the other lanes start once its meta (and key) exist
			for (let other = 1; other < meta.lanes; other++) {
				await env.PROCESSING_CHECK_QUEUE!.send({ kind: ARCHIVE_PRIVACY_REWRITE_KIND, runId: body.runId, lane: other, prefixIndex: other, cursor: null } satisfies ArchivePrivacyMessage);
			}
		}
		const lane: ArchivePrivacyLane = (await readJson<ArchivePrivacyLane>(settings, laneKey(body.runId, body.lane))) ?? {
			lane: body.lane,
			status: 'running',
			updatedAt: now.toISOString(),
			prefixes: {},
		};
		const prefix = meta.prefixes[body.prefixIndex];
		if (lane.status === 'done' || prefix === undefined) {
			msg.ack();
			return;
		}
		if (!meta.dryRun && !meta.key) throw new Error(`run ${body.runId} has no key left (finished?)`);
		const result = await runArchivePrivacyPage(bucket, meta, prefix, body.cursor);
		const soFar = lane.prefixes[prefix] ?? { ...EMPTY };
		for (const k of Object.keys(soFar) as Array<keyof PrefixCounts>) soFar[k] += result.counts[k];
		lane.prefixes[prefix] = soFar;
		lane.updatedAt = now.toISOString();
		const next: ArchivePrivacyMessage | null = result.nextCursor
			? { kind: ARCHIVE_PRIVACY_REWRITE_KIND, runId: body.runId, lane: body.lane, prefixIndex: body.prefixIndex, cursor: result.nextCursor }
			: body.prefixIndex + meta.lanes < meta.prefixes.length
				? { kind: ARCHIVE_PRIVACY_REWRITE_KIND, runId: body.runId, lane: body.lane, prefixIndex: body.prefixIndex + meta.lanes, cursor: null }
				: null;
		if (!next) {
			lane.status = 'done';
			lane.finishedAt = now.toISOString();
		}
		// State first, then the next page: a retried page adds its counts again but never skips one
		await putJson(settings, laneKey(body.runId, body.lane), lane);
		if (next) await env.PROCESSING_CHECK_QUEUE!.send(next);
		else await dropKeyWhenAllLanesDone(settings, meta);
		logger.info('[ArchivePrivacy] Page done', { runId: body.runId, lane: body.lane, prefix, dryRun: meta.dryRun, counts: result.counts, laneDone: !next });
		msg.ack();
	} catch (error) {
		logger.warn('[ArchivePrivacy] Page failed; retrying', { runId: body.runId, lane: body.lane, prefixIndex: body.prefixIndex, attempts: msg.attempts, error: error instanceof Error ? error.message : String(error) });
		msg.retry({ delaySeconds: Math.min(300, 30 * 2 ** Math.max(0, msg.attempts - 1)) });
	}
}

/** The run's key is deleted once every lane is done: the old pseudonyms then lead to nobody. */
async function dropKeyWhenAllLanesDone(settings: R2Bucket, meta: ArchivePrivacyMeta): Promise<void> {
	if (meta.key === null) return;
	for (let lane = 0; lane < meta.lanes; lane++) {
		const state = await readJson<ArchivePrivacyLane>(settings, laneKey(meta.runId, lane));
		if (state?.status !== 'done') return;
	}
	await putJson(settings, metaKey(meta.runId), { ...meta, key: null });
	logger.info('[ArchivePrivacy] Run done; key deleted', { runId: meta.runId });
}
