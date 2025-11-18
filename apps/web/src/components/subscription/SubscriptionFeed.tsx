"use client";
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

// Mock data for demonstration - in reality this would come from the API
const mockSubscriptionVideos: VideoObject[] = [
    {
      id: '1',
      title: 'The Importance of Daily Prayers - Complete Guide',
      description: 'A comprehensive guide to understanding and performing the five daily prayers',
      thumbnailUrl: '/placeholder-thumbnail.jpg',
      videoUrl: '/placeholder-video.mp4',
      userId: 'user1',
      channel: 'Islamic Lectures',
      channelId: 'channel1',
      channelAvatarUrl: '/default-avatar.png',
      channelName: 'Islamic Lectures',
      dateCreated: '2024-01-20T10:00:00Z',
      dateModified: '2024-01-20T10:00:00Z',
      createdAt: '2024-01-20T10:00:00Z',
      updatedAt: '2024-01-20T10:00:00Z',
      views: 15420,
      likesCount: 892,
      dislikesCount: 23,
      commentsCount: 156,
      isPublic: true,
      isLive: false
    },
    {
      id: '2',
      title: 'Beautiful Quran Recitation - Surah Al-Fatiha',
      description: 'Beautiful recitation of the opening chapter of the Holy Quran',
      thumbnailUrl: '/placeholder-thumbnail.jpg',
      videoUrl: '/placeholder-video.mp4',
      userId: 'user2',
      channel: 'Quran Recitations',
      channelId: 'channel2',
      channelAvatarUrl: '/default-avatar.png',
      channelName: 'Quran Recitations',
      dateCreated: '2024-01-19T15:30:00Z',
      dateModified: '2024-01-19T15:30:00Z',
      createdAt: '2024-01-19T15:30:00Z',
      updatedAt: '2024-01-19T15:30:00Z',
      views: 28540,
      likesCount: 1250,
      dislikesCount: 18,
      commentsCount: 234,
      isPublic: true,
      isLive: false
    },
    {
      id: '3',
      title: 'Stories from Islamic History - The Golden Age',
      description: 'Exploring the remarkable achievements during the Islamic Golden Age',
      thumbnailUrl: '/placeholder-thumbnail.jpg',
      videoUrl: '/placeholder-video.mp4',
      userId: 'user3',
      channel: 'Islamic History',
      channelId: 'channel3',
      channelAvatarUrl: '/default-avatar.png',
      channelName: 'Islamic History',
      dateCreated: '2024-01-18T09:15:00Z',
      dateModified: '2024-01-18T09:15:00Z',
      createdAt: '2024-01-18T09:15:00Z',
      updatedAt: '2024-01-18T09:15:00Z',
      views: 9870,
      likesCount: 445,
      dislikesCount: 12,
      commentsCount: 89,
      isPublic: true,
      isLive: false
    },
    {
      id: '4',
      title: 'Understanding the Pillars of Islam',
      description: 'A detailed explanation of the five fundamental acts of worship in Islam',
      thumbnailUrl: '/placeholder-thumbnail.jpg',
      videoUrl: '/placeholder-video.mp4',
      userId: 'user1',
      channel: 'Islamic Lectures',
      channelId: 'channel1',
      channelAvatarUrl: '/default-avatar.png',
      channelName: 'Islamic Lectures',
      dateCreated: '2024-01-17T14:20:00Z',
      dateModified: '2024-01-17T14:20:00Z',
      createdAt: '2024-01-17T14:20:00Z',
      updatedAt: '2024-01-17T14:20:00Z',
      views: 12340,
      likesCount: 678,
      dislikesCount: 15,
      commentsCount: 123,
      isPublic: true,
      isLive: false
    }
];

export const SubscriptionFeed: React.FC<SubscriptionFeedProps> = ({
  className = ''
}) => {
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const isAuthenticated = !!user;
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const loadSubscriptionFeed = useCallback(async () => {
    setIsLoading(true);
    try {
      // In a real implementation, this would fetch from the API
      // For now, we'll simulate loading with mock data
      await new Promise(resolve => setTimeout(resolve, 1000));
      setVideos(mockSubscriptionVideos);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to load subscription feed:', error);
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