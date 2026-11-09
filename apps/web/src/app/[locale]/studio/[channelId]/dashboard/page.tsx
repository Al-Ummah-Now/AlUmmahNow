import { StudioDashboard } from '@/components/studio/dashboard/StudioDashboard';
import { requireStudioPage } from '@/lib/studio/server';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';

export default async function StudioDashboardPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['dashboard']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  return <StudioDashboard locale={locale} channelId={channelId} role={access.role} />;
}
