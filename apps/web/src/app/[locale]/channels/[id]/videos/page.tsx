import { getChannelById } from '@/lib/api/channels';
import { listVideos } from '@/lib/api/videos';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface ChannelVideosPageProps {
  params: {
    locale: string;
    id: string;
  };
  searchParams: {
    sort?: 'latest' | 'popular' | 'oldest';
  };
}

export default async function ChannelVideosPage({
  params,
  searchParams,
}: ChannelVideosPageProps) {
  const channel = await getChannelById(params.id);

  if (!channel) {
    notFound();
  }

  const isRTL = params.locale === 'ar';
  const sortParam = searchParams.sort || 'latest';

  const videosData = await listVideos({
    channelId: params.id,
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
          locale={params.locale}
          channelId={params.id}
        />
        <SortButton
          sort="popular"
          currentSort={sortParam}
          locale={params.locale}
          channelId={params.id}
        />
        <SortButton
          sort="oldest"
          currentSort={sortParam}
          locale={params.locale}
          channelId={params.id}
        />
      </div>

      {/* Video Grid */}
      {videos.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          <p className="text-gray-500 text-lg">
            {isRTL ? 'لا توجد فيديوهات' : 'No videos available'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {videos.map((video) => (
            <Link
              key={video.id}
              href={`/${params.locale}/watch?v=${video.id}`}
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
                    <p>{formatViews(video.views || 0, isRTL)}</p>
                    <p>{formatDate(video.dateCreated, isRTL)}</p>
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
}

function SortButton({ sort, currentSort, locale, channelId }: SortButtonProps) {
  const isActive = currentSort === sort;
  const labels = {
    en: {
      latest: 'Latest',
      popular: 'Popular',
      oldest: 'Oldest',
    },
    ar: {
      latest: 'الأحدث',
      popular: 'الأكثر شعبية',
      oldest: 'الأقدم',
    },
  };

  const label = labels[locale as 'en' | 'ar']?.[sort] || labels.en[sort];

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

function formatViews(views: number, isRTL: boolean): string {
  const formatted = views.toLocaleString();
  return isRTL ? `${formatted} مشاهدة` : `${formatted} views`;
}

function formatDate(dateStr: string, isRTL: boolean): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (isRTL) {
    if (diffDays === 0) return 'اليوم';
    if (diffDays === 1) return 'أمس';
    if (diffDays < 7) return `منذ ${diffDays} أيام`;
    if (diffDays < 30) return `منذ ${Math.floor(diffDays / 7)} أسابيع`;
    if (diffDays < 365) return `منذ ${Math.floor(diffDays / 30)} أشهر`;
    return `منذ ${Math.floor(diffDays / 365)} سنوات`;
  }

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}
