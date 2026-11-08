

export interface PlayerOptions {
  id: string;
  title: string;
  /** Per-language titles (e.g. { en, ar }); the watch page shows the UI language's one */
  titleLocalized?: Record<string, string>;
  channel: string;
  channelName: string;
  channelAvatar: string;
  channelCover?: string;
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
  userId?: string; // Owner of the video (may delete any comment)
  channelId?: string | null;
  /** Who reacted (used to restore the viewer's like/dislike state) */
  likes?: VideoReaction[];
  dislikes?: VideoReaction[];
}

export interface VideoReaction {
  userId?: string;
  channelId?: string;
}
