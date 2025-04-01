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
    channelThumbnailUr: string;
    dateCreated: string;
    dateModified: string;
    views?: number;
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
}