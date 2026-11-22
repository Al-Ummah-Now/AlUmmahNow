'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatInteger } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/hooks/useLanguage';
import { getChannelCommentSummary, type StudioCommentSummary } from '@/lib/api/studio-comments';
import { formatRelativeTime } from '@/lib/format/videoMeta';
import { logger } from '@/lib/logger-client';
import { OnTitle } from '@/components/studio/comments/OnTitle';

/** Dashboard: the latest comments and how many wait for review, linking to Comments (spec §4.3). */
export function RecentComments({ locale, channelId }: { locale: string; channelId: string }) {
  const { t } = useLanguage();
  const text = t.studio.dashboard;
  const lang = locale === 'ar' ? 'ar' : 'en';
  const [summary, setSummary] = useState<StudioCommentSummary | null | 'failed'>(null);
  const base = `/${locale}/studio/${encodeURIComponent(channelId)}/comments`;

  const load = useCallback(async () => {
    setSummary(null);
    const result = await getChannelCommentSummary(channelId).catch(() => null);
    if (!result) logger.error('[Studio] Dashboard comments card failed', { channelId });
    setSummary(result ?? 'failed');
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (summary === null) return <Skeleton className="h-24 w-full" />;
  if (summary === 'failed') {
    return (
      <div>
        <p className="mb-2 text-sm text-muted-foreground">{text.cardFailed}</p>
        <Button variant="outline" className="min-h-11" onClick={() => void load()}>{text.retry}</Button>
      </div>
    );
  }

  return (
    <div data-testid="studio-dash-comments-body">
      {summary.held > 0 && (
        <p className="mb-2 text-sm">
          <Link href={`${base}?tab=held`} className="font-medium text-[var(--fanous-color-link)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="studio-dash-comments-held">
            {text.recentComments.held.replace('{count}', formatInteger(locale, summary.held))}
          </Link>
        </p>
      )}
      {summary.recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">{summary.indexing ? t.studio.commentsPage.indexing : text.recentComments.none}</p>
      ) : (
        <ul className="space-y-3">
          {summary.recent.map((comment) => (
            <li key={comment.id} className="text-sm" data-testid="studio-dash-comment">
              <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                <bdi className="font-medium text-foreground">{comment.author.displayName}</bdi>
                <time dateTime={comment.createdAt}>{formatRelativeTime(comment.createdAt, lang)}</time>
              </p>
              <p dir="auto" className="line-clamp-2 text-foreground text-left [html[dir=rtl]_&]:text-right">{comment.text}</p>
              <p className="text-xs text-muted-foreground [text-wrap:balance]">
                <OnTitle template={t.studio.commentsPage.on} title={comment.targetTitle} />
              </p>
            </li>
          ))}
        </ul>
      )}
      <Button asChild variant="outline" className="mt-3 min-h-11">
        <Link href={base} data-testid="studio-dash-comments-all">{text.recentComments.all}</Link>
      </Button>
    </div>
  );
}
