'use client';

/**
 * Explore page sections (Story 29.7), shared by the LTR and RTL variants.
 * Rails scroll horizontally on small screens; spacing uses logical properties.
 */

import React from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Baby,
  BookOpen,
  BookOpenText,
  Flame,
  GraduationCap,
  Heart,
  Landmark,
  MapPin,
  Megaphone,
  Mic,
  Moon,
  Music,
  Newspaper,
  Radio,
  Scale,
  ScrollText,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ExploreCategory, LiveStream, SearchChannelPayload, SeasonalRail, VideoObject } from '@al-ummah/shared-types';
import VideoCard from '@/components/videoCard/index';
import { ChannelTile } from '@/components/ChannelTile';
import { useLanguage } from '@/hooks/useLanguage';
import { searchVideoToVideoObject } from '@/lib/search/mappers';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  quran_recitation: BookOpenText,
  quran_tafsir: BookOpen,
  hadith_studies: ScrollText,
  islamic_history: Landmark,
  fiqh: Scale,
  aqeedah: Sparkles,
  dawah: Megaphone,
  khutbah: Mic,
  islamic_lectures: GraduationCap,
  islamic_nasheed: Music,
  islamic_kids: Baby,
  islamic_news: Newspaper,
  hajj_umrah: MapPin,
  ramadan: Moon,
  islamic_lifestyle: Heart,
};

export function SectionHeader({ id, icon: Icon, title, subtitle, action }: { id: string; icon: LucideIcon; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
          <Icon className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </h2>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function Rail({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <ul data-testid={testId} className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </ul>
  );
}

function RailItem({ children }: { children: React.ReactNode }) {
  return <li className="w-72 shrink-0 snap-start sm:w-auto">{children}</li>;
}

export function SectionError({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <div role="alert" className="flex items-center gap-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-800 dark:text-red-200">
      <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="flex-1">{t.explore.sectionFailed}</span>
      <button type="button" onClick={onRetry} className="rounded-full border border-current px-3 py-1 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        {t.explore.retry}
      </button>
    </div>
  );
}

export function RailSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="mb-2 aspect-video rounded-lg bg-gray-200 dark:bg-gray-800" />
          <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-800" />
        </div>
      ))}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-gray-50 dark:bg-gray-900 p-4 text-sm text-gray-500 dark:text-gray-400">{children}</p>;
}

export function TrendingSection({ videos, fallback }: { videos: VideoObject[]; fallback: boolean }) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="explore-trending" data-testid="explore-trending">
      <SectionHeader id="explore-trending" icon={Flame} title={fallback ? t.explore.popularFallback : t.explore.trending} />
      {videos.length === 0 ? (
        <EmptyNote>{t.explore.noTrending}</EmptyNote>
      ) : (
        <Rail testId="explore-trending-list">
          {videos.map(video => <RailItem key={video.id}><VideoCard {...video} /></RailItem>)}
        </Rail>
      )}
    </section>
  );
}

/** Explore never shows an empty category tile (the API filters too; this guards older responses). */
export function visibleCategories(categories: ExploreCategory[]): ExploreCategory[] {
  return categories.filter(category => category.count > 0);
}

export function CategoryGrid({ categories: all }: { categories: ExploreCategory[] }) {
  const { t, lang } = useLanguage();
  const categories = visibleCategories(all);
  if (!categories.length) return null;
  return (
    <section aria-labelledby="explore-categories" data-testid="explore-categories">
      <SectionHeader id="explore-categories" icon={BookOpen} title={t.explore.categories} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {categories.map(category => {
          const Icon = CATEGORY_ICONS[category.value] ?? BookOpen;
          const label = lang === 'ar' ? category.label.ar : category.label.en;
          return (
            <li key={category.value}>
              <Link
                href={`/${lang}/search?type=video&category=${encodeURIComponent(category.value)}`}
                data-testid="explore-category"
                data-category={category.value}
                data-count={category.count}
                aria-label={t.explore.browseCategory.replace('{category}', label)}
                className="flex h-full items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 hover:border-blue-400 hover:shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{label}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {t.explore.categoryVideos.replace('{count}', new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en').format(category.count))}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function LiveNowSection({
  streams,
  loading,
  error,
  onRetry,
  renderCard,
}: {
  streams: LiveStream[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  renderCard: (stream: LiveStream) => React.ReactNode;
}) {
  const { t, lang } = useLanguage();
  return (
    <section aria-labelledby="explore-live" data-testid="explore-live">
      <SectionHeader
        id="explore-live"
        icon={Radio}
        title={t.explore.liveNow}
        action={<Link href={`/${lang}/live`} className="shrink-0 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">{t.explore.viewAll}</Link>}
      />
      {loading ? <RailSkeleton /> : error ? <SectionError onRetry={onRetry} /> : streams.length === 0 ? (
        <EmptyNote>{t.explore.noLive}</EmptyNote>
      ) : (
        <Rail testId="explore-live-list">
          {streams.map(stream => <RailItem key={stream.id}>{renderCard(stream)}</RailItem>)}
        </Rail>
      )}
    </section>
  );
}

export function NewChannelsSection({ channels }: { channels: SearchChannelPayload[] }) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="explore-new-channels" data-testid="explore-new-channels">
      <SectionHeader id="explore-new-channels" icon={Users} title={t.explore.newChannels} />
      {channels.length === 0 ? <EmptyNote>{t.explore.noNewChannels}</EmptyNote> : (
        <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
          {channels.map(channel => (
            <li key={channel.id} className="w-40 shrink-0 sm:w-auto">
              <ChannelTile channel={channel} variant="compact" className="h-full" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SeasonalSection({ rail }: { rail: SeasonalRail }) {
  const { t, lang } = useLanguage();
  const title = lang === 'ar' ? rail.title.ar : rail.title.en;
  const subtitle = (lang === 'ar' ? rail.subtitle?.ar : rail.subtitle?.en) || undefined;
  const ends = new Date(rail.endsAt);
  const until = Number.isNaN(ends.getTime())
    ? undefined
    : t.explore.seasonalUntil.replace('{date}', ends.toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { day: 'numeric', month: 'long' }));
  if (rail.videos.length === 0) return null;
  return (
    <section aria-labelledby={`explore-seasonal-${rail.id}`} data-testid="explore-seasonal" data-rail-id={rail.id}>
      <SectionHeader id={`explore-seasonal-${rail.id}`} icon={Moon} title={title} subtitle={[subtitle, until].filter(Boolean).join(' · ')} />
      <Rail testId="explore-seasonal-list">
        {rail.videos.map(video => <RailItem key={video.id}><VideoCard {...searchVideoToVideoObject(video)} /></RailItem>)}
      </Rail>
    </section>
  );
}
