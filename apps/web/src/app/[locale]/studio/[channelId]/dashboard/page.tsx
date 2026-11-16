import { redirect } from 'next/navigation';
import { StudioDashboard } from '@/components/studio/dashboard/StudioDashboard';
import { getStudioAccess, getStudioFeatures, requireStudioPage } from '@/lib/studio/server';
import { studioHomePath } from '@/lib/studio/nav';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';

export default async function StudioDashboardPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  // Every Studio link opens Dashboard; a role with none of its sections opens its first section
  const studio = await getStudioAccess(channelId);
  if (studio.status === 'ok') {
    const home = studioHomePath(studio.role, await getStudioFeatures(channelId, studio.role));
    if (home !== 'dashboard') redirect(`/${locale}/studio/${encodeURIComponent(channelId)}/${home}`);
  }
  const access = await requireStudioPage(channelId, ['dashboard']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  return (
    <StudioDashboard
      locale={locale}
      channelId={channelId}
      role={access.role}
      liveOn={access.features.live === true}
      uploadOn={access.features.upload === true}
    />
  );
}
