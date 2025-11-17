"use client";
import React, { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { VideoObject } from "@/interfaces";
import * as VideosAPI from "@/lib/api/videos";
import VideoCard from "@/components/videoCard/rtl/index";
import { useI18n } from "@/lib/i18n";

interface TrendingContentProps {
  period?: 'hour' | 'day' | 'week' | 'month';
  category?: string;
  limit?: number;
  className?: string;
}

export const TrendingContent: React.FC<TrendingContentProps> = ({
  period = 'day',
  category,
  limit = 8,
  className = ''
}) => {
  const pathname = usePathname();
  const locale = pathname.startsWith('/ar') ? 'ar' : 'en';
  const { t } = useI18n(locale);

  const periodLabels = {
    hour: t.search.lastHour,
    day: t.search.today,
    week: t.search.thisWeek,
    month: t.search.thisMonth
  };

  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState(period);

  const fetchTrendingVideos = useCallback(async () => {
    setLoading(true);
    try {
      const trendingVideos = await VideosAPI.getTrendingVideos(selectedPeriod, category, limit);
      setVideos(trendingVideos);
    } catch (error) {
      console.error('Error fetching trending videos:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, category, limit]);

  useEffect(() => {
    fetchTrendingVideos();
  }, [fetchTrendingVideos]);

  if (loading) {
    return (
      <div className={`${className}`} dir="rtl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            🔥 {t.search.trendingVideos}
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: limit }).map((_, index) => (
            <div key={index} className="animate-pulse">
              <div className="bg-gray-200 aspect-video rounded-lg mb-2"></div>
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={className} dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          🔥 {t.search.trendingVideos}
        </h2>

        {/* Period Selector */}
        <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          {(Object.keys(periodLabels) as Array<keyof typeof periodLabels>).map((key) => (
            <button
              key={key}
              onClick={() => setSelectedPeriod(key)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                selectedPeriod === key
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {periodLabels[key]}
            </button>
          ))}
        </div>
      </div>

      {videos.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {videos.map((video, index) => (
            <div key={video.id} className="relative">
              {/* Trending indicator */}
              <div className="absolute top-2 right-2 z-10 bg-red-500 text-white text-xs px-2 py-1 rounded-md font-semibold">
                #{index + 1}
              </div>
              <VideoCard {...video} />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <div className="text-gray-400 text-6xl mb-4">📈</div>
          <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-2">
            {t.search.noTrendingVideos}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {t.search.checkBackLater}
          </p>
        </div>
      )}
    </div>
  );
};

export default TrendingContent;
