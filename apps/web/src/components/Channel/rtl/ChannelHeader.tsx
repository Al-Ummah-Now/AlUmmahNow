'use client';

import { Channel } from '@al-ummah/shared-types';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger-client';
import { getTranslations } from '@/lib/i18n';
import Link from 'next/link';

interface ChannelHeaderProps {
  channel: Channel;
  locale: string;
  isOwner?: boolean;
}

export function ChannelHeader({ channel, locale, isOwner = false }: ChannelHeaderProps) {
  const { user } = useMultiAccount();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [checkingSubscription, setCheckingSubscription] = useState(true);

  const t = getTranslations(locale as 'en' | 'ar');
  const displayName = channel.nameLocalized?.[locale] || channel.name;
  const displayDescription = channel.descriptionLocalized?.[locale] || channel.description;

  // Check initial subscription status
  useEffect(() => {
    async function checkSubscription() {
      if (!user || isOwner) {
        setCheckingSubscription(false);
        return;
      }

      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3086';
        const response = await fetch(`${apiUrl}/api/channels/${channel.id}/subscriptions/check`, {
          headers: {
            'userId': user.id,
            'channelId': user.channel?.id || '',
          },
        });

        if (response.ok) {
          const data = await response.json();
          setIsSubscribed(data.isSubscribed || false);
        }
      } catch (error) {
        logger.error('[ChannelHeader RTL] Error checking subscription status:', error);
      } finally {
        setCheckingSubscription(false);
      }
    }

    checkSubscription();
  }, [user, channel.id, isOwner]);

  const handleSubscribe = async () => {
    if (!user) {
      logger.warn('[ChannelHeader] Subscribe clicked but user not logged in');
      // Redirect to login or show login modal
      window.location.href = `/${locale}/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    setIsLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3086';
      const endpoint = isSubscribed
        ? `${apiUrl}/api/channels/${channel.id}/subscriptions`
        : `${apiUrl}/api/channels/${channel.id}/subscriptions`;

      const method = isSubscribed ? 'DELETE' : 'POST';

      logger.info(`[ChannelHeader] ${isSubscribed ? 'Unsubscribing from' : 'Subscribing to'} channel`, {
        channelId: channel.id,
        userId: user.id,
        method,
      });

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'userId': user.id,
          'channelId': user.channel?.id || '',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Failed to ${isSubscribed ? 'unsubscribe' : 'subscribe'}`);
      }

      setIsSubscribed(!isSubscribed);
      logger.info(`[ChannelHeader] Successfully ${isSubscribed ? 'unsubscribed' : 'subscribed'}`, {
        channelId: channel.id,
        newState: !isSubscribed,
      });
    } catch (error) {
      logger.error('[ChannelHeader] Subscription error:', error);
      alert(error instanceof Error ? error.message : 'Failed to update subscription');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800" dir="rtl">
      {/* Channel Cover/Banner */}
      {channel.coverUrl && (
        <div className="relative w-full h-48 md:h-64 lg:h-80 bg-gray-200 dark:bg-gray-800">
          <Image
            src={channel.coverUrl}
            alt={`${displayName} cover`}
            fill
            className="object-cover"
            priority
          />
          {/* Owner Buttons - Top Left on Cover (RTL) */}
          {isOwner && (
            <div className="absolute top-4 left-4">
              <Link
                href={`/${locale}/settings/channel/${channel.id}/edit`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white/90 dark:bg-gray-800/90 hover:bg-white dark:hover:bg-gray-800 text-gray-900 dark:text-white rounded-lg font-medium transition-colors shadow-lg"
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
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Channel Info */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex gap-6 items-start flex-row-reverse">
          {/* Channel Avatar */}
          <div className="relative w-20 h-20 md:w-32 md:h-32 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-700 flex-shrink-0">
            {channel.avatarUrl ? (
              <Image
                src={channel.avatarUrl}
                alt={`${displayName} avatar`}
                fill
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl md:text-5xl font-bold text-gray-600 dark:text-gray-300">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Channel Details */}
          <div className="flex-1 min-w-0 text-right">
            <div className="flex items-center justify-between gap-3 mb-2 flex-row-reverse">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white truncate">
                  {displayName}
                </h1>
                {channel.isVerified && (
                  <svg
                    className="w-5 h-5 md:w-6 md:h-6 text-blue-600 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-label="Verified"
                  >
                    <path
                      fillRule="evenodd"
                      d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>

              {/* Subscribe Button - Only show if not owner */}
              {!isOwner && (
                <button
                  onClick={handleSubscribe}
                  disabled={isLoading || checkingSubscription}
                  className={cn(
                    'px-4 py-1.5 text-sm font-semibold rounded-lg transition-all shadow-md hover:shadow-lg flex-shrink-0',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500',
                    isSubscribed
                      ? 'bg-gray-200 hover:bg-gray-300 text-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white'
                      : 'bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-600 hover:to-amber-700 text-gray-900',
                    (isLoading || checkingSubscription) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {isLoading || checkingSubscription ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {t.common.loading}
                    </span>
                  ) : (
                    <>
                      {isSubscribed ? t.channel.subscribed : t.channel.subscribe}
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
              {channel.subscribersCount !== undefined && (
                <span>
                  {formatSubscriberCount(channel.subscribersCount)} {t.channel.subscribers}
                </span>
              )}
              {channel.videosCount !== undefined && channel.videosCount > 0 && (
                <>
                  <span>•</span>
                  <span>
                    {formatNumber(channel.videosCount)} {t.video.videos}
                  </span>
                </>
              )}
            </div>

            {displayDescription && (
              <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 mb-4">
                {displayDescription}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatSubscriberCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}
