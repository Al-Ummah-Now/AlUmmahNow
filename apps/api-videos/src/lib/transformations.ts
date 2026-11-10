// Transformation utilities for converting business models to view models
// This reduces code duplication across endpoints

import { z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, Profile as BusinessProfile, Playlist as BusinessPlaylist, Comment as BusinessComment } from "./types";
import { VideoView, ChannelView, ProfileView, PlaylistView, CommentView } from "./model/view";
import { getCommentSettings, isCommentVisible, StoredComment } from './comments';

// Transform a business video to a view model
export function transformVideoToView(
    video: z.infer<typeof BusinessVideo>,
    channel?: z.infer<typeof BusinessChannel> | null
): z.infer<typeof VideoView> {
    // Held-for-review, hidden and deleted comments are never exposed with the video
    const publicComments = (video.comments || []).filter((comment) => isCommentVisible(comment as unknown as StoredComment));
    // Processing internals stay server-side: the check loop's state and Bunny's
    // raw failure text. Clients get only the issue kind (watch page, studio).
    const { processingCheck: _check, processingIssue, ...rest } = video;
    return {
        ...rest,
        ...(processingIssue ? { processingIssueKind: processingIssue.kind } : {}),
        comments: publicComments,
        commentSettings: getCommentSettings(video),
        channelName: channel?.name || "",
        channelAvatarUrl: channel?.avatarUrl,
        channelCoverUrl: channel?.coverUrl,
        // Set only by admins (admin-api channel verification); not in the business schema
        channelIsVerified: (channel as { isVerified?: boolean } | null | undefined)?.isVerified === true,
        likesCount: video.likes?.length || 0,
        dislikesCount: video.dislikes?.length || 0,
        commentsCount: publicComments.length,
    };
}

// Transform a business channel to a view model
export function transformChannelToView(channel: z.infer<typeof BusinessChannel>): z.infer<typeof ChannelView> {
    // Admin bookkeeping stays out of every view (who suspended it, the holds)
    const { suspension, suspensionHolds: _holds, hiddenBeforeSuspension: _before, ...rest } = channel as typeof channel & {
        suspension?: { at?: string; reason?: string; by?: string };
        suspensionHolds?: unknown;
        hiddenBeforeSuspension?: unknown;
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
export function transformProfileToView(profile: z.infer<typeof BusinessProfile>): z.infer<typeof ProfileView> {
   
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
        thumbnailUrl: playlist.thumbnailUrl,
        userId: playlist.userId,
        channelId: playlist.channelId,
        channelName: channel?.name || "",
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
        likesCount: comment.likes?.length || 0,
        dislikesCount: comment.dislikes?.length || 0,
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
    return (profiles || []).map(transformProfileToView);
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

import {
    ChannelSection,
    ChannelSectionView,
    ChannelSectionCreateInput,
    ChannelSectionUpdateInput,
    AUTO_POPULATED_TYPES,
    CONTENT_REQUIRED_TYPES
} from '@al-ummah/shared-types';

/**
 * Transform business channel section to view model
 */
export function transformChannelSectionToView(section: ChannelSection): ChannelSectionView {
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
        },
        dateCreated: section.dateCreated,
        dateModified: section.dateModified,
    };
}

/**
 * Transform multiple channel sections to view models
 */
export function transformChannelSectionsToView(sections: ChannelSection[]): ChannelSectionView[] {
    return sections.map(transformChannelSectionToView);
}

/**
 * Validate section content based on type
 */
export function validateSectionContent(
    type: string,
    input: ChannelSectionCreateInput | ChannelSectionUpdateInput
): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields for specific types
    if (CONTENT_REQUIRED_TYPES[type]) {
        const requiredFields = CONTENT_REQUIRED_TYPES[type];

        if (requiredFields.includes('videoIds')) {
            if (!input.videoIds || input.videoIds.length === 0) {
                errors.push(`${type} type requires at least one video ID`);
            }
        }

        if (requiredFields.includes('playlistId')) {
            if (!input.playlistId) {
                errors.push(`${type} type requires playlistId`);
            }
        }

        if (requiredFields.includes('playlistIds')) {
            if (!input.playlistIds || input.playlistIds.length === 0) {
                errors.push(`${type} type requires at least one playlist ID`);
            }
        }
    }

    // Auto-populated types shouldn't have content
    if (AUTO_POPULATED_TYPES.includes(type as any)) {
        if (input.videoIds && input.videoIds.length > 0) {
            errors.push(`${type} sections are auto-populated, remove videoIds`);
        }
        if (input.playlistId) {
            errors.push(`${type} sections are auto-populated, remove playlistId`);
        }
        if (input.playlistIds && input.playlistIds.length > 0) {
            errors.push(`${type} sections are auto-populated, remove playlistIds`);
        }
        if (input.channelIds && input.channelIds.length > 0) {
            errors.push(`${type} sections are auto-populated, remove channelIds`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}