import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { LiveTab } from '@/components/studio/live/LiveTab';
import { requireStudioPage } from '@/lib/studio/server';

export default async function StudioLivePage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['content', 'live']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  return <LiveTab locale={locale} channelId={channelId} role={access.role} />;
}
