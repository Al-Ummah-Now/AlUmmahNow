'use client';
import { logger } from '@/lib/logger-client';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider/authContext';
import { VideoObject } from '@/interfaces';
import VideoCardLTR from '@/components/videoCard';
import VideoCardRTL from '@/components/videoCard/rtl';
import { Button } from '@/components/ui/button';
import { RefreshCw, Users } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import Link from '@/components/common/AppLink';
import { getSubscriptionFeed } from '@/lib/api/channels';
import { SignInPrompt } from '@/components/common/SignInPrompt';

const FEED_PAGE_SIZE = 24;

interface SubscriptionFeedProps {
  className?: string;
}

export const SubscriptionFeed: React.FC<SubscriptionFeedProps> = ({
  className = ''
}) => {
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang, isRTL } = useLanguage();
  const VideoCard = isRTL ? VideoCardRTL : VideoCardLTR;
  const isAuthenticated = !!user;
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Set on the client after the first load: a server-rendered time would not
  // match the client's and break hydration (React error #418)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadSubscriptionFeed = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await getSubscriptionFeed({ limit: FEED_PAGE_SIZE });
      if (!response?.success) {
        logger.warn('[SubscriptionFeed] Feed request failed');
        setLoadError(true);
        return;
      }
      setVideos(response.data || []);
      setNextCursor(response.cursor);
      setLastRefresh(new Date());
    } catch (error) {
      logger.error('[SubscriptionFeed] Failed to load subscription feed', { error });
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const response = await getSubscriptionFeed({ limit: FEED_PAGE_SIZE, cursor: nextCursor });
      if (!response?.success) {
        setLoadError(true);
        return;
      }
      setVideos((prev) => {
        const seen = new Set(prev.map((v) => v.id));
        return [...prev, ...(response.data || []).filter((v) => !seen.has(v.id))];
      });
      setNextCursor(response.cursor);
    } catch (error) {
      logger.error('[SubscriptionFeed] Failed to load more feed videos', { error });
      setLoadError(true);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor]);

  useEffect(() => {
    if (isAuthenticated && user) {
      loadSubscriptionFeed();
    }
  }, [isAuthenticated, user, loadSubscriptionFeed]);

  const refreshFeed = () => {
    loadSubscriptionFeed();
  };

  if (!isAuthenticated) {
    return <SignInPrompt title={t.subscriptions.subscriptionFeed} message={t.subscriptions.loginToSeeVideos} />;
  }

  return (
    <div className={`max-w-7xl mx-auto p-6 ${className}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">{t.subscriptions.subscriptionFeed}</h1>
          <Link href={`/${lang}/subscriptions/manage`} data-testid="subscriptions-manage-link" className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">{t.subscriptions.manage}</Link>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {t.subscriptions.latestVideos}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {lastRefresh && (
            <span className="text-sm text-gray-500 dark:text-gray-400" data-testid="feed-last-updated">
              {t.subscriptions.lastUpdated} {lastRefresh.toLocaleTimeString(lang === 'ar' ? 'ar' : 'en-US')}
            </span>
          )}
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
      ) : loadError && videos.length === 0 ? (
        <div className="text-center py-12" role="alert">
          <p className="text-gray-600 dark:text-gray-400 mb-4">{t.subscriptions.loadFailed}</p>
          <Button variant="outline" onClick={refreshFeed}>
            {t.subscriptions.refresh}
          </Button>
        </div>
      ) : videos.length === 0 ? (
        <div className="text-center py-12" data-testid="feed-empty">
          <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">{t.subscriptions.noVideosInFeed}</h2>
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
              <VideoCard key={video.id} {...video} channel={video.channel || video.channelName} />
            ))}
          </div>

          {nextCursor && (
            <div className="flex justify-center mt-8">
              <Button variant="outline" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? t.common.loading : t.subscriptions.loadMore}
              </Button>
            </div>
          )}
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