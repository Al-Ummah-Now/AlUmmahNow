/**
 * Watch history helpers shared by the /api/watch-history endpoints.
 *
 * - Pause: `watchHistoryPaused` lives on the user's profile (profiles/{userId}),
 *   next to privacyConsent, so it is exported and erased with the profile and
 *   is never swept by the watch-history retention job.
 * - Events: WatchHistory messages use the standard QueueMessage envelope
 *   ({ id, type, payload, timestamp }). The endpoints used to send
 *   { type: "WatchHistory", data }, which the processor rejects as an invalid
 *   message structure.
 */
import type { WatchHistoryEvent } from '@al-ummah/shared-types';
import R2Repository from './r2Repo';
import Queue, { MessageType } from './queue';

interface ProfileWithHistorySettings {
	id: string;
	watchHistoryPaused?: boolean;
	dateModified?: string;
	[key: string]: unknown;
}

export async function isWatchHistoryPaused(profiles: R2Bucket | undefined, userId: string): Promise<boolean> {
	if (!profiles) return false;
	const profile = await new R2Repository<ProfileWithHistorySettings>(profiles).getObject(userId);
	return profile?.watchHistoryPaused === true;
}

export async function setWatchHistoryPaused(
	profiles: R2Bucket,
	userId: string,
	email: string | undefined,
	paused: boolean,
): Promise<boolean> {
	const now = new Date().toISOString();
	const updated = await new R2Repository<ProfileWithHistorySettings>(profiles).updateObject(
		userId,
		(profile) => {
			if (profile.watchHistoryPaused === paused) return false;
			profile.watchHistoryPaused = paused;
			profile.dateModified = now;
			return true;
		},
		{
			initial: () => ({
				id: userId,
				email: email || 'unknown',
				dateCreated: now,
				dateModified: now,
				channels: [],
				subscribedTo: [],
			}),
		},
	);
	return updated?.watchHistoryPaused === true;
}

/** Ratio watched as a 0..100 integer; 0 when the duration is unknown. */
export function percentageOf(progress: number, duration: number): number {
	if (!Number.isFinite(progress) || !Number.isFinite(duration) || duration <= 0) return 0;
	return Math.max(0, Math.min(Math.round((progress / duration) * 100), 100));
}

export async function queueWatchHistoryEvent(queue: unknown, event: WatchHistoryEvent): Promise<void> {
	await new Queue(queue).send(MessageType.WatchHistory, event);
}
