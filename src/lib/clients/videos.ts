import { PlayerOptions } from "@/components/videoPlayer/interface";
import { PaginationResponse, VideoInfo, VideoObject } from "@/interfaces";

const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "https://videos.api.alummahnow.net";

export async function fetchVideoById(vid: string): Promise<PlayerOptions> {
    if (!vid) return;

    try {
        const response = await fetch(
            `${baseUrl}/api/videos/${vid}`
        );
        if (!response.ok) {
            throw new Error(`Error fetching video: ${response.statusText}`);
        }
        const video: VideoObject = await response.json();
        return {
            id: video.id,
            title: video.title,
            description: video.description,
            channel: video.channel,
            url: video.videoUrl,
            views: `${video.views || 0}`,
            dateCreated: new Date(video.dateCreated),
            autoplay: false,
            type: "video/mp4",
            width: video.width,
            height: video.height,
            availableResolutions: video.availableResolutions,
            channelAvatar: video.channelAvatarUrl, // Updated field name
        };
    } catch (error) {
        console.error(error);
    }
};


export async function fetchVideos(cursor: string | null = null): Promise<VideoInfo[]> {
    try {
        const cursorString = cursor ? `&cursor=${cursor}` : "";
        const response = await fetch(
            `${baseUrl}/api/videos?limit=15${cursorString}`
        );
        if (!response.ok) {
            throw new Error(`Error fetching related videos: ${response.statusText}`);
        }
        const result: PaginationResponse<VideoObject> = await response.json();
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
    }
};

export async function fetchVideosWithPagination(cursor: string | null = null): Promise<PaginationResponse<VideoObject> | null> {
    try {
        const cursorString = cursor ? `&cursor=${cursor}` : "";
        const response = await fetch(
            `${baseUrl}/api/videos?limit=15${cursorString}`
        );
        if (!response.ok) {
            throw new Error(`Error fetching videos: ${response.statusText}`);
        }
        const result: PaginationResponse<VideoObject> = await response.json();
        return result;
    } catch (error) {
        console.error(error);
        return null;
    }
};