/**
 * Upload quotas (Epic 27): `upload.monthlyUploads`, `storage.gb` and
 * `upload.maxDurationMinutes`, per user.
 *
 * Counters are reserved at upload start with a conditional upsert, so parallel
 * uploads cannot overshoot. Usage counts from rollout: existing videos have no
 * stored size and consume no quota (grandfathering). Only uploads started under
 * enforcement carry `entitlementChecked`, so an existing video can never fail
 * the duration check.
 *
 * Any D1 failure allows the upload: an outage must not block creators.
 */
import { checkNumericLimit, usagePeriod, type EntitlementValue, type UpgradeRequiredError } from '@al-ummah/shared-types';
import { BYTES_PER_GB, getEntitlements, requestLanguage, upgradeRequiredBody, type EntitlementsEnv } from './entitlements';
import { logger } from './logger';

const MONTHLY = 'upload.monthlyUploads';
const STORAGE = 'storage.gb';
const DURATION = 'upload.maxDurationMinutes';

export interface UploadRequest {
	userId: string;
	count: number;
	bytes: number;
	/** Longest duration the client declared, in seconds. Verified again after encoding. */
	declaredSeconds?: number;
}

export interface UploadReservation {
	userId: string;
	count: number;
	bytes: number;
	period: string;
}

export type ReserveResult =
	| { ok: true; reservation: UploadReservation | null }
	| { ok: false; key: string; limit: number; current: number | null };

/** Adds to a counter unless that would exceed `ceiling`. Returns false when refused. */
async function addWithin(db: any, userId: string, key: string, period: string, amount: number, ceiling: number | null): Promise<boolean> {
	if (ceiling !== null && amount > ceiling) return false;
	const result = await db
		.prepare(
			`INSERT INTO usage_counters (subject_type, subject_id, key, period, value, updated_at)
			 VALUES ('user', ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT (subject_type, subject_id, key, period)
			 DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at
			 WHERE ? IS NULL OR value + excluded.value <= ?`,
		)
		.bind(userId, key, period, amount, ceiling, ceiling)
		.run();
	return Number(result.meta?.changes ?? 0) > 0;
}

async function subtract(db: any, userId: string, key: string, period: string, amount: number): Promise<void> {
	await db
		.prepare(`UPDATE usage_counters SET value = MAX(value - ?, 0), updated_at = datetime('now') WHERE subject_type = 'user' AND subject_id = ? AND key = ? AND period = ?`)
		.bind(amount, userId, key, period)
		.run();
}

async function readCounter(db: any, userId: string, key: string, period: string): Promise<number | null> {
	try {
		const row = await db.prepare(`SELECT value FROM usage_counters WHERE subject_type = 'user' AND subject_id = ? AND key = ? AND period = ?`).bind(userId, key, period).first();
		return Number(row?.value ?? 0);
	} catch {
		return null;
	}
}

const finite = (value: EntitlementValue | undefined): number | null => (typeof value === 'number' ? value : null);

/** Checks limits and reserves quota. A refusal has changed nothing. */
export async function reserveUpload(env: EntitlementsEnv, request: UploadRequest, now: Date = new Date()): Promise<ReserveResult> {
	const snapshot = await getEntitlements(env, [{ type: 'user', id: request.userId }], now);
	if (snapshot.degraded) return { ok: true, reservation: null };
	const db = env.REPORTS_DB;
	const value = (key: string) => snapshot.entitlements[key]?.value;

	const maxMinutes = finite(value(DURATION));
	if (maxMinutes !== null && request.declaredSeconds !== undefined && request.declaredSeconds > maxMinutes * 60) {
		return { ok: false, key: DURATION, limit: maxMinutes, current: Math.ceil(request.declaredSeconds / 60) };
	}

	const period = usagePeriod(now);
	const monthlyLimit = finite(value(MONTHLY));
	const storageGb = finite(value(STORAGE));
	try {
		if (request.count > 0 && !(await addWithin(db, request.userId, MONTHLY, period, request.count, monthlyLimit))) {
			return { ok: false, key: MONTHLY, limit: monthlyLimit as number, current: await readCounter(db, request.userId, MONTHLY, period) };
		}
		if (request.bytes > 0 && !(await addWithin(db, request.userId, STORAGE, 'all', request.bytes, storageGb === null ? null : storageGb * BYTES_PER_GB))) {
			if (request.count > 0) await subtract(db, request.userId, MONTHLY, period, request.count);
			const used = await readCounter(db, request.userId, STORAGE, 'all');
			return { ok: false, key: STORAGE, limit: storageGb as number, current: used === null ? null : Math.round((used / BYTES_PER_GB) * 100) / 100 };
		}
		return { ok: true, reservation: { userId: request.userId, count: request.count, bytes: request.bytes, period } };
	} catch (error) {
		logger.warn('[UploadQuota] Reservation failed; allowing upload', { error: error instanceof Error ? error.message : String(error) });
		return { ok: true, reservation: null };
	}
}

/** Gives back a reservation when the upload could not start on our side. */
export async function releaseReservation(env: EntitlementsEnv, reservation: UploadReservation | null): Promise<void> {
	if (!reservation) return;
	try {
		if (reservation.count > 0) await subtract(env.REPORTS_DB, reservation.userId, MONTHLY, reservation.period, reservation.count);
		if (reservation.bytes > 0) await subtract(env.REPORTS_DB, reservation.userId, STORAGE, 'all', reservation.bytes);
	} catch (error) {
		logger.warn('[UploadQuota] Release failed', { error: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * Returns storage when a counted video is deleted. The monthly count is not
 * returned, so deleting cannot reset it. Never throws: a delete must not fail on this.
 */
export async function releaseVideoStorage(env: EntitlementsEnv, video: { userId?: string; usageBytes?: number }): Promise<void> {
	if (!video.userId || !video.usageBytes || !env.REPORTS_DB) return;
	try {
		await subtract(env.REPORTS_DB, video.userId, STORAGE, 'all', video.usageBytes);
	} catch (error) {
		logger.warn('[UploadQuota] Storage release failed', { error: error instanceof Error ? error.message : String(error) });
	}
}

/** True when an upload started under enforcement turned out longer than the owner's limit. */
export async function exceedsDurationLimit(env: EntitlementsEnv, video: { userId?: string; entitlementChecked?: boolean }, seconds: number, now: Date = new Date()): Promise<boolean> {
	if (!video.entitlementChecked || !seconds || !video.userId) return false;
	const snapshot = await getEntitlements(env, [{ type: 'user', id: video.userId }], now);
	if (snapshot.degraded) return false;
	const maxMinutes = finite(snapshot.entitlements[DURATION]?.value);
	return maxMinutes !== null && seconds > maxMinutes * 60;
}

/** The 402 body for a refused reservation, localized from the request. */
export function quotaRefusal(result: Extract<ReserveResult, { ok: false }>, acceptLanguage: string | null | undefined): UpgradeRequiredError {
	return upgradeRequiredBody(result.key, result.limit, result.current, requestLanguage(acceptLanguage));
}

/** Refuses growth only: a channel above the limit keeps its links and may reduce them. */
export function linksAllowed(limit: EntitlementValue, stored: number, requested: number): boolean {
	return checkNumericLimit(limit, stored, requested - stored).allowed;
}
