'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { studioVideoTitle } from '@/lib/studio/videos';
import { VideoAnalytics } from './VideoAnalytics';

interface Props {
  locale: string;
  channelId: string;
  video: { id: string; title: string; titleLocalized?: Partial<Record<string, string>> | null; duration?: number; dateCreated?: string };
}

export function StudioVideoAnalyticsPage({ locale, channelId, video }: Props) {
  const { t } = useLanguage();
  return (
    <VideoAnalytics
      locale={locale}
      channelId={channelId}
      videoId={video.id}
      title={studioVideoTitle(video, locale)}
      duration={video.duration}
      created={video.dateCreated}
      backHref={`/${locale}/studio/${encodeURIComponent(channelId)}/content/videos`}
      backLabel={t.studio.editor.back}
    />
  );
}
