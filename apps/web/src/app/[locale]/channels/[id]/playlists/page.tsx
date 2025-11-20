import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getTranslations } from '@/lib/i18n';

interface ChannelPlaylistsPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

export default async function ChannelPlaylistsPage({ params }: ChannelPlaylistsPageProps) {
  const { locale, id } = await params;
  const channel = await getChannelById(id);

  if (!channel) {
    notFound();
  }

  const isRTL = locale === 'ar';
  const t = getTranslations(locale as 'en' | 'ar');

  return (
    <div className="bg-white rounded-lg shadow-sm p-12 text-center">
      <div className="max-w-md mx-auto space-y-4">
        <svg
          className="w-24 h-24 mx-auto text-gray-300"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
        </svg>
        <h2 className={cn(
          'text-2xl font-semibold text-gray-900',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {t.channel.playlists}
        </h2>
        <p className={cn(
          'text-gray-600',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {t.profile.noPlaylistsAvailable}
        </p>
      </div>
    </div>
  );
}
