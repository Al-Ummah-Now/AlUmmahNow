'use client';

/**
 * Start review (#2015): marks an open report as under review, or puts it back to pending. While a report
 * about a channel is under review, its owner can't hand the channel over. Undone by the same button.
 */
import type { ReportableEntityType, ReportStatus } from '@al-ummah/shared-types';
import type { setReportReview } from '@/lib/api/admin';
import { ActionFeedback, useContentAction } from '@/components/content/actions';
import { cardClass, primaryButtonClass } from '@/components/ui';
import { smallButtonClass } from '@/components/content/parts';
import { useLanguage } from '@/i18n/I18nProvider';

interface Props {
  reportId: string;
  entityType: ReportableEntityType;
  status: Extract<ReportStatus, 'pending' | 'reviewing'>;
  /** The server action it calls (a test passes its own) */
  setReview: typeof setReportReview;
}

export function ReportReview({ reportId, entityType, status, setReview }: Props) {
  const { t } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  const reviewing = status === 'reviewing';
  const change = () => run('review', () => setReview(reportId, !reviewing), { success: t(reviewing ? 'reportReview.stopped' : 'reportReview.started') });
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="report-review-title" data-testid="report-review" data-reviewing={reviewing}>
      <h2 id="report-review-title" className="mb-2 text-lg font-semibold text-fg">{t(reviewing ? 'reportReview.titleOn' : 'reportReview.title')}</h2>
      <p className="mb-4 text-sm text-fg-muted">
        {t(entityType === 'channel' ? (reviewing ? 'reportReview.channelOn' : 'reportReview.channel') : reviewing ? 'reportReview.on' : 'reportReview.body')}
      </p>
      <ActionFeedback error={error} message={message} testId="report-review-feedback" />
      <button type="button" className={reviewing ? smallButtonClass : primaryButtonClass} disabled={!!busy} aria-busy={!!busy} onClick={() => void change()} data-testid="report-review-toggle">
        {t(reviewing ? 'reportReview.stop' : 'reportReview.start')}
      </button>
    </section>
  );
}
