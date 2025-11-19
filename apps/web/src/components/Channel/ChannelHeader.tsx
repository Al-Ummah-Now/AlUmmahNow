import { Channel } from '@al-ummah/shared-types';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface ChannelHeaderProps {
  channel: Channel;
  locale: string;
}

export function ChannelHeader({ channel, locale }: ChannelHeaderProps) {
  const isRTL = locale === 'ar';

  const displayName = channel.nameLocalized?.[locale] || channel.name;
  const displayDescription = channel.descriptionLocalized?.[locale] || channel.description;

  return (
    <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
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
        <div className={cn(
          'flex gap-6 items-start',
          isRTL ? 'flex-row-reverse' : 'flex-row'
        )}>
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
          <div className={cn(
            'flex-1 min-w-0',
            isRTL ? 'text-right' : 'text-left'
          )}>
            <div className="flex items-center gap-2 mb-2">
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

            <div className="flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
              {channel.subscribersCount !== undefined && (
                <span>
                  {formatSubscriberCount(channel.subscribersCount)} {isRTL ? 'مشترك' : 'subscribers'}
                </span>
              )}
              {channel.videosCount !== undefined && channel.videosCount > 0 && (
                <>
                  <span>•</span>
                  <span>
                    {formatNumber(channel.videosCount)} {isRTL ? 'فيديو' : 'videos'}
                  </span>
                </>
              )}
            </div>

            {displayDescription && (
              <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 mb-4">
                {displayDescription}
              </p>
            )}

            {/* Subscribe Button */}
            <button
              className={cn(
                'px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-full transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2'
              )}
            >
              {isRTL ? 'اشتراك' : 'Subscribe'}
            </button>
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
