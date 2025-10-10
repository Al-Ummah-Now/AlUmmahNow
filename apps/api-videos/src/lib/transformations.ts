// Transformation utilities for converting business models to view models
// This reduces code duplication across endpoints

import { z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, Profile as BusinessProfile, Playlist as BusinessPlaylist, Comment as BusinessComment } from "./types";
import { VideoView, ChannelView, ProfileView, PlaylistView, CommentView } from "./model/view";

// Transform a business video to a view model
export function transformVideoToView(video: z.infer<typeof BusinessVideo>): z.infer<typeof VideoView> {
    return {
        ...video,
        channelName: "", // TODO: Resolve from channel data
        channelAvatarUrl: undefined, // TODO: Resolve from channel data
        likesCount: video.likes?.length || 0,
        dislikesCount: video.dislikes?.length || 0,
        commentsCount: video.comments?.length || 0,
    };
}

// Transform a business channel to a view model
export function transformChannelToView(channel: z.infer<typeof BusinessChannel>): z.infer<typeof ChannelView> {
    return {
        ...channel,
        playlistsCount: channel.playlists?.length || 0,
        videosCount: channel.videos?.length || 0,
        subscribersCount: channel.subscribers?.length || 0,
        subscriptionsCount: channel.subscriptions?.length || 0,
        likesCount: channel.likes?.length || 0,
    };
}

// Transform a business profile to a view model
export function transformProfileToView(profile: z.infer<typeof BusinessProfile>): z.infer<typeof ProfileView> {
    // Compute display name
    const displayName = profile.userName || 
                       (profile.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : null) ||
                       profile.firstName ||
                       profile.lastName ||
                       undefined;

    return {
        id: profile.id,
        email: profile.email,
        userName: profile.userName,
        firstName: profile.firstName,
        lastName: profile.lastName,
        displayName,
        avatarUrl: profile.avatarUrl,
        coverUrl: profile.coverUrl,
        dateCreated: profile.dateCreated,
        dateModified: profile.dateModified,
        channelsCount: profile.channels?.length || 0,
        // For detailed views, channels array can be populated separately
        channels: undefined,
    };
}

// Transform a business playlist to a view model
export function transformPlaylistToView(playlist: z.infer<typeof BusinessPlaylist>): z.infer<typeof PlaylistView> {
    return {
        id: playlist.id,
        title: playlist.title,
        description: playlist.description,
        thumbnailUrl: playlist.thumbnailUrl,
        userId: playlist.userId,
        channelId: playlist.channelId,
        channelName: "", // TODO: Resolve from channel data
        dateCreated: playlist.dateCreated,
        dateModified: playlist.dateModified,
        videosCount: playlist.videos?.length || 0,
        isPublic: playlist.isPublic,
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
    return (videos || []).map(transformVideoToView);
}

export function transformChannelsToView(channels: z.infer<typeof BusinessChannel>[]): z.infer<typeof ChannelView>[] {
    return (channels || []).map(transformChannelToView);
}

export function transformProfilesToView(profiles: z.infer<typeof BusinessProfile>[]): z.infer<typeof ProfileView>[] {
    return (profiles || []).map(transformProfileToView);
}

export function transformPlaylistsToView(playlists: z.infer<typeof BusinessPlaylist>[]): z.infer<typeof PlaylistView>[] {
    return (playlists || []).map(transformPlaylistToView);
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