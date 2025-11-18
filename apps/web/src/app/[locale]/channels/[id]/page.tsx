import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';

interface ChannelHomePageProps {
  params: {
    locale: string;
    id: string;
  };
}

export default async function ChannelHomePage({ params }: ChannelHomePageProps) {
  const channel = await getChannelById(params.id);

  if (!channel) {
    notFound();
  }

  const isRTL = params.locale === 'ar';
  const displayDescription = channel.descriptionLocalized?.[params.locale] || channel.description;

  return (
    <div className="space-y-8">
      {/* Channel Trailer Section */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className={`text-xl font-semibold mb-4 ${isRTL ? 'text-right' : 'text-left'}`}>
          {isRTL ? 'إعلان القناة' : 'Channel Trailer'}
        </h2>
        <div className="aspect-video bg-gray-200 rounded-lg flex items-center justify-center">
          <p className="text-gray-500">
            {isRTL ? 'لا يوجد إعلان للقناة' : 'No channel trailer available'}
          </p>
        </div>
      </section>

      {/* About Section */}
      {displayDescription && (
        <section className="bg-white rounded-lg shadow-sm p-6">
          <h2 className={`text-xl font-semibold mb-4 ${isRTL ? 'text-right' : 'text-left'}`}>
            {isRTL ? 'حول القناة' : 'About'}
          </h2>
          <p className={`text-gray-700 whitespace-pre-wrap ${isRTL ? 'text-right' : 'text-left'}`}>
            {displayDescription}
          </p>
        </section>
      )}

      {/* Channel Sections - Placeholder for future implementation */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className={`text-xl font-semibold mb-4 ${isRTL ? 'text-right' : 'text-left'}`}>
          {isRTL ? 'المحتوى' : 'Content'}
        </h2>
        <p className={`text-gray-500 ${isRTL ? 'text-right' : 'text-left'}`}>
          {isRTL ? 'سيتم عرض أقسام القناة هنا' : 'Channel sections will be displayed here'}
        </p>
      </section>
    </div>
  );
}
