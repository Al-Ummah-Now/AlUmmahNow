

export interface PlayerOptions {
  id: string;
  title: string;
  channel: string;
  channelAvatar: string;
  description: string;
  views: string;
  url: string;
  playUrl?: string; // HLS streaming URL from Bunny.net
  poster?: string; // Video thumbnail/poster image URL
  autoplay: boolean;
  type: string;
  width?: number;
  height?: number;
  availableResolutions?: string[];
  dateCreated: Date;
  likesCount?: number;
  dislikesCount?: number;
  commentsCount?: number;
}
