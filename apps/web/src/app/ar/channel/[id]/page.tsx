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
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900" dir="rtl">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">جاري تحميل القناة...</p>
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900" dir="rtl">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-2">القناة غير موجودة</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">القناة التي تبحث عنها غير موجودة أو تم حذفها.</p>
          <Link href="/ar/" className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
            العودة للصفحة الرئيسية
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900" dir="rtl">
      <div className="font-sans text-gray-800 dark:text-gray-200 max-w-6xl mx-auto">
        {/* Channel Banner */}
        <div className="relative h-52 bg-gradient-to-r from-blue-500 to-purple-600 dark:from-blue-700 dark:to-purple-800">
          {channel.bannerUrl ? (
            <Image
              src={channel.bannerUrl}
              alt="صورة غلاف القناة"
              fill
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-20 h-20 text-white/20" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
          )}
          <div className="absolute bottom-[-50px] right-5 w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-700 border-4 border-gray-50 dark:border-gray-900 overflow-hidden shadow-lg">
            {channel.avatarUrl ? (
              <Image
                src={channel.avatarUrl}
                alt={channel.name}
                fill
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
                <span className="text-3xl font-bold text-white">
                  {channel.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Channel Info */}
        <div className="pt-16 pb-5 px-5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{channel.name}</h1>
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
        <div className="flex bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-2">
          <button className="ml-5 px-4 py-2 text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 font-semibold">
            الفيديوهات
          </button>
        </div>

        {/* Video Grid */}
        <div className="p-5 bg-white dark:bg-gray-800">
          {videos.length === 0 ? (
            <div className="text-center py-16">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">لا توجد فيديوهات بعد</h3>
              <p className="text-gray-500 dark:text-gray-400">لم تقم هذه القناة برفع أي فيديوهات بعد.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {videos.map((video) => (
                <Link
                  key={video.id}
                  href={`/ar/video?vid=${video.id}`}
                  className="group rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-900 hover:shadow-xl transition-all duration-300 border border-gray-200 dark:border-gray-700"
                >
                  <div className="relative w-full aspect-video bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    {video.thumbnailUrl && (
                      <Image
                        src={video.thumbnailUrl}
                        alt={video.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-semibold line-clamp-2 text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {video.title}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400 text-xs mt-1">
                      {video.views?.toLocaleString('ar-EG') || 0} مشاهدة
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChannelPage;
