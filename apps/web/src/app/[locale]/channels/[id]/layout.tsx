import type { Metadata } from 'next';
import { logger } from '@/lib/logger-client';
import { loadChannelById } from '@/lib/channel-loaders';
import { notFound } from 'next/navigation';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { getCurrentUserId } from '@/lib/channel-utils';
import { ChannelPageShell } from '@/components/Channel/ChannelPageShell';
import { buildChannelMetadata } from '@/lib/channel-metadata';

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
  return buildChannelMetadata(await loadChannelById(id), locale);
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
      {children}
    </ChannelPageShell>
  );
}
