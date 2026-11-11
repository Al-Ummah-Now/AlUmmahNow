/**
 * The one status a video has in Studio's Videos tab (docs/specs/CREATOR-STUDIO.md §4.4.1).
 * No imports: release scripts load this file with plain Node.
 */

export type StudioVideoStatus = 'published' | 'scheduled' | 'drafts' | 'processing' | 'failed';

export const STUDIO_VIDEO_STATUSES: readonly StudioVideoStatus[] = ['published', 'scheduled', 'drafts', 'processing', 'failed'];

/** The one status a video has in Studio. The first match wins. */
export function studioVideoStatus(video: {
  uploadStatus?: unknown;
  processingStatus?: unknown;
  scheduledPublishStatus?: unknown;
  isDraft?: unknown;
}): StudioVideoStatus {
  const { uploadStatus, processingStatus, scheduledPublishStatus, isDraft } = video;
  if (uploadStatus === 'failed' || processingStatus === 'failed' || scheduledPublishStatus === 'failed') return 'failed';
  if (uploadStatus === 'initiated' || uploadStatus === 'uploading' || uploadStatus === 'processing') return 'processing';
  if (processingStatus === 'pending' || processingStatus === 'processing' || processingStatus === 'transcoding') return 'processing';
  if (scheduledPublishStatus === 'scheduled' || scheduledPublishStatus === 'publishing') return 'scheduled';
  return isDraft === true ? 'drafts' : 'published';
}

/** What a Retry on a failed video should do. Null when the video hasn't failed. */
export function studioFailureKind(video: { uploadStatus?: unknown; processingStatus?: unknown; scheduledPublishStatus?: unknown }): 'upload' | 'publish' | null {
  if (video.uploadStatus === 'failed' || video.processingStatus === 'failed') return 'upload';
  return video.scheduledPublishStatus === 'failed' ? 'publish' : null;
}
