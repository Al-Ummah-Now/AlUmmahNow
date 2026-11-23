import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { logger } from '@/lib/logger-server';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { getCurrentUserId } from '@/lib/channel-utils';
import { decodeHandleSegment, loadChannelByHandle } from '@/lib/channel-loaders';
import { ChannelPageShell } from '@/components/Channel/ChannelPageShell';
import { buildChannelJsonLd, buildChannelMetadata } from '@/lib/channel-metadata';
import { JsonLd } from '@/components/seo/JsonLd';
import { notFoundMetadata } from '@/lib/seo/not-found-metadata';

interface HandleLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
    handle: string;
  }>;
}

export async function generateMetadata({ params }: Pick<HandleLayoutProps, 'params'>): Promise<Metadata> {
  const { locale, handle } = await params;
  const channel = isLocaleSupported(locale) ? await loadChannelByHandle(decodeHandleSegment(handle)) : null;
  // The layout answers 404 (or the Worker 410): the error page's title and robots
  if (!channel) return notFoundMetadata();
  return buildChannelMetadata(channel, locale);
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
      <JsonLd data={await buildChannelJsonLd(channel, locale)} />
      {children}
    </ChannelPageShell>
  );
}
