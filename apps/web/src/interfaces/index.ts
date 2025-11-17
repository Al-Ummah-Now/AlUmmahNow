export type PaginationResponse<T> = {
    cursor: string;
    limit: number;
    data: T[];
};

export interface VideoObject {
    id: string;
    title: string;
    description: string | null;
    thumbnailUrl: string;
    videoUrl: string;
    userId: string;
    channel: string;
    channelId: string | null;
    channelAvatarUrl: string; // Updated to match shared-types interface
    channelName: string;
    dateCreated: string;
    dateModified: string;
    views?: number;
    width?: number;
    height?: number;
    availableResolutions?: string[];
    likesCount: number;
    dislikesCount: number;
    commentsCount: number;
    isPublic?: boolean; // Added from API spec
    isLive?: boolean;   // Added from API spec
    comments?: Comments[]; // Optional array of Comments
    likes?: Likes[];       // Optional array of Likes
    dislikes?: Dislikes[]; // Optional array of Dislikes
};

export type ResponseError = {
    message: string;
    error?: unknown;
};

export interface VideoInfo {
    id: string;
    title: string;
    description: string | null;
    channel: string;
    channelId: string | null;
    channelName: string;
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
}

export interface Profile {
    id: string;
    email: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    coverUrl?: string;
    channelsCount?: number;
    dateCreated?: string;
    dateModified?: string;
    playlists?: string[];
    channels?: string[];
    subscriptions?: string[];
}

export interface User {
    id: string;
    email: string;
    role?: 'user' | 'moderator' | 'admin'; // Add role field for moderation access
}

export interface AuthSubject {
    properties: User
}

export interface Playlist {
    id: string;
    title: string;
    description?: string;
    thumbnailUrl?: string;
    userId: string; // Made required to match API spec
    channelId: string; // Made required to match API spec
    channelName?: string; // Added from API spec
    dateCreated: string;
    dateModified: string;
    videos?: string[];
    videosCount?: number; // Added from API spec
    isPublic?: boolean;
}

export interface Channel {
    id: string;
    userId: string;
    email: string;
    name: string;
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
    dislikesCount: number;   // Changed from dislikes array to count
    repliesCount: number;    // Changed from replies array to count
    isEdited: boolean;       // Made required to match API spec
    isDeleted: boolean;      // Made required to match API spec
    isPinned: boolean;       // Made required to match API spec
}

export interface Likes {
    id: string;
    userId: string;
    videoId: string;
    dateCreated?: string;
}

export interface Dislikes {
    id: string;
    userId: string;
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

