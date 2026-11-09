import { notFound } from 'next/navigation';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { StudioVideoEditor } from '@/components/studio/editor/StudioVideoEditor';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { getVideoById } from '@/lib/api/videos';
import { can } from '@/lib/studio/permissions';
import { requireStudioPage } from '@/lib/studio/server';

interface Props {
  params: Promise<{ locale: string; channelId: string; videoId: string }>;
}

export default async function StudioVideoEditPage({ params }: Props) {
  const { locale, channelId, videoId } = await params;
  const access = await requireStudioPage(channelId, ['content', 'videos', videoId, 'edit']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;

  const [video, auth] = await Promise.all([getVideoById(decodeURIComponent(videoId)), getServerAuthContext()]);
  // A video of another channel is the same as no video here
  if (!video || video.channelId !== channelId || !auth?.userId) notFound();

  return (
    <StudioVideoEditor
      locale={locale}
      channelId={channelId}
      userId={auth.userId}
      video={video}
      canViewAnalytics={can(access.role, 'analytics.view')}
    />
  );
}
