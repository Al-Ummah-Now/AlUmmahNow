'use client';

import { useEffect, useState } from 'react';
import { VideoObject } from '@al-ummah/shared-types';
import VideoCard from '../../../videoCard/rtl';
import { SectionHeader } from '../../SectionHeader';
import { logger } from '@/lib/logger-client';

interface LikedVideosSectionProps {
  channelId: string;
  title?: string;
}

export function LikedVideosSection({ channelId, title }: LikedVideosSectionProps) {
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logger.info('LikedVideosSection (RTL): Fetching liked videos', { channelId });

    async function fetchLikedVideos() {
      try {
        // Import here to avoid issues with 'use server'
        const { listVideos } = await import('@/lib/api/videos');

        // Fetch liked videos for the channel owner
        const result = await listVideos({
          channelId,
          limit: 12,
          sortBy: 'date',
          sortOrder: 'desc'
        });

        logger.info('LikedVideosSection (RTL): API response', { result });

        if (result && result.data) {
          logger.info('LikedVideosSection (RTL): Loaded videos', { count: result.data.length });
          setVideos(result.data);
        }
      } catch (err) {
        logger.error('LikedVideosSection (RTL): Error fetching liked videos', { error: err });
      } finally {
        setLoading(false);
      }
    }

    fetchLikedVideos();
  }, [channelId]);

  if (loading) {
    return <SectionSkeleton />;
  }

  if (videos.length === 0) {
    logger.warn('LikedVideosSection (RTL): No liked videos to display', { channelId });
    return null;
  }

  return (
    <section data-section="liked" className="space-y-4" dir="rtl">
      <SectionHeader
        title={title || 'الفيديوهات المفضلة'}
        viewAllHref={`/ar/channels/${channelId}/liked`}
      />

      <div className="relative">
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-4 pb-2">
            {videos.map((video) => (
              <div key={video.id} className="flex-shrink-0 w-64 sm:w-72 md:w-80">
                <VideoCard {...video} />
              </div>
            ))}
          </div>
        </div>

        {videos.length > 5 && (
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-white dark:from-gray-900 to-transparent pointer-events-none" />
        )}
      </div>
    </section>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" dir="rtl">
      <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48"></div>
      <div className="flex gap-4 overflow-x-auto">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex-shrink-0 w-64 space-y-2">
            <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    </div>
  );
}
