import { getLocalizedValue } from '@al-ummah/shared-types';
import { loadPublicVideo, type EmbedVideo } from '@/lib/embed/content';
import { isValidContentId } from '@/lib/embed/params';
import { channelLabel } from '@/lib/channel-name';
import { channelPath } from '@/lib/channel-url';
import type { WatchHint } from '@/components/video/WatchPageSkeleton';

const HINT_BUDGET_MS = 700;

/**
 * What the server renders for a public video before the player loads (wiki AUN-SEO, phase 4): title,
 * description, channel name and link, poster and its size, and whether there are chapters. Anonymous,
 * so private videos get none, and bounded so a slow API can't delay the page. The watch layout has
 * already read the same video (per-request cache), so this normally answers at once.
 */
export async function loadWatchHint(id: string | undefined, locale: string): Promise<WatchHint | undefined> {
  if (!id || !isValidContentId(id)) return undefined;
  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), HINT_BUDGET_MS));
  const load = loadPublicVideo(id).then((video: EmbedVideo | null): WatchHint | undefined => {
    if (!video) return undefined;
    const description = getLocalizedValue(video.descriptionLocalized, video.description ?? '', locale)?.trim();
    return {
      title: video.titleLocalized?.[locale] || video.title,
      channelName: channelLabel(video, locale),
      ...(video.channelId ? { channelHref: channelPath(locale, { id: video.channelId, handle: video.channelHandle }) } : {}),
      ...(description ? { description } : {}),
      poster: video.poster,
      ...(video.width && video.height ? { width: video.width, height: video.height } : {}),
      chapters: video.hasChapters === true,
    };
  }).catch(() => undefined);
  return Promise.race([load, timeout]);
}
