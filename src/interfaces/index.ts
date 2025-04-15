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
}

export interface User {
    id: string;
    email: string;
}

export interface AuthSubject {
    properties: User
  }