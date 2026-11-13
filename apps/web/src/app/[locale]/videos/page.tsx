/**
 * /{locale}/videos - All videos browse page
 *
 * Server component: localized metadata only; data fetching and pagination
 * happen in the client component.
 */

import { Metadata } from 'next';
import { listPageMetadata } from '@/lib/seo/structured-data';
import { getTranslations } from '@/lib/i18n/utils/getTranslations';
import { VideosPageClient } from './VideosPageClient';

interface VideosPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: VideosPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslations(locale === 'ar' ? 'ar' : 'en');
  // Each language its own canonical, x-default English (D-SEO-1; wiki AUN-SEO)
  return listPageMetadata(locale, '/videos', t.discovery.allVideos, t.discovery.allVideosDescription);
}

export default function VideosPage() {
  return <VideosPageClient />;
}
