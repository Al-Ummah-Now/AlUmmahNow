/**
 * Concurrent R2 transcodes as an autoscaling range (shared-types transcode-limit.ts; videos admin →
 * Video providers → Cloudflare R2 settings).
 *
 * The container's max_instances is Cloudflare's own limit (production 3,746 standard-4: what the account's
 * 15,000 vCPU; stage and QA 2, as the account limit is shared). The admin's
 * min–max range is enforced here: one TranscodeSlots object (named 'global') holds a lease per video
 * that is transcoding. The queue consumer asks for a slot before it starts a job:
 * - up to `allowed` slots are in use at once; `allowed` is min normally;
 * - a job that can't start under it waits (its message is sent again in SLOT_WAIT_SECONDS, without
 *   using up a delivery), oldest first, and while jobs wait `allowed` grows by one per job start or
 *   finish (scaleStep) up to max; with nothing waiting it falls back to min.
 * `min` is a concurrency floor, not warm instances: nothing runs (or is billed) without a job.
 *
 * Leases: taken by the consumer, kept alive by the Transcoder's watchdog every minute (and up to its
 * next retry while it waits for one), given back when the job is ready, failed for good or cancelled.
 * A lease nobody renews lapses after LEASE_MS, so a slot is never lost for good.
 */
import { effectiveTranscodeRange, parseTranscodeLimitDoc, scaleStep, transcodeCeilingOf, TRANSCODE_LIMIT_CACHE_MS, TRANSCODE_LIMIT_DEFAULT_MIN, TRANSCODE_LIMIT_KEY, type TranscodeRange } from '@al-ummah/shared-types';
import { errorText, log, type Env } from './env';
import type { TranscodeSlots } from './slots';

/** A lease the watchdog stops renewing lapses after this long. */
export const LEASE_MS = 10 * 60 * 1000;
/** A waiting job that has not asked again for this long has gone (cancelled, given up) and loses its place. */
export const WAITER_MS = 5 * 60 * 1000;
/** A job with no free slot asks again after this long. */
export const SLOT_WAIT_SECONDS = 60;

export interface Lease {
	jobId: string;
	since: number;
	until: number;
}
export interface Waiter {
	jobId: string;
	since: number;
	seen: number;
}
export interface SlotState {
	leases: Record<string, Lease>;
	waiters: Record<string, Waiter>;
	/** Slots that may be in use now (min..max, autoscaled) */
	allowed: number;
	/** A job started or finished since the last step up */
	stepArmed: boolean;
	/** The range of the last request (a finish falls back to its min when nothing waits) */
	min: number;
}
export interface SlotAnswer {
	granted: boolean;
	/** Slots in use after this call */
	inUse: number;
	/** Slots that may be in use now (autoscaled within the range) */
	allowed: number;
	/** Jobs waiting longer than this one (0 when granted) */
	ahead: number;
	/** Jobs waiting (this one included when it waits) */
	waiting: number;
}

/** Fresh: `allowed` 0 reads as the range's min on the first request. */
export const emptySlots = (): SlotState => ({ leases: {}, waiters: {}, allowed: 0, stepArmed: false, min: TRANSCODE_LIMIT_DEFAULT_MIN });

/** Drops lapsed leases and gone waiters. Pure (returns a new state). */
export function pruneSlots(state: SlotState, now: number): SlotState {
	const base = { ...emptySlots(), ...state };
	const leases = Object.fromEntries(Object.entries(base.leases).filter(([, l]) => l.until > now));
	const waiters = Object.fromEntries(Object.entries(base.waiters).filter(([, w]) => now - w.seen < WAITER_MS));
	return { ...base, leases, waiters };
}

/**
 * One job asks for a slot. Its own video's lease (a redelivery, a newer job of the same video) is
 * always granted. Otherwise it starts while the slots in use plus the jobs waiting longer than it are
 * under `allowed`, so the oldest waiting job gets the next free slot. A job that can't start waits,
 * and while jobs wait `allowed` steps up (one per job start or finish, up to max). Pure.
 */
export function acquireSlot(prev: SlotState, videoId: string, jobId: string, range: TranscodeRange, now: number): { state: SlotState; answer: SlotAnswer } {
	const state = pruneSlots({ ...prev, min: range.min }, now);
	const inUse = Object.keys(state.leases).length;
	const answer = (granted: boolean, ahead: number): SlotAnswer => ({ granted, inUse: Object.keys(state.leases).length, allowed: state.allowed, ahead, waiting: Object.keys(state.waiters).length });
	if (state.leases[videoId]) {
		state.leases[videoId] = { jobId, since: state.leases[videoId]!.since, until: now + LEASE_MS };
		delete state.waiters[videoId];
		return { state, answer: answer(true, 0) };
	}
	const since = state.waiters[videoId]?.since ?? now;
	const ahead = Object.entries(state.waiters).filter(([id, w]) => id !== videoId && w.since < since).length;
	const grant = () => {
		state.leases[videoId] = { jobId, since: now, until: now + LEASE_MS };
		delete state.waiters[videoId];
		// A start: the next waiting job may open one more slot
		state.stepArmed = true;
		return { state, answer: answer(true, 0) };
	};
	// Within the current allowance (min, or what autoscaling has opened)
	state.allowed = Math.min(Math.max(state.allowed, range.min), range.max);
	if (inUse + ahead < state.allowed) return grant();
	// Can't start: it waits, and the queue is not empty, so autoscaling may open one more slot
	state.waiters[videoId] = { jobId, since, seen: now };
	const step = scaleStep(state, Object.keys(state.waiters).length, range);
	state.allowed = step.allowed;
	state.stepArmed = step.stepArmed;
	if (inUse + ahead < state.allowed) return grant();
	return { state, answer: answer(false, ahead) };
}

/** The running job keeps its slot until `until` (the watchdog; a retry's time). Re-taken if it lapsed. Pure. */
export function renewSlot(prev: SlotState, videoId: string, jobId: string, until: number, now: number): SlotState {
	const state = pruneSlots(prev, now);
	const held = state.leases[videoId];
	state.leases[videoId] = { jobId, since: held?.since ?? now, until: Math.max(until, now + LEASE_MS) };
	return state;
}

/**
 * The job is over: its slot is free (a finish arms the next step up). With nothing waiting the queue
 * has drained, so autoscaling falls back to min. Only the job that holds it can give it back. Pure.
 */
export function releaseSlot(prev: SlotState, videoId: string, jobId: string, now: number): SlotState {
	const state = pruneSlots(prev, now);
	if (state.leases[videoId]?.jobId === jobId) {
		delete state.leases[videoId];
		state.stepArmed = true;
	}
	delete state.waiters[videoId];
	if (!Object.keys(state.waiters).length) state.allowed = state.min;
	return state;
}

// ---------------------------------------------------------------------------
// The admin's setting, read by the consumer (cached per isolate)
// ---------------------------------------------------------------------------

let limitCache: { at: number; value: TranscodeRange } | null = null;

export function clearTranscodeLimitCache(): void {
	limitCache = null;
}

/** The admin's range under MEDIA_TRANSCODE_CEILING; the defaults when unset or unreadable. Cached TRANSCODE_LIMIT_CACHE_MS. */
export async function readTranscodeLimit(env: Pick<Env, 'GLOBAL_SETTINGS' | 'MEDIA_TRANSCODE_CEILING'>, now = Date.now()): Promise<TranscodeRange> {
	if (limitCache && now - limitCache.at < TRANSCODE_LIMIT_CACHE_MS) return limitCache.value;
	const ceiling = transcodeCeilingOf(env.MEDIA_TRANSCODE_CEILING);
	let doc = null;
	try {
		const obj = await env.GLOBAL_SETTINGS?.get(TRANSCODE_LIMIT_KEY);
		if (obj) doc = parseTranscodeLimitDoc(await obj.json());
	} catch (error) {
		log.warn('[MediaSlots] Could not read the transcode limit; using the default', { error: errorText(error) });
	}
	const value = effectiveTranscodeRange(doc, ceiling);
	limitCache = { at: now, value };
	return value;
}

/** The one slots object of this environment. */
export function slotsOf(env: Pick<Env, 'TRANSCODE_SLOTS'>): DurableObjectStub<TranscodeSlots> {
	return env.TRANSCODE_SLOTS.get(env.TRANSCODE_SLOTS.idFromName('global'));
}
