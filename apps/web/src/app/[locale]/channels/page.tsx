/**
 * /{locale}/channels - Channel directory
 *
 * Server component: localized metadata only; data fetching and pagination
 * happen in the client component.
 */

import { Metadata } from 'next';
import { listPageMetadata } from '@/lib/seo/structured-data';
import { getTranslations } from '@/lib/i18n/utils/getTranslations';
import { ChannelsPageClient } from './ChannelsPageClient';

interface ChannelsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ChannelsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslations(locale === 'ar' ? 'ar' : 'en');
  // Each language its own canonical, x-default English (D-SEO-1; wiki AUN-SEO)
  return listPageMetadata(locale, '/channels', t.discovery.allChannels, t.discovery.allChannelsDescription);
}

export default function ChannelsPage() {
  return <ChannelsPageClient />;
}
