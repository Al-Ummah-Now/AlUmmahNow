import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/utils';

interface ChannelShortsPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

export default async function ChannelShortsPage({ params }: ChannelShortsPageProps) {
  const { locale, id } = await params;
  const channel = await getChannelById(id);

  if (!channel) {
    notFound();
  }

  const isRTL = locale === 'ar';

  return (
    <div className="bg-white rounded-lg shadow-sm p-12 text-center">
      <div className="max-w-md mx-auto space-y-4">
        <svg
          className="w-24 h-24 mx-auto text-gray-300"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
        </svg>
        <h2 className={cn(
          'text-2xl font-semibold text-gray-900',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {isRTL ? 'الفيديوهات القصيرة' : 'Shorts'}
        </h2>
        <p className={cn(
          'text-gray-600',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {isRTL
            ? 'لا توجد فيديوهات قصيرة متاحة حاليًا'
            : 'No shorts available at this time'}
        </p>
      </div>
    </div>
  );
}
