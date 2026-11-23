import type { Metadata } from 'next';
import { logger } from '@/lib/logger-client';
import { loadChannelById } from '@/lib/channel-loaders';
import { notFound } from 'next/navigation';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { getCurrentUserId } from '@/lib/channel-utils';
import { ChannelPageShell } from '@/components/Channel/ChannelPageShell';
import { buildChannelJsonLd, buildChannelMetadata } from '@/lib/channel-metadata';
import { JsonLd } from '@/components/seo/JsonLd';
import { notFoundMetadata } from '@/lib/seo/not-found-metadata';

interface ChannelLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/** Canonical link points at /{locale}/@{handle} when the channel has a handle. */
export async function generateMetadata({ params }: Pick<ChannelLayoutProps, 'params'>): Promise<Metadata> {
  const { locale, id } = await params;
  const channel = isLocaleSupported(locale) ? await loadChannelById(id) : null;
  // The layout answers 404 (or the Worker 410): the error page's title and robots
  if (!channel) return notFoundMetadata();
  return buildChannelMetadata(channel, locale);
}

/**
 * Channel Layout for /[locale]/channels/[id] (id URLs keep working; the
 * canonical URL is the @handle one, see generateMetadata).
 */
export default async function ChannelLayout({
  children,
  params,
}: ChannelLayoutProps) {
  const { locale, id } = await params;

  // Validate locale
  if (!isLocaleSupported(locale)) {
    logger.debug(`[ChannelLayout] Unsupported locale: ${locale}`);
    notFound();
  }

  const [channel, userId] = await Promise.all([loadChannelById(id), getCurrentUserId()]);

  if (!channel) {
    notFound();
  }

  return (
    <ChannelPageShell channel={channel} locale={locale} isOwner={!!userId && channel.userId === userId}>
      <JsonLd data={await buildChannelJsonLd(channel, locale)} />
      {children}
    </ChannelPageShell>
  );
}
