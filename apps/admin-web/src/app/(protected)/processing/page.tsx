import Link from '@/components/AppLink';
import { listProcessingVideos, listThumbnailRuns } from '@/lib/api/admin';
import type { ProcessingVideosResponse, ThumbnailRun } from '@/lib/api/types';
import { getAdminSession } from '@/lib/auth';
import { canUseProcessing } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, linkClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { FILTER_LABEL, PROCESSING_FILTERS, parseFilter } from './labels';
import { ProcessingTable } from './ProcessingTable';
import { ThumbnailRepairPanel } from './ThumbnailRepairPanel';
import { LiveRefresh } from '@/components/LiveRefresh';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Upload processing health: stuck uploads next to Bunny's state, with Sync / Retry / Mark failed, and the thumbnail shape check. */
export default async function ProcessingHealthPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = parseFilter(params.status);
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canUseProcessing(session?.user.role)) {
    return <ErrorAlert testId="processing-no-access">{t('processing.noAccess')}</ErrorAlert>;
  }

  const [videos, thumbs] = await Promise.allSettled([listProcessingVideos({ status: filter }), listThumbnailRuns()]);
  const data: ProcessingVideosResponse | null = videos.status === 'fulfilled' ? videos.value : null;
  if (videos.status === 'rejected') {
    logger.error('[processing] Failed to load', { error: videos.reason instanceof Error ? videos.reason.message : String(videos.reason) });
  }
  const thumbnailRuns: ThumbnailRun[] | null = thumbs.status === 'fulfilled' ? thumbs.value.runs : null;
  if (thumbs.status === 'rejected') {
    logger.error('[processing] Failed to load thumbnail runs', { error: thumbs.reason instanceof Error ? thumbs.reason.message : String(thumbs.reason) });
  }
  const r = data?.reconciler;

  return (
    <div>
      <LiveRefresh topics={['uploads']} />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-fg">{t('processing.title')}</h1>
          <p className="text-fg-muted mt-1">{t('processing.subtitle')}</p>
        </div>
        <Link href="/errors" className={linkClass}>{t('processing.errorsLink')}</Link>
      </div>

      <section className={`${cardClass} mb-6`} data-testid="processing-reconciler" aria-labelledby="reconciler-title">
        <h2 id="reconciler-title" className="text-lg font-semibold text-fg mb-1">{t('processing.reconcilerTitle')}</h2>
        {r ? (
          <p className="text-fg-muted text-sm" data-last-run={r.lastRunAt}>
            {t('processing.reconcilerLast', { date: formatDate(r.lastRunAt, locale, true), scanned: r.scanned, notReady: r.notReady, started: r.loopsStarted })}
            {' · '}
            {t('processing.reconcilerFlagged', { reupload: r.flagged.needsReupload, stalled: r.flagged.stalled, failed: r.flagged.failed })}
          </p>
        ) : (
          <p className="text-fg-muted text-sm">{t('processing.reconcilerNever')}</p>
        )}
      </section>

      <ThumbnailRepairPanel runs={thumbnailRuns} locale={locale} />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-2" data-testid="processing-filter">
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          {t('processing.filterLabel')}
          <select name="status" defaultValue={filter} className={fieldClass}>
            {PROCESSING_FILTERS.map((f) => (
              <option key={f} value={f}>{t(FILTER_LABEL[f])}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={secondaryButtonClass}>{t('processing.apply')}</button>
      </form>

      {!data && <ErrorAlert testId="processing-error">{t('processing.loadFailed')}</ErrorAlert>}
      {data && data.items.length === 0 && (
        <div className={`${cardClass} text-center text-fg-muted`} data-testid="processing-empty">{t('processing.empty')}</div>
      )}
      {data && data.items.length > 0 && <ProcessingTable rows={data.items} locale={locale} />}
    </div>
  );
}
