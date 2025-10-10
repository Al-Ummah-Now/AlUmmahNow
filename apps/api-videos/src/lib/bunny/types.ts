export interface CollectionModel {
    videoLibraryId: number;
    guid?: string;
    name?: string;
    videoCount: number;
    totalSize: number;
    previewVideoIds?: string;
    previewImageUrls?: string[];
}

export interface VideoModel {
    videoLibraryId: number;
    guid?: string;
    title?: string;
    dateUploaded?: string; // ISO 8601 format
    views: number;
    isPublic: boolean;
    length: number;
    status: number; // Enum: 0 = Created, 1 = Uploaded, etc.
    framerate: number;
    rotation?: number;
    width: number;
    height: number;
    availableResolutions?: string;
    thumbnailCount: number;
    encodeProgress: number;
    storageSize: number;
    captions?: CaptionModel[];
    hasMP4Fallback: boolean;
    collectionId?: string;
    thumbnailFileName?: string;
    averageWatchTime: number;
    totalWatchTime: number;
    category?: string;
    chapters?: ChapterModel[];
    moments?: MomentModel[];
    metaTags?: MetaTagModel[];
    transcodingMessages?: TranscodingMessageModel[];
}

export interface CaptionModel {
    srclang?: string;
    label?: string;
}

export interface ChapterModel {
    title: string;
    start: number;
    end: number;
}

export interface MomentModel {
    label: string;
    timestamp: number;
}

export interface MetaTagModel {
    property?: string;
    value?: string;
}

export interface TranscodingMessageModel {
    timeStamp: string; // ISO 8601 format
    level: number; // Enum: 0 = Undefined, 1 = Information, etc.
    issueCode: number; // Enum: 0 = Undefined, 1 = StreamLengthsDifference, etc.
    message?: string;
    value?: string;
}