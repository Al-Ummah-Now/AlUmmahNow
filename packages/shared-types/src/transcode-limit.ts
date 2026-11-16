/**
 * Concurrent R2 transcodes as a range (videos admin → Video providers → Cloudflare R2 settings).
 *
 * - Ceiling ("Cloudflare limit" in the admin): the transcoder container's max_instances, set to what
 *   Cloudflare allows. Containers have no per-application cap, only account-wide concurrency (15,000 vCPU,
 *   60 TiB memory, 300 TB disk), the account is shared with other projects, so 10% stays free and production gets
 *   (15,000 x 0.9 - stage's and QA's 16) / 4 vCPU = 3,371 standard-4 instances; stage and
 *   QA stay at 2 because the account limit is shared. Given to the Workers as MEDIA_TRANSCODE_CEILING.
 *   Unused instances cost nothing.
 * - Setting: { min, max } at global_settings/ops/media-transcode-limit.json, written by api-videos
 *   (the admin's change through admin-api, audited as media:transcode-limit). Default 4–4.
 * - Autoscaling (apps/media TranscodeSlots, scaleStep below): up to `min` run at once normally; while
 *   jobs wait, one more slot opens per job start or finish until the queue is empty or `max` is
 *   reached; once nothing waits it falls back to `min`. `min` is a concurrency floor, not warm
 *   instances: Cloudflare bills a container only while it runs (nothing once it sleeps).
 * - Readers cache it TRANSCODE_LIMIT_CACHE_MS, so a change applies within a minute.
 */

export const TRANSCODE_LIMIT_KEY = 'ops/media-transcode-limit.json';
export const TRANSCODE_LIMIT_DEFAULT_MIN = 4;
export const TRANSCODE_LIMIT_DEFAULT_MAX = 4;
export const TRANSCODE_LIMIT_FLOOR = 1;
/** How long the dispatcher and the API keep the stored value (changes apply within a minute). */
export const TRANSCODE_LIMIT_CACHE_MS = 30_000;
/** Audit key in site_settings_log (admin-api). */
export const TRANSCODE_LIMIT_AUDIT_KEY = 'media:transcode-limit';

/**
 * Containers standard-4 list price (2026-11), USD per instance-second: 4 vCPU + 12 GiB + 20 GB disk.
 * The same figure as api-videos' cost collector (lib/media/costs.ts PRICES.containerInstanceSecond).
 * CPU is billed only while active, so this is an upper bound.
 */
export const TRANSCODER_USD_PER_SECOND = 4 * 0.00002 + 12 * 0.0000025 + 20 * 0.00000007;

/** The admin's range. */
export interface TranscodeRange {
	min: number;
	max: number;
}

/** The stored document. */
export interface TranscodeLimitDoc extends TranscodeRange {
	updatedAt: string | null;
	updatedBy: string | null;
}

/** What the admin page shows and edits. */
export interface TranscodeLimitView {
	/** The setting (the defaults when never set) */
	min: number;
	max: number;
	/** What the dispatcher enforces: the setting under the ceiling */
	effective: TranscodeRange;
	/** max_instances of the transcoder container; null when not configured */
	ceiling: number | null;
	/** True while no admin has set it */
	isDefault: boolean;
	updatedAt: string | null;
	updatedBy: string | null;
	/** Estimated cost of one more slot, USD, while it transcodes */
	slotUsdPerHour: number;
	/** The same slot busy around the clock for a 30-day month */
	slotUsdPerMonth: number;
	/** Worst case: every slot up to `max` busy (per hour while all transcode) */
	maxUsdPerHour: number;
}

export type TranscodeLimitProblem = 'not_whole_number' | 'below_minimum' | 'min_above_max' | 'above_ceiling';
export type TranscodeLimitField = 'min' | 'max';

/** MEDIA_TRANSCODE_CEILING as a number; null when unset or not a positive whole number. */
export function transcodeCeilingOf(value: string | undefined | null): number | null {
	const n = Number(value);
	return value && Number.isInteger(n) && n > 0 ? n : null;
}

const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Why the range can't be saved under `ceiling` (the first problem, and its field); null when it can. 1 ≤ min ≤ max ≤ ceiling. */
export function transcodeRangeProblem(min: unknown, max: unknown, ceiling: number | null): { problem: TranscodeLimitProblem; field: TranscodeLimitField } | null {
	if (!whole(min)) return { problem: 'not_whole_number', field: 'min' };
	if (!whole(max)) return { problem: 'not_whole_number', field: 'max' };
	if (min < TRANSCODE_LIMIT_FLOOR) return { problem: 'below_minimum', field: 'min' };
	if (max < TRANSCODE_LIMIT_FLOOR) return { problem: 'below_minimum', field: 'max' };
	if (ceiling !== null && max > ceiling) return { problem: 'above_ceiling', field: 'max' };
	if (ceiling !== null && min > ceiling) return { problem: 'above_ceiling', field: 'min' };
	if (min > max) return { problem: 'min_above_max', field: 'min' };
	return null;
}

/**
 * A stored document, or null when it is missing or unreadable (the defaults apply). The first
 * version stored one `limit`: it reads as min = max = limit.
 */
export function parseTranscodeLimitDoc(raw: unknown): TranscodeLimitDoc | null {
	const r = raw as (Partial<TranscodeLimitDoc> & { limit?: unknown }) | null;
	if (!r || typeof r !== 'object') return null;
	const min = whole(r.min) ? r.min : whole(r.limit) ? r.limit : null;
	const max = whole(r.max) ? r.max : whole(r.limit) ? r.limit : null;
	if (min === null || max === null || transcodeRangeProblem(min, max, null)) return null;
	return { min, max, updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null, updatedBy: typeof r.updatedBy === 'string' ? r.updatedBy : null };
}

/** The range the dispatcher enforces: the setting (or the defaults) under the ceiling, never below 1. */
export function effectiveTranscodeRange(doc: TranscodeRange | null, ceiling: number | null): TranscodeRange {
	const cap = (n: number) => Math.max(TRANSCODE_LIMIT_FLOOR, ceiling === null ? n : Math.min(n, ceiling));
	const max = cap(doc?.max ?? TRANSCODE_LIMIT_DEFAULT_MAX);
	return { min: Math.min(cap(doc?.min ?? TRANSCODE_LIMIT_DEFAULT_MIN), max), max };
}

const cents = (usd: number) => Math.round(usd * 100) / 100;

export function transcodeLimitView(doc: TranscodeLimitDoc | null, ceiling: number | null): TranscodeLimitView {
	const effective = effectiveTranscodeRange(doc, ceiling);
	const hour = TRANSCODER_USD_PER_SECOND * 3600;
	return {
		min: doc?.min ?? TRANSCODE_LIMIT_DEFAULT_MIN,
		max: doc?.max ?? TRANSCODE_LIMIT_DEFAULT_MAX,
		effective,
		ceiling,
		isDefault: !doc,
		updatedAt: doc?.updatedAt ?? null,
		updatedBy: doc?.updatedBy ?? null,
		slotUsdPerHour: cents(hour),
		slotUsdPerMonth: cents(hour * 24 * 30),
		maxUsdPerHour: cents(hour * effective.max),
	};
}

/**
 * Autoscaling: how many slots may be in use now.
 * - `allowed` starts at min. While jobs wait (`waiting` > 0) it grows by one per job start or finish
 *   (`stepArmed`: a start or finish happened since the last step), never past max.
 * - With nothing waiting it falls back to min. Running jobs are never stopped: over the allowed number,
 *   new starts just wait until enough finish.
 * Pure (tested in apps/media test/slots.test.ts).
 */
export function scaleStep(state: { allowed: number; stepArmed: boolean }, waiting: number, range: TranscodeRange): { allowed: number; stepArmed: boolean } {
	const floor = Math.min(Math.max(state.allowed, range.min), range.max);
	if (waiting <= 0) return { allowed: range.min, stepArmed: state.stepArmed };
	if (state.stepArmed && floor < range.max) return { allowed: floor + 1, stepArmed: false };
	return { allowed: floor, stepArmed: state.stepArmed };
}
