/**
 * Watch-state sync (Epic 9.9): the playback position of a video, shared by
 * every device of a user.
 *
 * - Stored on the watch history entry (`watch_history/<userId>:<videoId>`), so
 *   the web progress endpoints and native clients read and write one record.
 * - Last writer wins on `stateUpdatedAt`: the client's time of the write,
 *   clamped to server time + MAX_CLOCK_SKEW_MS so a device with a clock in the
 *   future cannot pin a position forever. Web writes use server time.
 * - `lastWatchedAt` is always server time and is the incremental-sync cursor
 *   (`GET /watch-state?since=`), so client clocks never affect what is synced.
 */
import type { WatchHistoryEntry } from '@al-ummah/shared-types';
import { percentageOf } from './watch-history';

export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Continue watching: started (>= 5%) and not finished (< 95%). */
export const CONTINUE_MIN_PERCENT = 5;
export const COMPLETED_PERCENT = 95;

export interface WatchStateInput {
	position: number;
	duration: number;
	clientUpdatedAt: string;
	deviceId?: string;
}

/** The position of one video as native clients sync it. */
export interface WatchState {
	videoId: string;
	position: number;
	duration: number;
	percentageWatched: number;
	completed: boolean;
	/** Last-writer-wins clock (client time, clamped) */
	updatedAt: string;
	/** Server time of the last write: the `since` cursor */
	serverUpdatedAt: string;
	deviceId?: string;
}

/** The client's time of the write, never later than server time + the allowed skew. */
export function clampClientTime(clientUpdatedAt: string, now: Date): Date {
	const client = Date.parse(clientUpdatedAt);
	const max = now.getTime() + MAX_CLOCK_SKEW_MS;
	return new Date(Number.isFinite(client) ? Math.min(client, max) : now.getTime());
}

/** The LWW clock of an entry (`lastWatchedAt` for entries written before 9.9). */
export function stateTime(entry: Pick<WatchHistoryEntry, 'stateUpdatedAt' | 'lastWatchedAt'>): number {
	const t = Date.parse(entry.stateUpdatedAt ?? entry.lastWatchedAt);
	return Number.isFinite(t) ? t : 0;
}

/**
 * Apply a client write to an entry in place. Returns false (entry untouched)
 * when the stored state is newer or equally new: ties keep the stored value so
 * every device converges on the same answer whatever order writes arrive in.
 */
export function applyWatchState(entry: WatchHistoryEntry, input: WatchStateInput, now: Date): boolean {
	const at = clampClientTime(input.clientUpdatedAt, now);
	if (at.getTime() <= stateTime(entry)) return false;
	const percentageWatched = percentageOf(input.position, input.duration);
	entry.progress = input.position;
	entry.videoDuration = input.duration;
	entry.percentageWatched = percentageWatched;
	entry.completed = entry.completed || percentageWatched >= COMPLETED_PERCENT;
	entry.stateUpdatedAt = at.toISOString();
	if (input.deviceId) entry.stateDeviceId = input.deviceId;
	else delete entry.stateDeviceId;
	entry.lastWatchedAt = now.toISOString();
	return true;
}

export function toWatchState(entry: WatchHistoryEntry): WatchState {
	return {
		videoId: entry.videoId,
		position: entry.progress,
		duration: entry.videoDuration,
		percentageWatched: entry.percentageWatched,
		completed: entry.completed,
		updatedAt: entry.stateUpdatedAt ?? entry.lastWatchedAt,
		serverUpdatedAt: entry.lastWatchedAt,
		...(entry.stateDeviceId ? { deviceId: entry.stateDeviceId } : {}),
	};
}

/** In progress: belongs on the Continue watching row. */
export function isContinueWatching(entry: Pick<WatchHistoryEntry, 'percentageWatched'>): boolean {
	return entry.percentageWatched >= CONTINUE_MIN_PERCENT && entry.percentageWatched < COMPLETED_PERCENT;
}

/**
 * Entries changed at or after `since` (server time), oldest first, at most
 * `limit`. Inclusive so entries sharing the boundary millisecond are never
 * skipped; clients apply states idempotently, so a repeat is harmless.
 */
export function changesSince(
	entries: WatchHistoryEntry[],
	since: string | undefined,
	limit: number,
): { items: WatchHistoryEntry[]; hasMore: boolean } {
	const from = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
	const changed = entries
		.filter((e) => Date.parse(e.lastWatchedAt) >= from)
		.sort((a, b) => Date.parse(a.lastWatchedAt) - Date.parse(b.lastWatchedAt));
	return { items: changed.slice(0, limit), hasMore: changed.length > limit };
}
