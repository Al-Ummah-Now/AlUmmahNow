import Link from '@/components/AppLink';
import { getReviewAlerts, getReviewStats, listReviewQueue, type ReviewRowView, type ReviewStatsView, type ReviewTab } from '@/lib/api/review';
import { getI18n } from '@/i18n/server';
import { formatDate, translateDynamic } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { AlertsToggle } from './AlertsToggle';

export const dynamic = 'force-dynamic';

const TABS: ReviewTab[] = ['action_needed', 'checking', 'history', 'shadow'];
const thClass = 'text-start px-4 py-3 text-fg-muted font-medium whitespace-nowrap';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Videos in review (docs/specs/VIDEO-REVIEW.md §7): Action needed, Checking, History, Shadow. */
export default async function VideoReviewQueuePage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const { t, locale } = await getI18n();
  const tab: ReviewTab = TABS.includes(raw.tab as ReviewTab) ? (raw.tab as ReviewTab) : 'action_needed';
  const cursor = typeof raw.cursor === 'string' ? raw.cursor : undefined;

  let items: ReviewRowView[] = [];
  let nextCursor: string | null = null;
  let stats: ReviewStatsView | null = null;
  let alerts = false;
  let failed = false;
  try {
    const [queue, s, a] = await Promise.all([listReviewQueue(tab, cursor), getReviewStats(), getReviewAlerts()]);
    items = queue.items;
    nextCursor = queue.nextCursor;
    stats = s;
    alerts = a.alerts;
  } catch (e) {
    failed = true;
    logger.error('[review] Failed to load the queue', { tab, error: e instanceof Error ? e.message : String(e) });
  }
  const waiting = stats ? (stats.open.in_review ?? 0) + (stats.open.appealed ?? 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg">{t('review.title')}</h1>
          <p className="text-fg-muted mt-1 max-w-prose">{t('review.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AlertsToggle initial={alerts} />
          <Link href="/moderation/review/settings" className={linkClass}>{t('review.settingsLink')}</Link>
        </div>
      </div>

      {stats && (
        <p className="text-sm text-fg-muted flex flex-wrap gap-x-4 gap-y-1" data-testid="review-stats">
          <span>{t('review.statsOpen', { count: String(waiting) })}</span>
          {stats.queueMinutes !== null && <span>{t('review.statsQueue', { minutes: String(stats.queueMinutes) })}</span>}
          <span>{t('review.statsCost', { usd: stats.todayCostUsd.toFixed(2) })}</span>
          {stats.shadow14d.checked > 0 && <span>{t('review.statsShadow', { checked: String(stats.shadow14d.checked), held: String(stats.shadow14d.wouldHold), nsfw: String(stats.shadow14d.nsfw) })}</span>}
        </p>
      )}

      <nav aria-label={t('review.title')} className="flex flex-wrap gap-2">
        {TABS.map((id) => (
          <Link key={id} href={`/moderation/review?tab=${id}`} aria-current={id === tab ? 'page' : undefined} className={`rounded-full border px-3 py-1 text-sm ${id === tab ? 'border-accent bg-accent text-on-accent' : 'border-border text-fg'}`} data-testid={`review-tab-${id}`}>
            {t(`review.tabs.${id}`)}
          </Link>
        ))}
      </nav>

      {failed && <ErrorAlert testId="review-error">{t('review.failed')}</ErrorAlert>}

      <section className={`${cardClass} p-0 overflow-x-auto`}>
        {items.length === 0 ? (
          <p className="p-6 text-fg-muted" data-testid="review-empty">{t('review.empty')}</p>
        ) : (
          <table className="w-full text-sm" data-testid="review-table">
            <thead>
              <tr className="border-b border-border">
                <th className={thClass}>{t('review.columns.video')}</th>
                <th className={thClass}>{t('review.columns.why')}</th>
                <th className={thClass}>{t('review.columns.status')}</th>
                <th className={thClass}>{t('review.columns.since')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0" data-testid="review-row" data-escalated={row.escalate ? '1' : '0'}>
                  <td className="px-4 py-3">
                    <Link href={`/moderation/review/${encodeURIComponent(row.id)}`} className={linkClass}>{row.subject_id}</Link>
                    <span className="ms-2 inline-flex gap-1">
                      {row.escalate ? <span className="rounded bg-danger-bg px-1 text-xs text-danger-fg">{t('review.escalated')}</span> : null}
                      {row.appeal_of ? <span className="rounded bg-surface-2 px-1 text-xs text-fg">{t('review.appeal')}</span> : null}
                      {row.nsfw ? <span className="rounded bg-danger-bg px-1 text-xs text-danger-fg">{t('review.nsfw')}</span> : null}
                      {row.partial ? <span className="rounded bg-surface-2 px-1 text-xs text-fg">{t('review.partial')}</span> : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fg">{row.hold_cause ? translateDynamic(t, 'review.holdCause', row.hold_cause) : (row.top_category ?? '—')}</td>
                  <td className="px-4 py-3 text-fg">{translateDynamic(t, 'review.status', row.status)}</td>
                  <td className="px-4 py-3 text-fg-muted whitespace-nowrap">{formatDate(row.decided_at ?? row.sla_due_at ?? row.created_at, locale, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {nextCursor && (
        <Link href={`/moderation/review?tab=${tab}&cursor=${encodeURIComponent(nextCursor)}`} className={linkClass} data-testid="review-more">{t('review.loadMore')}</Link>
      )}
    </div>
  );
}
