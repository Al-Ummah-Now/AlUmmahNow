'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { RelativeDate } from '@/components/RelativeDate';
import { formatAbsoluteDateTime, publishedDateOf, type MetaLang } from '@/lib/format/videoMeta';

export interface DatedVideo {
  isLive?: boolean | null;
  publishedAt?: string | null;
  dateCreated?: string | Date | null;
  scheduledPublishDate?: string | null;
  scheduledPublishStatus?: string | null;
}

/** Scheduled and not out yet. */
export function isScheduledAhead(video: DatedVideo, now = Date.now()): boolean {
  if (video.scheduledPublishStatus !== 'scheduled' || !video.scheduledPublishDate) return false;
  const at = new Date(video.scheduledPublishDate).getTime();
  return Number.isFinite(at) && at > now;
}

/**
 * A video's date with what it is, for the line beside its views: «يُبث مباشرة الآن» while live,
 * «مجدول في …» before a scheduled release, else «نُشر قبل …» / "Published …" (publishedAt, else
 * the upload date).
 */
export function VideoDate({ video, lang }: { video: DatedVideo; lang: MetaLang }) {
  const { t } = useLanguage();
  const labels = t.video?.dateLabel;
  if (video.isLive) return <span className="video-date-live">{labels?.liveNow ?? 'Live now'}</span>;
  if (isScheduledAhead(video)) {
    const exact = formatAbsoluteDateTime(video.scheduledPublishDate, lang);
    return <time className="rel-date" dateTime={new Date(video.scheduledPublishDate!).toISOString()} title={exact}>{(labels?.scheduled ?? '{date}').replace('{date}', exact)}</time>;
  }
  return <RelativeDate value={publishedDateOf(video)} lang={lang} label="published" />;
}
