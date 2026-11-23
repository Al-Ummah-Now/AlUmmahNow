/**
 * Account erasure and creator support (wiki AUN-MEMBERS §9.8; cross-provider review of #1758).
 *
 * Before an account's data is erased, its monthly support is stopped AT THE COLLECTOR, so no charge
 * follows the erasure. The processor's erasure then keeps the money records under the erased marker
 * (user-traces.ts). If the collector can't be reached, the erasure goes on: the pledge is marked
 * canceled here, and a renewal that still arrives is booked (it is the creator's money) and stopped at
 * the collector by the webhook job.
 *
 * Keyed reads only (idx_support_pledges_supporter).
 */
import type { SearchDb } from '@al-ummah/shared-types';
import { collectorFor, type SupportAdapterEnv } from './adapters';
import type { CollectorContext } from './collector';
import { logger } from '../logger';

export async function stopSupportBeforeErasure(
	env: SupportAdapterEnv & { SEARCH_DB?: SearchDb },
	userId: string,
	ctxFor: (mode: 'test' | 'live') => CollectorContext,
	now = new Date(),
): Promise<{ stopped: number; unreachable: number }> {
	const db = env.SEARCH_DB;
	if (!db || !userId) return { stopped: 0, unreachable: 0 };
	const pledges = await db
		.prepare("SELECT id, collector, mode, collector_pledge_ref FROM support_pledges WHERE supporter_user_id = ? AND status IN ('active', 'past_due') LIMIT 200")
		.bind(userId)
		.all<{ id: string; collector: string; mode: 'test' | 'live'; collector_pledge_ref: string | null }>();
	let stopped = 0;
	let unreachable = 0;
	const at = now.toISOString();
	for (const p of pledges.results ?? []) {
		const collector = collectorFor(env, p.collector as never);
		try {
			if (!collector || !p.collector_pledge_ref) throw new Error(`collector ${p.collector} not available here`);
			await collector.cancelPledge(ctxFor(p.mode), p.collector_pledge_ref, 'erasure');
			stopped++;
		} catch (error) {
			unreachable++;
			logger.warn('[Support] Pledge not stopped at the collector before erasure; the webhook job stops it on its next renewal', { pledgeId: p.id, error: error instanceof Error ? error.message : String(error) });
		}
		await db
			.prepare("UPDATE support_pledges SET status = 'canceled', canceled_at = ?, cancel_reason = 'erasure', last_event_at = CASE WHEN last_event_at IS NULL OR last_event_at < ? THEN ? ELSE last_event_at END, updated_at = ? WHERE id = ? AND status IN ('active', 'past_due')")
			.bind(at, at, at, at, p.id)
			.run();
	}
	return { stopped, unreachable };
}
