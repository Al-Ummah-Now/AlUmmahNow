import { permanentRedirect } from 'next/navigation';
import { loadPublicVideo } from '@/lib/embed/content';
import { isValidContentId } from '@/lib/embed/params';
import WatchLayout, { generateMetadata as watchMetadata } from '../../video/[id]/layout';

interface ShortsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}

/** The same metadata as the watch page; for a Short its canonical is this /shorts/{id} page. */
export const generateMetadata = watchMetadata;

/**
 * A Short's own page (owner decision D-SEO-10): the watch page in the vertical Shorts viewer, with the
 * same status codes (404 / 410 / 503) and structured data. A video that is not a Short goes to its
 * /video/{id} page (308).
 */
export default async function ShortsLayout({ children, params }: ShortsLayoutProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  if (isValidContentId(id)) {
    const video = await loadPublicVideo(id);
    if (video && !video.isShort) permanentRedirect(`/${locale}/video/${encodeURIComponent(id)}`);
  }
  return <WatchLayout params={params}>{children}</WatchLayout>;
}
