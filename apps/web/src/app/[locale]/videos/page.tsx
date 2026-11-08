/**
 * /{locale}/videos - All videos browse page
 *
 * Server component: localized metadata only; data fetching and pagination
 * happen in the client component.
 */

import { Metadata } from 'next';
import { getTranslations } from '@/lib/i18n/utils/getTranslations';
import { VideosPageClient } from './VideosPageClient';

interface VideosPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: VideosPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslations(locale === 'ar' ? 'ar' : 'en');
  const title = `${t.discovery.allVideos} | ${t.common.appName}`;

  return {
    title,
    description: t.discovery.allVideosDescription,
    openGraph: {
      title,
      description: t.discovery.allVideosDescription,
      type: 'website',
    },
    alternates: {
      languages: { en: '/en/videos', ar: '/ar/videos' },
    },
  };
}

export default function VideosPage() {
  return <VideosPageClient />;
}
