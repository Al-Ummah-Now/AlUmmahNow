import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/utils';

interface ChannelAboutPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

export default async function ChannelAboutPage({ params }: ChannelAboutPageProps) {
  const { locale, id } = await params;
  const channel = await getChannelById(id);

  if (!channel) {
    notFound();
  }

  const isRTL = locale === 'ar';
  const displayDescription = channel.descriptionLocalized?.[locale] || channel.description;

  return (
    <div className={cn(
      'max-w-4xl space-y-8',
      isRTL ? 'mr-0' : 'ml-0'
    )}>
      {/* Description */}
      <section>
        <h2 className={cn(
          'text-xl font-semibold mb-4',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {isRTL ? 'الوصف' : 'Description'}
        </h2>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className={cn(
            'text-gray-700 whitespace-pre-wrap',
            isRTL ? 'text-right' : 'text-left'
          )}>
            {displayDescription || (isRTL ? 'لا يوجد وصف متاح' : 'No description provided.')}
          </p>
        </div>
      </section>

      {/* Stats */}
      <section>
        <h2 className={cn(
          'text-xl font-semibold mb-4',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {isRTL ? 'الإحصائيات' : 'Statistics'}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label={isRTL ? 'المشتركون' : 'Subscribers'}
            value={formatNumber(channel.subscribersCount ?? 0)}
            isRTL={isRTL}
          />
          <StatCard
            label={isRTL ? 'الفيديوهات' : 'Videos'}
            value={formatNumber(channel.videosCount ?? 0)}
            isRTL={isRTL}
          />
          <StatCard
            label={isRTL ? 'المشاهدات' : 'Views'}
            value={formatNumber(channel.totalViews ?? 0)}
            isRTL={isRTL}
          />
          <StatCard
            label={isRTL ? 'تاريخ الانضمام' : 'Joined'}
            value={formatDate(channel.dateCreated, locale)}
            isRTL={isRTL}
          />
        </div>
      </section>

      {/* Links */}
      {(channel.websiteUrl || channel.socialLinks) && (
        <section>
          <h2 className={cn(
            'text-xl font-semibold mb-4',
            isRTL ? 'text-right' : 'text-left'
          )}>
            {isRTL ? 'الروابط' : 'Links'}
          </h2>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className={cn(
              'space-y-2',
              isRTL ? 'text-right' : 'text-left'
            )}>
              {channel.websiteUrl && (
                <a
                  href={channel.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline block"
                >
                  {channel.websiteUrl}
                </a>
              )}
              {channel.socialLinks?.twitter && (
                <a
                  href={channel.socialLinks.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline block"
                >
                  {isRTL ? 'تويتر' : 'Twitter'}: {channel.socialLinks.twitter}
                </a>
              )}
              {channel.socialLinks?.facebook && (
                <a
                  href={channel.socialLinks.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline block"
                >
                  {isRTL ? 'فيسبوك' : 'Facebook'}: {channel.socialLinks.facebook}
                </a>
              )}
              {channel.socialLinks?.instagram && (
                <a
                  href={channel.socialLinks.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline block"
                >
                  {isRTL ? 'إنستغرام' : 'Instagram'}: {channel.socialLinks.instagram}
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Channel Details */}
      <section>
        <h2 className={cn(
          'text-xl font-semibold mb-4',
          isRTL ? 'text-right' : 'text-left'
        )}>
          {isRTL ? 'تفاصيل القناة' : 'Channel Details'}
        </h2>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className={cn(
            'space-y-3',
            isRTL ? 'text-right' : 'text-left'
          )}>
            <DetailRow
              label={isRTL ? 'المعرف' : 'Channel ID'}
              value={channel.id}
              isRTL={isRTL}
            />
            {channel.category && (
              <DetailRow
                label={isRTL ? 'الفئة' : 'Category'}
                value={channel.category}
                isRTL={isRTL}
              />
            )}
            {channel.tags && channel.tags.length > 0 && (
              <div className={cn(
                'flex gap-2',
                isRTL ? 'flex-row-reverse' : 'flex-row'
              )}>
                <span className="font-medium text-gray-700">
                  {isRTL ? 'الوسوم:' : 'Tags:'}
                </span>
                <div className={cn(
                  'flex flex-wrap gap-2',
                  isRTL ? 'flex-row-reverse' : 'flex-row'
                )}>
                  {channel.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-gray-100 text-gray-700 text-sm rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  isRTL: boolean;
}

function StatCard({ label, value, isRTL }: StatCardProps) {
  return (
    <div className={cn(
      'bg-white p-4 rounded-lg border',
      isRTL ? 'text-right' : 'text-left'
    )}>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-sm text-gray-600">{label}</div>
    </div>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  isRTL: boolean;
}

function DetailRow({ label, value, isRTL }: DetailRowProps) {
  return (
    <div className={cn(
      'flex gap-2',
      isRTL ? 'flex-row-reverse' : 'flex-row'
    )}>
      <span className="font-medium text-gray-700">{label}:</span>
      <span className="text-gray-600">{value}</span>
    </div>
  );
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

function formatDate(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
