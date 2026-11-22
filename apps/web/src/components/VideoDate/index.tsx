'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { RelativeDate } from '@/components/RelativeDate';
import type { ReactNode } from 'react';
import { formatAbsoluteDate, formatAbsoluteDateTime, formatViews, formatViewsExact, publishedDateOf, type MetaLang } from '@/lib/format/videoMeta';

import { metaSeparator } from '@/lib/i18n/meta-separator';
import { MetaSep } from '@/components/ui/MetaSep';
export interface DatedVideo {
  isLive?: boolean | null;
  /** Premiere fields (shared-types VideoObject): its date is the premiere's */
  isPremiered?: boolean | null;
  premiereDate?: string | null;
  publishedAt?: string | null;
  dateCreated?: string | Date | null;
  scheduledPublishDate?: string | null;
  scheduledPublishStatus?: string | null;
  /** Brought from YouTube by its creator (wiki AUN-YT-IMPORT), or from a social source (TOOLS-ADMIN TA-9) */
  importedFrom?: ImportOriginFields | null;
}

/** Where an imported video or post first came out: YouTube's publishedAt, a social source's postedAt and url. */
export interface ImportOriginFields {
  platform?: string;
  publishedAt?: string | null;
  postedAt?: string | null;
  url?: string | null;
}

/** The YouTube publish date of an imported video, or null. */
export function youtubeOriginDate(video: DatedVideo): string | null {
  const at = video.importedFrom?.platform === 'youtube' ? video.importedFrom.publishedAt : null;
  return at && Number.isFinite(Date.parse(at)) ? at : null;
}

const SOURCE_NETWORKS = ['rss', 'bluesky', 'mastodon', 'telegram'] as const;
export type SourceNetwork = (typeof SOURCE_NETWORKS)[number];

/** A social source's origin (network, first posted, the original's https link), or null. */
export function sourceOrigin(from: ImportOriginFields | null | undefined): { network: SourceNetwork; at: string; url: string | null } | null {
  const network = SOURCE_NETWORKS.find((n) => n === from?.platform);
  const at = from?.postedAt;
  if (!network || !at || !Number.isFinite(Date.parse(at))) return null;
  // Only a web link is ever rendered as one
  const url = from?.url && /^https:\/\//i.test(from.url) ? from.url : null;
  return { network, at, url };
}

type DateLabels = Record<string, string | Record<string, string>> | undefined;
const text = (labels: DateLabels, key: string, fallback: string) => (typeof labels?.[key] === 'string' ? (labels[key] as string) : fallback);

/** "Originally posted on Mastodon on 10 November 2026" (the date only, as for YouTube). */
export function fromSourceText(origin: { network: SourceNetwork; at: string }, lang: MetaLang, labels: DateLabels): string {
  return fromSourceTemplate(origin, labels).replace('{date}', formatAbsoluteDate(origin.at, lang));
}

/** "Originally posted on Mastodon on {date}": the network filled in, the date still to come. */
function fromSourceTemplate(origin: { network: SourceNetwork }, labels: DateLabels): string {
  return text(labels, 'fromSource', 'Originally posted on {network} on {date}').replace('{network}', sourceNetworkName(origin.network, labels));
}

/** "Originally on Mastodon" */
export function fromSourceShortText(origin: { network: SourceNetwork }, labels: DateLabels): string {
  return text(labels, 'fromSourceShort', 'Originally on {network}').replace('{network}', sourceNetworkName(origin.network, labels));
}

function sourceNetworkName(network: SourceNetwork, labels: DateLabels): string {
  const names = labels?.sourceNetworks;
  const fallback: Record<SourceNetwork, string> = { rss: 'their website', bluesky: 'Bluesky', mastodon: 'Mastodon', telegram: 'Telegram' };
  return (typeof names === 'object' && names?.[network]) || fallback[network];
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
  const [template, date] = labelledDateParts(video, lang, labels);
  return template.replace('{date}', date);
}

/** The template ("Published on {date}") and the exact date it takes. */
function labelledDateParts(video: DatedVideo, lang: MetaLang, labels: Record<string, string> | undefined): [string, string] {
  if (isScheduledAhead(video)) return [labels?.scheduled ?? '{date}', formatAbsoluteDateTime(video.scheduledPublishDate, lang)];
  if (video.isPremiered && video.premiereDate) return [labels?.premiered ?? '{date}', formatAbsoluteDateTime(video.premiereDate, lang)];
  return [labels?.published ?? '{date}', formatAbsoluteDateTime(publishedDateOf(video), lang)];
}

/** A template with its date kept on one line: a narrow screen wraps before the date, never inside it. */
function wholeDate(template: string, date: string): ReactNode {
  const at = template.indexOf('{date}');
  if (at < 0) return template;
  return (
    <>
      {template.slice(0, at)}
      <span className="whitespace-nowrap">{date}</span>
      {template.slice(at + '{date}'.length)}
    </>
  );
}

/**
 * The watch page's collapsed description line, YouTube style: "6 views • 1 day ago". Hovering it,
 * or focusing it with the keyboard, shows the exact count and what the date is
 * («1,234 مشاهدة، نُشر في 12 نوفمبر 2026، 06:32 م»); screen readers get that text through
 * aria-describedby.
 */
export function WatchMetaSummary({ video, views, lang, describedById }: { video: DatedVideo; views: number | string | null | undefined; lang: MetaLang; describedById: string }) {
  const { t } = useLanguage();
  const labels = t.video?.dateLabel as unknown as Record<string, string> | undefined;
  const origin = youtubeOriginDate(video);
  const social = origin ? null : sourceOrigin(video.importedFrom);
  const originText = origin ? fromYoutubeText(origin, lang, labels) : social ? fromSourceText(social, lang, labels) : null;
  const tip = `${formatViewsExact(views, lang)}${metaSeparator(lang)}${labelledDate(video, lang, labels)}${originText ? `${metaSeparator(lang)}${originText}` : ''}`;
  return (
    <summary title={tip} data-tip={tip} aria-describedby={describedById}>
      {/* Each part keeps its separator after it and never breaks inside, so a narrow screen wraps whole
          parts and the separator ends the line («،» stays with the word before it) */}
      <span className="watch-meta-part">{formatViews(views, lang)}<MetaSep lang={lang} gap="6px" /></span>
      <span className="watch-meta-part">
        <VideoDate video={video} lang={lang} />
        {(origin || social) && <MetaSep lang={lang} gap="6px" className="watch-origin-sep" />}
      </span>
      {(origin || social) && (
        <span className="watch-meta-part watch-origin" data-testid="watch-origin-short">{origin ? (labels?.fromYoutubeShort ?? 'Originally on YouTube') : fromSourceShortText(social!, labels)}</span>
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
  const labels = t.video?.dateLabel as unknown as Record<string, string> | undefined;
  const origin = youtubeOriginDate(video);
  const social = origin ? null : sourceOrigin(video.importedFrom);
  return (
    <>
      <p className="watch-desc-date" data-testid="watch-published">
        {formatViewsExact(views, lang)}{metaSeparator(lang)}{wholeDate(...labelledDateParts(video, lang, labels))}
      </p>
      {origin && (
        <p className="watch-desc-origin" data-testid="watch-origin">
          {wholeDate(labels?.fromYoutube ?? 'Originally published on YouTube on {date}', formatAbsoluteDate(origin, lang))}
        </p>
      )}
      {social && (
        <p className="watch-desc-origin" data-testid="watch-origin">
          {social.url ? (
            <a href={social.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="hover:underline focus-visible:underline">
              {wholeDate(fromSourceTemplate(social, labels), formatAbsoluteDate(social.at, lang))}
            </a>
          ) : (
            wholeDate(fromSourceTemplate(social, labels), formatAbsoluteDate(social.at, lang))
          )}
        </p>
      )}
    </>
  );
}
