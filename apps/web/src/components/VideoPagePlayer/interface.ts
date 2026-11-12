

export interface PlayerOptions {
  id: string;
  title: string;
  /** Per-language titles (e.g. { en, ar }); the watch page shows the UI language's one */
  titleLocalized?: Record<string, string>;
  channel: string;
  channelName: string;
  channelAvatar: string;
  /** Channel has the scholar/institution badge (Epic 6.1) */
  channelVerified?: boolean;
  channelCover?: string;
  description: string;
  views: string;
  url: string;
  playUrl?: string; // HLS streaming URL from Bunny.net
  /** R2 + Cloudflare CDN beside Bunny (epic #687): which source this play gets (lib/video/delivery.ts) */
  delivery?: import('@/lib/video/delivery').DeliveryView;
  poster?: string; // Video thumbnail/poster image URL
  autoplay: boolean;
  type: string;
  width?: number;
  height?: number;
  duration?: number;
  /** Uploader's choice of Short or video; absent = detected */
  format?: 'short' | 'video';
  /** Short by the shared rule (shared-types video-format.ts) */
  isShort?: boolean;
  availableResolutions?: string[];
  dateCreated: Date;
  likesCount?: number;
  commentsCount?: number;
  userId?: string; // Owner of the video (may delete any comment)
  channelId?: string | null;
  /** Who liked it (used to restore the viewer's like) */
  likes?: VideoReaction[];
  /** Anything but "ready" (or unset, for older videos) shows the processing state instead of the player */
  uploadStatus?: 'initiated' | 'uploading' | 'processing' | 'ready' | 'failed';
  processingIssueKind?: 'encode_failed' | 'needs_reupload' | 'stalled';
}

/** True while the video cannot play yet (still uploading or processing at Bunny). */
export function isVideoProcessing(video: Pick<PlayerOptions, 'uploadStatus'>): boolean {
  return video.uploadStatus === 'initiated' || video.uploadStatus === 'uploading' || video.uploadStatus === 'processing';
}

export interface VideoReaction {
  userId?: string;
  channelId?: string;
}
