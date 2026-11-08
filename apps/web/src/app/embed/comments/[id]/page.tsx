import type { Metadata } from 'next';
import CommentsFrame from '@/components/embed/CommentsFrame';
import UnavailableFrame from '@/components/embed/UnavailableFrame';
import { loadPublicComments, loadPublicVideo, localizedTitle } from '@/lib/embed/content';
import { isValidContentId, parseEmbedParams } from '@/lib/embed/params';
import { embedStrings } from '@/lib/embed/strings';

interface EmbedCommentsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: EmbedCommentsPageProps): Promise<Metadata> {
  const { lang } = parseEmbedParams(await searchParams);
  return { title: `${embedStrings(lang).comments} - ${embedStrings(lang).brand}`, robots: { index: false, follow: false } };
}

/**
 * /embed/comments/{videoId}: the video's public thread, read-only (Epic 26 v1).
 * Comments are shown only when the video itself is public.
 */
export default async function EmbedCommentsPage({ params, searchParams }: EmbedCommentsPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const embedParams = parseEmbedParams(query);
  const video = isValidContentId(id) ? await loadPublicVideo(id) : null;
  if (!video) {
    return <UnavailableFrame lang={embedParams.lang} origin={embedParams.origin} contentId={id} />;
  }
  const initial = await loadPublicComments(id);
  return (
    <CommentsFrame
      videoId={id}
      videoTitle={localizedTitle(video, embedParams.lang)}
      lang={embedParams.lang}
      origin={embedParams.origin}
      initial={initial}
    />
  );
}
