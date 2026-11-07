'use client';

import { useEffect, useState } from 'react';
import { VideoObject } from '@al-ummah/shared-types';
import VideoCard from '../../videoCard';
import { SectionHeader } from '../SectionHeader';
import { resolveSectionTitle } from '../sectionData';
import { logger } from '@/lib/logger-client';
import { listVideos } from '@/lib/api/videos';
import { useLanguage } from '@/hooks/useLanguage';

interface LikedVideosSectionProps {
  channelId: string;
  title?: string;
}

export function LikedVideosSection({ channelId, title }: LikedVideosSectionProps) {
  const { t } = useLanguage();
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logger.info('LikedVideosSection: Fetching liked videos', { channelId });

    async function fetchLikedVideos() {
      try {
        // Fetch liked videos for the channel owner
        // This would typically require authentication and fetch from a likes endpoint
        const result = await listVideos({
          channelId,
          limit: 12,
          sortBy: 'date',
          sortOrder: 'desc'
        });

        logger.info('LikedVideosSection: API response', { result });

        if (result && result.data) {
          logger.info('LikedVideosSection: Loaded videos', { count: result.data.length });
          setVideos(result.data);
        }
      } catch (err) {
        logger.error('LikedVideosSection: Error fetching liked videos', { error: err });
      } finally {
        setLoading(false);
      }
    }

    fetchLikedVideos();
  }, [channelId]);

  if (loading) {
    return <SectionSkeleton />;
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title={resolveSectionTitle(title, t.channel.likedVideos)}

      />

      {videos.length === 0 ? (
        <div className="flex items-center justify-center p-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t.feed.likedVideos}
          </p>
        </div>
      ) : (
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
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white dark:from-gray-900 to-transparent pointer-events-none" />
        )}
      </div>
      )}
    </section>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
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
