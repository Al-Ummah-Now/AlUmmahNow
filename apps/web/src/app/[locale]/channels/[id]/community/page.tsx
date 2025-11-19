import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/utils';
import CommunityPosts from '@/components/Community/CommunityPosts';
import { Suspense } from 'react';

interface ChannelCommunityPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

function CommunityPostsSkeleton({ isRTL }: { isRTL: boolean }) {
  return (
    <div className="space-y-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 animate-pulse">
          <div className={cn(
            'flex items-center gap-3 mb-4',
            isRTL && 'flex-row-reverse'
          )}>
            <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full" />
            <div className="flex-1">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-2" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/6" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function ChannelCommunityPage({ params }: ChannelCommunityPageProps) {
  const { locale, id } = await params;
  const channel = await getChannelById(id);

  if (!channel) {
    notFound();
  }

  const isRTL = locale === 'ar';

  return (
    <div className="max-w-4xl mx-auto">
      {channel.subscribersCount && channel.subscribersCount < 1000 ? (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 mb-6">
          <div className={cn(
            'flex items-start gap-3',
            isRTL && 'flex-row-reverse'
          )}>
            <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div className={cn('flex-1', isRTL && 'text-right')}>
              <h3 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-1">
                {isRTL ? 'ميزة المجتمع غير متاحة' : 'Community Feature Unavailable'}
              </h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                {isRTL
                  ? `تحتاج هذه القناة إلى ${1000 - (channel.subscribersCount || 0)} مشترك إضافي للوصول إلى ميزة المنشورات المجتمعية`
                  : `This channel needs ${1000 - (channel.subscribersCount || 0)} more subscribers to access the Community Posts feature`}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <Suspense fallback={<CommunityPostsSkeleton isRTL={isRTL} />}>
        <CommunityPosts
          channelId={id}
          isRTL={isRTL}
          locale={locale}
        />
      </Suspense>
    </div>
  );
}
