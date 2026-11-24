/**
 * Which videos a viewer sees inside a playlist: publicly visible ones, and those they may see while
 * private or unfinished because of their role on the video's live channel (lib/channelAccess.ts
 * canOnVideo), whichever account the record names. Removed videos are shown to no one.
 */
import { canOnVideo, memoChannels, type ChannelAccessEnv } from './channelAccess';
import { isVideoPubliclyVisible, isVideoRemoved, type VisibilityFields } from './visibility';

type ViewedVideo = VisibilityFields & { channelId?: string | null; uploadedBy?: string | null };
export type VideoViewer = (video: ViewedVideo | null | undefined) => Promise<boolean>;

/** A check for one request: each channel is read once. */
export function videoViewer(env: ChannelAccessEnv, userId: string | null | undefined): VideoViewer {
	const channels = memoChannels(env);
	return async (video) => {
		if (!video || isVideoRemoved(video)) return false;
		if (isVideoPubliclyVisible(video)) return true;
		return !!userId && canOnVideo(channels, video as never, userId, 'video.view_private');
	};
}

/** The videos of `list` the viewer sees, in order. */
export async function visibleVideos<T>(list: readonly T[], videoOf: (item: T) => ViewedVideo | null | undefined, sees: VideoViewer): Promise<T[]> {
	const shown = await Promise.all(list.map((item) => sees(videoOf(item))));
	return list.filter((_, i) => shown[i]);
}
