export type PaginationResponse<T> = {
    cursor: string;
    limit: number;
    total: number;
    data: T[];
};

export interface VideoObject {
    id: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    videoUrl: string;
    userId: string;
    channel: string;
    channelId: string;
    channelThumbnailUrl: string;
    dateCreated: string;
    dateModified: string;
    views?: number;
    width?: number;
    height?: number;
    availableResolutions?: string[];
    comments?: Comments[]; // Optional array of Comments
    likes?: Likes[];       // Optional array of Likes
    dislikes?: Dislikes[]; // Optional array of Dislikes
};

export type ResponseError = {
    message: string;
    error?: any;
};

export interface VideoInfo {
    id: string;
    title: string;
    description: string;
    channel: string;
    channelId: string;
    thumbnail: string;
    video: string;
    views: string;
    dateCreated: Date;
    dateModified: Date;
    width?: number;
    height?: number;
    availableResolutions?: string[];
}

export interface Profile {
    id: string;
    email: string;
    userName?: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    coverUrl?: string;
    dateCreated?: string;
    dateModified?: string;
    playlists?: string[];
    channels?: string[];
    subscriptions?: string[];
}

export interface User {
    id: string;
    email: string;
}

export interface AuthSubject {
    properties: User
}

export interface Playlist {
    id: string;
    title: string;
    description?: string;
    thumbnailUrl?: string;
    userId?: string;
    channelId?: string;
    dateCreated: string;
    dateModified: string;
    videos?: string[];
    isPublic?: boolean;
}

export interface Channel {
    id: string;
    userId: string;
    email: string;
    name: string;
    avatarUrl?: string;
    coverUrl?: string;
    dateCreated?: string;
    dateModified?: string;
    playlists?: string[];
    videos?: string[];
}

export interface Comments {
    id: string;
    userId: string;
    videoId: string;
    text: string;
    dateCreated?: string;
    dateModified?: string;
    replies?: string[];
    likes?: string[];
    dislikes?: string[];
    isEdited?: boolean;
    isDeleted?: boolean;
    isPinned?: boolean;
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

