/**
 * Tier changes (wiki AUN-TIER-REQUESTS "Telling the user"): every change of a
 * user's tier for any reason is stored (creator_tier_changes, migration 0063)
 * and the user is told: an in-app notice at once (dedupe key per change) and an
 * email through admin-api (job `tier_changed` on the contact mail queue, one
 * language at send time, branded layout). An approved request is told by its
 * own decision delivery (admin-api tier-request-mail), so its change is stored
 * without a second notice.
 *
 * Not changes: the default written at sign-up, the Free backfill, a super
 * admin's automatic Unlimited, an invite's tier (the invite email says it).
 */
import { toPublicTier, type NotificationCreatePayload, type TierChange, type TierChangeReason } from '@al-ummah/shared-types';
import { readTier, readTiers } from './creatorTiers';
import { enqueueNotification, type NotificationsEnv } from './notifications';
import { logger } from './logger';

export interface TierChangeEnv extends NotificationsEnv {
	SEARCH_DB?: D1Database;
	/** admin-api's contact mail queue (producer binding): the tier-change email job */
	CONTACT_MAIL_QUEUE?: { send(message: unknown, opts?: unknown): Promise<unknown> };
}

export const TIER_CHANGE_MAIL_VERSION = 1;

interface ChangeRow {
	id: string;
	user_id: string;
	reason: TierChangeReason;
	from_tier_id: string | null;
	to_tier_id: string;
	request_id: string | null;
	created_at: string;
	email_status: string | null;
}

/** The in-app notice of a change (always on, category account). */
export function tierChangeNotification(change: Pick<TierChange, 'id' | 'userId' | 'fromTierName' | 'fromTierNameAr' | 'toTierName' | 'toTierNameAr' | 'reason'>, now = Date.now()): NotificationCreatePayload {
	return {
		notificationId: crypto.randomUUID(),
		recipientUserId: change.userId,
		notificationKey: 'tierChanged',
		params: {
			from: change.fromTierName,
			from_en: change.fromTierName,
			from_ar: change.fromTierNameAr,
			to: change.toTierName,
			to_en: change.toTierName,
			to_ar: change.toTierNameAr,
			reason: change.reason,
		},
		actionUrl: '/upgrade',
		entityId: change.id,
		dedupeKey: `tier-change:${change.id}`,
		createdAt: now,
	};
}

/**
 * Stores a change and tells the user (unless `quiet`: an approved request has
 * its own delivery). Never throws: the tier is already changed; a failure to
 * tell is logged (the email job flags the admin Errors page on its own failures).
 */
export async function recordTierChange(
	env: TierChangeEnv,
	input: { userId: string; from: string | null; to: string; reason: TierChangeReason; requestId?: string | null; quiet?: boolean },
	now = new Date(),
): Promise<string | null> {
	if (input.from === input.to || !env.SEARCH_DB) return null;
	const db = env.SEARCH_DB;
	const id = `tch_${crypto.randomUUID().replace(/-/g, '')}`;
	try {
		await db
			.prepare('INSERT INTO creator_tier_changes (id, user_id, reason, from_tier_id, to_tier_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
			.bind(id, input.userId, input.reason, input.from, input.to, input.requestId ?? null, now.toISOString())
			.run();
	} catch (error) {
		logger.error('[TierChanges] Could not store the change', { userId: input.userId, from: input.from, to: input.to, error: error instanceof Error ? error.message : String(error) });
		return null;
	}
	if (input.quiet) return id;
	const change = await readTierChange(db, id);
	if (change && (await enqueueNotification(env, tierChangeNotification(change, now.getTime())))) {
		await db.prepare('UPDATE creator_tier_changes SET notified_at = ? WHERE id = ?').bind(now.toISOString(), id).run().catch(() => undefined);
	} else {
		logger.warn('[TierChanges] In-app notice not queued', { changeId: id, userId: input.userId });
	}
	if (!env.CONTACT_MAIL_QUEUE) {
		logger.warn('[TierChanges] CONTACT_MAIL_QUEUE is not bound: no email', { changeId: id });
		return id;
	}
	try {
		await env.CONTACT_MAIL_QUEUE.send({ v: TIER_CHANGE_MAIL_VERSION, kind: 'tier_changed', changeId: id }, { contentType: 'json' });
		await db.prepare("UPDATE creator_tier_changes SET email_status = 'queued' WHERE id = ?").bind(id).run().catch(() => undefined);
	} catch (error) {
		logger.error('[TierChanges] Email job not queued', { changeId: id, error: error instanceof Error ? error.message : String(error) });
		await db.prepare("UPDATE creator_tier_changes SET email_status = 'failed', email_error = 'could not queue the email' WHERE id = ?").bind(id).run().catch(() => undefined);
	}
	return id;
}

/** One change with both tiers' names (a tier gone since keeps its id as the name). */
export async function readTierChange(db: D1Database, id: string): Promise<TierChange | null> {
	const row = await db.prepare('SELECT * FROM creator_tier_changes WHERE id = ?').bind(id).first<ChangeRow>();
	if (!row) return null;
	const tiers = await readTiers(db);
	const named = (tierId: string | null) => {
		const tier = tierId ? tiers.find((t) => t.id === tierId) : null;
		return { name: tier?.name ?? tierId ?? '—', nameAr: tier?.nameAr || tier?.name || tierId || '—' };
	};
	const from = named(row.from_tier_id);
	const to = named(row.to_tier_id);
	const toTier = await readTier(db, row.to_tier_id);
	return {
		id: row.id,
		userId: row.user_id,
		reason: row.reason,
		fromTierId: row.from_tier_id,
		fromTierName: from.name,
		fromTierNameAr: from.nameAr,
		toTierId: row.to_tier_id,
		toTierName: to.name,
		toTierNameAr: to.nameAr,
		toTier: toTier ? toPublicTier(toTier) : null,
		createdAt: row.created_at,
		emailStatus: row.email_status,
	};
}

/** What the email job did (sent, sunk, disabled, no_address, failed). */
export async function recordTierChangeEmail(db: D1Database, id: string, status: string, error: string | null): Promise<void> {
	await db.prepare('UPDATE creator_tier_changes SET email_status = ?, email_error = ? WHERE id = ?').bind(status, error, id).run();
}

/** GDPR erase: the user's requests and tier changes. */
export async function eraseTierHistory(db: D1Database, userId: string): Promise<void> {
	await db.prepare('DELETE FROM tier_requests WHERE user_id = ?').bind(userId).run();
	await db.prepare('DELETE FROM creator_tier_changes WHERE user_id = ?').bind(userId).run();
}
