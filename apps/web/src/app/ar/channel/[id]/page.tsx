"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { SubscribeButton } from '@/components/subscription/SubscribeButton';
import { getChannelById } from '@/lib/api/channels';
import * as VideosAPI from '@/lib/api/videos';
import { VideoObject } from '@/interfaces';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';

interface ChannelData {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  subscribersCount?: number;
}

function ChannelPage({params}: {  params: Promise<{ id: string }> }) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelData | null>(null);
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();
  const { profile } = useProfile(user);

  useEffect(() => {
    // Resolve the params Promise
    params.then((resolvedParams) => {
      setChannelId(resolvedParams.id);
    });
  }, [params]);

  useEffect(() => {
    if (!channelId) return;

    const fetchChannelData = async () => {
      setIsLoading(true);
      try {
        // Get user's own channel ID for auth headers
        const userChannelId = profile?.channels?.[0] || '';

        // Fetch channel info (the channel being viewed)
        const channelData = await getChannelById(
          channelId,
          userChannelId && user?.id ? { channelId: userChannelId, userId: user.id } : undefined
        );
        if (channelData) {
          setChannel(channelData);
        }

        // Fetch videos FROM the channel being viewed
        // channelId in query params filters by channel (takes precedence over header)
        // channelId in headers is for auth (user's own channel)
        const videosResponse = await VideosAPI.listVideos(
          { limit: 12, channelId }, // Query param: filter by this channel
          userChannelId && user?.id ? { channelId: userChannelId, userId: user.id } : undefined // Header: auth
        );
        if (videosResponse?.data) {
          setVideos(videosResponse.data);
        }
      } catch (error) {
        console.error('Error fetching channel data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchChannelData();
  }, [channelId, user?.id, profile]);

  if (!channelId || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" dir="rtl">
        <div>جاري التحميل...</div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex items-center justify-center min-h-screen" dir="rtl">
        <div>القناة غير موجودة</div>
      </div>
    );
  }

  return (
    <div className="font-sans text-gray-800 dark:text-gray-200 max-w-6xl mx-auto" dir="rtl">
      {/* Channel Banner */}
      <div className="relative h-52 bg-gray-200 dark:bg-gray-700">
        {channel.bannerUrl && (
          <Image
            src={channel.bannerUrl}
            alt="صورة غلاف القناة"
            fill
            className="object-cover"
          />
        )}
        <div className="absolute bottom-[-50px] right-5 w-24 h-24 rounded-full bg-gray-400 border-4 border-white dark:border-gray-800 overflow-hidden">
          {channel.avatarUrl && (
            <Image
              src={channel.avatarUrl}
              alt={channel.name}
              fill
              className="object-cover"
            />
          )}
        </div>
      </div>

      {/* Channel Info */}
      <div className="pt-16 pb-5 px-5 border-b border-gray-300 dark:border-gray-600">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{channel.name}</h1>
            {channel.subscribersCount !== undefined && (
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                {channel.subscribersCount.toLocaleString('ar-EG')} مشترك
              </p>
            )}
            {channel.description && (
              <p className="text-gray-600 dark:text-gray-400 mt-2">{channel.description}</p>
            )}
          </div>
          <SubscribeButton
            channelId={channelId}
            channelName={channel.name}
            subscribersCount={channel.subscribersCount || 0}
            initialSubscribed={false}
            lang="ar"
          />
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-gray-300 dark:border-gray-600 px-5 py-2">
        <button className="ml-5 text-blue-600 dark:text-blue-400">الفيديوهات</button>
      </div>

      {/* Video Grid */}
      <div className="p-5">
        {videos.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            لا توجد فيديوهات بعد
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {videos.map((video) => (
              <Link
                key={video.id}
                href={`/ar/video?vid=${video.id}`}
                className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-800 hover:shadow-lg transition-shadow"
              >
                <div className="w-full h-36 bg-gray-300 dark:bg-gray-700 relative">
                  {video.thumbnailUrl && (
                    <Image
                      src={video.thumbnailUrl}
                      alt={video.title}
                      fill
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="p-3">
                  <h3 className="text-lg font-bold line-clamp-2">{video.title}</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                    {video.views?.toLocaleString('ar-EG') || 0} مشاهدة
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelPage;
