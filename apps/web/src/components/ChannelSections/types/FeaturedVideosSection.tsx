'use client';

import { useEffect, useState } from 'react';
import { VideoObject } from '@al-ummah/shared-types';
import VideoCard from '../../videoCard';
import { SectionHeader } from '../SectionHeader';
import { resolveSectionTitle } from '../sectionData';
import { logger } from '@/lib/logger-client';
import { getVideoById } from '@/lib/api/videos';
import { useLanguage } from '@/hooks/useLanguage';

interface FeaturedVideosSectionProps {
  videoIds: string[];
  title?: string;
  channelId?: string;
}

export function FeaturedVideosSection({ videoIds, title, channelId }: FeaturedVideosSectionProps) {
  const { t, locale } = useLanguage();
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logger.info('FeaturedVideosSection: Fetching featured videos', { videoIds, count: videoIds.length });

    async function fetchVideos() {
      try {
        // Fetch videos by IDs (in order)
        const videoPromises = videoIds.map(async (id) => {
          try {
            const video = await getVideoById(id);
            return video;
          } catch (err) {
            logger.error('FeaturedVideosSection: Error fetching video', { videoId: id, error: err });
            return null;
          }
        });

        const fetchedVideos = await Promise.all(videoPromises);
        const validVideos = fetchedVideos.filter((v): v is VideoObject => v !== null);

        logger.info('FeaturedVideosSection: Loaded videos', {
          requested: videoIds.length,
          loaded: validVideos.length
        });

        setVideos(validVideos);
      } catch (err) {
        logger.error('FeaturedVideosSection: Error fetching featured videos', { error: err });
      } finally {
        setLoading(false);
      }
    }

    if (videoIds.length > 0) {
      fetchVideos();
    } else {
      setLoading(false);
    }
  }, [videoIds]);

  if (loading) {
    return <SectionSkeleton />;
  }

  return (
    <section data-section="featured" className="space-y-4">
      <SectionHeader
        title={resolveSectionTitle(title, t.channel.featuredVideos)}
        viewAllHref={channelId && videos.length > 0 ? `/${locale}/channels/${channelId}?tab=videos` : undefined}
      />

      {videos.length === 0 ? (
        <div className="flex items-center justify-center p-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t.channel.featuredVideosDescription}
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
