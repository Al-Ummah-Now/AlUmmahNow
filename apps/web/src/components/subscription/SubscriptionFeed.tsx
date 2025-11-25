'use client';
import { logger } from '@/lib/logger-client';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider/authContext';
import { VideoObject } from '@/interfaces';
import VideoCard from '@/components/videoCard';
import { Button } from '@/components/ui/button';
import { RefreshCw, Users } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface SubscriptionFeedProps {
  className?: string;
}

export const SubscriptionFeed: React.FC<SubscriptionFeedProps> = ({
  className = ''
}) => {
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const isAuthenticated = !!user;
  const [videos, _setVideos] = useState<VideoObject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const loadSubscriptionFeed = useCallback(async () => {
    setIsLoading(true);
    try {
      // TODO: Implement API call to fetch subscription feed
      // const response = await fetchSubscriptionVideos(user.id);
      // _setVideos(response.videos);
      setLastRefresh(new Date());
    } catch (error) {
      logger.error('Failed to load subscription feed:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && user) {
      loadSubscriptionFeed();
    }
  }, [isAuthenticated, user, loadSubscriptionFeed]);

  const refreshFeed = () => {
    loadSubscriptionFeed();
  };

  if (!isAuthenticated) {
    return (
      <div className={`p-6 text-center ${className}`}>
        <div className="flex flex-col items-center gap-4">
          <Users className="w-16 h-16 text-gray-400" />
          <h2 className="text-2xl font-bold">{t.subscriptions.subscriptionFeed}</h2>
          <p className="text-gray-600 dark:text-gray-400 max-w-md">
            {t.subscriptions.loginToSeeVideos}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`max-w-7xl mx-auto p-6 ${className}`}>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">{t.subscriptions.subscriptionFeed}</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {t.subscriptions.latestVideos}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t.subscriptions.lastUpdated} {lastRefresh.toLocaleTimeString()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshFeed}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            {t.subscriptions.refresh}
          </Button>
        </div>
      </div>

      {isLoading && videos.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>{t.subscriptions.loadingFeed}</span>
          </div>
        </div>
      ) : videos.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">{t.subscriptions.noVideosInFeed}</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t.subscriptions.subscribeToSeeVideos}
          </p>
          <Button variant="outline" onClick={() => router.push(`/${lang}`)}>
            {t.subscriptions.discoverChannels}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {videos.map((video) => (
              <VideoCard key={video.id} {...video} />
            ))}
          </div>

          {/* Load More Button */}
          <div className="flex justify-center mt-8">
            <Button variant="outline" disabled>
              {t.subscriptions.loadMoreComingSoon}
            </Button>
          </div>
        </>
      )}

      {videos.length > 0 && (
        <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t.subscriptions.showingVideosFrom.replace('{count}', videos.length.toString())}{' '}
            <span className="font-medium">
              {t.subscriptions.wantMore}
            </span>
          </p>
        </div>
      )}
    </div>
  );
};

export default SubscriptionFeed;