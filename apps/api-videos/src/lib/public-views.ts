/**
 * Serializers for responses anyone can read without signing in.
 *
 * Each one lists the fields it returns, so a field added to the stored record
 * stays out of public output until it is added here on purpose. Account
 * details (email, legal names, timezone) and relation arrays are returned only
 * by the authenticated owner routes (GET /api/channels/:id/owner, GET /api/profile).
 */

import { z } from 'zod';
import { Channel as BusinessChannel, Profile as BusinessProfile } from './types';
import { PublicChannelView, PublicProfileView } from './model/view';
import { safeChannelLinks } from './channelAbout';
import { subscriberCounts } from './subscription-store';
import { channelVideoCountsFromIndex, OwnershipEnv } from './search/ownership';
import { logger } from './logger';

type StoredChannel = z.infer<typeof BusinessChannel> & { isVerified?: boolean; isSuspended?: boolean; suspension?: { at?: string; reason?: string } };
type StoredProfile = z.infer<typeof BusinessProfile>;

/**
 * `subscribers`: the channel's subscriber count from the subscription store
 * (subscriberCounts, SCALABILITY-AUDIT AV-4). Without it the legacy array in
 * the channel JSON is counted.
 */
export function toPublicChannel(channel: StoredChannel, subscribers?: number): z.infer<typeof PublicChannelView> {
	return {
		id: channel.id,
		userId: channel.userId,
		name: channel.name,
		nameLocalized: channel.nameLocalized,
		description: channel.description,
		descriptionLocalized: channel.descriptionLocalized,
		isMain: channel.isMain === true,
		isPrivate: channel.isPrivate,
		isVerified: channel.isVerified === true,
		avatarUrl: channel.avatarUrl,
		coverUrl: channel.coverUrl,
		handle: channel.handle,
		links: channel.links ? safeChannelLinks(channel.links) : undefined,
		location: channel.location,
		dateCreated: channel.dateCreated,
		dateModified: channel.dateModified,
		playlistsCount: channel.playlists?.length || 0,
		videosCount: channel.videos?.length || 0,
		subscribersCount: channel.subscribers?.length || 0,
		subscriptionsCount: subscribers ?? (channel.subscriptions?.length || 0),
		likesCount: channel.likes?.length || 0,
		// Only the owner ever gets a suspended channel (my channels); the web app shows the notice
		...(channel.isSuspended === true ? { isSuspended: true, suspension: { at: channel.suspension?.at ?? '', ...(channel.suspension?.reason ? { reason: channel.suspension.reason } : {}) } } : {}),
	};
}

export function toPublicProfile(profile: StoredProfile): z.infer<typeof PublicProfileView> {
	return {
		id: profile.id,
		userName: profile.userName,
		displayName: profile.displayName,
		displayNameLocalized: profile.displayNameLocalized,
		bio: profile.bio,
		bioLocalized: profile.bioLocalized,
		avatarUrl: profile.avatarUrl,
		coverUrl: profile.coverUrl,
		dateCreated: profile.dateCreated,
		dateModified: profile.dateModified,
		channelsCount: profile.channels?.length || 0,
	};
}

/** toPublicChannel for many channels, with their subscriber counts from one D1 query. */
/**
 * Public channel views. With `env` (the ownership index), `videosCount` is the
 * channel's public, published, ready videos counted in the index: uploads
 * never append to the stored `channel.videos`, which therefore stays [] (the
 * 2026-11-10 "0 videos" badge). Without the index the stored count is kept.
 */
export async function toPublicChannels(
	db: D1Database | undefined,
	channels: StoredChannel[],
	env?: OwnershipEnv,
): Promise<z.infer<typeof PublicChannelView>[]> {
	const [counts, videoCounts] = await Promise.all([
		subscriberCounts(db, channels),
		env
			? channelVideoCountsFromIndex(env, channels.map((channel) => channel?.id)).catch((error) => {
					logger.warn('[PublicViews] Video counts from index failed', { error: error instanceof Error ? error.message : String(error) });
					return null;
				})
			: Promise.resolve(null),
	]);
	return channels.map((channel) => {
		const view = toPublicChannel(channel, channel?.id ? counts.get(channel.id) : undefined);
		const indexed = channel?.id ? videoCounts?.get(channel.id) : undefined;
		if (indexed !== undefined) view.videosCount = indexed;
		return view;
	});
}

/**
 * Set a channel view's `videosCount` from the ownership index (the owner and
 * create/update responses build their view from the stored channel, whose
 * `videos` array uploads never update). Keeps the stored count without the index.
 */
export async function withIndexedVideoCount<T extends { id?: string; videosCount?: number }>(env: OwnershipEnv, view: T): Promise<T> {
	if (!view?.id) return view;
	const counts = await channelVideoCountsFromIndex(env, [view.id]).catch(() => null);
	const indexed = counts?.get(view.id);
	if (indexed !== undefined) view.videosCount = indexed;
	return view;
}
