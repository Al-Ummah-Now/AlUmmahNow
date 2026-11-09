/**
 * Studio plan limits. The resolver arrives with PR #390 as `getEntitlements` in
 * lib/entitlements.ts; this reads it through the module namespace, so these
 * limits enforce as soon as that export exists, with no further change. Until
 * then, and on any resolver failure, everything is allowed: an outage must not
 * lock creators out.
 */
import { checkNumericLimit, type EntitlementValue, type Subject, type UpgradeRequiredError } from '@al-ummah/shared-types';
import * as entitlements from './entitlements';
import { logger } from './logger';

export type EntitlementResolver = (
	env: unknown,
	subjects: Subject[],
) => Promise<{ entitlements: Record<string, { value: EntitlementValue }> }>;

function projectResolver(): EntitlementResolver | null {
	const resolver = (entitlements as unknown as { getEntitlements?: EntitlementResolver }).getEntitlements;
	return typeof resolver === 'function' ? resolver : null;
}

async function resolveValue(env: unknown, key: string, subjects: Subject[], resolver: EntitlementResolver | null): Promise<EntitlementValue | undefined> {
	if (!resolver) return undefined;
	try {
		return (await resolver(env, subjects)).entitlements[key]?.value;
	} catch (error) {
		logger.warn('[StudioLimits] Resolver failed, allowing', { key, error: error instanceof Error ? error.message : String(error) });
		return undefined;
	}
}

function refused(entitlement: string, limit: UpgradeRequiredError['limit'], current: number | null, message: string): UpgradeRequiredError {
	return { success: false, error: 'upgrade_required', entitlement, limit, current, message };
}

/** Null when another draft is allowed. */
export async function checkDraftAllowed(
	env: unknown,
	input: { userId: string; channelId: string; drafts: number },
	resolver: EntitlementResolver | null = projectResolver(),
): Promise<UpgradeRequiredError | null> {
	const value = await resolveValue(env, 'studio.drafts.max', [{ type: 'channel', id: input.channelId }, { type: 'user', id: input.userId }], resolver);
	if (value === undefined) return null;
	const decision = checkNumericLimit(value, input.drafts, 1);
	return decision.allowed ? null : refused('studio.drafts.max', decision.limit, input.drafts, 'Your plan has reached its limit of drafts.');
}

/** Null when bulk scheduling is allowed. */
export async function checkBulkScheduleAllowed(
	env: unknown,
	userId: string,
	resolver: EntitlementResolver | null = projectResolver(),
): Promise<UpgradeRequiredError | null> {
	const value = await resolveValue(env, 'studio.bulkSchedule', [{ type: 'user', id: userId }], resolver);
	return value === false ? refused('studio.bulkSchedule', null, null, 'Your plan does not include bulk scheduling.') : null;
}
