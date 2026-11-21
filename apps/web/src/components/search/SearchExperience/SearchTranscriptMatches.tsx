'use client';

/**
 * "Said in videos" (AUN-CAPTIONS §5.10): on the first page of a text search, the videos whose
 * published captions say the words, each with the passage and the time it starts. Each row opens
 * the watch page there (`?t=` seconds). Matching words are marked in the passage.
 */

import React from 'react';
import Link from '@/components/common/AppLink';
import { Captions, Play } from 'lucide-react';
import { getLocalizedValue, normalizeSearchText, tokenizeSearchText, type SearchTranscriptMatch, formatClock } from '@al-ummah/shared-types';
import VideoThumbnail from '@/components/VideoThumbnail';
import { useLanguage } from '@/hooks/useLanguage';
import { removeUnwantedChars } from '@/lib/utility';
import { channelLabel } from '@/lib/channel-name';
import { SUPPORTED_LANGUAGES } from '@/lib/api/subtitles-types';

import { MetaSep } from '@/components/ui/MetaSep';
/** `M:SS` or `H:MM:SS` from milliseconds (0:00 at the start). */
export function passageTime(ms: number, lang = 'en'): string {
  return formatClock(lang, Math.max(0, Math.floor(ms / 1000)));
}

/** The passage split into words, with the ones that match a searched word flagged. */
export function markPassage(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const tokens = tokenizeSearchText(query);
  if (!tokens.length) return [{ text, hit: false }];
  return text.split(/(\s+)/).filter(Boolean).map((part) => {
    const words = normalizeSearchText(part).split(' ').filter(Boolean);
    return { text: part, hit: words.some((w) => tokens.some((t) => w.startsWith(t) || (w.length > 2 && t.startsWith(w)))) };
  });
}

const fill = (template: string, values: Record<string, string>) => Object.entries(values).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), template);

export function SearchTranscriptMatches({ matches, query }: { matches: SearchTranscriptMatch[]; query: string }) {
  const { t, lang } = useLanguage();
  if (!matches.length) return null;
  const languageName = (code: string) => {
    const known = SUPPORTED_LANGUAGES.find((l) => l.code === code.split('-')[0]);
    return known ? (lang === 'ar' ? known.nameAr : known.name) : code;
  };

  return (
    <section aria-labelledby="search-transcripts-title" data-testid="search-transcripts" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <Captions className="mt-0.5 h-5 w-5 shrink-0 text-brand-ink" aria-hidden="true" />
        <div>
          <h2 id="search-transcripts-title" className="text-base font-semibold text-foreground">{t.search.saidInVideos}</h2>
          <p className="text-sm text-muted-foreground">{t.search.saidInVideosHint}</p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {matches.map((m) => {
          const title = removeUnwantedChars(getLocalizedValue(m.video.titleLocalized, m.video.title, lang));
          const time = passageTime(m.startMs, lang);
          const otherLanguage = m.language.split('-')[0] !== lang;
          return (
            <li key={m.videoId} data-testid="search-transcript" data-video-id={m.videoId} data-start-ms={m.startMs}>
              <Link
                href={`/${lang}/video/${encodeURIComponent(m.videoId)}?t=${Math.floor(m.startMs / 1000)}`}
                className="group flex gap-3 rounded-lg p-2 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="relative w-36 shrink-0 overflow-hidden rounded-md sm:w-44">
                  <VideoThumbnail src={m.video.thumbnailUrl ?? ''} alt="" className="aspect-video h-auto w-full" />
                  <span dir="ltr" className="absolute bottom-1 end-1 inline-flex items-center gap-1 rounded bg-background/90 px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground">
                    <Play className="h-3 w-3" aria-hidden="true" />
                    {time}
                  </span>
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p dir="auto" className="line-clamp-2 text-sm font-semibold text-foreground">{title}</p>
                  <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <span className="shrink-0">{fill(t.search.saidAt, { time })}</span>
                    <MetaSep lang={lang} en="·" gap="0.25rem" />
                    <span dir="auto" className="truncate">
                      {channelLabel({ channelName: m.channel?.name ?? m.video.channelName ?? '', channelNameLocalized: m.channel?.nameLocalized ?? m.video.channelNameLocalized }, lang)}
                    </span>
                  </p>
                  <blockquote dir="auto" lang={m.language} data-testid="search-transcript-text" className="line-clamp-3 border-s-2 border-brand ps-2 text-sm text-foreground">
                    {markPassage(m.text, query).map((part, i) =>
                      part.hit ? (
                        <mark key={i} className="rounded-sm bg-brand-soft px-0.5 text-brand-ink">{part.text}</mark>
                      ) : (
                        <React.Fragment key={i}>{part.text}</React.Fragment>
                      ),
                    )}
                  </blockquote>
                  {otherLanguage && <p className="text-xs text-muted-foreground">{fill(t.search.fromCaptions, { language: languageName(m.language) })}</p>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
