/** Links from Studio to pages outside it. */

/** The upload page with this channel chosen (its channel picker reads ?channel=). */
export function studioUploadHref(locale: string, channelId: string): string {
  return `/${locale}/upload?channel=${encodeURIComponent(channelId)}`;
}

/** Re-upload into a failed video, on its channel (lib/dashboard/reupload.ts). */
export function studioReuploadHref(locale: string, channelId: string, video: { id: string; title?: string }): string {
  const params = new URLSearchParams({ resume: video.id });
  if (video.title) params.set('title', video.title);
  params.set('channel', channelId);
  return `/${locale}/upload?${params.toString()}`;
}
