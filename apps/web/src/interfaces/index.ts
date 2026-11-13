import type { VideoCategory } from '@al-ummah/shared-types';
export type PaginationResponse<T> = {
    cursor: string;
    limit: number;
    data: T[];
};

export interface VideoObject {
    id: string;
    title: string;
    titleLocalized?: Record<string, string>; // Multi-language titles
    description: string | null;
    descriptionLocalized?: Record<string, string>; // Multi-language descriptions
    thumbnailUrl: string;
    videoUrl: string;
    playUrl?: string; // HLS streaming URL (e.g., https://vz-xxx.b-cdn.net/{videoGuid}/playlist.m3u8)
    userId: string;
    channel: string;
    channelId: string | null;
    channelAvatarUrl: string; // Updated to match shared-types interface
    channelIsVerified?: boolean;
    channelCoverUrl?: string; // Channel cover/banner image
    channelName: string;
    /** The channel's name per language (lib/channel-name.ts) */
    channelNameLocalized?: Record<string, string>;
    dateCreated: string;
    /** When the video was first published (public and ready); the "Published" label shows it, else dateCreated */
    publishedAt?: string;
    dateModified: string;
    createdAt: string; // For compatibility with shared-types
    updatedAt?: string; // For compatibility with shared-types - made optional
    duration?: number; // Video duration in seconds
    views?: number;
    width?: number;
    height?: number;
    /** Uploader's choice of Short or video; absent = detected */
    format?: 'short' | 'video';
    /** Short by the shared rule (API-computed) */
    isShort?: boolean;
    availableResolutions?: string[];
    likesCount: number;
    dislikesCount: number;
    commentsCount: number;
    isPublic?: boolean; // Added from API spec
  /** Not public but open to anyone with the link (D-SEO-5) */
  isUnlisted?: boolean;
    isLive?: boolean;   // Added from API spec
    tags?: string[];
    category?: VideoCategory;
    /** Who set the category: the owner, the AI (a suggestion nobody confirmed yet) or an admin */
    categorySource?: 'uploader' | 'ai' | 'admin';
    thumbnailType?: 'auto' | 'custom';
    /** Width-only variants of a custom thumbnail (aspect kept) */
    thumbnailSizes?: { hd?: string; sd?: string; mobile?: string; thumb?: string };
    /** Featured by an editor */
    isFeatured?: boolean;
    /** Saved but not published */
    isDraft?: boolean;
    uploadStatus?: 'initiated' | 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted';
    /** Set when the video needs the owner's action (e.g. the upload must be redone). */
    processingIssue?: { kind: 'encode_failed' | 'needs_reupload' | 'stalled'; reason?: string; at?: string };
    comments?: Comments[]; // Optional array of Comments
    likes?: Likes[];       // Optional array of Likes
    dislikes?: Dislikes[]; // Optional array of Dislikes
    // Scheduling fields
    scheduledPublishDate?: string;        // ISO 8601 datetime in UTC
    scheduledPublishTimezone?: string;    // IANA timezone (e.g., 'America/New_York')
    scheduledPublishStatus?: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
    scheduledBy?: string;                 // User ID who scheduled
    scheduledAt?: string;                 // When it was scheduled
    publishedViaSchedule?: boolean;       // True if published via scheduler
};

export type ResponseError = {
    message: string;
    error?: unknown;
};

export interface VideoInfo {
    id: string;
    titleLocalized?: Record<string, string>;
    duration?: number;
    title: string;
    description: string | null;
    channel: string;
    channelId: string | null;
    channelName: string;
    /** The channel's name per language (lib/channel-name.ts) */
    channelNameLocalized?: Record<string, string>;
    thumbnail: string;
    video: string;
    views: string;
    dateCreated: Date;
    dateModified: Date;
    width?: number;
    height?: number;
    availableResolutions?: string[];
    likesCount: number;
    dislikesCount: number;
    commentsCount: number;
    /** Short by the shared rule (API flag), for "Up next" format matching */
    isShort?: boolean;
    /** The API's pick: the next video of the playing video's numbered series (plays next) */
    seriesNext?: boolean;
}

export interface Profile {
    id: string;
    email: string;
    displayName?: string;
    displayNameLocalized?: Record<string, string>; // Multi-language display names
    firstName?: string;
    firstNameLocalized?: Record<string, string>; // Multi-language first names
    lastName?: string;
    lastNameLocalized?: Record<string, string>; // Multi-language last names
    /** The name others see (api-videos resolveDisplayName); show it with userDisplayName() */
    resolvedDisplayName?: string;
    avatarUrl?: string;
    coverUrl?: string;
    bio?: string;
    bioLocalized?: Record<string, string>; // Multi-language bios
    timezone?: string; // IANA timezone (e.g., 'America/New_York', 'Asia/Dubai')
    channelsCount?: number;
    dateCreated?: string;
    dateModified?: string;
    playlists?: string[];
    channels?: string[];
    subscriptions?: string[];
}

// Re-export auth types from shared-types
export type { AuthUser, AuthSubject } from '@al-ummah/shared-types';

// Extended User interface for web app (includes channel context)
export interface User {
    id: string;
    email: string;
    roles?: string[]; // User roles from auth token (e.g., ['user'], ['admin', 'moderator'])
    channel?: Partial<Channel> | null; // Optional channel reference (Partial for ChannelInfo compatibility)
    channelName?: string; // Channel display name
    /** The channel's name per language (lib/channel-name.ts) */
    channelNameLocalized?: Record<string, string>;
    name?: string; // User display name
}

export interface Playlist {
    id: string;
    title: string;
    name: string; // Required for compatibility with shared-types
    description?: string;
    /** Name and description per language ('en', 'ar'); a missing language shows title/description */
    titleLocalized?: Record<string, string>;
    descriptionLocalized?: Record<string, string>;
    thumbnailUrl?: string;
    cover?: { videoId: string; thumbnailUrl: string }; // Derived by the API when thumbnailUrl is not set
    userId: string; // Made required to match API spec
    channelId: string; // Made required to match API spec
    channelName?: string; // Added from API spec
    /** The channel's name per language (lib/channel-name.ts) */
    channelNameLocalized?: Record<string, string>;
    dateCreated: string;
    dateModified: string;
    createdAt: string; // Required for compatibility with shared-types (from Timestamps)
    updatedAt?: string; // Optional for compatibility with shared-types (from Timestamps)
    videos?: string[];
    videosCount?: number; // Added from API spec
    isPublic?: boolean;
}

export interface Channel {
    id: string;
    userId: string;
    email: string;
    name: string;
    nameLocalized?: Record<string, string>; // Multi-language names
    description?: string;
    descriptionLocalized?: Record<string, string>; // Multi-language descriptions
    isMain: boolean; // Added from API spec
    avatarUrl?: string;
    coverUrl?: string;
    dateCreated: string; // Made required to match API spec
    dateModified: string; // Made required to match API spec
    playlistsCount: number; // Added from API spec
    videosCount: number; // Added from API spec
    subscribersCount: number; // Added from API spec
    subscriptionsCount: number; // Added from API spec
    likesCount: number; // Added from API spec
    playlists?: string[];
    videos?: string[];
}

export interface Comments {
    id: string;
    userId: string;
    channelId: string; // Added from API spec
    videoId: string;
    text: string;
    dateCreated: string;     // Made required to match API spec
    dateModified: string;    // Made required to match API spec
    likesCount: number;      // Changed from likes array to count
    dislikesCount: number;   // Always 0: comment dislikes are hidden (2026-11-12)
    repliesCount: number;    // Changed from replies array to count
    isEdited: boolean;       // Made required to match API spec
    isDeleted: boolean;      // Made required to match API spec
    isPinned: boolean;       // Made required to match API spec
    isLiked?: boolean;       // Viewer channel liked this comment (GET /api/videos/:id/comments)
    isDisliked?: boolean;    // Always false: comment dislikes are hidden (2026-11-12)
    author?: CommentAuthor;  // Resolved author (channel name/avatar, falling back to profile)
    isHeld?: boolean;        // Awaiting the video owner's review (visible to author + owner only)
    parentCommentId?: string | null; // Set on replies (one level deep)
}

export interface CommentAuthor {
    userId: string;
    channelId: string;
    displayName: string;
    avatarUrl?: string;
}

export interface Likes {
    id: string;
    userId: string;
    /** Channel the reaction was made as */
    channelId?: string;
    videoId: string;
    dateCreated?: string;
}

export interface Dislikes {
    id: string;
    userId: string;
    /** Channel the reaction was made as */
    channelId?: string;
    videoId: string;
    dateCreated?: string;
}

// Live Stream Types
export interface LiveStream {
    id: string;
    title: string;
    description?: string;
    userId: string;
    channelId: string;
    channelName?: string;
    /** The channel's name per language (lib/channel-name.ts) */
    channelNameLocalized?: Record<string, string>;
    channelAvatarUrl?: string;
    dateCreated: string;
    dateModified: string;
    scheduledStartTime?: string;
    actualStartTime?: string;
    actualEndTime?: string;
    status: 'scheduled' | 'live' | 'ended' | 'cancelled';
    streamUrl?: string;
    rtmpUrl?: string;
    streamKey?: string;
    thumbnailUrl?: string;
    currentViewers: number;
    peakViewers: number;
    views: number;
    likesCount: number;
    dislikesCount: number;
    commentsCount: number;
    isPrivate: boolean;
    allowChat: boolean;
    tags?: string[];
    category?: string;
    language?: 'en' | 'ar';
    duration?: number;
}

// Re-export WebSocket types
export * from './websocket';

