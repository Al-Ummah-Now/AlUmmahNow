import { PlayerOptions } from "@/components/videoPlayer/interface";
import { PaginationResponse, VideoInfo, VideoObject } from "@/interfaces";
import { VideosAPI } from "@/lib/api";

export async function fetchVideoById(vid: string): Promise<PlayerOptions | undefined> {
    if (!vid) return undefined;

    try {
        console.log('[fetchVideoById] Fetching video:', vid);
        const video = await VideosAPI.getById(vid);
        console.log('[fetchVideoById] API response:', video);

        if (!video) {
            throw new Error('Video not found');
        }

        const playerOptions = {
            id: video.id,
            title: video.title,
            description: video.description || '',
            channel: video.channel,
            url: video.videoUrl,
            poster: video.thumbnailUrl, // Video thumbnail from API
            views: '0', // API doesn't return views field yet
            dateCreated: new Date(video.dateCreated),
            autoplay: false,
            type: "video/mp4",
            width: video.width,
            height: video.height,
            availableResolutions: video.availableResolutions,
            channelAvatar: video.channelThumbnailUrl, // Fixed: API returns channelThumbnailUrl
        };

        console.log('[fetchVideoById] Mapped to PlayerOptions:', playerOptions);
        return playerOptions;
    } catch (error) {
        console.error('[fetchVideoById] Error:', error);
        return undefined;
    }
};


export async function fetchVideos(cursor: string | null = null): Promise<VideoInfo[] | undefined> {
    try {
        const result = await VideosAPI.list({
            limit: 15,
            cursor: cursor || undefined
        });

        if (!result) {
            throw new Error('Failed to fetch videos');
        }

        return result.data.map((video) => ({
            id: video.id,
            title: video.title,
            description: video.description,
            channel: video.channel,
            channelId: video.channelId,
            channelName: video.channelName,
            thumbnail: video.thumbnailUrl,
            video: video.videoUrl,
            views: `${video.views || 0}`,
            width: video.width,
            height: video.height,
            availableResolutions: video.availableResolutions,
            dateCreated: new Date(video.dateCreated),
            dateModified: new Date(video.dateModified),
            likesCount: video.likesCount,
            dislikesCount: video.dislikesCount,
            commentsCount: video.commentsCount,
        }));

    } catch (error) {
        console.error(error);
        return undefined;
    }
};

export async function fetchVideosWithPagination(cursor: string | null = null): Promise<PaginationResponse<VideoObject> | null> {
    try {
        const result = await VideosAPI.list({ 
            limit: 15, 
            cursor: cursor || undefined 
        });
        return result;
    } catch (error) {
        console.error(error);
        return null;
    }
};