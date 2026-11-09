import { loadPublicVideo } from '@/lib/embed/content';
import { isValidContentId } from '@/lib/embed/params';
import type { WatchHint } from '@/components/video/WatchPageSkeleton';

const HINT_BUDGET_MS = 700;

/**
 * Title, channel and poster for the first paint of a public video. Anonymous,
 * so private videos get none, and bounded so a slow API can't delay the page.
 */
export async function loadWatchHint(id: string | undefined, locale: string): Promise<WatchHint | undefined> {
  if (!id || !isValidContentId(id)) return undefined;
  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), HINT_BUDGET_MS));
  const load = loadPublicVideo(id).then((video): WatchHint | undefined => video ? {
    title: video.titleLocalized?.[locale] || video.title,
    channelName: video.channelName,
    poster: video.poster,
  } : undefined).catch(() => undefined);
  return Promise.race([load, timeout]);
}
