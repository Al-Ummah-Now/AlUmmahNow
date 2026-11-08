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

type StoredChannel = z.infer<typeof BusinessChannel> & { isVerified?: boolean };
type StoredProfile = z.infer<typeof BusinessProfile>;

export function toPublicChannel(channel: StoredChannel): z.infer<typeof PublicChannelView> {
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
		subscriptionsCount: channel.subscriptions?.length || 0,
		likesCount: channel.likes?.length || 0,
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
