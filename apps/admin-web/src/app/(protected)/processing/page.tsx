import Link from '@/components/AppLink';
import { listProcessingVideos, listThumbnailRuns } from '@/lib/api/admin';
import type { ProcessingVideosResponse, ThumbnailRun } from '@/lib/api/types';
import { getAdminSession } from '@/lib/auth';
import { canUseProcessing } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert, cardClass, fieldClass, linkClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { videoFailuresById } from '@/lib/api/failures';
import { failureIds } from '@/lib/video-failure';
import { FILTER_LABEL, PROCESSING_FILTERS, parseFilter } from './labels';
import { ProcessingTable } from './ProcessingTable';
import { ThumbnailRepairPanel } from './ThumbnailRepairPanel';
import { LiveRefresh } from '@/components/LiveRefresh';
import { Select } from '@/components/select/Select';

import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
import { Sep } from '@/components/Sep';
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const pageHref = (status: string, offset: number) => `/processing?${new URLSearchParams({ status, ...(offset ? { offset: String(offset) } : {}) })}`;

/** Upload processing health: stuck and failed uploads (on Bunny or on R2) with why and what to do, next to Bunny's and R2's state, with Sync / Retry / Mark failed, and the thumbnail shape check. */
export default async function ProcessingHealthPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = parseFilter(params.status);
  const offset = Math.max(0, Number.parseInt(String(params.offset ?? ''), 10) || 0);
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canUseProcessing(session?.user.role)) {
    return <ErrorAlert testId="processing-no-access">{t('processing.noAccess')}</ErrorAlert>;
  }

  const [videos, thumbs] = await Promise.allSettled([listProcessingVideos({ status: filter, offset }), listThumbnailRuns()]);
  const data: ProcessingVideosResponse | null = videos.status === 'fulfilled' ? videos.value : null;
  if (videos.status === 'rejected') {
    logger.error('[processing] Failed to load', { error: videos.reason instanceof Error ? videos.reason.message : String(videos.reason) });
  }
  const thumbnailRuns: ThumbnailRun[] | null = thumbs.status === 'fulfilled' ? thumbs.value.runs : null;
  if (thumbs.status === 'rejected') {
    logger.error('[processing] Failed to load thumbnail runs', { error: thumbs.reason instanceof Error ? thumbs.reason.message : String(thumbs.reason) });
  }
  const r = data?.reconciler;

  const failures = await videoFailuresById(failureIds((data?.items ?? []).map((v) => ({ id: v.id, failed: v.uploadStatus === 'failed' || v.r2Status === 'failed' || !!v.processingIssue }))));

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
            {fillNodes(t('processing.reconcilerLast', { scanned: r.scanned, notReady: r.notReady, started: r.loopsStarted }), { date: <LocalTime value={r.lastRunAt} withTime /> })}
            <Sep />
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
          <Select name="status" defaultValue={filter} className={fieldClass}>
            {PROCESSING_FILTERS.map((f) => (
              <option key={f} value={f}>{t(FILTER_LABEL[f])}</option>
            ))}
          </Select>
        </label>
        <button type="submit" className={secondaryButtonClass}>{t('processing.apply')}</button>
      </form>

      {!data && <ErrorAlert testId="processing-error">{t('processing.loadFailed')}</ErrorAlert>}
      {data?.truncated && (
        <p role="status" data-testid="processing-partial" className="mb-4 rounded-lg border border-border border-s-4 border-s-warning-fg bg-surface-2 px-4 py-3 text-sm text-fg">
          {t('processing.partialList')}
        </p>
      )}
      {data && data.items.length === 0 && (
        <div className={`${cardClass} text-center text-fg-muted`} data-testid="processing-empty">{t(typeof data.nextOffset === 'number' || offset > 0 ? 'processing.pageEmpty' : 'processing.empty')}</div>
      )}
      {/* A new page starts with nothing selected */}
      {data && data.items.length > 0 && <ProcessingTable key={`${filter}:${offset}`} rows={data.items} failures={failures} locale={locale} />}
      {data && (offset > 0 || typeof data.nextOffset === 'number') && (
        <nav className="mt-4 flex flex-wrap items-center justify-between gap-2" aria-label={t('processing.pages')} data-testid="processing-pages">
          {offset > 0 ? <Link href={pageHref(filter, 0)} className={secondaryButtonClass} data-testid="processing-first">{t('processing.firstPage')}</Link> : <span />}
          {typeof data.nextOffset === 'number' && <Link href={pageHref(filter, data.nextOffset)} className={secondaryButtonClass} data-testid="processing-next">{t('processing.nextPage')}</Link>}
        </nav>
      )}
    </div>
  );
}
