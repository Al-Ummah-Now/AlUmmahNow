import { permanentRedirect } from 'next/navigation';
import { WatchSkeletonSlot } from '@/components/video/WatchSkeletonSlot';
import { loadPublicVideo } from '@/lib/embed/content';
import { isValidContentId } from '@/lib/embed/params';

/**
 * The watch page itself is in the /[locale]/video layout (components/video/WatchShell.tsx), so it
 * stays mounted from one video to the next. This page gives it the server's placeholder (title and
 * poster when known), shown until the first video's details load.
 *
 * A Short's page is /shorts/{id} (owner decision D-SEO-10): its /video/{id} answers 308 there, the
 * start time kept, except inside a playlist (?list=), which plays on here.
 */
export default async function VideoViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id, locale }, query] = await Promise.all([params, searchParams]);
  if (isValidContentId(id) && !query.list) {
    const video = await loadPublicVideo(id);
    if (video?.isShort) {
      const t = typeof query.t === 'string' && /^\d{1,6}$/.test(query.t) ? `?t=${query.t}` : '';
      permanentRedirect(`/${locale}/shorts/${encodeURIComponent(id)}${t}`);
    }
  }
  return <WatchSkeletonSlot id={id} locale={locale} />;
}
