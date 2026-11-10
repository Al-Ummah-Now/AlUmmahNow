import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { logger } from '@/lib/logger-server';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { getCurrentUserId } from '@/lib/channel-utils';
import { decodeHandleSegment, loadChannelByHandle } from '@/lib/channel-loaders';
import { ChannelPageShell } from '@/components/Channel/ChannelPageShell';
import { buildChannelMetadata } from '@/lib/channel-metadata';

interface HandleLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
    handle: string;
  }>;
}

export async function generateMetadata({ params }: Pick<HandleLayoutProps, 'params'>): Promise<Metadata> {
  const { locale, handle } = await params;
  return buildChannelMetadata(await loadChannelByHandle(decodeHandleSegment(handle)), locale);
}

/**
 * Channel page by @handle: /[locale]/@{handle} (middleware rewrite) and
 * /[locale]/c/{handle}. Handles resolve case-insensitively.
 */
export default async function ChannelHandleLayout({ children, params }: HandleLayoutProps) {
  const { locale, handle } = await params;

  if (!isLocaleSupported(locale)) {
    notFound();
  }

  const [channel, userId] = await Promise.all([loadChannelByHandle(decodeHandleSegment(handle)), getCurrentUserId()]);
  if (!channel) {
    logger.debug('[ChannelHandleLayout] Unknown handle', { handle });
    notFound();
  }

  return (
    <ChannelPageShell channel={channel} locale={locale} isOwner={!!userId && channel.userId === userId}>
      {children}
    </ChannelPageShell>
  );
}
