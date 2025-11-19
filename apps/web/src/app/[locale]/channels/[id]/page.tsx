import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { getTranslations } from '@/lib/i18n';

interface ChannelHomePageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

export default async function ChannelHomePage({ params }: ChannelHomePageProps) {
  const { locale, id } = await params;
  const channel = await getChannelById(id);

  if (!channel) {
    notFound();
  }

  const isRTL = locale === 'ar';
  const displayDescription = channel.descriptionLocalized?.[locale] || channel.description;
  const t = getTranslations(locale as 'en' | 'ar');

  return (
    <div className="space-y-8">
      {/* Channel Trailer Section */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className={`text-xl font-semibold mb-4 ${isRTL ? 'text-right' : 'text-left'}`}>
          {t.channel.channelTrailer}
        </h2>
        <div className="aspect-video bg-gray-200 rounded-lg flex items-center justify-center">
          <p className="text-gray-500">
            {t.channel.noChannelTrailer}
          </p>
        </div>
      </section>

      {/* About Section */}
      {displayDescription && (
        <section className="bg-white rounded-lg shadow-sm p-6">
          <h2 className={`text-xl font-semibold mb-4 ${isRTL ? 'text-right' : 'text-left'}`}>
            {t.channel.about}
          </h2>
          <p className={`text-gray-700 whitespace-pre-wrap ${isRTL ? 'text-right' : 'text-left'}`}>
            {displayDescription}
          </p>
        </section>
      )}

      {/* Channel Sections - Placeholder for future implementation */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className={`text-xl font-semibold mb-4 ${isRTL ? 'text-right' : 'text-left'}`}>
          {t.channel.content}
        </h2>
        <p className={`text-gray-500 ${isRTL ? 'text-right' : 'text-left'}`}>
          {t.channel.channelSectionsPlaceholder}
        </p>
      </section>
    </div>
  );
}
