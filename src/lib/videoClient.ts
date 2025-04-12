import { PlayerOptions } from "@/components/videoPlayer/interface";
import { PaginationResponse, VideoInfo, VideoObject } from "@/interfaces";

export async function fetchVideoById(vid: string): Promise<PlayerOptions> {
    if (!vid) return;

    try {
        const response = await fetch(
            `https://videos.api.alummahnow.net/api/videos/${vid}`
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
            channelAvatar: video.channelThumbnailUrl,
        };
    } catch (error) {
        console.error(error);
    }
};


export async function fetchVideos(cursor: string | null = null): Promise<VideoInfo[]> {
    try {
        const cursorString = cursor ? `&cursor=${cursor}` : "";
        const response = await fetch(
            `https://videos.api.alummahnow.net/api/videos?limit=15${cursorString}`
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
            thumbnail: video.thumbnailUrl,
            video: video.videoUrl,
            views: `${video.views || 0}`,
            width: video.width,
            height: video.height,
            availableResolutions: video.availableResolutions,
            dateCreated: new Date(video.dateCreated),
            dateModified: new Date(video.dateModified),
        }));

    } catch (error) {
        console.error(error);
    }
};