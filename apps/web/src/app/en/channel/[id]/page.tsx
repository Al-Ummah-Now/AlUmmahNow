"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { SubscribeButton } from '@/components/subscription/SubscribeButton';
import { getChannelById } from '@/lib/api/channels';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';
import { useI18n } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import { ChannelSections } from '@/components/ChannelSections';

interface ChannelData {
  id: string;
  userId: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  coverUrl?: string;
  subscribersCount?: number;
  nameLocalized?: Record<string, string>;
  descriptionLocalized?: Record<string, string>;
}

function ChannelPage({params}: {  params: Promise<{ id: string }> }) {
  const { t } = useI18n('en');
  const router = useRouter();
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelData | null>(null);
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
        // Fetch channel info (the channel being viewed)
        const channelData = await getChannelById(channelId);
        if (channelData) {
          setChannel(channelData);
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
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{t.common.loading}</p>
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-2">{t.errors.notFound}</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">The channel you&apos;re looking for doesn&apos;t exist or has been removed.</p>
          <Link href="/en/" className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
            {t.feed.home}
          </Link>
        </div>
      </div>
    );
  }

  const channelName = getLocalizedValue(channel.nameLocalized, channel.name, 'en');
  const channelDescription = getLocalizedValue(channel.descriptionLocalized, channel.description, 'en');
  const isOwner = user?.id === channel.userId;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="font-sans text-gray-800 dark:text-gray-200 max-w-6xl mx-auto">
        {/* Channel Banner */}
        <div className="relative h-52 bg-gradient-to-r from-blue-500 to-purple-600 dark:from-blue-700 dark:to-purple-800">
          {channel.coverUrl ? (
            <Image
              src={channel.coverUrl}
              alt="Channel Banner"
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
          {/* Edit Button - Always visible for owner */}
          {isOwner && (
            <button
              type="button"
              onClick={() => router.push(`/en/channel/${channelId}/edit`)}
              className="absolute top-4 right-4 inline-flex items-center gap-2 px-4 py-2 bg-white/90 dark:bg-gray-800/90 hover:bg-white dark:hover:bg-gray-800 text-gray-900 dark:text-white rounded-lg font-medium transition-colors shadow-lg cursor-pointer"
              aria-label="Edit channel"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
              {t.common.edit}
            </button>
          )}
          <div className="absolute bottom-[-50px] left-5 w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-700 border-4 border-gray-50 dark:border-gray-900 overflow-hidden shadow-lg">
            {channel.avatarUrl ? (
              <Image
                src={channel.avatarUrl}
                alt={channelName}
                fill
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
                <span className="text-3xl font-bold text-white">
                  {channelName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Channel Info */}
        <div className="pt-16 pb-5 px-5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{channelName}</h1>
              {channel.subscribersCount !== undefined && (
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  {channel.subscribersCount.toLocaleString()} {t.channel.subscribers}
                </p>
              )}
              {channelDescription && (
                <p className="text-gray-600 dark:text-gray-400 mt-2">{channelDescription}</p>
              )}
            </div>
            <SubscribeButton
              channelId={channelId}
              channelName={channelName}
              subscribersCount={channel.subscribersCount || 0}
              initialSubscribed={false}
            />
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-2">
          <button className="mr-5 px-4 py-2 text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 font-semibold">
            Home
          </button>
          <button className="mr-5 px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 font-medium">
            {t.channel.videos}
          </button>
        </div>

        {/* Channel Sections (Home Tab) */}
        <div className="p-5 bg-white dark:bg-gray-800">
          <ChannelSections channelId={channelId} />
        </div>
      </div>
    </div>
  );
};

export default ChannelPage;
