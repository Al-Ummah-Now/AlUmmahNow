/**
 * Hourly import of legacy channel subscriptions into D1
 * (SCALABILITY-AUDIT AV-4; see lib/subscription-store.ts).
 *
 * Walks the channels bucket from the last key it handled, kept in D1
 * (channel_subscription_import_state.cursor, used as R2 `startAfter`), imports every channel without an
 * import marker, and stops when the operation budget is spent. At the end of
 * a pass it records the pass and starts over, so channels created since are
 * imported on the next pass. Each import is idempotent and guarded by its
 * marker, so overlapping runs are harmless.
 */
import { importLegacySubscriptions, type ChannelWithLegacySubscriptions } from './subscription-store';
import { BudgetExhausted, OperationBudget } from './privacy/scan';
import { logger } from './logger';

/** Cron expression of the import (wrangler triggers.crons). */
export const SUBSCRIPTION_IMPORT_CRON = '47 * * * *';
/** Subrequests per run: well under the 1000 a Worker invocation may make. */
export const SUBSCRIPTION_IMPORT_BUDGET = 900;
const PAGE_SIZE = 1000;

export interface SubscriptionImportResult {
	checked: number;
	imported: number;
	passCompleted: boolean;
	cursor: string | null;
}

export async function importPendingSubscriptions(
	env: { NOTIFICATIONS_DB?: D1Database; channels: R2Bucket },
	budget = new OperationBudget(SUBSCRIPTION_IMPORT_BUDGET),
	now = Date.now(),
): Promise<SubscriptionImportResult> {
	const db = env.NOTIFICATIONS_DB;
	const result: SubscriptionImportResult = { checked: 0, imported: 0, passCompleted: false, cursor: null };
	if (!db) return result;

	budget.spend();
	const state = await db.prepare('SELECT cursor FROM channel_subscription_import_state WHERE id = 1').first<{ cursor: string | null }>();
	let cursor: string | undefined = state?.cursor || undefined;

	// Not charged: the budget leaves room for this one write (900 + 1 < 1000)
	const saveCursor = async (next: string | null, completed: boolean) => {
		await db
			.prepare(
				`INSERT INTO channel_subscription_import_state (id, cursor, passes, completed_at, updated_at) VALUES (1, ?1, ?2, ?3, ?4)
				 ON CONFLICT (id) DO UPDATE SET cursor = excluded.cursor, passes = passes + excluded.passes,
				   completed_at = COALESCE(excluded.completed_at, completed_at), updated_at = excluded.updated_at`,
			)
			.bind(next, completed ? 1 : 0, completed ? now : null, now)
			.run();
	};

	let reachedEnd = false;
	try {
		while (true) {
			budget.spend();
			const page = await env.channels.list({ limit: PAGE_SIZE, ...(cursor ? { startAfter: cursor } : {}) });
			const keys = page.objects.map((o) => o.key);
			for (let i = 0; i < keys.length; i += 100) {
				const chunk = keys.slice(i, i + 100);
				budget.spend();
				const { results } = await db
					.prepare('SELECT j.value AS channel_id FROM json_each(?1) AS j JOIN channel_subscription_imports i ON i.channel_id = j.value')
					.bind(JSON.stringify(chunk))
					.all<{ channel_id: string }>();
				const done = new Set((results || []).map((r) => r.channel_id));
				for (const key of chunk) {
					if (!done.has(key)) {
						// a get and the import (marker check + batch)
						budget.spend(3);
						const object = await env.channels.get(key);
						let channel: ChannelWithLegacySubscriptions | null = null;
						try {
							channel = object ? await object.json<ChannelWithLegacySubscriptions>() : null;
						} catch {
							channel = null;
						}
						// Channels are stored under their id; the key is the id even if the JSON lacks it
						if (channel) {
							if (await importLegacySubscriptions(db, { ...channel, id: key }, now)) result.imported++;
						}
					}
					result.checked++;
					cursor = key;
				}
			}
			if (!page.truncated) {
				reachedEnd = true;
				break;
			}
		}
	} catch (error) {
		if (!(error instanceof BudgetExhausted)) throw error;
	}
	if (reachedEnd) {
		result.passCompleted = true;
		cursor = undefined;
	}
	result.cursor = cursor ?? null;
	await saveCursor(result.cursor, result.passCompleted).catch((error) => {
		logger.warn('[SubscriptionImport] Could not save progress', { error: error instanceof Error ? error.message : String(error) });
	});
	return result;
}
