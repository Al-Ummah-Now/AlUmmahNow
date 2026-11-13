// Transformation utilities for converting business models to view models
// This reduces code duplication across endpoints

import { z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, Profile as BusinessProfile, Playlist as BusinessPlaylist, Comment as BusinessComment } from "./types";
import { VideoView, ChannelView, ProfileView, PlaylistView, CommentView } from "./model/view";
import { can, channelRoleOf, isShort, resolveDisplayName, type ChannelRoleSource } from "@al-ummah/shared-types";
import { isVideoReady } from './visibility';
import { getCommentSettings, isCommentVisible, StoredComment, withoutDislikes } from './comments';
import { PUBLIC_DISLIKES_COUNT } from './reactions';

/**
 * The stored video without server-only processing fields, as every video view
 * returns it: no check-loop state (processingCheck), no raw Bunny failure text
 * (processingIssue → processingIssueKind), and no auto thumbnail URL until the
 * video is ready and Bunny's image exists (it would 404: clients show their
 * placeholder). Used by the detail view and every list view.
 * Dislikes are hidden (owner decision 2026-11-11): a stored `dislikes` list
 * goes out empty (the field stays for older clients), and `dislikesCount`
 * is PUBLIC_DISLIKES_COUNT (0). Embedded comments lose their dislikes the
 * same way (comment dislikes hidden 2026-11-12).
 */
export function publicVideoFields<T extends Record<string, any>>(video: T): Omit<T, 'processingCheck' | 'processingIssue' | 'thumbnailPending'> & { processingIssueKind?: 'encode_failed' | 'needs_reupload' | 'stalled' } {
    const { processingCheck: _check, processingIssue, thumbnailPending, ...rest } = video as Record<string, any>;
    const hideThumbnail = (thumbnailPending || !isVideoReady(video)) && video.thumbnailType !== 'custom';
    return {
        ...rest,
        ...(Array.isArray(rest.dislikes) ? { dislikes: [] } : {}),
        ...(Array.isArray(rest.comments) ? { comments: (rest.comments as StoredComment[]).map(withoutDislikes) } : {}),
        ...(processingIssue ? { processingIssueKind: processingIssue.kind } : {}),
        ...(hideThumbnail ? { thumbnailUrl: undefined, thumbnailSizes: undefined } : {}),
    } as never;
}

/**
 * The processing issue with its reason (why an upload failed or stalled), for
 * the people who can act on it: the video's owner and channel members who may
 * upload (they re-upload it). Visitors only ever get processingIssueKind from
 * publicVideoFields(); the check-loop state stays server-side for everyone.
 * Spread after publicVideoFields() in list views.
 */
export function uploaderProcessingIssue(
    video: { userId?: string | null; processingIssue?: { kind?: string; reason?: string; at?: string } | null },
    channel: ChannelRoleSource | null | undefined,
    viewerId: string | null | undefined,
): { processingIssue?: { kind: 'encode_failed' | 'needs_reupload' | 'stalled'; reason?: string; at?: string } } {
    const issue = video.processingIssue;
    if (!issue?.kind || !viewerId) return {};
    const mayUpload = (!!video.userId && video.userId === viewerId) || can(channelRoleOf(channel, viewerId), 'video.upload');
    if (!mayUpload) return {};
    return {
        processingIssue: {
            kind: issue.kind as 'encode_failed' | 'needs_reupload' | 'stalled',
            ...(issue.reason ? { reason: issue.reason } : {}),
            ...(issue.at ? { at: issue.at } : {}),
        },
    };
}

// Transform a business video to a view model
export function transformVideoToView(
    video: z.infer<typeof BusinessVideo>,
    channel?: z.infer<typeof BusinessChannel> | null
): z.infer<typeof VideoView> {
    // Held-for-review, hidden and deleted comments are never exposed with the video
    // and comment dislikes are hidden (2026-11-12): they go out empty
    const publicComments = (video.comments || [])
        .filter((comment) => isCommentVisible(comment as unknown as StoredComment))
        .map((comment) => withoutDislikes(comment as unknown as StoredComment) as unknown as typeof comment);
    return {
        ...publicVideoFields(video),
        comments: publicComments,
        commentSettings: getCommentSettings(video),
        ...channelNameFields(channel),
        channelAvatarUrl: channel?.avatarUrl,
        channelCoverUrl: channel?.coverUrl,
        // Set only by admins (admin-api channel verification); not in the business schema
        channelIsVerified: (channel as { isVerified?: boolean } | null | undefined)?.isVerified === true,
        likesCount: video.likes?.length || 0,
        dislikesCount: PUBLIC_DISLIKES_COUNT,
        commentsCount: publicComments.length,
        isShort: isShort(video),
    };
}

// Transform a business channel to a view model
export function transformChannelToView(channel: z.infer<typeof BusinessChannel>): z.infer<typeof ChannelView> {
    // Admin bookkeeping stays out of every view (who suspended it, the holds),
    // and so does the channel team: it is read through GET /:id/members, which
    // checks members.view
    // Bunny collection ids are internal too (lib/channelCollection.ts)
    const { suspension, suspensionHolds: _holds, hiddenBeforeSuspension: _before, members: _members, bunnyCollectionId: _collection, bunnyCollections: _collections, ...rest } = channel as typeof channel & {
        suspension?: { at?: string; reason?: string; by?: string };
        suspensionHolds?: unknown;
        hiddenBeforeSuspension?: unknown;
        members?: unknown;
        bunnyCollectionId?: unknown;
        bunnyCollections?: unknown;
    };
    return {
        ...(rest as typeof channel),
        ...(suspension ? { suspension: { at: suspension.at, ...(suspension.reason ? { reason: suspension.reason } : {}) } } : {}),
        playlistsCount: channel.playlists?.length || 0,
        videosCount: channel.videos?.length || 0,
        subscribersCount: channel.subscribers?.length || 0,
        subscriptionsCount: channel.subscriptions?.length || 0,
        likesCount: channel.likes?.length || 0,
    };
}

// Transform a business profile to a view model
export function transformProfileToView(profile: z.infer<typeof BusinessProfile>, locale?: string): z.infer<typeof ProfileView> {
    return {
        id: profile.id,
        email: profile.email,
        userName: profile.userName,
        firstName: profile.firstName,
        firstNameLocalized: profile.firstNameLocalized,
        lastName: profile.lastName,
        lastNameLocalized: profile.lastNameLocalized,
        displayName: profile.displayName,
        displayNameLocalized: profile.displayNameLocalized,
        // What others see (the edit form keeps the raw displayName above)
        resolvedDisplayName: resolveDisplayName(profile, locale),
        bio: profile.bio,
        bioLocalized: profile.bioLocalized,
        avatarUrl: profile.avatarUrl,
        coverUrl: profile.coverUrl,
        timezone: profile.timezone,
        dateCreated: profile.dateCreated,
        dateModified: profile.dateModified,
        channelsCount: profile.channels?.length || 0,
        // For detailed views, channels array can be populated separately
        channels: undefined,
    };
}

// Transform a business playlist to a view model
export function transformPlaylistToView(
    playlist: z.infer<typeof BusinessPlaylist>,
    channel?: z.infer<typeof BusinessChannel> | null
): z.infer<typeof PlaylistView> {
    return {
        id: playlist.id,
        title: playlist.title,
        description: playlist.description,
        ...(playlist.titleLocalized ? { titleLocalized: playlist.titleLocalized } : {}),
        ...(playlist.descriptionLocalized ? { descriptionLocalized: playlist.descriptionLocalized } : {}),
        thumbnailUrl: playlist.thumbnailUrl,
        userId: playlist.userId,
        channelId: playlist.channelId,
        ...channelNameFields(channel),
        dateCreated: playlist.dateCreated,
        dateModified: playlist.dateModified,
        videosCount: playlist.videos?.length || 0,
        isPublic: playlist.isPublic,
        name: playlist.title,
        videos: playlist.videos || [],
    };
}

// Transform a business comment to a view model
export function transformCommentToView(comment: z.infer<typeof BusinessComment>): z.infer<typeof CommentView> {
    return {
        ...comment,
        ...(Array.isArray(comment.dislikes) ? { dislikes: [] } : {}),
        likesCount: comment.likes?.length || 0,
        dislikesCount: PUBLIC_DISLIKES_COUNT,
        repliesCount: comment.replies?.length || 0,
        // Transform nested replies if present
        replies: comment.replies ? comment.replies.map(transformCommentToView) : undefined,
    };
}

// Batch transformation functions for arrays
export function transformVideosToView(videos: z.infer<typeof BusinessVideo>[]): z.infer<typeof VideoView>[] {
    return (videos || []).map(video => transformVideoToView(video));
}

export function transformChannelsToView(channels: z.infer<typeof BusinessChannel>[]): z.infer<typeof ChannelView>[] {
    return (channels || []).map(transformChannelToView);
}

export function transformProfilesToView(profiles: z.infer<typeof BusinessProfile>[]): z.infer<typeof ProfileView>[] {
    return (profiles || []).map((profile) => transformProfileToView(profile));
}

export function transformPlaylistsToView(
    playlists: z.infer<typeof BusinessPlaylist>[],
    channelMap?: Map<string, z.infer<typeof BusinessChannel>>
): z.infer<typeof PlaylistView>[] {
    return (playlists || []).map(playlist => {
        const channel = playlist.channelId && channelMap ? channelMap.get(playlist.channelId) : undefined;
        return transformPlaylistToView(playlist, channel);
    });
}

export function transformCommentsToView(comments: z.infer<typeof BusinessComment>[]): z.infer<typeof CommentView>[] {
    return (comments || []).map(transformCommentToView);
}

// Utility function for generating new entity IDs
export function generateEntityId(): string {
    return crypto.randomUUID();
}

// Utility function for generating timestamps
export function getCurrentTimestamp(): string {
    return new Date().toISOString();
}

// Helper function to create default business entity fields
export function createEntityDefaults() {
    return {
        id: generateEntityId(),
        dateCreated: getCurrentTimestamp(),
        dateModified: getCurrentTimestamp(),
    };
}

// ============================================================================
// Channel Section Transformations
// ============================================================================

import { ChannelSection, ChannelSectionView } from '@al-ummah/shared-types';
import { hasValidSectionConsent } from './channelSectionAccess';
import { channelNameFields } from './channelName';

/**
 * Transform a channel section to its view model. `channel` (the section's
 * channel) decides whether a stored opt-in still counts (spec §6); without it
 * any stored opt-in is reported.
 */
export function transformChannelSectionToView(
    section: ChannelSection,
    channel?: { userId?: string | null } | null,
): ChannelSectionView {
    const isConsentType = section.type === 'subscribed_channels' || section.type === 'liked_videos';
    return {
        id: section.id,
        channelId: section.channelId,
        type: section.type,
        title: section.title,
        titleLocalized: section.titleLocalized,
        position: section.position,
        style: section.style,
        itemCount: section.itemCount,
        showTimestamp: section.showTimestamp,
        showChannelName: section.showChannelName,
        content: {
            videoIds: section.videoIds && section.videoIds.length > 0 ? section.videoIds : undefined,
            playlistId: section.playlistId,
            playlistIds: section.playlistIds && section.playlistIds.length > 0 ? section.playlistIds : undefined,
            channelIds: section.channelIds && section.channelIds.length > 0 ? section.channelIds : undefined,
            trailerVideoId: section.trailerVideoId,
            returningVideoId: section.returningVideoId,
        },
        ...(section.type === 'shorts' ? { sort: section.sort ?? 'latest' } : {}),
        ...(section.type === 'live_streams' ? { liveFilter: section.liveFilter ?? 'live_and_upcoming' } : {}),
        ...(section.type === 'community_posts' ? { postMode: section.postMode ?? 'latest' } : {}),
        ...(isConsentType ? { consented: channel ? hasValidSectionConsent(section, channel) : !!section.consent?.grantedBy } : {}),
        dateCreated: section.dateCreated,
        dateModified: section.dateModified,
    };
}

/**
 * Transform multiple channel sections to view models
 */
export function transformChannelSectionsToView(
    sections: ChannelSection[],
    channel?: { userId?: string | null } | null,
): ChannelSectionView[] {
    return sections.map((section) => transformChannelSectionToView(section, channel));
}
