'use client';

import React from 'react';
import Link from 'next/link';
import VideoThumbnail, { THUMBNAIL_16_9 } from '@/components/VideoThumbnail';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { removeUnwantedChars } from '@/lib/utility';

export interface LibraryTileVideo {
  id: string;
  title?: string;
  titleLocalized?: Record<string, string>;
  thumbnailUrl?: string | null;
  channelName?: string;
  channel?: string;
  duration?: number;
  /** Share watched, 0-100: shows a progress bar under the thumbnail */
  percentWatched?: number;
}

function formatDuration(seconds: number | undefined, locale: string): string | null {
  if (!seconds || seconds <= 0) return null;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => n.toLocaleString(locale, { minimumIntegerDigits: 2 });
  return h > 0 ? `${h.toLocaleString(locale)}:${pad(m)}:${pad(s)}` : `${m.toLocaleString(locale)}:${pad(s)}`;
}

/** Compact video tile used by the Library hub and lists. */
export function LibraryVideoTile({ video, subtitle, testId = 'library-video' }: { video: LibraryTileVideo; subtitle?: string; testId?: string }) {
  const { lang, t } = useLanguage();
  const percent =
    typeof video.percentWatched === 'number' && Number.isFinite(video.percentWatched)
      ? Math.min(100, Math.max(0, Math.round(video.percentWatched)))
      : null;
  const title = removeUnwantedChars(getLocalizedValue(video.titleLocalized, video.title || '', lang));
  const duration = formatDuration(video.duration, lang);
  return (
    <Link
      href={`/${lang}/video?vid=${encodeURIComponent(video.id)}`}
      data-testid={testId}
      data-video-id={video.id}
      className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <div className="relative overflow-hidden rounded-lg">
        <VideoThumbnail src={video.thumbnailUrl} alt={title} style={THUMBNAIL_16_9} />
        {duration && (
          <span className="absolute bottom-1 end-1 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white" dir="ltr">
            {duration}
          </span>
        )}
        {percent !== null && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t.library.watchedPercent.replace('{percent}', percent.toLocaleString(lang))}
            data-testid="library-video-progress"
            className="absolute inset-x-0 bottom-0 h-1 bg-gray-300/80"
          >
            <div className="h-full bg-red-600" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-medium text-gray-900 group-hover:underline dark:text-white">{title}</p>
      {(video.channelName || video.channel) && (
        <p className="truncate text-xs text-gray-600 dark:text-gray-400">{video.channelName || video.channel}</p>
      )}
      {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
    </Link>
  );
}

export default LibraryVideoTile;
