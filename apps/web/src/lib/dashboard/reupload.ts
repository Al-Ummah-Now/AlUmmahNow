import type { VideoObject } from '@/interfaces';
import { isUploadIssueCode, type AppTranslations } from '@al-ummah/shared-types';

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

/** Whether its creator may send the file again: a file that arrived changed is imported again by the team. */
export function canReupload(video: Pick<VideoObject, 'processingIssue'>): boolean {
  return video.processingIssue?.code !== 'source_changed';
}

/** Why the video failed, in the page's language (the stored reason is English, for the logs). */
export function uploadIssueText(video: Pick<VideoObject, 'processingIssue'>, text: AppTranslations['upload']['issue']): string | null {
  const issue = video.processingIssue;
  if (!issue || issue.kind === 'stalled') return null;
  // A code or kind this build does not know (an older page): the kind's words, else none
  return (isUploadIssueCode(issue.code) ? text[issue.code] : undefined) ?? text[issue.kind] ?? null;
}
