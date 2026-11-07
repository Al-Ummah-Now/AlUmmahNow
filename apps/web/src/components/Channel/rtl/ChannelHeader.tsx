'use client';

import { Channel } from '@al-ummah/shared-types';
import Image from 'next/image';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useChannelSubscription } from '@/hooks/useChannelSubscription';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger-client';
import { getTranslations } from '@/lib/i18n';
import Link from 'next/link';
import { ChannelBellMenu } from '@/components/notifications/ChannelBellMenu';
import { ChannelOwnerActions } from '@/components/Channel/ChannelOwnerActions';
import { formatHandle } from '@/lib/channel-url';

interface ChannelHeaderProps {
  channel: Channel;
  locale: string;
  isOwner?: boolean;
}

export function ChannelHeader({ channel, locale, isOwner = false }: ChannelHeaderProps) {
  // While the session loads `user` is still null: treat that as "checking", not anonymous
  const { user, loading: authLoading } = useMultiAccount();
  // Server-side ownership plus a client fallback (e.g. right after switching accounts)
  const owner = isOwner || (!!user && user.id === channel.userId);
  const t = getTranslations(locale as 'en' | 'ar');
  const displayName = channel.nameLocalized?.[locale] || channel.name;
  const displayDescription = channel.descriptionLocalized?.[locale] || channel.description;

  const {
    isSubscribed,
    subscriberCount,
    isChecking: checkingSubscription,
    isUpdating: isLoading,
    error: subscriptionError,
    toggle,
  } = useChannelSubscription({
    channelId: channel.id,
    enabled: !!user && !owner,
    initialSubscriberCount: channel.subscribersCount,
  });

  const handleSubscribe = async () => {
    if (!user) {
      logger.warn('[ChannelHeader RTL] Subscribe clicked but user not logged in');
      window.location.href = `/${locale}/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    const ok = await toggle();
    logger.info('[ChannelHeader RTL] Subscription toggle finished', { channelId: channel.id, ok });
  };

  return (
    <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800" data-testid="channel-header" dir="rtl">
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
        </div>
      )}

      {/* Channel Info */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex gap-6 items-start">
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
            <div className="flex items-center justify-between gap-3 mb-2">
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

              {/* Subscribe Button (+ per-channel bell while subscribed) - Only show if not owner */}
              {!owner && (
                <div className="flex items-center gap-2 flex-shrink-0">
                {user && isSubscribed && !isLoading && <ChannelBellMenu channelId={channel.id} />}
                <button
                  onClick={handleSubscribe}
                  data-testid="channel-subscribe-button"
                  aria-pressed={isSubscribed}
                  disabled={authLoading || isLoading || checkingSubscription}
                  className={cn(
                    'px-4 py-1.5 text-sm font-semibold rounded-lg transition-all shadow-md hover:shadow-lg flex-shrink-0',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500',
                    isSubscribed
                      ? 'bg-gray-200 hover:bg-gray-300 text-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white'
                      : 'bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-600 hover:to-amber-700 text-gray-900',
                    (authLoading || isLoading || checkingSubscription) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {authLoading || isLoading || checkingSubscription ? (
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
                </div>
              )}
            </div>

            {channel.handle && (
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" dir="ltr" data-testid="channel-handle">
                {formatHandle(channel.handle)}
              </p>
            )}

            <div className="flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
              {subscriberCount !== undefined && (
                <span data-testid="channel-subscriber-count">
                  {formatSubscriberCount(subscriberCount)} {t.channel.subscribers}
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

            {subscriptionError && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-2" role="alert">
                {subscriptionError === 'auth'
                  ? t.errors.loginRequired
                  : subscriptionError === 'channel'
                    ? t.errors.channelRequired
                    : t.errors.failedToUpdate}
                {subscriptionError === 'channel' && (
                  <>
                    {' '}
                    <Link href={`/${locale}/profile`} className="underline font-medium">
                      {t.navigation.createChannel}
                    </Link>
                  </>
                )}
              </p>
            )}

            {displayDescription && (
              <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 mb-4">
                {displayDescription}
              </p>
            )}

            {owner && (
              <ChannelOwnerActions
                channel={{ id: channel.id, name: channel.name, nameLocalized: channel.nameLocalized, isMain: channel.isMain }}
                className="mt-2"
              />
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
