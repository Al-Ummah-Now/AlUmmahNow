/**
 * R2 backfill of existing videos (epic AUN-R2-MIGRATION, AlUmmahNow#687; owner 2026-11-14: "build
 * backfill infra, admin does it, dont do scripts"). Shared by api-videos (the engine), admin-api
 * (RBAC + audit) and admin-web (the Backfill page). docs/media-delivery/BACKFILL.md has the design.
 *
 * A run: scope → estimate (real sizes) → admin presses Start → per video, queued and resumable:
 *   copy our original from Bunny into R2 → our transcode on Containers → verify → R2-ready.
 * Then the admin may flip playback to R2 first (per video / channel / global, the existing
 * provider settings), and separately schedule the removal of verified videos from a Bunny library.
 */

export type BackfillScopeKind = 'all' | 'channel' | 'dates' | 'videos';

export interface BackfillScope {
	kind: BackfillScopeKind;
	/** kind channel */
	channelId?: string;
	/** kind dates: upload date range, inclusive days (YYYY-MM-DD, UTC) */
	from?: string;
	to?: string;
	/** kind videos: explicit ids */
	videoIds?: string[];
	/** Only videos that have no ready R2 rendition yet */
	onlyMissing: boolean;
}

export interface BackfillSettings {
	/** Videos worked on at the same time (copy, transcode or verify) */
	concurrency: number;
	/** Minimum seconds between two video starts (0 = as fast as concurrency allows) */
	spacingSeconds: number;
	/** The run stops when its spend (one-time cost + the first month of storage) would pass this, USD */
	budgetUsd: number;
}

export type BackfillRunStatus = 'estimating' | 'estimated' | 'running' | 'paused' | 'cancelled' | 'done' | 'stopped_budget' | 'failed';

export type BackfillItemState = 'pending' | 'copying' | 'transcoding' | 'verifying' | 'verified' | 'failed' | 'skipped' | 'cancelled';

/** Why an item needs no work (estimate time). */
export type BackfillSkipReason = 'deleted' | 'live' | 'not_found' | 'no_source' | 'already_verified' | 'has_rendition' | 'not_ready';

/** Cost lines. Bytes and seconds are the inputs; usd is the list price (lib/media/costs.ts PRICES). */
export interface BackfillCost {
	/** Bytes copied out of Bunny (Bunny CDN egress) */
	egressBytes: number;
	egressUsd: number;
	/** Container seconds of our transcodes */
	transcodeSeconds: number;
	transcodeUsd: number;
	/** Kept originals + renditions, per month */
	storageBytes: number;
	storageUsdMonth: number;
	/** R2 writes (Class A) */
	classAOps: number;
	opsUsd: number;
	/** egress + transcode + ops + one month of storage: what the budget cap compares */
	totalUsd: number;
}

export interface BackfillEstimate extends BackfillCost {
	videos: number;
	/** Videos with nothing to do, by reason */
	skipped: Partial<Record<BackfillSkipReason, number>>;
	/** Seconds of video to transcode */
	videoSeconds: number;
	/** Ratios measured from this environment's finished transcodes (media_jobs) */
	basis: { jobs: number; containerPerVideoSecond: number; renditionBytesPerVideoSecond: number; objectsPerVideoSecond: number; assumed: boolean };
	at: string;
}

export interface BackfillCounts {
	total: number;
	pending: number;
	copying: number;
	transcoding: number;
	verifying: number;
	verified: number;
	failed: number;
	skipped: number;
	cancelled: number;
}

export interface BackfillRun {
	id: string;
	status: BackfillRunStatus;
	scope: BackfillScope;
	settings: BackfillSettings;
	estimate: BackfillEstimate | null;
	/** Actual spend so far */
	spent: BackfillCost;
	counts: BackfillCounts;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	stopReason: string | null;
}

export interface BackfillItem {
	runId: string;
	videoId: string;
	state: BackfillItemState;
	title: string | null;
	channelId: string | null;
	libraryId: number | null;
	durationSeconds: number | null;
	sourceBytes: number | null;
	/** Which Bunny file was copied: original, play_1080p.mp4, … */
	sourceFile: string | null;
	copiedBytes: number;
	/** Has our own original (kept upload or an earlier copy): no copy needed */
	hasOriginal: boolean;
	estUsd: number;
	spentUsd: number;
	skipReason: BackfillSkipReason | null;
	error: string | null;
	errorStep: string | null;
	attempts: number;
	checks: BackfillChecks | null;
	startedAt: string | null;
	verifiedAt: string | null;
	updatedAt: string;
}

/** What verification looked at; every one must pass. */
export interface BackfillChecks {
	/** Our original: manifest, size equal to Bunny's, every part's MD5 equal to R2's */
	original: { ok: boolean; bytes?: number; parts?: number; detail?: string };
	/** The rendition is ready and its playlists list rungs no higher than the source */
	renditions: { ok: boolean; rungs?: string[]; detail?: string };
	/** Rendition duration vs Bunny's (tolerance max(2 s, 1%)) */
	duration: { ok: boolean; r2Seconds?: number; bunnySeconds?: number; detail?: string };
	/** Every object the playlists name exists in R2 and is not empty */
	objects: { ok: boolean; checked?: number; missing?: number; detail?: string };
	rev?: string;
	access?: string;
}

export const BACKFILL_LIMITS = {
	maxConcurrency: 20,
	maxSpacingSeconds: 3600,
	maxVideoIds: 500,
	maxBudgetUsd: 500,
	/** Bunny removal grace period, days */
	minGraceDays: 7,
	maxGraceDays: 90,
} as const;

export const DEFAULT_BACKFILL_SETTINGS: BackfillSettings = { concurrency: 2, spacingSeconds: 30, budgetUsd: 0 };

const VIDEO_ID = /^[A-Za-z0-9-]{8,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function emptyCounts(): BackfillCounts {
	return { total: 0, pending: 0, copying: 0, transcoding: 0, verifying: 0, verified: 0, failed: 0, skipped: 0, cancelled: 0 };
}

export function emptyCost(): BackfillCost {
	return { egressBytes: 0, egressUsd: 0, transcodeSeconds: 0, transcodeUsd: 0, storageBytes: 0, storageUsdMonth: 0, classAOps: 0, opsUsd: 0, totalUsd: 0 };
}

/** Validate a scope from a request. */
export function parseBackfillScope(input: unknown): { ok: true; scope: BackfillScope } | { ok: false; error: string } {
	const b = (input ?? {}) as Record<string, unknown>;
	const kind = b.kind;
	const onlyMissing = b.onlyMissing === true;
	if (kind === 'all') return { ok: true, scope: { kind, onlyMissing } };
	if (kind === 'channel') {
		if (typeof b.channelId !== 'string' || !VIDEO_ID.test(b.channelId)) return { ok: false, error: 'channelId must be a channel id' };
		return { ok: true, scope: { kind, channelId: b.channelId, onlyMissing } };
	}
	if (kind === 'dates') {
		const from = typeof b.from === 'string' && DAY.test(b.from) && !Number.isNaN(Date.parse(b.from)) ? b.from : undefined;
		const to = typeof b.to === 'string' && DAY.test(b.to) && !Number.isNaN(Date.parse(b.to)) ? b.to : undefined;
		if (!from && !to) return { ok: false, error: 'from or to must be a date (YYYY-MM-DD)' };
		if (from && to && from > to) return { ok: false, error: 'from must not be after to' };
		return { ok: true, scope: { kind, ...(from ? { from } : {}), ...(to ? { to } : {}), onlyMissing } };
	}
	if (kind === 'videos') {
		const ids = Array.isArray(b.videoIds) ? [...new Set(b.videoIds.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))] : [];
		if (!ids.length) return { ok: false, error: 'videoIds must list at least one video id' };
		if (ids.length > BACKFILL_LIMITS.maxVideoIds) return { ok: false, error: `At most ${BACKFILL_LIMITS.maxVideoIds} video ids` };
		const bad = ids.find((v) => !VIDEO_ID.test(v));
		if (bad) return { ok: false, error: `Not a video id: ${bad.slice(0, 80)}` };
		return { ok: true, scope: { kind, videoIds: ids, onlyMissing } };
	}
	return { ok: false, error: 'kind must be all, channel, dates or videos' };
}

/** Validate settings (a partial change merges into `current`). */
export function parseBackfillSettings(input: unknown, current: BackfillSettings): { ok: true; settings: BackfillSettings } | { ok: false; error: string } {
	const b = (input ?? {}) as Record<string, unknown>;
	const next = { ...current };
	const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
	if (b.concurrency !== undefined) {
		if (!int(b.concurrency, 1, BACKFILL_LIMITS.maxConcurrency)) return { ok: false, error: `concurrency must be a whole number 1-${BACKFILL_LIMITS.maxConcurrency}` };
		next.concurrency = b.concurrency as number;
	}
	if (b.spacingSeconds !== undefined) {
		if (!int(b.spacingSeconds, 0, BACKFILL_LIMITS.maxSpacingSeconds)) return { ok: false, error: `spacingSeconds must be a whole number 0-${BACKFILL_LIMITS.maxSpacingSeconds}` };
		next.spacingSeconds = b.spacingSeconds as number;
	}
	if (b.budgetUsd !== undefined) {
		if (typeof b.budgetUsd !== 'number' || !Number.isFinite(b.budgetUsd) || b.budgetUsd < 0 || b.budgetUsd > BACKFILL_LIMITS.maxBudgetUsd) {
			return { ok: false, error: `budgetUsd must be 0-${BACKFILL_LIMITS.maxBudgetUsd}` };
		}
		next.budgetUsd = Math.round(b.budgetUsd * 100) / 100;
	}
	return { ok: true, settings: next };
}

/** List prices the cost lines use (the same numbers as api-videos lib/media/costs.ts PRICES). */
export interface BackfillPrices {
	containerInstanceSecond: number;
	r2GbMonth: number;
	r2ClassAPerMillion: number;
	bunnyEgressGb: number;
}

const GB = 1024 ** 3;
const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Cost lines from raw inputs. */
export function backfillCost(prices: BackfillPrices, input: { egressBytes: number; transcodeSeconds: number; storageBytes: number; classAOps: number }): BackfillCost {
	const egressUsd = (input.egressBytes / GB) * prices.bunnyEgressGb;
	const transcodeUsd = input.transcodeSeconds * prices.containerInstanceSecond;
	const storageUsdMonth = (input.storageBytes / GB) * prices.r2GbMonth;
	const opsUsd = (input.classAOps / 1e6) * prices.r2ClassAPerMillion;
	return {
		egressBytes: Math.round(input.egressBytes),
		egressUsd: round(egressUsd),
		transcodeSeconds: Math.round(input.transcodeSeconds),
		transcodeUsd: round(transcodeUsd),
		storageBytes: Math.round(input.storageBytes),
		storageUsdMonth: round(storageUsdMonth),
		classAOps: Math.round(input.classAOps),
		opsUsd: round(opsUsd),
		totalUsd: round(egressUsd + transcodeUsd + opsUsd + storageUsdMonth),
	};
}

export function addCosts(a: BackfillCost, b: BackfillCost): BackfillCost {
	return {
		egressBytes: a.egressBytes + b.egressBytes,
		egressUsd: round(a.egressUsd + b.egressUsd),
		transcodeSeconds: a.transcodeSeconds + b.transcodeSeconds,
		transcodeUsd: round(a.transcodeUsd + b.transcodeUsd),
		storageBytes: a.storageBytes + b.storageBytes,
		storageUsdMonth: round(a.storageUsdMonth + b.storageUsdMonth),
		classAOps: a.classAOps + b.classAOps,
		opsUsd: round(a.opsUsd + b.opsUsd),
		totalUsd: round(a.totalUsd + b.totalUsd),
	};
}

/**
 * Budget gate before a video starts: spent so far, plus what the videos in progress are still
 * expected to cost, plus this video's estimate, must stay within the cap. A cap of 0 means none
 * was set, which never passes (Start requires a cap).
 */
export function withinBudget(budgetUsd: number, spentUsd: number, inFlightRemainingUsd: number, nextEstimateUsd: number): boolean {
	if (!(budgetUsd > 0)) return false;
	return spentUsd + inFlightRemainingUsd + nextEstimateUsd <= budgetUsd + 1e-9;
}

/** Duration check tolerance: max(2 s, 1%). */
export function durationMatches(r2Seconds: number, bunnySeconds: number): boolean {
	if (!(r2Seconds > 0) || !(bunnySeconds > 0)) return false;
	return Math.abs(r2Seconds - bunnySeconds) <= Math.max(2, bunnySeconds * 0.01);
}

/** URIs an HLS playlist names (segments, init maps, variant playlists), relative ones only. */
export function playlistUris(text: string): string[] {
	const out: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('#')) {
			const m = /URI="([^"]+)"/.exec(line);
			if (m && !/^[a-z]+:\/\//i.test(m[1]!)) out.push(m[1]!);
			continue;
		}
		if (!/^[a-z]+:\/\//i.test(line)) out.push(line.split('?')[0]!);
	}
	return [...new Set(out)];
}

/** Resolve a playlist-relative URI against the playlist's own key. */
export function resolveKey(playlistKey: string, uri: string): string {
	const base = playlistKey.split('/').slice(0, -1);
	for (const part of uri.split('/')) {
		if (part === '..') base.pop();
		else if (part !== '.' && part !== '') base.push(part);
	}
	return base.join('/');
}

/** Bunny removal (retiring a library): one row per video. */
export type BunnyRemovalStatus = 'scheduled' | 'removing' | 'removed' | 'cancelled' | 'failed';

export interface BunnyRemoval {
	videoId: string;
	libraryId: number;
	status: BunnyRemovalStatus;
	scheduledBy: string;
	scheduledAt: string;
	deleteAfter: string;
	removedAt: string | null;
	error: string | null;
}

export interface BunnyLibrarySummary {
	libraryId: number;
	primary: boolean;
	legacy: boolean;
	/** Videos a backfill verified in this library (current rendition) */
	verified: number;
	scheduled: number;
	removed: number;
	failed: number;
}
