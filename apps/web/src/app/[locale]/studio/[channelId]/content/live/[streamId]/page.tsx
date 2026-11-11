import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { GoLive } from '@/components/studio/live/GoLive';
import { requireStudioPage } from '@/lib/studio/server';

export default async function StudioGoLivePage({ params }: { params: Promise<{ locale: string; channelId: string; streamId: string }> }) {
  const { locale, channelId, streamId } = await params;
  const access = await requireStudioPage(channelId, ['content', 'live', streamId]);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  return <GoLive locale={locale} channelId={channelId} streamId={streamId} />;
}
