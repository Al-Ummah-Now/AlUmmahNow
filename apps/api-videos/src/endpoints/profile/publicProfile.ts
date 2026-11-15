/**
 * Public profile (Story 29.5).
 *
 * Owner (signed in):
 *   PUT /api/profile/public                          { handle?, showSubscriptions?, showPlaylists?, showLikes? }
 *   GET /api/profile/handle-availability?handle=     { available, handle, reason? }
 *
 * Anyone:
 *   GET /api/users/by-handle/:handle                 the profile: name, picture, bio, public channels, which lists show
 *   GET /api/users/by-handle/:handle/subscriptions   public channels the user subscribes to (404 when hidden)
 *   GET /api/users/by-handle/:handle/playlists       the user's public personal playlists (404 when hidden)
 *   GET /api/users/by-handle/:handle/likes           public videos the user liked (404 when hidden)
 *
 * A hidden list answers exactly like an unknown handle's (404 not_found), so a request can't tell
 * "hidden" from "empty". Only public things are ever listed: private, unlisted, deleted, hidden or
 * suspended channels, playlists and videos are left out, for the owner too (this is the visitor view).
 */

import { Str } from "chanfana";
import { z } from "zod";
import { AuthenticatedRoute, OptionalAuthRoute, AppContext } from "../../base";
import R2Repository from "../../lib/r2Repo";
import { logger } from "../../lib/logger";
import { Profile as BusinessProfile, Channel, ResponseError } from "../../lib/types";
import { ProfileView, PublicUserProfileView } from "../../lib/model/view";
import { transformProfileToView } from "../../lib/transformations";
import { nameLangField, nameLocale } from "../../lib/name-locale";
import { resolveDisplayName } from "@al-ummah/shared-types";
import {
	checkUserHandleAvailability,
	claimUserHandle,
	releaseUserHandle,
	resolvePublicProfilePrivacy,
	resolveUserHandle,
	type PublicProfilePrivacy,
} from "../../lib/userHandles";
import { normalizeHandleInput } from "../../lib/channelHandles";
import { isChannelVisibleTo } from "../../lib/channelAbout";
import { toPublicChannels } from "../../lib/public-views";
import { subscribedChannelIds } from "../../lib/subscription-store";
import { collectPersonalPlaylists } from "../../lib/personalPlaylists";
import { canViewPlaylist, canViewVideo, isPersonalPlaylist, toPlaylistResponse, type VideoType } from "../../lib/playlists";
import { isSystemPlaylist, listLikedIds, toLibraryVideoViews } from "../../lib/library";
import { withPlaylistCovers } from "../../lib/playlistCovers";
import { cachedBan } from "../../lib/admin/bans";
import { edgeCacheUrl, readEdgeCache, writeEdgeCache } from "../../lib/edge-cache";
import { waitUntilOf } from "../../lib/search/ownership";
import type { SearchDb } from "@al-ummah/shared-types";

type ProfileType = z.infer<typeof BusinessProfile>;
type ChannelType = z.infer<typeof Channel>;
type PlaylistType = Parameters<typeof canViewPlaylist>[0];

/** Anonymous list responses are cached per colo this long (a changed setting shows within it) */
const PUBLIC_CACHE_SECONDS = 60;
const SUBSCRIPTIONS_PAGE_MAX = 48;
const PLAYLISTS_MAX = 100;

const notFound = (c: AppContext) => c.json({ success: false, error: "not_found" }, 404);
const NotFoundResponse = { "404": { description: "No public profile with this handle, or the list is hidden", content: { "application/json": { schema: ResponseError } } } };
const HandleParam = z.object({ handle: Str({ description: "The user's @handle (with or without the @)" }) });

// ---------------------------------------------------------------------------
// Owner settings
// ---------------------------------------------------------------------------

export const PublicProfileSettingsInput = z.object({
	handle: z.string().max(64).nullable().optional().describe("Claim or change the @handle; null or \"\" removes it (and the public profile with it)"),
	showSubscriptions: z.boolean().optional().describe("Show the channels you subscribe to"),
	showPlaylists: z.boolean().optional().describe("Show your public playlists"),
	showLikes: z.boolean().optional().describe("Show the public videos you liked"),
});

export class PublicProfileSettingsUpdate extends AuthenticatedRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Set your @handle and what your public profile shows",
		request: { body: { content: { "application/json": { schema: PublicProfileSettingsInput } } } },
		responses: {
			"200": { description: "The updated profile", content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ profile: ProfileView }) }) } } },
			"400": { description: "Handle format problem: too_short, too_long, invalid_characters or reserved", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Profile not found", content: { "application/json": { schema: ResponseError } } },
			"409": { description: "Handle taken", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const repository = new R2Repository<ProfileType>(c.env.profiles);
		const existing = await repository.getObject(userId);
		if (!existing) return c.json({ success: false, error: "Profile not found" }, 404);

		const bucket = c.env.channel_tabs;
		const oldHandle = existing.handle || null;
		let nextHandle: string | null | undefined; // undefined: unchanged
		let claimed: string | null = null;
		if (body.handle !== undefined) {
			const requested = normalizeHandleInput(body.handle ?? '');
			if (!requested) {
				nextHandle = null;
			} else if (requested !== oldHandle) {
				const claim = await claimUserHandle(bucket, requested, userId);
				if ('reason' in claim) {
					return c.json({ success: false, error: claim.reason, reason: claim.reason }, claim.reason === 'taken' ? 409 : 400);
				}
				nextHandle = claim.handle;
				// A new claim (not a re-cased own handle) is freed again if the profile write fails
				if (!oldHandle || oldHandle.toLowerCase() !== claim.handle.toLowerCase()) claimed = claim.handle;
			}
		}

		const toggles: Partial<PublicProfilePrivacy> = {};
		for (const key of ['showSubscriptions', 'showPlaylists', 'showLikes'] as const) {
			if (typeof body[key] === 'boolean') toggles[key] = body[key];
		}

		let updated: ProfileType | null;
		try {
			updated = await repository.updateObject(userId, (fresh) => {
				if (nextHandle === null) delete fresh.handle;
				else if (nextHandle !== undefined) fresh.handle = nextHandle;
				if (Object.keys(toggles).length > 0) fresh.publicProfile = { ...(fresh.publicProfile || {}), ...toggles };
				fresh.dateModified = new Date().toISOString();
			});
		} catch (error) {
			if (claimed) await releaseUserHandle(bucket, claimed, userId);
			throw error;
		}
		if (!updated) {
			if (claimed) await releaseUserHandle(bucket, claimed, userId);
			return c.json({ success: false, error: "Profile not found" }, 404);
		}

		// The old handle is free once the profile no longer uses it
		if (oldHandle && (!updated.handle || updated.handle.toLowerCase() !== oldHandle.toLowerCase())) {
			await releaseUserHandle(bucket, oldHandle, userId).catch((error) => {
				logger.warn('[PublicProfile] Could not free the old handle', { userId, error: error instanceof Error ? error.message : String(error) });
			});
		}

		logger.info('[PublicProfile] Settings updated', { userId, handleChanged: nextHandle !== undefined, toggles: Object.keys(toggles) });
		return { success: true, result: { profile: transformProfileToView(updated, nameLocale(c)) } };
	}
}

export class UserHandleAvailability extends AuthenticatedRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Whether you can take this @handle for your profile",
		request: { query: z.object({ handle: Str({ description: "Handle to check (with or without @)" }) }) },
		responses: {
			"200": {
				description: "Availability",
				content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ available: z.boolean(), handle: Str(), reason: Str().optional() }) }) } },
			},
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const result = await checkUserHandleAvailability(c.env.channel_tabs, query.handle, this.getUserId(c));
		return { success: true, result };
	}
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

/** The profile behind a handle, or null when there is no public profile (unknown, removed, banned). */
export async function loadPublicUser(env: AppContext['env'], rawHandle: string): Promise<{ userId: string; profile: ProfileType; privacy: PublicProfilePrivacy } | null> {
	const handle = normalizeHandleInput(rawHandle);
	const userId = await resolveUserHandle(env.channel_tabs, handle);
	if (!userId) return null;
	const profile = await new R2Repository<ProfileType>(env.profiles).getObject(userId);
	// The index may outlive a change: the profile must still use this handle
	if (!profile || !profile.handle || profile.handle.toLowerCase() !== handle.toLowerCase()) return null;
	// Removed by an admin (restorable for 30 days)
	if ((profile as { adminDeletion?: unknown }).adminDeletion) return null;
	const db = (env as { SEARCH_DB?: SearchDb }).SEARCH_DB;
	if (db && (await cachedBan(db, userId).catch(() => null))) return null;
	return { userId, profile, privacy: resolvePublicProfilePrivacy(profile.publicProfile) };
}

/** Public channels only: never private, deleted, moderation-hidden or suspended ones. */
function isPublicChannel(channel: ChannelType | null | undefined): channel is ChannelType {
	return !!channel && isChannelVisibleTo(channel, null) && (channel as { isSuspended?: boolean }).isSuspended !== true;
}

async function readChannels(bucket: R2Bucket, ids: string[]): Promise<ChannelType[]> {
	const repo = new R2Repository<ChannelType>(bucket);
	const loaded = await Promise.all(ids.map((id) => repo.getObject(id).catch(() => null)));
	return loaded.filter(isPublicChannel);
}

function cacheKey(c: AppContext, path: string): string | null {
	// Signed-in requests skip the cache (their tokens differ; the answer does not)
	return c.req.header('Authorization') ? null : edgeCacheUrl(c.req.url, `public-profile/${path}`);
}

export class UserByHandleFetch extends OptionalAuthRoute {
	schema = {
		tags: ["Profiles"],
		summary: "A user's public profile by @handle",
		request: { params: HandleParam, query: z.object({ lang: nameLangField }) },
		responses: {
			"200": { description: "The public profile", content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ profile: PublicUserProfileView }) }) } } },
			...NotFoundResponse,
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const found = await loadPublicUser(c.env, params.handle);
		if (!found) return notFound(c);
		const { userId, profile, privacy } = found;
		const locale = nameLocale(c);
		const channels = await readChannels(c.env.channels, [...new Set(profile.channels || [])]);
		// Main channel first, then oldest first
		channels.sort((a, b) => Number(b.isMain === true) - Number(a.isMain === true) || String(a.dateCreated).localeCompare(String(b.dateCreated)));
		const name = resolveDisplayName(profile, locale);
		const view: z.infer<typeof PublicUserProfileView> = {
			id: userId,
			handle: profile.handle as string,
			displayName: name || undefined,
			resolvedDisplayName: name,
			...(profile.displayNameLocalized ? { displayNameLocalized: profile.displayNameLocalized } : {}),
			...(profile.bio ? { bio: profile.bio } : {}),
			...(profile.bioLocalized ? { bioLocalized: profile.bioLocalized } : {}),
			...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
			...(profile.coverUrl ? { coverUrl: profile.coverUrl } : {}),
			dateCreated: profile.dateCreated,
			channels: channels.map((ch) => ({
				id: ch.id,
				name: ch.name,
				...(ch.nameLocalized ? { nameLocalized: ch.nameLocalized } : {}),
				...(ch.handle ? { handle: ch.handle } : {}),
				...(ch.avatarUrl ? { avatarUrl: ch.avatarUrl } : {}),
				...((ch as { isVerified?: boolean }).isVerified ? { isVerified: true } : {}),
			})),
			sections: { subscriptions: privacy.showSubscriptions, playlists: privacy.showPlaylists, likes: privacy.showLikes },
		};
		return { success: true, result: { profile: view } };
	}
}

export class UserSubscriptionsPublicList extends OptionalAuthRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Public channels a user subscribes to (when they show them)",
		request: {
			params: HandleParam,
			query: z.object({
				page: z.coerce.number().int().min(1).max(1000).optional().default(1),
				pageSize: z.coerce.number().int().min(1).max(SUBSCRIPTIONS_PAGE_MAX).optional().default(24),
			}),
		},
		responses: { "200": { description: "{ items, page, hasMore }" }, ...NotFoundResponse },
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const key = cacheKey(c, `subs/${normalizeHandleInput(params.handle).toLowerCase()}/${query.page}/${query.pageSize}`);
		if (key) {
			const hit = await readEdgeCache<unknown>(key);
			if (hit) return hit;
		}
		const found = await loadPublicUser(c.env, params.handle);
		if (!found || !found.privacy.showSubscriptions) return notFound(c);
		const ids = await subscribedChannelIds(c.env.NOTIFICATIONS_DB, found.userId, found.profile.subscribedTo);
		const start = (query.page - 1) * query.pageSize;
		const channels = await readChannels(c.env.channels, ids.slice(start, start + query.pageSize));
		const response = {
			success: true,
			result: { items: await toPublicChannels(c.env.NOTIFICATIONS_DB, channels, c.env as never), page: query.page, hasMore: start + query.pageSize < ids.length },
		};
		if (key) writeEdgeCache(key, response, PUBLIC_CACHE_SECONDS, waitUntilOf(c as never));
		return response;
	}
}

export class UserPlaylistsPublicList extends OptionalAuthRoute {
	schema = {
		tags: ["Profiles"],
		summary: "A user's public playlists (when they show them)",
		request: { params: HandleParam },
		responses: { "200": { description: "{ items } newest first, up to 100" }, ...NotFoundResponse },
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const key = cacheKey(c, `playlists/${normalizeHandleInput(params.handle).toLowerCase()}`);
		if (key) {
			const hit = await readEdgeCache<unknown>(key);
			if (hit) return hit;
		}
		const found = await loadPublicUser(c.env, params.handle);
		if (!found || !found.privacy.showPlaylists) return notFound(c);
		const { userId } = found;
		// Public (listed) personal playlists only: never private, unlisted or Watch later
		const listed = (playlist: PlaylistType | null): playlist is PlaylistType =>
			!!playlist && playlist.userId === userId && isPersonalPlaylist(playlist)
			&& canViewPlaylist(playlist, null) && !isSystemPlaylist(playlist);
		const { playlists } = await collectPersonalPlaylists(c.env as never, userId, listed as never);
		playlists.sort((a, b) => (b.dateModified || '').localeCompare(a.dateModified || ''));
		const items = await withPlaylistCovers(c.env, playlists.slice(0, PLAYLISTS_MAX).map(toPlaylistResponse), null);
		const response = { success: true, result: { items } };
		if (key) writeEdgeCache(key, response, PUBLIC_CACHE_SECONDS, waitUntilOf(c as never));
		return response;
	}
}

export class UserLikesPublicList extends OptionalAuthRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Public videos a user liked (when they show them)",
		request: {
			params: HandleParam,
			query: z.object({
				limit: z.coerce.number().int().min(1).max(50).optional().default(24),
				cursor: Str({ description: "nextCursor from the previous page" }).optional(),
			}),
		},
		responses: { "200": { description: "{ items, nextCursor } newest like first" }, ...NotFoundResponse },
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const key = cacheKey(c, `likes/${normalizeHandleInput(params.handle).toLowerCase()}/${query.limit}/${encodeURIComponent(query.cursor || '')}`);
		if (key) {
			const hit = await readEdgeCache<unknown>(key);
			if (hit) return hit;
		}
		const found = await loadPublicUser(c.env, params.handle);
		if (!found || !found.privacy.showLikes) return notFound(c);
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return c.json({ success: true, result: { items: [], nextCursor: null } });
		const page = await listLikedIds(db, found.userId, { limit: query.limit, cursor: query.cursor });
		const repo = new R2Repository<VideoType>(c.env.videos);
		const videos = await Promise.all(page.items.map((item) => repo.getObject(item.videoId).catch(() => null)));
		// Publicly visible videos only (the visitor view, also for the owner)
		const visible = videos.filter((video): video is VideoType => !!video && canViewVideo(video, null));
		const response = { success: true, result: { items: await toLibraryVideoViews(c.env.channels, visible), nextCursor: page.nextCursor } };
		if (key) writeEdgeCache(key, response, PUBLIC_CACHE_SECONDS, waitUntilOf(c as never));
		return response;
	}
}
