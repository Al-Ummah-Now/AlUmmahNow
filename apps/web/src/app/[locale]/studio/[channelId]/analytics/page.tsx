import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { ChannelAnalytics } from '@/components/studio/analytics/ChannelAnalytics';
import { requireStudioPage } from '@/lib/studio/server';

export default async function StudioAnalyticsPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['analytics']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  return <ChannelAnalytics locale={locale} channelId={channelId} channelCreated={access.channel.dateCreated as string | undefined} />;
}
