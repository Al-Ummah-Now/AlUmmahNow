import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/utils';

interface ChannelLivePageProps {
  params: {
    locale: string;
    id: string;
  };
}

export default async function ChannelLivePage({ params }: ChannelLivePageProps) {
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
          <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
        </svg>
        <h2 className={cn(
          'text-2xl font-semibold text-gray-900',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {isRTL ? 'البث المباشر' : 'Live Streams'}
        </h2>
        <p className={cn(
          'text-gray-600',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {isRTL
            ? 'لا توجد بثوث مباشرة حاليًا'
            : 'No live streams available at this time'}
        </p>
      </div>
    </div>
  );
}
