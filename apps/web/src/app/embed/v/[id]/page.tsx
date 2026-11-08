import type { Metadata } from 'next';
import EmbedPlayer from '@/components/embed/EmbedPlayer';
import UnavailableFrame from '@/components/embed/UnavailableFrame';
import { loadPublicVideo, localizedTitle } from '@/lib/embed/content';
import { isValidContentId, parseEmbedParams } from '@/lib/embed/params';
import { embedStrings } from '@/lib/embed/strings';

interface EmbedVideoPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Embed frames are not search results; the watch page is the canonical page. */
export async function generateMetadata({ params, searchParams }: EmbedVideoPageProps): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { lang } = parseEmbedParams(query);
  const video = isValidContentId(id) ? await loadPublicVideo(id) : null;
  return {
    title: video ? `${localizedTitle(video, lang)} - ${embedStrings(lang).brand}` : embedStrings(lang).brand,
    robots: { index: false, follow: false },
  };
}

/** /embed/v/{videoId}: one public video (docs/embeds/README.md §2). */
export default async function EmbedVideoPage({ params, searchParams }: EmbedVideoPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const embedParams = parseEmbedParams(query);
  const video = isValidContentId(id) ? await loadPublicVideo(id) : null;
  if (!video) {
    return <UnavailableFrame lang={embedParams.lang} origin={embedParams.origin} contentId={id} />;
  }
  return <EmbedPlayer videos={[video]} params={embedParams} />;
}
