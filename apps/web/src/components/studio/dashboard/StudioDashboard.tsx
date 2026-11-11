'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { StudioVideoStatus } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatSeconds } from '@/components/studio/analytics/parts';
import { useLanguage } from '@/hooks/useLanguage';
import { getStudioChannelAnalytics, getStudioVideoAnalytics, type StudioChannelAnalytics } from '@/lib/api/studio-analytics';
import { getChannelContentCounts, listChannelContent, type StudioVideo } from '@/lib/api/studio-content';
import { logger } from '@/lib/logger-client';
import { changePercent, rangeDates, sumMetrics } from '@/lib/studio/analytics';
import { can, type StudioRole } from '@/lib/studio/permissions';
import { legacyHref } from '@/lib/studio/nav';
import { studioUploadHref } from '@/lib/studio/links';

interface Props {
  locale: string;
  channelId: string;
  role: StudioRole;
}

interface DashboardData {
  counts: Record<StudioVideoStatus, number> | null;
  latest: StudioVideo | null;
  latestWatchTime: number | null;
  scheduled: StudioVideo[];
  overview: StudioChannelAnalytics | null;
  previous: StudioChannelAnalytics | null;
}

const NEXT_COUNT = 3;
const SCHEDULED_FETCH = 50;

function Card({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card p-4" data-testid={testId}>
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** What needs attention on this channel, by what the role can see (spec §4.3). */
export function StudioDashboard({ locale, channelId, role }: Props) {
  const { t } = useLanguage();
  const text = t.studio.dashboard;
  const [data, setData] = useState<DashboardData | null>(null);
  const request = useRef(0);
  const canSeeVideos = can(role, 'video.view_private');
  const canSeeStats = can(role, 'analytics.view');

  const load = useCallback(async () => {
    const id = ++request.current;
    setData(null);
    const safe = <T,>(work: Promise<T>): Promise<T | null> => work.catch((error) => {
      logger.error('[Studio] Dashboard card failed', { channelId, error });
      return null;
    });
    const windows = rangeDates('28', new Date());
    const [counts, published, scheduled, overview, previous] = await Promise.all([
      canSeeVideos ? safe(getChannelContentCounts(channelId)) : Promise.resolve(null),
      canSeeVideos ? safe(listChannelContent(channelId, { status: 'published', sort: 'newest', limit: 1 })) : Promise.resolve(null),
      canSeeVideos ? safe(listChannelContent(channelId, { status: 'scheduled', limit: SCHEDULED_FETCH })) : Promise.resolve(null),
      canSeeStats ? safe(getStudioChannelAnalytics(channelId, windows.current)) : Promise.resolve(null),
      canSeeStats && windows.previous ? safe(getStudioChannelAnalytics(channelId, windows.previous)) : Promise.resolve(null),
    ]);
    const latest = published?.items[0] ?? null;
    const latestStats = latest && canSeeStats ? await safe(getStudioVideoAnalytics(latest.id, windows.current)) : null;
    if (id !== request.current) return;
    setData({
      counts,
      latest,
      latestWatchTime: latestStats?.watchTime ?? null,
      scheduled: [...(scheduled?.items ?? [])].sort((a, b) => Date.parse(a.scheduledPublishDate ?? '') - Date.parse(b.scheduledPublishDate ?? '')).slice(0, NEXT_COUNT),
      overview,
      previous,
    });
  }, [canSeeStats, canSeeVideos, channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const base = `/${locale}/studio/${encodeURIComponent(channelId)}`;
  const number = new Intl.NumberFormat(locale);
  const quickLinks = [
    can(role, 'video.upload') && { label: text.quick.upload, href: studioUploadHref(locale, channelId) },
    can(role, 'post.manage') && { label: text.quick.newPost, href: legacyHref(locale, channelId, 'content/posts/new')! },
    can(role, 'channel.edit') && { label: text.quick.customise, href: legacyHref(locale, channelId, 'customisation/profile')! },
  ].filter((link): link is { label: string; href: string } => Boolean(link));

  const heading = <h1 className="mb-4 text-xl font-bold text-foreground">{t.studio.nav.dashboard}</h1>;

  if (!data) {
    return (
      <div data-testid="studio-dashboard" aria-busy="true">
        {heading}
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2].map((card) => <Skeleton key={card} className="h-32 w-full" />)}
        </div>
      </div>
    );
  }

  const { counts, latest, latestWatchTime, scheduled, overview, previous } = data;
  const links = quickLinks.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {quickLinks.map((link) => <Button key={link.href} asChild variant="outline" className="min-h-11"><Link href={link.href}>{link.label}</Link></Button>)}
    </div>
  );

  if (!canSeeVideos) {
    return (
      <div data-testid="studio-dashboard">
        {heading}
        <Card title={text.moderator.title} testId="studio-dash-moderator">
          <p className="mb-3 text-sm text-muted-foreground">{text.moderator.body}</p>
        </Card>
      </div>
    );
  }

  const isNew = counts !== null && Object.values(counts).every((count) => count === 0);
  if (isNew) {
    return (
      <div data-testid="studio-dashboard">
        {heading}
        <div className="rounded-md border border-border bg-card p-6 text-center" data-testid="studio-dash-welcome">
          <h2 className="mb-2 text-lg font-semibold text-foreground">{text.welcome.title}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{text.welcome.body}</p>
          {can(role, 'video.upload') && <Button asChild className="min-h-11"><Link href={studioUploadHref(locale, channelId)}>{text.welcome.upload}</Link></Button>}
        </div>
      </div>
    );
  }

  const totals = overview ? sumMetrics(overview.recentMetrics) : null;
  const before = previous ? sumMetrics(previous.recentMetrics) : undefined;
  const change = totals ? changePercent(totals.views, before?.views) : null;
  const totalVideos = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : null;
  const failedCard = (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">{text.cardFailed}</p>
      <Button variant="outline" onClick={() => void load()}>{text.retry}</Button>
    </div>
  );
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const task = (status: StudioVideoStatus, label: string, count: number) => (
    <li key={status}>
      <Link href={`${base}/content/videos?status=${status}`} className="flex min-h-11 items-center justify-between text-sm text-foreground hover:underline">
        <span>{label}</span>
        <span className="tabular-nums">{number.format(count)}</span>
      </Link>
    </li>
  );

  return (
    <div data-testid="studio-dashboard">
      {heading}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={text.tasks.title} testId="studio-dash-tasks">
          {counts ? (
            counts.processing + counts.failed === 0 ? (
              <p className="text-sm text-muted-foreground">{text.tasks.none}</p>
            ) : (
              <ul>
                {task('failed', text.tasks.failed, counts.failed)}
                {task('processing', text.tasks.processing, counts.processing)}
              </ul>
            )
          ) : failedCard}
        </Card>

        {latest && (
          <Card title={text.latest} testId="studio-dash-latest">
            <div className="flex gap-3">
              <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded bg-muted">
                {latest.thumbnailUrl?.trim() ? <Image src={latest.thumbnailUrl} alt="" fill sizes="112px" className="object-cover" unoptimized /> : null}
              </div>
              <div className="min-w-0 text-sm">
                <Link href={`${base}/content/videos/${encodeURIComponent(latest.id)}/edit`} dir="auto" className="block truncate font-medium text-foreground hover:underline">{latest.title}</Link>
                <p className="mt-1 text-muted-foreground">
                  {text.counts.replace('{views}', number.format(latest.views ?? 0)).replace('{likes}', number.format(latest.likesCount ?? 0)).replace('{comments}', number.format(latest.commentsCount ?? 0))}
                </p>
                {latestWatchTime !== null && <p className="text-muted-foreground">{text.watchTime.replace('{time}', formatSeconds(latestWatchTime))}</p>}
              </div>
            </div>
          </Card>
        )}

        {canSeeStats && (
          <Card title={text.totals.title} testId="studio-dash-totals">
            {overview && totals ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted-foreground">{text.totals.views}</dt><dd className="text-lg font-semibold tabular-nums text-foreground">{number.format(overview.totalViews)}</dd></div>
                <div><dt className="text-muted-foreground">{text.totals.subscribers}</dt><dd className="text-lg font-semibold tabular-nums text-foreground">{number.format(overview.totalSubscribers)}</dd></div>
                <div><dt className="text-muted-foreground">{text.totals.videos}</dt><dd className="text-lg font-semibold tabular-nums text-foreground">{totalVideos === null ? '–' : number.format(totalVideos)}</dd></div>
                <div>
                  <dt className="text-muted-foreground">{text.totals.last28}</dt>
                  <dd className="text-lg font-semibold tabular-nums text-foreground">{number.format(totals.views)}</dd>
                  {change !== null && <dd className="text-xs text-muted-foreground">{t.studio.analytics.change.replace('{change}', `${change > 0 ? '+' : ''}${change}`)}</dd>}
                </div>
              </dl>
            ) : failedCard}
          </Card>
        )}

        {scheduled.length > 0 && (
          <Card title={text.next} testId="studio-dash-next">
            <ul className="space-y-2 text-sm">
              {scheduled.map((video) => (
                <li key={video.id} className="flex justify-between gap-2">
                  <Link href={`${base}/content/videos/${encodeURIComponent(video.id)}/edit`} dir="auto" className="truncate text-foreground hover:underline">{video.title}</Link>
                  <span className="shrink-0 text-muted-foreground">{video.scheduledPublishDate ? dateTime.format(new Date(video.scheduledPublishDate)) : ''}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {links && <Card title={text.quick.title} testId="studio-dash-quick">{links}</Card>}
      </div>
    </div>
  );
}
