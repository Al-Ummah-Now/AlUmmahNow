/**
 * Event tags of live streams and premieres (wiki E17 §5.1), behind the `liveEvents` switch: who may set one,
 * and what a reader is shown. The tags are LIVE_EVENT_TYPES (shared-types); taking one off always works.
 */
import { LIVE_METADATA_TABLE, featureGate, isLiveEventType, tierAllowsLiveCapability, type FeatureKey, type LiveEventType } from '@al-ummah/shared-types';
import type { AppContext } from '../../base';
import { channelOwnerTier } from '../creatorTiers';
import { featureOff } from '../features/off';
import { logger } from '../logger';

/** The switch is on; off while it cannot be read. */
export const switchOn = async (c: AppContext, key: FeatureKey): Promise<boolean> => (await featureGate(c.env as never, key).catch(() => ({ on: false as const }))).on;

/** The answer that refuses this tag, or null: the switch is on and the owner's tier has event tags. */
export async function eventTagRefused(c: AppContext, ownerId: string | null | undefined, eventType: LiveEventType | null | undefined): Promise<Response | null> {
	if (!eventType) return null;
	const db = (c.env as { SEARCH_DB?: D1Database }).SEARCH_DB;
	if (!db || !ownerId || !(await switchOn(c, 'liveEvents'))) return featureOff(c, 'liveEvents');
	return tierAllowsLiveCapability(await channelOwnerTier(db, ownerId), 'liveEvents') ? null : featureOff(c, 'liveEvents');
}

/** The tag a reader is shown: none while event tags are off. */
export const shownEventType = (stream: object, eventsOn: boolean): LiveEventType | null => {
	const value = (stream as { eventType?: unknown }).eventType;
	return eventsOn && isLiveEventType(value) ? value : null;
};

/** How many people asked to be reminded of each stream, by primary key; 0 while reminders are off or unreadable. */
export async function reminderCounts(c: AppContext, ids: string[]): Promise<Map<string, number>> {
	const db = (c.env as { SEARCH_DB?: D1Database }).SEARCH_DB;
	const counts = new Map<string, number>();
	if (!db || !ids.length || !(await switchOn(c, 'liveReminders'))) return counts;
	try {
		for (let i = 0; i < ids.length; i += 90) {
			const part = ids.slice(i, i + 90);
			const { results } = await db.prepare(`SELECT stream_id, reminder_count FROM ${LIVE_METADATA_TABLE} WHERE stream_id IN (${part.map(() => '?').join(', ')})`).bind(...part).all<{ stream_id: string; reminder_count: number }>();
			for (const row of results ?? []) counts.set(row.stream_id, row.reminder_count);
		}
	} catch (error) {
		logger.warn('[Live] Reminder counts not read', { error: error instanceof Error ? error.message : String(error) });
	}
	return counts;
}
