import type { VideoObject } from '@/interfaces';

/** The upload failed for good (flagged needs_reupload, or an older failed upload) */
export function needsReupload(video: VideoObject): boolean {
  return video.processingIssue?.kind === 'needs_reupload' || video.uploadStatus === 'failed';
}

/** Upload page in re-upload mode for this video (same video, details kept) */
export function reuploadHref(lang: string, video: Pick<VideoObject, 'id' | 'title'>): string {
  const params = new URLSearchParams({ resume: video.id });
  if (video.title) params.set('title', video.title);
  return `/${lang}/upload?${params.toString()}`;
}
