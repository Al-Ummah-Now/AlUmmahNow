'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from '@/components/common/AppLink';
import { formatWatchTime, watchTimeUnit, type StudioComment, type StudioVideoStatus, dateTimeFormat, numberFormat, fillTemplate, formatPercent } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/hooks/useLanguage';
import { getStudioChannelAnalytics, getStudioVideoAnalytics, type StudioChannelAnalytics } from '@/lib/api/studio-analytics';
import { listHeldComments } from '@/lib/api/studio-comments';
import { getChannelContentCounts, listChannelContent, type StudioVideo } from '@/lib/api/studio-content';
import { logger } from '@/lib/logger-client';
import { changePercent, rangeDates, sumMetrics } from '@/lib/studio/analytics';
import { can, type StudioRole } from '@/lib/studio/permissions';
import { legacyHref } from '@/lib/studio/nav';
import { studioLiveHref, studioUploadHref } from '@/lib/studio/links';

/** The dashboard's recent window («آخر ٢٨ يومًا» / "last 28 days"). */
const RECENT_DAYS = 28;

interface Props {
  locale: string;
  channelId: string;
  role: StudioRole;
  /** Live is on for this channel (GET /api/me/features): otherwise no Go live quick action */
  liveOn?: boolean;
  /** features.upload for this channel: no upload links or upload invitation without it */
  uploadOn?: boolean;
}

type Listed = { items: StudioVideo[] } | null;

interface DashboardData {
  counts: Record<StudioVideoStatus, number> | null;
  latest: StudioVideo | null;
  latestWatchTime: number | null;
  /** Newest uploads after they were sent, with their status; null when every list failed */
  recent: StudioVideo[] | null;
  drafts: StudioVideo[] | null;
  scheduled: StudioVideo[] | null;
  held: { items: StudioComment[]; total: number } | null;
  overview: StudioChannelAnalytics | null;
  previous: StudioChannelAnalytics | null;
}

const NEXT_COUNT = 3;
const RECENT_COUNT = 4;
const DRAFTS_COUNT = 3;
const HELD_COUNT = 3;
const SCHEDULED_FETCH = 50;
/** The states an upload passes through after it is sent (Recent uploads) */
const UPLOAD_STATES: readonly StudioVideoStatus[] = ['processing', 'in_review', 'failed', 'not_approved', 'published'];

function Card({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card p-4" data-testid={testId}>
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

const created = (video: StudioVideo) => Date.parse(video.dateCreated ?? '') || 0;

/**
 * What needs attention on this channel, by what the role can see (spec §4.3). Each section shows
 * only while the role can use it and its feature is on; a section with no data says so plainly.
 * Every card settles: a call that fails, is refused (feature_off, 404) or never completes shows
 * the card's failure or empty state, never a loader that stays (owner review 2026-11-16).
 */
export function StudioDashboard({ locale, channelId, role, liveOn = false, uploadOn = false }: Props) {
  const { t } = useLanguage();
  const text = t.studio.dashboard;
  const statuses = t.studio.videos.statuses;
  const [data, setData] = useState<DashboardData | null>(null);
  const request = useRef(0);
  const canSeeVideos = can(role, 'video.view_private');
  const canSeeStats = can(role, 'analytics.view');
  const canModerate = can(role, 'comment.moderate');

  const load = useCallback(async () => {
    const id = ++request.current;
    setData(null);
    const safe = <T,>(work: () => Promise<T>): Promise<T | null> => {
      const failed = (error: unknown) => {
        logger.error('[Studio] Dashboard card failed', { channelId, error });
        return null;
      };
      try {
        return work().catch(failed);
      } catch (error) {
        return Promise.resolve(failed(error));
      }
    };
    const none = Promise.resolve(null);
    const list = (status: StudioVideoStatus, limit: number, sort?: string): Promise<Listed> =>
      canSeeVideos ? safe(() => listChannelContent(channelId, { status, limit, ...(sort ? { sort } : {}) })) : none;
    const windows = rangeDates(String(RECENT_DAYS) as '28', new Date());
    const [counts, scheduled, drafts, held, overview, previous, ...uploads] = await Promise.all([
      canSeeVideos ? safe(() => getChannelContentCounts(channelId)) : none,
      list('scheduled', SCHEDULED_FETCH),
      list('drafts', DRAFTS_COUNT, 'newest'),
      canModerate ? safe(() => listHeldComments(channelId, HELD_COUNT)) : none,
      canSeeStats ? safe(() => getStudioChannelAnalytics(channelId, windows.current)) : none,
      canSeeStats && windows.previous ? safe(() => getStudioChannelAnalytics(channelId, windows.previous!)) : none,
      ...UPLOAD_STATES.map((status) => list(status, RECENT_COUNT, 'newest')),
    ]);
    const listedUploads = uploads as Listed[];
    const published = listedUploads[UPLOAD_STATES.indexOf('published')];
    const latest = published?.items[0] ?? null;
    const latestStats = latest && canSeeStats ? await safe(() => getStudioVideoAnalytics(latest.id, windows.current)) : null;
    if (id !== request.current) return;
    const answered = listedUploads.filter((listed): listed is { items: StudioVideo[] } => listed !== null);
    setData({
      counts,
      latest,
      latestWatchTime: latestStats?.watchTime ?? null,
      recent: answered.length > 0 ? answered.flatMap((listed) => listed.items).sort((a, b) => created(b) - created(a)).slice(0, RECENT_COUNT) : null,
      drafts: drafts?.items ?? null,
      scheduled: scheduled ? [...scheduled.items].sort((a, b) => Date.parse(a.scheduledPublishDate ?? '') - Date.parse(b.scheduledPublishDate ?? '')).slice(0, NEXT_COUNT) : null,
      held,
      overview,
      previous,
    });
  }, [canModerate, canSeeStats, canSeeVideos, channelId]);

  useEffect(() => {
    void load();
    // Leaving the page (or a newer load) makes this load's answer stale: it is dropped
    return () => {
      request.current += 1;
    };
  }, [load]);

  const base = `/${locale}/studio/${encodeURIComponent(channelId)}`;
  const number = numberFormat(locale);
  const quickLinks = [
    can(role, 'video.upload') && uploadOn && { label: text.quick.upload, href: studioUploadHref(locale, channelId) },
    can(role, 'live.manage') && liveOn && { label: text.quick.goLive, href: studioLiveHref(locale, channelId) },
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

  const { counts, latest, latestWatchTime, recent, drafts, scheduled, held, overview, previous } = data;
  const failedCard = (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">{text.cardFailed}</p>
      <Button variant="outline" onClick={() => void load()}>{text.retry}</Button>
    </div>
  );
  const dateTime = dateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const editHref = (video: StudioVideo) => `${base}/content/videos/${encodeURIComponent(video.id)}/edit`;

  const heldCard = canModerate && (
    <Card title={text.held.title} testId="studio-dash-held">
      {held ? (
        held.items.length === 0 ? (
          <Empty>{text.held.none}</Empty>
        ) : (
          <>
            <ul className="space-y-3 text-sm">
              {held.items.map((comment) => (
                <li key={comment.id} className="min-w-0">
                  <p dir="auto" className="line-clamp-2 text-foreground">{comment.text}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    <span dir="auto">{comment.author.displayName}</span>
                    {' · '}
                    <Link href={`/${locale}${comment.targetUrlPath}`} dir="auto" className="hover:underline">{text.held.on.replace('{title}', comment.targetTitle)}</Link>
                  </p>
                </li>
              ))}
            </ul>
            {held.total > held.items.length && <p className="mt-3 text-xs text-muted-foreground">{fillTemplate(locale, text.held.all, { count: held.total })}</p>}
          </>
        )
      ) : failedCard}
    </Card>
  );

  if (!canSeeVideos) {
    return (
      <div data-testid="studio-dashboard">
        {heading}
        <div className="grid gap-4 md:grid-cols-2">{heldCard}</div>
      </div>
    );
  }

  // A new channel is invited to upload only while uploads are on; otherwise it gets the sections, empty
  const isNew = counts !== null && Object.values(counts).every((count) => count === 0);
  if (isNew && uploadOn && can(role, 'video.upload')) {
    return (
      <div data-testid="studio-dashboard">
        {heading}
        <div className="rounded-md border border-border bg-card p-6 text-center" data-testid="studio-dash-welcome">
          <h2 className="mb-2 text-lg font-semibold text-foreground">{text.welcome.title}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{text.welcome.body}</p>
          <Button asChild className="min-h-11"><Link href={studioUploadHref(locale, channelId)}>{text.welcome.upload}</Link></Button>
        </div>
      </div>
    );
  }

  const totals = overview ? sumMetrics(overview.recentMetrics) : null;
  const before = previous ? sumMetrics(previous.recentMetrics) : undefined;
  const change = totals ? changePercent(totals.views, before?.views) : null;
  const totalVideos = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : null;
  const task = (status: StudioVideoStatus, label: string, count: number) => (
    <li key={status}>
      <Link href={`${base}/content/videos?status=${status}`} className="flex min-h-11 items-center justify-between text-sm text-foreground hover:underline">
        <span>{label}</span>
        <span className="tabular-nums">{number.format(count)}</span>
      </Link>
    </li>
  );
  const links = quickLinks.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {quickLinks.map((link) => <Button key={link.href} asChild variant="outline" className="min-h-11"><Link href={link.href}>{link.label}</Link></Button>)}
    </div>
  );

  return (
    <div data-testid="studio-dashboard">
      {heading}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={text.tasks.title} testId="studio-dash-tasks">
          {counts ? (
            counts.processing + counts.failed === 0 ? (
              <Empty>{text.tasks.none}</Empty>
            ) : (
              <ul>
                {task('failed', text.tasks.failed, counts.failed)}
                {task('processing', text.tasks.processing, counts.processing)}
              </ul>
            )
          ) : failedCard}
        </Card>

        <Card title={text.recent.title} testId="studio-dash-recent">
          {recent ? (
            recent.length === 0 ? (
              <Empty>{text.recent.none}</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {recent.map((video) => (
                  <li key={video.id} className="flex items-center justify-between gap-2">
                    <Link href={editHref(video)} dir="auto" className="min-w-0 truncate text-foreground hover:underline">{video.title}</Link>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground" data-status={video.studioStatus}>
                      {statuses[video.studioStatus] ?? video.studioStatus}
                    </span>
                  </li>
                ))}
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
                <Link href={editHref(latest)} dir="auto" className="block truncate font-medium text-foreground hover:underline">{latest.title}</Link>
                <p className="mt-1 text-muted-foreground">
                  {text.counts.replace('{views}', number.format(latest.views ?? 0)).replace('{likes}', number.format(latest.likesCount ?? 0)).replace('{comments}', number.format(latest.commentsCount ?? 0))}
                </p>
                {latestWatchTime !== null && <p className="text-muted-foreground">{fillTemplate(locale, text.watchTime, { days: RECENT_DAYS, time: formatWatchTime(locale, watchTimeUnit(latestWatchTime))(latestWatchTime) })}</p>}
              </div>
            </div>
          </Card>
        )}

        {heldCard}

        <Card title={text.drafts.title} testId="studio-dash-drafts">
          {drafts && scheduled ? (
            drafts.length === 0 && scheduled.length === 0 ? (
              <Empty>{text.drafts.none}</Empty>
            ) : (
              <div className="space-y-4 text-sm">
                {drafts.length > 0 && (
                  <div data-testid="studio-dash-drafts-list">
                    <Link href={`${base}/content/videos?status=drafts`} className="mb-1 flex items-center justify-between font-medium text-foreground hover:underline">
                      <span>{text.drafts.drafts}</span>
                      {counts && <span className="tabular-nums">{number.format(counts.drafts)}</span>}
                    </Link>
                    <ul className="space-y-1">
                      {drafts.map((video) => (
                        <li key={video.id}><Link href={editHref(video)} dir="auto" className="block truncate text-muted-foreground hover:text-foreground hover:underline">{video.title}</Link></li>
                      ))}
                    </ul>
                  </div>
                )}
                {scheduled.length > 0 && (
                  <div data-testid="studio-dash-next">
                    <p className="mb-1 font-medium text-foreground">{text.next}</p>
                    <ul className="space-y-1">
                      {scheduled.map((video) => (
                        <li key={video.id} className="flex justify-between gap-2">
                          <Link href={editHref(video)} dir="auto" className="truncate text-muted-foreground hover:text-foreground hover:underline">{video.title}</Link>
                          <span className="shrink-0 text-muted-foreground">{video.scheduledPublishDate ? dateTime.format(new Date(video.scheduledPublishDate)) : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          ) : failedCard}
        </Card>

        {canSeeStats && (
          <Card title={text.totals.title} testId="studio-dash-totals">
            {overview && totals ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted-foreground">{text.totals.views}</dt><dd className="text-lg font-semibold tabular-nums text-foreground">{number.format(overview.totalViews)}</dd></div>
                <div><dt className="text-muted-foreground">{text.totals.subscribers}</dt><dd className="text-lg font-semibold tabular-nums text-foreground">{number.format(overview.totalSubscribers)}</dd></div>
                <div><dt className="text-muted-foreground">{text.totals.videos}</dt><dd className="text-lg font-semibold tabular-nums text-foreground">{totalVideos === null ? '–' : number.format(totalVideos)}</dd></div>
                <div>
                  <dt className="text-muted-foreground">{fillTemplate(locale, text.totals.last28, { days: RECENT_DAYS })}</dt>
                  <dd className="text-lg font-semibold tabular-nums text-foreground">{number.format(totals.views)}</dd>
                  {change !== null && <dd className="text-xs text-muted-foreground">{t.studio.analytics.change.replace('{change}', formatPercent(locale, change / 100, { signDisplay: 'exceptZero' }))}</dd>}
                </div>
              </dl>
            ) : failedCard}
          </Card>
        )}

        {links && <Card title={text.quick.title} testId="studio-dash-quick">{links}</Card>}
      </div>
    </div>
  );
}
