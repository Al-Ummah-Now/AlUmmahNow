'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { RelativeDate } from '@/components/RelativeDate';
import { formatAbsoluteDate, formatAbsoluteDateTime, formatViews, formatViewsExact, publishedDateOf, type MetaLang } from '@/lib/format/videoMeta';

export interface DatedVideo {
  isLive?: boolean | null;
  /** Premiere fields (shared-types VideoObject): its date is the premiere's */
  isPremiered?: boolean | null;
  premiereDate?: string | null;
  publishedAt?: string | null;
  dateCreated?: string | Date | null;
  scheduledPublishDate?: string | null;
  scheduledPublishStatus?: string | null;
  /** Brought from YouTube by its creator (wiki AUN-YT-IMPORT) */
  importedFrom?: { platform?: string; publishedAt?: string | null } | null;
}

/** The YouTube publish date of an imported video, or null. */
export function youtubeOriginDate(video: DatedVideo): string | null {
  const at = video.importedFrom?.platform === 'youtube' ? video.importedFrom.publishedAt : null;
  return at && Number.isFinite(Date.parse(at)) ? at : null;
}

/** Scheduled and not out yet. */
export function isScheduledAhead(video: DatedVideo, now = Date.now()): boolean {
  if (video.scheduledPublishStatus !== 'scheduled' || !video.scheduledPublishDate) return false;
  const at = new Date(video.scheduledPublishDate).getTime();
  return Number.isFinite(at) && at > now;
}

/**
 * A video's date for the line beside its views, as YouTube shows it: «يُبث مباشرة الآن» while live
 * and «مجدول في …» before a scheduled release (visible labels); otherwise just the relative time
 * («قبل يوم واحد»), its tooltip saying what the date is with a verb and the exact date and time:
 * «نُشر في …» / "Published on …" (publishedAt, else the upload date), «عُرض لأول مرة في …» /
 * "Premiered on …" for a premiere.
 */
export function VideoDate({ video, lang }: { video: DatedVideo; lang: MetaLang }) {
  const { t } = useLanguage();
  const labels = t.video?.dateLabel;
  if (video.isLive) return <span className="video-date-live">{labels?.liveNow ?? 'Live now'}</span>;
  if (isScheduledAhead(video)) {
    const exact = formatAbsoluteDateTime(video.scheduledPublishDate, lang);
    return <time className="rel-date" dateTime={new Date(video.scheduledPublishDate!).toISOString()} title={exact}>{(labels?.scheduled ?? '{date}').replace('{date}', exact)}</time>;
  }
  // The tooltip's verb follows the kind of video (YouTube style): a premiere «عُرض لأول مرة في …» /
  // "Premiered on …", any other upload «نُشر في …» / "Published on …". Past live streams are not
  // video records yet; "Streamed live on …" maps here once they are.
  if (video.isPremiered && video.premiereDate) return <RelativeDate value={video.premiereDate} lang={lang} label="premiered" />;
  return <RelativeDate value={publishedDateOf(video)} lang={lang} label="published" />;
}

/** The compact view count ("1.2K views"), its exact count as the tooltip ("1,234 views"). */
export function ViewCount({ count, lang }: { count: number | string | null | undefined; lang: MetaLang }) {
  return <span title={formatViewsExact(count, lang)}>{formatViews(count, lang)}</span>;
}

/** What the video's date is, with the exact value: «نُشر في …», «عُرض لأول مرة في …», «مجدول في …». */
function labelledDate(video: DatedVideo, lang: MetaLang, labels: Record<string, string> | undefined): string {
  if (isScheduledAhead(video)) return (labels?.scheduled ?? '{date}').replace('{date}', formatAbsoluteDateTime(video.scheduledPublishDate, lang));
  if (video.isPremiered && video.premiereDate) return (labels?.premiered ?? '{date}').replace('{date}', formatAbsoluteDateTime(video.premiereDate, lang));
  return (labels?.published ?? '{date}').replace('{date}', formatAbsoluteDateTime(publishedDateOf(video), lang));
}

const SEP = ' • ';

/**
 * The watch page's collapsed description line, YouTube style: "6 views • 1 day ago". Hovering it,
 * or focusing it with the keyboard, shows the exact count and what the date is
 * («1,234 مشاهدة • نُشر في 12 نوفمبر 2026، 06:32 م»); screen readers get that text through
 * aria-describedby.
 */
export function WatchMetaSummary({ video, views, lang, describedById }: { video: DatedVideo; views: number | string | null | undefined; lang: MetaLang; describedById: string }) {
  const { t } = useLanguage();
  const labels = t.video?.dateLabel as Record<string, string> | undefined;
  const origin = youtubeOriginDate(video);
  const tip = `${formatViewsExact(views, lang)}${SEP}${labelledDate(video, lang, labels)}${origin ? `${SEP}${fromYoutubeText(origin, lang, labels)}` : ''}`;
  return (
    <summary title={tip} data-tip={tip} aria-describedby={describedById}>
      <span>{formatViews(views, lang)}</span>
      <span aria-hidden="true">•</span>
      <VideoDate video={video} lang={lang} />
      {origin && (
        <>
          <span aria-hidden="true">•</span>
          <span className="watch-origin" data-testid="watch-origin-short">{labels?.fromYoutubeShort ?? 'Originally on YouTube'}</span>
        </>
      )}
      <span id={describedById} hidden>{tip}</span>
    </summary>
  );
}

/** "Originally published on YouTube on 3 March 2021" (the date only: YouTube's time is not ours to show). */
function fromYoutubeText(at: string, lang: MetaLang, labels: Record<string, string> | undefined): string {
  return (labels?.fromYoutube ?? 'Originally published on YouTube on {date}').replace('{date}', formatAbsoluteDate(at, lang));
}

/** The expanded description's first line: the full count and what the date is, exact; an imported video says where it first came out. */
export function WatchMetaDetail({ video, views, lang }: { video: DatedVideo; views: number | string | null | undefined; lang: MetaLang }) {
  const { t } = useLanguage();
  const labels = t.video?.dateLabel as Record<string, string> | undefined;
  const origin = youtubeOriginDate(video);
  return (
    <>
      <p className="watch-desc-date" data-testid="watch-published">
        {formatViewsExact(views, lang)}{SEP}{labelledDate(video, lang, labels)}
      </p>
      {origin && (
        <p className="watch-desc-origin" data-testid="watch-origin">
          {fromYoutubeText(origin, lang, labels)}
        </p>
      )}
    </>
  );
}
