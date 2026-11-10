import {
    CollectionModel,
    VideoModel,
    CaptionModel,
    ChapterModel,
    MomentModel,
    MetaTagModel,
    TranscodingMessageModel,
} from './types';

export class BunnyStreamClient {
    private baseURL: string;
    private namePrefix = '';

    constructor(private accessKey: string, baseURL: string = 'https://video.bunnycdn.com/') {
        this.baseURL = baseURL;
    }

    /**
     * Applies the env's BUNNY_NAME_PREFIX (stage sets "[stage] ") to the titles of
     * videos and the names of collections this client creates or renames, so an env
     * that shares another env's Bunny library (stage shares QA's) can be told apart
     * and cleaned up. No prefix in QA and production.
     */
    forEnv(env: unknown): this {
        const prefix = (env as { BUNNY_NAME_PREFIX?: string } | undefined)?.BUNNY_NAME_PREFIX;
        this.namePrefix = typeof prefix === 'string' ? prefix : '';
        return this;
    }

    /** `name` with this env's prefix (once). */
    prefixed(name: string): string;
    prefixed(name: string | undefined): string | undefined;
    prefixed(name: string | undefined): string | undefined {
        if (name === undefined || !this.namePrefix || name.startsWith(this.namePrefix)) return name;
        return `${this.namePrefix}${name}`;
    }

    private async request<T>(method: string, endpoint: string, body?: any, params?: Record<string, any>): Promise<T> {
        const url = new URL(endpoint, this.baseURL);

        // Add query parameters if provided
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined) {
                    url.searchParams.append(key, String(value));
                }
            });
        }

        const response = await fetch(url.toString(), {
            method,
            headers: {
                'AccessKey': this.accessKey,
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return response.json();
    }

    // Get a collection
    async getCollection(libraryId: number, collectionId: string, includeThumbnails: boolean = false): Promise<CollectionModel> {
        return this.request<CollectionModel>('GET', `/library/${libraryId}/collections/${collectionId}`, undefined, { includeThumbnails });
    }

    // Update a collection
    async updateCollection(libraryId: number, collectionId: string, data: { name?: string }): Promise<CollectionModel> {
        return this.request<CollectionModel>('POST', `/library/${libraryId}/collections/${collectionId}`, { ...data, name: this.prefixed(data.name) });
    }

    // Delete a collection
    async deleteCollection(libraryId: number, collectionId: string): Promise<void> {
        return this.request<void>('DELETE', `/library/${libraryId}/collections/${collectionId}`);
    }

    // List collections
    async listCollections(
        libraryId: number,
        params: { page?: number; itemsPerPage?: number; search?: string; orderBy?: string; includeThumbnails?: boolean } = {}
    ): Promise<CollectionModel[]> {
        return this.request<CollectionModel[]>('GET', `/library/${libraryId}/collections`, undefined, params);
    }

    // Create a collection
    async createCollection(libraryId: number, data: { name?: string }): Promise<CollectionModel> {
        return this.request<CollectionModel>('POST', `/library/${libraryId}/collections`, { ...data, name: this.prefixed(data.name) });
    }

    // Get a video
    async getVideo(libraryId: number, videoId: string): Promise<VideoModel> {
        return this.request<VideoModel>('GET', `/library/${libraryId}/videos/${videoId}`);
    }

    // Update a video
    async updateVideo(libraryId: number, videoId: string, data: { title?: string; collectionId?: string }): Promise<VideoModel> {
        return this.request<VideoModel>('POST', `/library/${libraryId}/videos/${videoId}`, { ...data, title: this.prefixed(data.title) });
    }

    /** Encode the video again from its original upload (admin "reprocess"). */
    async reencodeVideo(libraryId: number, videoId: string): Promise<VideoModel> {
        return this.request<VideoModel>('POST', `/library/${libraryId}/videos/${videoId}/reencode`);
    }

    // Delete a video
    async deleteVideo(libraryId: number, videoId: string): Promise<void> {
        return this.request<void>('DELETE', `/library/${libraryId}/videos/${videoId}`);
    }

    // List videos
    async listVideos(
        libraryId: number,
        params: { page?: number; itemsPerPage?: number; search?: string; collection?: string; orderBy?: string } = {}
    ): Promise<VideoModel[]> {
        return this.request<VideoModel[]>('GET', `/library/${libraryId}/videos`, undefined, params);
    }

    // Create a video
    async createVideo(libraryId: number, data: { title: string; collectionId?: string; thumbnailTime?: number }): Promise<VideoModel> {
        return this.request<VideoModel>('POST', `/library/${libraryId}/videos`, { ...data, title: this.prefixed(data.title) });
    }

    // Analytics methods
    
    // Get video statistics
    async getVideoStatistics(libraryId: number, videoId: string, dateFrom?: string, dateTo?: string, hourly: boolean = false): Promise<any> {
        const params: Record<string, any> = {};
        if (dateFrom) params.dateFrom = dateFrom;
        if (dateTo) params.dateTo = dateTo;
        if (hourly) params.hourly = 'true';
        
        return this.request<any>('GET', `/library/${libraryId}/videos/${videoId}/statistics`, undefined, params);
    }

    // Get library statistics
    async getLibraryStatistics(libraryId: number, dateFrom?: string, dateTo?: string, hourly: boolean = false): Promise<any> {
        const params: Record<string, any> = {};
        if (dateFrom) params.dateFrom = dateFrom;
        if (dateTo) params.dateTo = dateTo;
        if (hourly) params.hourly = 'true';
        
        return this.request<any>('GET', `/library/${libraryId}/statistics`, undefined, params);
    }

    // Get country statistics
    async getCountryStatistics(libraryId: number, dateFrom?: string, dateTo?: string): Promise<any> {
        const params: Record<string, any> = {};
        if (dateFrom) params.dateFrom = dateFrom;
        if (dateTo) params.dateTo = dateTo;
        
        return this.request<any>('GET', `/library/${libraryId}/statistics/countries`, undefined, params);
    }

    // Get referrer statistics
    async getReferrerStatistics(libraryId: number, dateFrom?: string, dateTo?: string): Promise<any> {
        const params: Record<string, any> = {};
        if (dateFrom) params.dateFrom = dateFrom;
        if (dateTo) params.dateTo = dateTo;
        
        return this.request<any>('GET', `/library/${libraryId}/statistics/referrers`, undefined, params);
    }

    // Upload a video
    async uploadVideo(libraryId: number, videoId: string, file: Blob, enabledResolutions?: string): Promise<VideoModel> {
        const url = new URL(`/library/${libraryId}/videos/${videoId}`, this.baseURL);
        if (enabledResolutions) {
            url.searchParams.append('enabledResolutions', enabledResolutions);
        }

        const response = await fetch(url.toString(), {
            method: 'PUT',
            headers: {
                'AccessKey': this.accessKey,
                'Content-Type': 'application/octet-stream',
            },
            body: file,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return response.json();
    }
}