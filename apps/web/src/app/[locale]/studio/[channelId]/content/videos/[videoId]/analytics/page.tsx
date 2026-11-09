import { notFound } from 'next/navigation';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { StudioVideoAnalyticsPage as View } from '@/components/studio/analytics/StudioVideoAnalyticsPage';
import { getVideoById } from '@/lib/api/videos';
import { requireStudioPage } from '@/lib/studio/server';

interface Props {
  params: Promise<{ locale: string; channelId: string; videoId: string }>;
}

export default async function StudioVideoAnalyticsRoute({ params }: Props) {
  const { locale, channelId, videoId } = await params;
  const access = await requireStudioPage(channelId, ['content', 'videos', videoId, 'analytics']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const video = await getVideoById(decodeURIComponent(videoId));
  if (!video || video.channelId !== channelId) notFound();
  return <View locale={locale} channelId={channelId} video={{ id: video.id, title: video.title, duration: video.duration, dateCreated: video.dateCreated }} />;
}
