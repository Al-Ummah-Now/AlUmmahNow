/**
 * Upload reaper: removes Bunny placeholders whose bytes never arrived, and
 * Bunny videos of this environment that have no record at all (owner,
 * 2026-11-10: retried uploads left a Bunny video per attempt, forever).
 *
 * A loop per item, on the processing-check queue (message kind
 * `upload-reaper`, so it shares that queue's retries and DLQ):
 *
 *   sweep (cron, admin "Scan now") → enqueue a check per candidate
 *   check → still a candidate? → requeue for a confirming second check (delay)
 *   second check → still a candidate, no upload progress → delete → done
 *   anything finished / active / already gone → done (kept)
 *
 * Abandoned: a record not ready/processing, no activity for 24 h (created,
 * initiated, resumed, upload created), Bunny status Created (0) or
 * UploadFailed (6), and the TUS offset unchanged between the two checks. An
 * upload flagged needs_reupload is left FLAGGED_GRACE_MS after its flag, so
 * the uploader's Re-upload stays possible.
 * Delete the Bunny video, then soft-remove the record (abandoned + isDeleted,
 * which drops it from the channel's lists and the search index through the
 * search-sync wrapper), then release its fingerprint claim.
 *
 * Orphan: a Bunny video of this environment's library (name prefix rule:
 * stage shares QA's library) with no record, older than 24 h, status Created,
 * Error or UploadFailed. Deleted only when the second check still finds no
 * record. Ready or encoding Bunny videos are never touched.
 *
 * Safety: the reaper starts in dry-run (it records "would delete" and changes
 * nothing) until an admin switches it to live on the Stale uploads page.
 * Every delete writes an audit row first, holding the full Bunny video and
 * record JSON (the backup). Idempotent and deduped: the item holds its active
 * loop id; a superseded message is dropped; deleting an already-deleted Bunny
 * video (404) counts as done. Transient failures are retried with backoff;
 * after the last delivery the item is flagged failed (admin Retry) and the
 * queue dead-letters the message (processor DLQ consumer → dead_letters).
 */

import { bunnyRef } from '../media/providers';
import { readRecordByBunnyGuid, videoIdForRef } from '../media/refs';
import { r2UploadOffset } from '../media/r2-tus';
import { deleteOriginal } from '../media/originals';
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { bunnyApi, bunnyLibraries, bunnyLibraryForVideo, primaryBunnyLibrary, type BunnyLibrariesEnv, type BunnyLibrary, type LibraryHints } from '../bunny/libraries';
import { generateTUSSignature } from '../bunny/tus';
import { fetchBunnyVideo, ProcessingEnv } from '../processing/loop';
import { releaseClaimFor } from './initiateOnce';

export const REAPER_KIND = 'upload-reaper';
export const REAPER_PREFIX = 'ops/upload-reaper/';
export const REAPER_CONFIG_KEY = `${REAPER_PREFIX}config.json`;
export const REAPER_SWEEP_KEY = `${REAPER_PREFIX}sweep.json`;
export const REAPER_ITEM_PREFIX = `${REAPER_PREFIX}items/`;
export const REAPER_AUDIT_PREFIX = `${REAPER_PREFIX}audit/`;
/**
 * Marker the upload flows write right after creating a Bunny video
 * (markUploadCreated). The reaper deletes a recordless Bunny video on its own
 * only when it carries this marker: anything else in the library (live
 * streams, legacy flows) is never an automatic orphan.
 */
export const UPLOAD_MARKER_PREFIX = `${REAPER_PREFIX}created/`;
/** Upload statuses of an unfinished upload: the only records the reaper may abandon. */
const ABANDONABLE_STATUSES = new Set(['initiated', 'uploading', 'failed']);

/** No upload activity this long → abandoned. */
export const ABANDON_AFTER_MS = 24 * 3600 * 1000;
/**
 * An upload flagged needs_reupload (lib/uploads/lifecycle.ts) was reported to
 * its uploader, whose dashboard offers Re-upload into the same video: the
 * reaper leaves it for this long after the flag (Delete now still can).
 */
export const FLAGGED_GRACE_MS = 7 * 24 * 3600 * 1000;
/**
 * A Bunny video that never received a byte (status Created, no storage, no length, no encode) and
 * has no record is an orphan after this long even without an upload marker: deleting it loses
 * nothing. The 2026-11-10 batch's 11 empty entries predated the marker (#1163).
 */
export const ORPHAN_EMPTY_MIN_AGE_MS = 7 * 24 * 3600 * 1000;

/** Never received a byte and older than ORPHAN_EMPTY_MIN_AGE_MS. */
export function isEmptyAbandoned(bunny: BunnyView, now: number): boolean {
	const empty = bunny.status === 0 && !(bunny.storageSize ?? 0) && !(bunny.length ?? 0) && !(bunny.encodeProgress ?? 0);
	const uploaded = Date.parse(bunny.dateUploaded || '');
	return empty && Number.isFinite(uploaded) && now - uploaded >= ORPHAN_EMPTY_MIN_AGE_MS;
}

/** A Bunny video without a record must be at least this old to be an orphan. */
export const ORPHAN_MIN_AGE_MS = 24 * 3600 * 1000;
/** Delay before the confirming second check. */
export const CONFIRM_DELAY_SECONDS = 30 * 60;
/** Confirming check after an admin "Delete now". */
export const FORCE_CONFIRM_DELAY_SECONDS = 60;
/** A checked item is not re-enqueued by the sweep for this long. */
export const RECHECK_AFTER_MS = 12 * 3600 * 1000;
/** A loop whose next check is this late is dead (lost message). */
const STALE_LOOP_MS = 15 * 60 * 1000;
/** Queue deliveries of one message: 1 + max_retries (wrangler: 5). */
export const REAPER_MAX_DELIVERIES = 6;

/** Bunny statuses (lib/bunny/schema.json): 0 Created, 5 Error, 6 UploadFailed. */
const ABANDONED_DELETABLE = new Set([0, 6]);
const ORPHAN_DELETABLE = new Set([0, 5, 6]);

const BUNNY_API = 'https://video.bunnycdn.com';

export type ReapTarget = 'abandoned' | 'orphan';
export type ReaperMode = 'dry-run' | 'live';

export interface ReaperConfig {
	mode: ReaperMode;
	updatedAt?: string;
	updatedBy?: string;
}

export interface ReaperMessage {
	kind: typeof REAPER_KIND;
	videoId: string;
	target: ReapTarget;
	loopId: string;
	/** Checks done in this loop before this one (0 = first check) */
	check: number;
	force?: boolean;
	actor?: string;
	startedAt: string;
}

export interface BunnyView {
	guid?: string;
	title?: string;
	status?: number;
	dateUploaded?: string;
	storageSize?: number;
	collectionId?: string;
	encodeProgress?: number;
	length?: number;
}

export interface RecordView {
	id: string;
	title?: string;
	userId?: string;
	channelId?: string;
	uploadStatus?: string;
	dateCreated?: string;
	dateModified?: string;
	lastResumeAt?: string;
	lastInitiateAt?: string;
	fileSize?: number;
	isDeleted?: boolean;
	abandoned?: { at: string; reason: string; by: string; bunnyDeleted: boolean };
	uploadFingerprint?: string;
	originalFormat?: string;
	processingIssue?: { kind: string; reason?: string; at: string } | null;
	tusUpload?: { sessionId: string; bunnyUploadUrl: string; fileSize: number; createdAt: string; target?: 'bunny' | 'r2' };
	/** Bunny library hints (lib/bunny/libraries.ts) */
	bunnyLibraryId?: number;
	playUrl?: string;
	thumbnailUrl?: string;
}

export type ItemStatus = 'checking' | 'would_delete' | 'deleted' | 'kept' | 'skipped' | 'failed';

export interface ReaperItem {
	videoId: string;
	target: ReapTarget;
	status: ItemStatus;
	reason?: string;
	loopId?: string;
	nextCheckAt?: string;
	checks: number;
	firstSeenAt: string;
	lastCheckedAt?: string;
	updatedAt: string;
	bunny?: BunnyView | null;
	record?: { title?: string; channelId?: string; userId?: string; uploadStatus?: string; dateCreated?: string; lastActivityAt?: string } | null;
	offset?: { value: number | null; at: string };
	force?: boolean;
	actor?: string;
	keptBy?: string;
	keptAt?: string;
	attempts?: number;
	lastError?: string;
	failedAt?: string;
	deletedAt?: string;
	auditKey?: string;
}

export type ReapDecision =
	| { action: 'keep'; reason: string }
	| { action: 'confirm'; delaySeconds: number; reason: string }
	| { action: 'would_delete'; reason: string }
	| { action: 'delete'; reason: string; deleteBunny: boolean };

export interface ReapInput {
	target: ReapTarget;
	now: number;
	mode: ReaperMode;
	force: boolean;
	/** Checks already done in this loop (0 = first check) */
	check: number;
	record: RecordView | null;
	bunny: BunnyView | null;
	/** This environment's Bunny name prefix ("" in QA and production) */
	prefix: string;
	/** TUS offset now, and at the previous check of this loop (null: no upload at Bunny) */
	offsetNow?: number | null;
	offsetBefore?: number | null;
	/** Orphans: an upload flow created this Bunny video (UPLOAD_MARKER_PREFIX) */
	uploadMarker?: boolean;
	/** Orphans: a live stream record refers to this Bunny video */
	liveStreamRef?: boolean;
}

/** A record an upload flow wrote (initiate, batch initiate, server upload): not a live stream or another record type. */
export function isUploadFlowRecord(record: Pick<RecordView, 'uploadFingerprint' | 'tusUpload' | 'lastInitiateAt' | 'originalFormat'>): boolean {
	return !!(record.uploadFingerprint || record.tusUpload || record.lastInitiateAt || record.originalFormat);
}

/** Latest sign of upload activity on a record. */
export function lastActivityAt(record: RecordView): number {
	const times = [record.dateCreated, record.dateModified, record.lastResumeAt, record.lastInitiateAt, record.tusUpload?.createdAt]
		.map((t) => Date.parse(t || ''))
		.filter((t) => Number.isFinite(t));
	return times.length ? Math.max(...times) : 0;
}

/**
 * Is this Bunny video one this environment created? Stage names its videos
 * "[stage] …" in QA's library; an environment without a prefix skips every
 * prefixed name.
 */
export function belongsToEnv(title: string | undefined, prefix: string): boolean {
	const name = title || '';
	if (prefix) return name.startsWith(prefix);
	return !/^\[[^\]]{1,32}\]\s/.test(name);
}

function finishOrConfirm(input: ReapInput, reason: string, deleteBunny: boolean): ReapDecision {
	if (input.check === 0) {
		return { action: 'confirm', delaySeconds: input.force ? FORCE_CONFIRM_DELAY_SECONDS : CONFIRM_DELAY_SECONDS, reason };
	}
	if (input.mode === 'dry-run' && !input.force) return { action: 'would_delete', reason };
	return { action: 'delete', reason, deleteBunny };
}

/** Pure: what to do with one item at one check. */
export function decideReap(input: ReapInput): ReapDecision {
	const { record, bunny, now } = input;
	if (input.target === 'orphan') {
		if (record) return { action: 'keep', reason: 'Has a record (not an orphan)' };
		if (!bunny) return { action: 'keep', reason: 'Already gone at Bunny' };
		if (!belongsToEnv(bunny.title, input.prefix)) return { action: 'keep', reason: 'Belongs to another environment' };
		if (input.liveStreamRef) return { action: 'keep', reason: 'A live stream refers to it' };
		if (!input.uploadMarker && !input.force && !isEmptyAbandoned(bunny, now)) return { action: 'keep', reason: 'Not created by an upload (no upload marker): only an admin Delete now removes it' };
		if (!ORPHAN_DELETABLE.has(bunny.status ?? -1)) return { action: 'keep', reason: `Bunny status ${bunny.status}: ready or encoding videos are never deleted` };
		const age = now - (Date.parse(bunny.dateUploaded || '') || now);
		if (!input.force && age < ORPHAN_MIN_AGE_MS) return { action: 'keep', reason: 'Younger than 24 hours' };
		return finishOrConfirm(input, `No record; Bunny status ${bunny.status}`, true);
	}

	if (!record) return { action: 'keep', reason: 'Record gone (the orphan sweep handles its Bunny video)' };
	if (record.isDeleted && !record.abandoned) return { action: 'keep', reason: 'Deleted by another flow' };
	if (record.abandoned) {
		if (bunny && ABANDONED_DELETABLE.has(bunny.status ?? -1)) {
			const reason = 'Finishing an interrupted abandon';
			return input.mode === 'dry-run' && !input.force ? { action: 'would_delete', reason } : { action: 'delete', reason, deleteBunny: true };
		}
		return { action: 'keep', reason: 'Already abandoned' };
	}
	if (record.uploadStatus === 'ready' || record.uploadStatus === 'processing') return { action: 'keep', reason: `Upload finished (${record.uploadStatus})` };
	// Allowlist: only an unfinished upload an upload flow wrote is ever abandoned
	if (!ABANDONABLE_STATUSES.has(record.uploadStatus ?? '')) return { action: 'keep', reason: `Upload status ${record.uploadStatus ?? 'none'} is not an unfinished upload` };
	if (!isUploadFlowRecord(record)) return { action: 'keep', reason: 'Not an upload record' };
	if (bunny && !ABANDONED_DELETABLE.has(bunny.status ?? -1)) return { action: 'keep', reason: `Bunny status ${bunny.status}: bytes arrived` };
	if (!input.force && now - lastActivityAt(record) < ABANDON_AFTER_MS) return { action: 'keep', reason: 'Upload activity in the last 24 hours' };
	if (!input.force && inReuploadGrace(record, now)) return { action: 'keep', reason: 'Flagged for re-upload; the uploader has 7 days to re-upload' };
	const size = record.tusUpload?.fileSize || record.fileSize || 0;
	if (input.offsetNow != null && size > 0 && input.offsetNow >= size) return { action: 'keep', reason: 'Every byte is at Bunny' };
	if (input.check > 0 && input.offsetNow != null && input.offsetBefore != null && input.offsetNow !== input.offsetBefore) {
		return { action: 'keep', reason: 'Upload is progressing' };
	}
	const reason = bunny ? `No upload progress for 24 hours; Bunny status ${bunny.status}` : 'No upload progress for 24 hours; not at Bunny';
	return finishOrConfirm(input, reason, !!bunny);
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

export interface ReaperEnv extends ProcessingEnv {
	global_settings: R2Bucket;
	BUNNY_NAME_PREFIX?: string;
	/** media_provider_refs: a new video's Bunny GUID → our id */
	SEARCH_DB?: D1Database;
	/** Our own TUS target's bytes */
	MEDIA_ORIGINALS?: R2Bucket;
}

function settings(env: ReaperEnv): R2Repository<ReaperItem> {
	return new R2Repository<ReaperItem>(env.global_settings);
}

export function itemKey(videoId: string): string {
	return `${REAPER_ITEM_PREFIX}${videoId}.json`;
}

const JSON_META = { httpMetadata: { contentType: 'application/json' } };

export async function readReaperConfig(env: Pick<ReaperEnv, 'global_settings'>): Promise<ReaperConfig> {
	try {
		const config = await (await env.global_settings.get(REAPER_CONFIG_KEY))?.json<ReaperConfig>();
		// Anything but an explicit "live" is a dry run
		return config?.mode === 'live' ? config : { ...(config ?? {}), mode: 'dry-run' };
	} catch {
		return { mode: 'dry-run' };
	}
}

export async function writeReaperConfig(env: Pick<ReaperEnv, 'global_settings'>, mode: ReaperMode, actor: string, now = new Date()): Promise<ReaperConfig> {
	const config: ReaperConfig = { mode, updatedAt: now.toISOString(), updatedBy: actor };
	await env.global_settings.put(REAPER_CONFIG_KEY, JSON.stringify(config), JSON_META);
	logger.info('[UploadReaper] Mode changed', { mode, actor });
	return config;
}

/** API key and id of the library a record's video lives in (lib/bunny/libraries.ts); the primary library without a record */
async function bunnySecrets(env: ReaperEnv, record?: LibraryHints | null): Promise<{ key: string; libraryId: string }> {
	const library = record ? await bunnyLibraryForVideo(env as BunnyLibrariesEnv, record) : await primaryBunnyLibrary(env as BunnyLibrariesEnv);
	const { libraryId, apiKey } = bunnyApi(library);
	return { key: apiKey, libraryId: String(libraryId) };
}

/** One page of a library (default: the primary one, where uploads go), newest first. */
export async function listBunnyVideos(env: ReaperEnv, page: number, itemsPerPage = 100, library?: BunnyLibrary): Promise<{ items: BunnyView[]; totalItems: number }> {
	const { key, libraryId } = library ? (({ apiKey, libraryId }) => ({ key: apiKey, libraryId: String(libraryId) }))(bunnyApi(library)) : await bunnySecrets(env);
	const url = `${BUNNY_API}/library/${encodeURIComponent(libraryId)}/videos?page=${page}&itemsPerPage=${itemsPerPage}&orderBy=date`;
	const response = await fetch(url, { headers: { AccessKey: key, accept: 'application/json' } });
	if (!response.ok) throw new Error(`Bunny listVideos page ${page} failed: HTTP ${response.status}`);
	const body = (await response.json()) as { items?: BunnyView[]; totalItems?: number };
	return { items: body.items ?? [], totalItems: body.totalItems ?? 0 };
}

async function deleteIn(key: string, libraryId: string, videoId: string): Promise<boolean> {
	const response = await fetch(`${BUNNY_API}/library/${encodeURIComponent(libraryId)}/videos/${encodeURIComponent(videoId)}`, {
		method: 'DELETE',
		headers: { AccessKey: key, accept: 'application/json' },
	});
	if (response.status === 404) return false;
	if (!response.ok) throw new Error(`Bunny deleteVideo ${videoId} failed: HTTP ${response.status}`);
	return true;
}

/**
 * Delete at Bunny; true when deleted now, false when it was already gone.
 * With the record: in its library. Without one (the record is already
 * deleted): in every library, primary first, until one had it.
 */
export async function deleteBunnyVideo(env: ReaperEnv, videoId: string, record?: LibraryHints | null): Promise<boolean> {
	if (record) {
		const { key, libraryId } = await bunnySecrets(env, record);
		return deleteIn(key, libraryId, videoId);
	}
	for (const library of await bunnyLibraries(env as BunnyLibrariesEnv)) {
		if (!library.primary && !library.apiKey) continue;
		const { libraryId, apiKey } = bunnyApi(library);
		if (await deleteIn(apiKey, String(libraryId), videoId)) return true;
	}
	return false;
}

/** Bunny's TUS offset of the record's upload; null when Bunny no longer has it. Throws on transient trouble. */
export async function fetchTusOffset(env: ReaperEnv, record: RecordView): Promise<number | null> {
	// Our own TUS target (lib/media/r2-tus.ts): what the originals bucket holds
	if (record.tusUpload?.target === 'r2') return r2UploadOffset(env as never, record.id, record.tusUpload.sessionId);
	const url = record.tusUpload?.bunnyUploadUrl;
	if (!url) return null;
	const { key, libraryId } = await bunnySecrets(env, record as LibraryHints);
	const expire = Math.floor(Date.now() / 1000) + 3600;
	const guid = bunnyRef(record as never) ?? record.id;
	const signature = await generateTUSSignature(parseInt(libraryId, 10), key, expire, guid);
	const response = await fetch(url, {
		method: 'HEAD',
		headers: {
			AuthorizationSignature: signature,
			AuthorizationExpire: String(expire),
			LibraryId: libraryId,
			VideoId: guid,
			'Tus-Resumable': '1.0.0',
		},
	});
	if (response.status === 404 || response.status === 410) return null;
	if (!response.ok) throw new Error(`Bunny TUS HEAD ${record.id} failed: HTTP ${response.status}`);
	const offset = parseInt(response.headers.get('Upload-Offset') || '', 10);
	return Number.isFinite(offset) ? offset : null;
}

async function readRecord(env: ReaperEnv, videoId: string): Promise<RecordView | null> {
	// Read the bucket directly: R2Repository.getObject turns an R2 error into
	// "missing", and a missing record would make an orphan of a real video.
	// A Bunny GUID of a new video finds its record through media_provider_refs (lib/media/refs.ts).
	return (await readRecordByBunnyGuid<RecordView>(env as never, videoId))?.record ?? null;
}

function bunnyView(b: BunnyView | null): BunnyView | null {
	if (!b) return null;
	return {
		guid: b.guid,
		title: b.title,
		status: b.status,
		dateUploaded: b.dateUploaded,
		storageSize: b.storageSize,
		collectionId: b.collectionId,
		encodeProgress: b.encodeProgress,
		length: b.length,
	};
}

function recordView(r: RecordView | null): ReaperItem['record'] {
	if (!r) return null;
	const at = lastActivityAt(r);
	return {
		title: r.title,
		channelId: r.channelId,
		userId: r.userId,
		uploadStatus: r.uploadStatus,
		dateCreated: r.dateCreated,
		lastActivityAt: at ? new Date(at).toISOString() : undefined,
	};
}

/**
 * Start (or restart, with `force`) the check loop of one item. Deduped: a
 * live loop is left alone, an item an admin kept is skipped unless forced.
 */
export async function startReaperLoop(
	env: ReaperEnv,
	videoId: string,
	target: ReapTarget,
	opts: { reason: string; force?: boolean; actor?: string; now?: Date; seed?: Partial<ReaperItem> },
): Promise<{ started: boolean; why?: string; loopId?: string }> {
	const queue = env.PROCESSING_CHECK_QUEUE;
	if (!queue) return { started: false, why: 'queue not bound' };
	const now = opts.now ?? new Date();
	const nowIso = now.toISOString();
	const loopId = crypto.randomUUID();
	let why: string | undefined;
	await settings(env).updateObject(
		itemKey(videoId),
		(item) => {
			why = undefined;
			const nextAt = Date.parse(item.nextCheckAt || '');
			const alive = item.status === 'checking' && Number.isFinite(nextAt) && nextAt + STALE_LOOP_MS > now.getTime();
			if (!opts.force) {
				if (item.status === 'kept') why = 'kept by an admin';
				else if (item.status === 'deleted') why = 'already deleted';
				else if (alive) why = 'loop already active';
				if (why) return false;
			}
			Object.assign(item, opts.seed ?? {}, {
				videoId,
				target,
				status: 'checking' as const,
				loopId,
				checks: 0,
				nextCheckAt: nowIso,
				force: !!opts.force,
				actor: opts.actor,
				attempts: 0,
				updatedAt: nowIso,
			});
			delete item.lastError;
			delete item.failedAt;
			return true;
		},
		{ initial: () => ({ videoId, target, status: 'checking', checks: 0, firstSeenAt: nowIso, updatedAt: nowIso }) },
	);
	if (why) return { started: false, why };
	const message: ReaperMessage = { kind: REAPER_KIND, videoId, target, loopId, check: 0, force: !!opts.force, actor: opts.actor, startedAt: nowIso };
	await queue.send(message);
	logger.info('[UploadReaper] Loop started', { videoId, target, loopId, reason: opts.reason, force: !!opts.force });
	return { started: true, loopId };
}

function auditKey(now: Date, videoId: string): string {
	// Inverted time: R2 lists ascending, so the newest audit row comes first
	const inverted = String(9_999_999_999_999 - now.getTime()).padStart(13, '0');
	return `${REAPER_AUDIT_PREFIX}${inverted}-${videoId}.json`;
}

export interface AuditRow {
	at: string;
	videoId: string;
	target: ReapTarget;
	action: 'delete';
	actor: string;
	mode: ReaperMode;
	force: boolean;
	reason: string;
	state: 'started' | 'done';
	bunnyDeleted?: boolean;
	recordAbandoned?: boolean;
	/** Backup: Bunny's full video JSON and our full record before the delete */
	backup: { bunny: unknown; record: unknown };
}

/** Delete one confirmed item. Idempotent; throws on transient failure (the queue retries). */
async function performDelete(
	env: ReaperEnv,
	message: ReaperMessage,
	decision: Extract<ReapDecision, { action: 'delete' }>,
	rawBunny: unknown,
	rawRecord: unknown,
	mode: ReaperMode,
	now: Date,
): Promise<{ auditKey: string; bunnyDeleted: boolean; recordAbandoned: boolean }> {
	const key = auditKey(now, message.videoId);
	const actor = message.actor || 'reaper';
	const row: AuditRow = {
		at: now.toISOString(),
		videoId: message.videoId,
		target: message.target,
		action: 'delete',
		actor,
		mode,
		force: !!message.force,
		reason: decision.reason,
		state: 'started',
		backup: { bunny: rawBunny, record: rawRecord },
	};
	// Audit row (with the backup) before anything is deleted
	await env.global_settings.put(key, JSON.stringify(row), JSON_META);

	const bunnyId = rawRecord ? bunnyRef(rawRecord as never) : message.videoId;
	const bunnyDeleted = decision.deleteBunny && bunnyId ? await deleteBunnyVideo(env, bunnyId, (rawRecord as LibraryHints | null) ?? undefined) : false;
	// An abandoned upload to our own target: its partial bytes in the originals bucket go too
	if (message.target === 'abandoned' && rawRecord && !bunnyId) await deleteOriginal(env as never, message.videoId).catch(() => undefined);
	let recordAbandoned = false;
	let fingerprint: string | undefined;
	if (message.target === 'abandoned') {
		const nowIso = now.toISOString();
		const saved = await new R2Repository<RecordView & Record<string, unknown>>(env.videos).updateObject(message.videoId, (fresh) => {
			recordAbandoned = false;
			if (fresh.abandoned) return false;
			fingerprint = fresh.uploadFingerprint;
			fresh.abandoned = { at: nowIso, reason: decision.reason, by: actor, bunnyDeleted: decision.deleteBunny };
			fresh.isDeleted = true;
			fresh.deletedAt = nowIso;
			fresh.dateModified = nowIso;
			if (fresh.uploadStatus !== 'ready' && fresh.uploadStatus !== 'processing') fresh.uploadStatus = 'failed';
			delete fresh.tusUpload;
			recordAbandoned = true;
			return true;
		});
		fingerprint = fingerprint ?? saved?.uploadFingerprint;
		if (fingerprint) {
			await releaseClaimFor(env.global_settings as never, fingerprint, message.videoId).catch((error) =>
				logger.warn('[UploadReaper] Could not release the fingerprint claim', { videoId: message.videoId, error: error instanceof Error ? error.message : String(error) }),
			);
		}
	}
	await env.global_settings.put(key, JSON.stringify({ ...row, state: 'done', bunnyDeleted, recordAbandoned }), JSON_META);
	logger.info('[UploadReaper] Deleted', { videoId: message.videoId, target: message.target, actor, mode, bunnyDeleted, recordAbandoned, audit: key });
	return { auditKey: key, bunnyDeleted, recordAbandoned };
}

/** One check of one loop message. Throws on transient errors (the queue retries). */
export async function runReaperCheck(env: ReaperEnv, message: ReaperMessage, now = new Date()): Promise<ReapDecision | { action: 'drop'; reason: string }> {
	const repo = settings(env);
	const item = await repo.getObject(itemKey(message.videoId));
	if (!item || item.loopId !== message.loopId) return { action: 'drop', reason: 'superseded loop' };
	if (item.status !== 'checking') return { action: 'drop', reason: `item is ${item.status}` };

	const config = await readReaperConfig(env);
	const record = await readRecord(env, message.videoId);
	// Bunny's id of the video: the record's ref (new videos), the message's id otherwise; none when Bunny holds no copy
	const bunnyId = record ? bunnyRef(record as never) : message.videoId;
	const rawBunny = bunnyId ? await fetchBunnyVideo(env, bunnyId, (record as LibraryHints | null) ?? null) : null;
	const bunny = bunnyView(rawBunny as BunnyView | null);
	let offsetNow: number | null = null;
	if (message.target === 'abandoned' && record && !record.abandoned && record.uploadStatus !== 'ready' && record.uploadStatus !== 'processing') {
		offsetNow = await fetchTusOffset(env, record);
	}
	let uploadMarker = false;
	let liveStreamRef = false;
	if (message.target === 'orphan' && !record && bunny) {
		uploadMarker = !!(await env.global_settings.head(`${UPLOAD_MARKER_PREFIX}${message.videoId}`));
		liveStreamRef = await referencedByLiveStream(env, message.videoId);
	}
	const decision = decideReap({
		uploadMarker,
		liveStreamRef,
		target: message.target,
		now: now.getTime(),
		mode: config.mode,
		force: !!message.force,
		check: message.check,
		record,
		bunny,
		prefix: env.BUNNY_NAME_PREFIX ?? '',
		offsetNow,
		offsetBefore: message.check > 0 ? item.offset?.value ?? null : null,
	});

	let deleted: { auditKey: string } | undefined;
	if (decision.action === 'delete') deleted = await performDelete(env, message, decision, rawBunny, record, config.mode, now);
	if (decision.action === 'confirm') {
		await env.PROCESSING_CHECK_QUEUE!.send({ ...message, check: message.check + 1 } satisfies ReaperMessage, { delaySeconds: decision.delaySeconds });
	}

	const nowIso = now.toISOString();
	await repo.updateObject(itemKey(message.videoId), (fresh) => {
		if (fresh.loopId !== message.loopId) return false;
		fresh.checks = message.check + 1;
		fresh.lastCheckedAt = nowIso;
		fresh.updatedAt = nowIso;
		fresh.reason = decision.reason;
		fresh.bunny = bunny;
		fresh.record = recordView(record);
		fresh.offset = { value: offsetNow, at: nowIso };
		fresh.attempts = 0;
		delete fresh.lastError;
		switch (decision.action) {
			case 'confirm':
				fresh.status = 'checking';
				fresh.nextCheckAt = new Date(now.getTime() + decision.delaySeconds * 1000).toISOString();
				break;
			case 'would_delete':
				fresh.status = 'would_delete';
				fresh.nextCheckAt = undefined;
				break;
			case 'delete':
				fresh.status = 'deleted';
				fresh.deletedAt = nowIso;
				fresh.auditKey = deleted?.auditKey;
				fresh.nextCheckAt = undefined;
				break;
			default:
				fresh.status = 'skipped';
				fresh.nextCheckAt = undefined;
		}
		return true;
	});
	logger.info('[UploadReaper] Check done', { videoId: message.videoId, target: message.target, check: message.check, decision: decision.action, reason: decision.reason });
	return decision;
}

interface QueueMessageLike<T> {
	body: T;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

export function isReaperMessage(body: unknown): body is ReaperMessage {
	return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === REAPER_KIND;
}

/** Backoff between deliveries of a failing check: 1 m, 4 m, 16 m, then hourly. */
export function reaperRetryDelaySeconds(attempts: number): number {
	return Math.min(3600, 60 * 4 ** Math.max(0, attempts - 1));
}

/** Queue consumer for reaper messages (dispatched from the processing-check queue). */
export async function handleReaperBatch(batch: { messages: readonly QueueMessageLike<unknown>[] }, env: ReaperEnv): Promise<void> {
	for (const msg of batch.messages) {
		const body = msg.body as ReaperMessage;
		if (!isReaperMessage(body) || !body.videoId || !body.loopId || (body.target !== 'abandoned' && body.target !== 'orphan')) {
			logger.error('[UploadReaper] Malformed message dropped', { body });
			msg.ack();
			continue;
		}
		try {
			await runReaperCheck(env, body);
			msg.ack();
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			const last = msg.attempts >= REAPER_MAX_DELIVERIES;
			try {
				await settings(env).updateObject(itemKey(body.videoId), (fresh) => {
					if (fresh.loopId !== body.loopId) return false;
					fresh.attempts = msg.attempts;
					fresh.lastError = text.slice(0, 500);
					fresh.updatedAt = new Date().toISOString();
					if (last) {
						// Flag for an admin (Stale uploads: failed, Retry); the queue dead-letters the message
						fresh.status = 'failed';
						fresh.failedAt = fresh.updatedAt;
						fresh.nextCheckAt = undefined;
					}
					return true;
				});
			} catch (flagError) {
				logger.error('[UploadReaper] Could not record the failure', { videoId: body.videoId, error: flagError instanceof Error ? flagError.message : String(flagError) });
			}
			const delaySeconds = reaperRetryDelaySeconds(msg.attempts);
			logger[last ? 'error' : 'warn']('[UploadReaper] Check failed', { videoId: body.videoId, attempts: msg.attempts, last, delaySeconds, error: text });
			msg.retry({ delaySeconds });
		}
	}
}

// ---------------------------------------------------------------------------
// Sweep (cron safety net + admin "Scan now")
// ---------------------------------------------------------------------------

export interface ReaperSweepStats {
	lastRunAt: string;
	mode: ReaperMode;
	recordsScanned: number;
	abandonedCandidates: number;
	bunnyScanned: number;
	bunnyTotal: number;
	orphanCandidates: number;
	loopsStarted: number;
	skipped: number;
	errors: number;
	/** Next page the orphan sweep reads in the primary library (it walks the library over several runs) */
	nextBunnyPage: number;
	/** The same per library id, every library this environment's uploads went to (legacy ones too) */
	nextBunnyPages?: Record<string, number>;
	durationMs: number;
}

export async function readReaperSweep(env: Pick<ReaperEnv, 'global_settings'>): Promise<ReaperSweepStats | null> {
	try {
		return (await (await env.global_settings.get(REAPER_SWEEP_KEY))?.json<ReaperSweepStats>()) ?? null;
	} catch {
		return null;
	}
}

/** Flagged needs_reupload less than FLAGGED_GRACE_MS ago (an unparsable flag time counts as just flagged). */
export function inReuploadGrace(record: Pick<RecordView, 'processingIssue'>, now: number): boolean {
	const issue = record.processingIssue;
	if (issue?.kind !== 'needs_reupload') return false;
	const at = Date.parse(issue.at || '');
	return !Number.isFinite(at) || now - at < FLAGGED_GRACE_MS;
}

/** Upload flows: mark a Bunny video they created (best effort: without it the video is never an automatic orphan). */
export async function markUploadCreated(store: Pick<R2Bucket, 'put'>, videoId: string, meta: { userId: string; channelId: string }, now = new Date()): Promise<void> {
	try {
		await store.put(`${UPLOAD_MARKER_PREFIX}${videoId}`, JSON.stringify({ ...meta, at: now.toISOString() }), JSON_META);
	} catch (error) {
		logger.warn('[UploadReaper] Upload marker not written', { videoId, error: error instanceof Error ? error.message : String(error) });
	}
}

/** Whether any live stream record (videos bucket, `livestream:<id>`) mentions this Bunny video id. */
export async function referencedByLiveStream(env: Pick<ReaperEnv, 'videos'>, videoId: string): Promise<boolean> {
	let cursor: string | undefined;
	do {
		const page = await env.videos.list({ prefix: 'livestream:', cursor, limit: 500 });
		for (const object of page.objects) {
			const text = await (await env.videos.get(object.key))?.text();
			if (text?.includes(videoId)) return true;
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return false;
}

/** Pre-filter of the sweep (the check decides): an unfinished record quiet for 24 h, not in its re-upload grace. */
export function isAbandonedCandidate(record: RecordView, now: number): boolean {
	if (record.abandoned || record.isDeleted) return false;
	if (!ABANDONABLE_STATUSES.has(record.uploadStatus ?? '') || !isUploadFlowRecord(record)) return false;
	return now - lastActivityAt(record) >= ABANDON_AFTER_MS && !inReuploadGrace(record, now);
}

async function recentlyChecked(env: ReaperEnv, videoId: string, now: number): Promise<boolean> {
	const item = await settings(env).getObject(itemKey(videoId));
	if (!item) return false;
	if (item.status === 'kept' || item.status === 'deleted' || item.status === 'failed') return true;
	const last = Date.parse(item.lastCheckedAt || item.updatedAt || '');
	if (item.status === 'checking') return Number.isFinite(Date.parse(item.nextCheckAt || '')) && Date.parse(item.nextCheckAt!) + STALE_LOOP_MS > now;
	return Number.isFinite(last) && now - last < RECHECK_AFTER_MS;
}

/**
 * Enqueue a check for every candidate. Capped per run; the orphan part walks
 * the Bunny library a few pages per run and resumes where it stopped.
 */
export async function sweepStaleUploads(
	env: ReaperEnv,
	opts: { now?: Date; maxStarts?: number; bunnyPagesPerRun?: number; actor?: string } = {},
): Promise<ReaperSweepStats> {
	const started = Date.now();
	const now = opts.now ?? new Date();
	const nowMs = now.getTime();
	const maxStarts = opts.maxStarts ?? 100;
	const pages = opts.bunnyPagesPerRun ?? 5;
	const previous = await readReaperSweep(env);
	const config = await readReaperConfig(env);
	const stats: ReaperSweepStats = {
		lastRunAt: now.toISOString(),
		mode: config.mode,
		recordsScanned: 0,
		abandonedCandidates: 0,
		bunnyScanned: 0,
		bunnyTotal: previous?.bunnyTotal ?? 0,
		orphanCandidates: 0,
		loopsStarted: 0,
		skipped: 0,
		errors: 0,
		nextBunnyPage: previous?.nextBunnyPage ?? 1,
		nextBunnyPages: { ...(previous?.nextBunnyPages ?? {}) },
		durationMs: 0,
	};

	const consider = async (videoId: string, target: ReapTarget) => {
		if (stats.loopsStarted >= maxStarts) return;
		try {
			if (await recentlyChecked(env, videoId, nowMs)) {
				stats.skipped++;
				return;
			}
			const result = await startReaperLoop(env, videoId, target, { reason: 'sweep', now, actor: opts.actor });
			if (result.started) stats.loopsStarted++;
			else stats.skipped++;
		} catch (error) {
			stats.errors++;
			logger.error('[UploadReaper] Could not start a check', { videoId, target, error: error instanceof Error ? error.message : String(error) });
		}
	};

	// Abandoned placeholders: our records
	let cursor: string | undefined;
	do {
		const page = await env.videos.list({ cursor, limit: 500 });
		cursor = page.truncated ? page.cursor : undefined;
		for (const object of page.objects) {
			if (object.key.includes('/') || object.key.includes(':')) continue;
			stats.recordsScanned++;
			let record: RecordView | null = null;
			try {
				record = (await (await env.videos.get(object.key))?.json<RecordView>()) ?? null;
			} catch {
				continue;
			}
			if (!record?.id || !isAbandonedCandidate(record, nowMs)) continue;
			stats.abandonedCandidates++;
			await consider(record.id, 'abandoned');
		}
	} while (cursor);

	// Orphans: Bunny videos of this environment without a record, in every library its uploads went to
	// (the primary one and legacy ones: the 2026-11-10 batch's empty entries sat in legacy 400189, #1163)
	const prefix = env.BUNNY_NAME_PREFIX ?? '';
	let libraries: BunnyLibrary[] = [];
	try {
		libraries = (await bunnyLibraries(env as BunnyLibrariesEnv)).filter((library) => library.primary || library.apiKey);
	} catch (error) {
		stats.errors++;
		logger.error('[UploadReaper] Bunny libraries unavailable', { error: error instanceof Error ? error.message : String(error) });
	}
	stats.bunnyTotal = 0;
	for (const library of libraries) {
		const libraryKey = String(bunnyApi(library).libraryId);
		let page = library.primary ? stats.nextBunnyPage : stats.nextBunnyPages?.[libraryKey] ?? 1;
		for (let i = 0; i < pages; i++) {
			let listed: { items: BunnyView[]; totalItems: number };
			try {
				listed = await listBunnyVideos(env, page, 100, library);
			} catch (error) {
				stats.errors++;
				logger.error('[UploadReaper] Bunny library listing failed', { library: libraryKey, page, error: error instanceof Error ? error.message : String(error) });
				break;
			}
			stats.bunnyTotal += i === 0 ? listed.totalItems : 0;
			for (const video of listed.items) {
				if (!video.guid) continue;
				stats.bunnyScanned++;
				if (!belongsToEnv(video.title, prefix) || !ORPHAN_DELETABLE.has(video.status ?? -1)) continue;
				if (nowMs - (Date.parse(video.dateUploaded || '') || nowMs) < ORPHAN_MIN_AGE_MS) continue;
				let exists: boolean;
				try {
					// A new video's record is under our id; media_provider_refs maps the GUID to it
					exists = !!(await env.videos.head(video.guid)) || !!(await env.videos.head(await videoIdForRef(env as never, 'bunny', video.guid)));
				} catch {
					stats.errors++;
					continue;
				}
				if (exists) continue;
				stats.orphanCandidates++;
				await consider(video.guid, 'orphan');
			}
			const end = listed.items.length < 100 || page * 100 >= listed.totalItems;
			page = end ? 1 : page + 1;
			if (end) break;
		}
		if (library.primary) stats.nextBunnyPage = page;
		else stats.nextBunnyPages = { ...(stats.nextBunnyPages ?? {}), [libraryKey]: page };
	}
	stats.durationMs = Date.now() - started;
	try {
		await env.global_settings.put(REAPER_SWEEP_KEY, JSON.stringify(stats), JSON_META);
	} catch (error) {
		logger.warn('[UploadReaper] Could not store sweep stats', { error: error instanceof Error ? error.message : String(error) });
	}
	logger.info('[UploadReaper] Sweep finished', { ...stats });
	return stats;
}

/** Admin "Keep": the sweep never picks this item again (until Retry). */
export async function keepItem(env: ReaperEnv, videoId: string, actor: string, now = new Date()): Promise<boolean> {
	const saved = await settings(env).updateObject(itemKey(videoId), (item) => {
		item.status = 'kept';
		item.keptBy = actor;
		item.keptAt = now.toISOString();
		item.updatedAt = item.keptAt;
		item.loopId = undefined;
		item.nextCheckAt = undefined;
		return true;
	});
	if (saved) logger.info('[UploadReaper] Kept by an admin', { videoId, actor });
	return !!saved;
}

export async function readItem(env: Pick<ReaperEnv, 'global_settings'>, videoId: string): Promise<ReaperItem | null> {
	return new R2Repository<ReaperItem>(env.global_settings).getObject(itemKey(videoId));
}

export async function listItems(env: Pick<ReaperEnv, 'global_settings'>, limit = 500): Promise<ReaperItem[]> {
	const items: ReaperItem[] = [];
	let cursor: string | undefined;
	do {
		const page = await env.global_settings.list({ prefix: REAPER_ITEM_PREFIX, cursor, limit: 500 });
		cursor = page.truncated ? page.cursor : undefined;
		const read = await Promise.all(
			page.objects.map(async (o) => {
				try {
					return (await (await env.global_settings.get(o.key))?.json<ReaperItem>()) ?? null;
				} catch {
					return null;
				}
			}),
		);
		for (const item of read) if (item) items.push(item);
	} while (cursor && items.length < limit);
	return items.slice(0, limit);
}

export async function listAudit(env: Pick<ReaperEnv, 'global_settings'>, limit = 50): Promise<Omit<AuditRow, 'backup'>[]> {
	const page = await env.global_settings.list({ prefix: REAPER_AUDIT_PREFIX, limit });
	const rows = await Promise.all(
		page.objects.map(async (o) => {
			try {
				const row = await (await env.global_settings.get(o.key))?.json<AuditRow>();
				if (!row) return null;
				const { backup: _backup, ...rest } = row;
				return { ...rest, key: o.key };
			} catch {
				return null;
			}
		}),
	);
	return rows.filter((r): r is NonNullable<typeof r> => !!r);
}
