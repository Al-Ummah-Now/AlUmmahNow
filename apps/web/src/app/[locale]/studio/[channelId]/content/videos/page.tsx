import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { VideosTab } from '@/components/studio/videos/VideosTab';
import { requireStudioPage } from '@/lib/studio/server';

export default async function StudioVideosPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['content', 'videos']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  return <VideosTab locale={locale} channelId={channelId} role={access.role} />;
}
