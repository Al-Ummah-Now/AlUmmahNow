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
import { logger } from './logger';

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

/** Stored when no channel name could be found; the web app shows its own localized fallback. */
export const UNKNOWN_CHANNEL_NAME = "Unknown Channel";

/** Channel name by id from the channels bucket, or null (missing bucket, object or name). */
export async function channelNameById(channels: R2Bucket | undefined, channelId: string | null | undefined): Promise<string | null> {
  if (!channels || !channelId) return null;
  try {
    const object = await channels.get(channelId);
    if (!object) return null;
    const channel = await object.json<{ name?: unknown }>();
    return typeof channel?.name === "string" && channel.name.trim() ? channel.name : null;
  } catch (error) {
    logger.warn("[WatchHistory] Channel lookup failed", { channelId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Display name of a video's channel. Channel uploads carry only `channelId`
 * (#294); legacy imports carry the name in `channel`.
 */
export async function resolveVideoChannelName(
  channels: R2Bucket | undefined,
  video: { channelName?: unknown; channel?: unknown; channelId?: unknown },
): Promise<string> {
  if (typeof video.channelName === "string" && video.channelName) return video.channelName;
  if (typeof video.channel === "string" && video.channel) return video.channel;
  const name = await channelNameById(channels, typeof video.channelId === "string" ? video.channelId : null);
  return name ?? UNKNOWN_CHANNEL_NAME;
}

/**
 * Fill in channel names for entries stored without one (recorded before #294
 * was fixed). One lookup per distinct channel; entries are not rewritten.
 */
export async function withChannelNames<T extends { channelId?: string; channelName?: string }>(
  channels: R2Bucket | undefined,
  entries: T[],
): Promise<T[]> {
  const missing = (e: T) => !!e.channelId && (!e.channelName || e.channelName === UNKNOWN_CHANNEL_NAME);
  const ids = [...new Set(entries.filter(missing).map(e => e.channelId as string))];
  if (!ids.length) return entries;
  const names = new Map<string, string | null>(
    await Promise.all(ids.map(async id => [id, await channelNameById(channels, id)] as const)),
  );
  return entries.map(e => {
    const name = missing(e) ? names.get(e.channelId as string) : null;
    return name ? { ...e, channelName: name } : e;
  });
}
