/**
 * /{locale}/channels - Channel directory
 *
 * Server component: localized metadata only; data fetching and pagination
 * happen in the client component.
 */

import { Metadata } from 'next';
import { getTranslations } from '@/lib/i18n/utils/getTranslations';
import { ChannelsPageClient } from './ChannelsPageClient';

interface ChannelsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ChannelsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslations(locale === 'ar' ? 'ar' : 'en');
  const title = `${t.discovery.allChannels} | ${t.common.appName}`;

  return {
    title,
    description: t.discovery.allChannelsDescription,
    openGraph: {
      title,
      description: t.discovery.allChannelsDescription,
      type: 'website',
    },
    alternates: {
      languages: { en: '/en/channels', ar: '/ar/channels' },
    },
  };
}

export default function ChannelsPage() {
  return <ChannelsPageClient />;
}
