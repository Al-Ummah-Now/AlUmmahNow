/**
 * The title an admin list shows for a video: the creator's title in the admin's language, else
 * the stored title, else null (the page shows "Untitled video"). Never the id: an older
 * api-videos filled an empty title with the id, so a title equal to the id counts as none.
 */
export function adminVideoTitle(video: { id: string; title?: string | null; titleLocalized?: Record<string, string> | null }, locale: string): string | null {
  const own = video.titleLocalized?.[locale]?.trim();
  if (own) return own;
  const stored = video.title?.trim();
  if (stored && stored !== video.id) return stored;
  for (const text of Object.values(video.titleLocalized ?? {})) if (text?.trim()) return text.trim();
  return null;
}
