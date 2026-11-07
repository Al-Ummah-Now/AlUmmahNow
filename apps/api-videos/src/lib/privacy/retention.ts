/**
 * Data retention enforcement (Story 1.3, AC 5).
 *
 * Runs from the api-videos cron trigger (see `scheduled` in src/index.ts and
 * `triggers.crons` in wrangler.jsonc). Periods are documented in
 * docs/compliance/GDPR.md; change them here and there together.
 *
 * - Watch history entries are rewritten on every progress update, so the R2
 *   object's `uploaded` timestamp is the last time the video was watched.
 *   Entries not touched for WATCH_HISTORY_RETENTION_DAYS are deleted. No object
 *   bodies are read.
 * - The processor's event archive (al-ummah-now-messages) uses keys that start
 *   with the ISO timestamp (`YYYY-MM-DDTHH-mm-ss.<id>`), so a lexicographic
 *   listing yields the oldest events first and the sweep can stop at the first
 *   key inside the retention window. Aggregated rollups under `analytics/` hold
 *   no personal data and are kept.
 */

import { BudgetExhausted, BucketLike, OperationBudget, deleteKeys, listKeys } from './scan';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Watch history: 18 months after the video was last watched. */
export const WATCH_HISTORY_RETENTION_DAYS = 548;
/** Raw event archive (views, likes, analytics beacons): 13 months. */
export const EVENT_ARCHIVE_RETENTION_DAYS = 395;

const ARCHIVE_KEY_DATE = /^(\d{4})-(\d{2})-(\d{2})T/;

export interface RetentionResult {
	watchHistoryDeleted: number;
	eventsDeleted: number;
	complete: boolean;
}

export function cutoff(now: Date, days: number): Date {
	return new Date(now.getTime() - days * DAY_MS);
}

/** Parse the date prefix of an archive key; null for keys outside the archive layout. */
export function archiveKeyDate(key: string): Date | null {
	const match = ARCHIVE_KEY_DATE.exec(key);
	if (!match) return null;
	const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
	return Number.isNaN(date.getTime()) ? null : date;
}

export async function purgeExpiredWatchHistory(bucket: BucketLike, now: Date, budget: OperationBudget): Promise<number> {
	const limit = cutoff(now, WATCH_HISTORY_RETENTION_DAYS);
	let deleted = 0;
	const expired: string[] = [];
	for await (const { key, uploaded } of listKeys(bucket, budget)) {
		if (uploaded && new Date(uploaded).getTime() < limit.getTime()) expired.push(key);
		if (expired.length >= 1000) deleted += await deleteKeys(bucket, expired.splice(0), budget);
	}
	if (expired.length > 0) deleted += await deleteKeys(bucket, expired, budget);
	return deleted;
}

export async function purgeExpiredEvents(bucket: BucketLike, now: Date, budget: OperationBudget): Promise<number> {
	const limit = cutoff(now, EVENT_ARCHIVE_RETENTION_DAYS);
	let deleted = 0;
	const expired: string[] = [];
	for await (const { key } of listKeys(bucket, budget)) {
		const date = archiveKeyDate(key);
		// Keys sort chronologically; the first key inside the window (or outside the
		// archive layout, e.g. analytics/ rollups) ends the sweep.
		if (!date || date.getTime() >= limit.getTime()) break;
		expired.push(key);
		if (expired.length >= 1000) deleted += await deleteKeys(bucket, expired.splice(0), budget);
	}
	if (expired.length > 0) deleted += await deleteKeys(bucket, expired, budget);
	return deleted;
}

export async function enforceRetention(
	buckets: { watch_history: unknown; analytics_rollups?: unknown },
	now: Date,
	budget: OperationBudget,
): Promise<RetentionResult> {
	const result: RetentionResult = { watchHistoryDeleted: 0, eventsDeleted: 0, complete: true };
	try {
		result.watchHistoryDeleted = await purgeExpiredWatchHistory(buckets.watch_history as BucketLike, now, budget);
		if (buckets.analytics_rollups) {
			result.eventsDeleted = await purgeExpiredEvents(buckets.analytics_rollups as BucketLike, now, budget);
		}
	} catch (error) {
		if (!(error instanceof BudgetExhausted)) throw error;
		result.complete = false;
	}
	return result;
}
