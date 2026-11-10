/**
 * The video id in a pasted link or id: `/video?vid=ID`, `?v=ID`,
 * `/video/ID`, `/shorts/ID`, or a bare id. Null when nothing id-like is found.
 */
export function extractVideoId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const idPattern = /^[A-Za-z0-9_-]{4,64}$/;
  if (idPattern.test(text)) return text;
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get('vid') || url.searchParams.get('v');
    if (fromQuery && idPattern.test(fromQuery)) return fromQuery;
    const parts = url.pathname.split('/').filter(Boolean);
    const marker = parts.findIndex((part) => part === 'video' || part === 'shorts' || part === 'watch');
    const candidate = marker >= 0 ? parts[marker + 1] : undefined;
    return candidate && idPattern.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/** Whether visitors can see a video, so a section may show it */
export function isPublicVideo(video: { isPublic?: boolean | null; uploadStatus?: string | null; isDeleted?: boolean; isHidden?: boolean }): boolean {
  if (video.isDeleted || video.isHidden) return false;
  if (video.isPublic === false) return false;
  return !video.uploadStatus || video.uploadStatus === 'ready';
}
