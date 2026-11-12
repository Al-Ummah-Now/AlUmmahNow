import Link from '@/components/AppLink';
import { getDeliverySettings, getMediaQoeLive, getMediaSummary, listMediaJobs } from '@/lib/api/admin';
import type { DeliverySettings, MediaJob, MediaSummary } from '@/lib/api/types';
import { getAdminSession } from '@/lib/auth';
import { canManageMedia } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import type { MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { DeliverySwitch } from './DeliverySwitch';
import { JobsTable } from './JobsTable';
import { LiveTranscodes } from './LiveTranscodes';
import { LiveQoe } from './LiveQoe';
import { CostSection, PlaybackSection, SpeedSection } from './sections';
import { JOB_FILTERS, JOB_STATUS_LABEL, PERIODS, parseJobFilter, parsePeriod } from './metrics';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PERIOD_LABEL: Record<number, MessageKey> = { 7: 'mediaDelivery.period7', 30: 'mediaDelivery.period30', 90: 'mediaDelivery.period90' };

function settled<T>(result: PromiseSettledResult<T>, what: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  logger.error(`[delivery] Failed to load ${what}`, { error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  return null;
}

/**
 * Delivery comparison (epic #687, docs/media-delivery/R2-DELIVERY-PLAN.md
 * Phase 3): the Bunny/R2 switch, time to playable, playback quality per
 * source, cost with the projection against the monthly cap, and recent
 * R2 transcodes with "Transcode again".
 */
export default async function DeliveryComparisonPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const days = parsePeriod(params.days);
  const filter = parseJobFilter(params.status);
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canManageMedia(session?.user.role)) {
    return <ErrorAlert testId="delivery-no-access">{t('mediaDelivery.noAccess')}</ErrorAlert>;
  }

  const [summaryResult, jobsResult, settingsResult, qoeLiveResult] = await Promise.allSettled([
    getMediaSummary(days),
    listMediaJobs({ status: filter === 'all' ? undefined : filter, limit: 50 }),
    getDeliverySettings(),
    getMediaQoeLive(),
  ]);
  const qoeLive = qoeLiveResult.status === 'fulfilled' && qoeLiveResult.value.ok ? qoeLiveResult.value.data : null;
  const summary: MediaSummary | null = settled(summaryResult, 'summary');
  const jobs: MediaJob[] | null = settled(jobsResult, 'jobs');
  const settings: DeliverySettings | null = settled(settingsResult, 'settings');
  const query = (next: Record<string, string>) => `?${new URLSearchParams({ days: String(days), ...(filter === 'all' ? {} : { status: filter }), ...next })}`;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold text-fg">{t('mediaDelivery.title')}</h1>
          <p className="text-fg-muted mt-1">{t('mediaDelivery.subtitle')}</p>
        </div>
        <nav aria-label={t('mediaDelivery.periodLabel')} data-testid="delivery-period">
          <ul className="flex flex-wrap gap-1">
            {PERIODS.map((p) => (
              <li key={p}>
                <Link
                  href={query({ days: String(p) })}
                  aria-current={p === days ? 'page' : undefined}
                  className={`block rounded px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    p === days ? 'bg-accent text-on-accent font-medium' : 'border border-border text-fg hover:bg-surface-hover'
                  }`}
                >
                  {t(PERIOD_LABEL[p])}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {settings ? <DeliverySwitch settings={settings} /> : <div className="mb-6"><ErrorAlert testId="delivery-switch-error">{t('mediaDelivery.switchFailed')}</ErrorAlert></div>}

      {summary ? (
        <>
          <LiveTranscodes initial={summary.live ?? null} />
          <LiveQoe initial={qoeLive} />
          <SpeedSection summary={summary} t={t} locale={locale} />
          <PlaybackSection summary={summary} t={t} locale={locale} />
          <CostSection summary={summary} t={t} locale={locale} />
        </>
      ) : (
        <div className="mb-6"><ErrorAlert testId="delivery-summary-error">{t('mediaDelivery.summaryFailed')}</ErrorAlert></div>
      )}

      <section aria-labelledby="delivery-jobs-title" data-testid="delivery-jobs-section">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="delivery-jobs-title" className="text-lg font-semibold text-fg">{t('mediaDelivery.jobsTitle')}</h2>
          <form method="get" className="flex flex-wrap items-end gap-2" data-testid="delivery-jobs-filter">
            <input type="hidden" name="days" value={days} />
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              {t('mediaDelivery.filterLabel')}
              <select name="status" defaultValue={filter} className={fieldClass}>
                {JOB_FILTERS.map((s) => (
                  <option key={s} value={s}>{s === 'all' ? t('mediaDelivery.filterAll') : t(JOB_STATUS_LABEL[s])}</option>
                ))}
              </select>
            </label>
            <button type="submit" className={secondaryButtonClass}>{t('mediaDelivery.apply')}</button>
          </form>
        </div>
        {!jobs && <ErrorAlert testId="delivery-jobs-error">{t('mediaDelivery.jobsLoadFailed')}</ErrorAlert>}
        {jobs && jobs.length === 0 && <div className={`${cardClass} text-center text-fg-muted`} data-testid="delivery-jobs-empty">{t('mediaDelivery.jobsEmpty')}</div>}
        {jobs && jobs.length > 0 && <JobsTable jobs={jobs} />}
      </section>
    </div>
  );
}
