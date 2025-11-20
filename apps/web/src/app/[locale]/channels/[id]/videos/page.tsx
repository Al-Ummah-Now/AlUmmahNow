import { getChannelById } from '@/lib/api/channels';
import { listVideos } from '@/lib/api/videos';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { getTranslations } from '@/lib/i18n';

interface ChannelVideosPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
  searchParams: Promise<{
    sort?: 'latest' | 'popular' | 'oldest';
  }>;
}

export default async function ChannelVideosPage({
  params,
  searchParams,
}: ChannelVideosPageProps) {
  const { locale, id } = await params;
  const { sort } = await searchParams;

  const channel = await getChannelById(id);

  if (!channel) {
    notFound();
  }

  const isRTL = locale === 'ar';
  const sortParam = sort || 'latest';
  const t = getTranslations(locale as 'en' | 'ar');

  const videosData = await listVideos({
    channelId: id,
    limit: 30,
  });

  const videos = videosData?.data || [];

  return (
    <div className="space-y-6">
      {/* Sort Filters */}
      <div className={cn(
        'flex gap-4',
        isRTL ? 'flex-row-reverse' : 'flex-row'
      )}>
        <SortButton
          sort="latest"
          currentSort={sortParam}
          locale={locale}
          channelId={id}
          t={t}
        />
        <SortButton
          sort="popular"
          currentSort={sortParam}
          locale={locale}
          channelId={id}
          t={t}
        />
        <SortButton
          sort="oldest"
          currentSort={sortParam}
          locale={locale}
          channelId={id}
          t={t}
        />
      </div>

      {/* Video Grid */}
      {videos.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          <p className="text-gray-500 text-lg">
            {t.video.noVideosAvailable}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {videos.map((video) => (
            <Link
              key={video.id}
              href={`/${locale}/watch?v=${video.id}`}
              className="group"
            >
              <div className="bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                {/* Thumbnail */}
                <div className="relative aspect-video bg-gray-200">
                  {video.thumbnailUrl ? (
                    <Image
                      src={video.thumbnailUrl}
                      alt={video.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Video Info */}
                <div className="p-3">
                  <h3 className={cn(
                    'font-medium text-sm line-clamp-2 mb-1 text-gray-900',
                    isRTL ? 'text-right' : 'text-left'
                  )}>
                    {video.title}
                  </h3>
                  <div className={cn(
                    'text-xs text-gray-600 space-y-1',
                    isRTL ? 'text-right' : 'text-left'
                  )}>
                    <p>{formatViews(video.views || 0, t)}</p>
                    <p>{formatDate(video.dateCreated, t)}</p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

interface SortButtonProps {
  sort: 'latest' | 'popular' | 'oldest';
  currentSort: string;
  locale: string;
  channelId: string;
  t: ReturnType<typeof getTranslations>;
}

function SortButton({ sort, currentSort, locale, channelId, t }: SortButtonProps) {
  const isActive = currentSort === sort;
  const labelMap = {
    latest: t.video.latest,
    popular: t.video.popular,
    oldest: t.video.oldest,
  };

  const label = labelMap[sort];

  return (
    <Link
      href={`/${locale}/channels/${channelId}/videos?sort=${sort}`}
      className={cn(
        'px-4 py-2 rounded-full text-sm font-medium transition-colors',
        isActive
          ? 'bg-blue-600 text-white'
          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
      )}
    >
      {label}
    </Link>
  );
}

function formatViews(views: number, t: ReturnType<typeof getTranslations>): string {
  const formatted = views.toLocaleString();
  const viewText = views === 1 ? t.video.view : t.video.views;
  return `${formatted} ${viewText}`;
}

function formatDate(dateStr: string, t: ReturnType<typeof getTranslations>): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t.video.today;
  if (diffDays === 1) return t.video.yesterday;
  if (diffDays < 7) return t.video.daysAgo.replace('{count}', diffDays.toString());
  if (diffDays < 30) return t.video.weeksAgo.replace('{count}', Math.floor(diffDays / 7).toString());
  if (diffDays < 365) return t.video.monthsAgo.replace('{count}', Math.floor(diffDays / 30).toString());
  return t.video.yearsAgo.replace('{count}', Math.floor(diffDays / 365).toString());
}
