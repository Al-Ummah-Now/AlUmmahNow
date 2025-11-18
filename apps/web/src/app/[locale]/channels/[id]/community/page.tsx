import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/utils';

interface ChannelCommunityPageProps {
  params: {
    locale: string;
    id: string;
  };
}

export default async function ChannelCommunityPage({ params }: ChannelCommunityPageProps) {
  const channel = await getChannelById(params.id);

  if (!channel) {
    notFound();
  }

  const isRTL = params.locale === 'ar';

  return (
    <div className="bg-white rounded-lg shadow-sm p-12 text-center">
      <div className="max-w-md mx-auto space-y-4">
        <svg
          className="w-24 h-24 mx-auto text-gray-300"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
        </svg>
        <h2 className={cn(
          'text-2xl font-semibold text-gray-900',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {isRTL ? 'المجتمع' : 'Community'}
        </h2>
        <p className={cn(
          'text-gray-600',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {isRTL
            ? 'لا توجد منشورات مجتمعية حاليًا'
            : 'No community posts available at this time'}
        </p>
        {channel.subscribersCount && channel.subscribersCount < 1000 && (
          <p className={cn(
            'text-sm text-gray-500',
            isRTL ? 'text-right' : 'text-left'
          )}>
            {isRTL
              ? 'تحتاج القناة إلى 1000 مشترك للوصول إلى ميزة المجتمع'
              : 'This channel needs 1,000 subscribers to access the Community feature'}
          </p>
        )}
      </div>
    </div>
  );
}
