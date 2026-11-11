import { notFound } from 'next/navigation';
import Link from '@/components/AppLink';
import type { Report } from '@al-ummah/shared-types';
import { getReport } from '@/lib/api/admin';
import { AdminApiError } from '@/lib/api/errors';
import { getI18n } from '@/i18n/server';
import { formatDate, translateDynamic } from '@/i18n/translate';
import { ErrorAlert, StatusChip, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { ReportActions } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ReportDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { t, locale } = await getI18n();

  let report: Report | null = null;
  let failed = false;

  try {
    const data = await getReport(id);
    report = data.report;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) {
      notFound();
    }
    failed = true;
    logger.error('[report] Failed to load report', { id, error: e instanceof Error ? e.message : String(e) });
  }

  if (!report && !failed) {
    notFound();
  }

  const statusLabel = report ? translateDynamic(t, 'status', report.status) : '';

  return (
    <div>
      <div className="mb-6">
        <Link href="/moderation" className={linkClass}>
          <span aria-hidden="true" className="inline-block rtl:rotate-180">&larr;</span> {t('report.backToQueue')}
        </Link>
      </div>

      {failed && <ErrorAlert testId="report-error">{t('errors.loadReport')}</ErrorAlert>}

      {report && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className={cardClass} data-testid="report-details">
              <div className="flex flex-wrap justify-between items-start gap-3 mb-6">
                <h1 className="text-2xl font-bold text-fg">{t('report.title')}</h1>
                <StatusChip status={report.status} label={statusLabel} large />
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <dt className="text-fg-muted text-sm">{t('report.reportId')}</dt>
                  <dd className="text-fg font-mono text-sm break-all" dir="ltr" data-testid="report-id">{report.id}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted text-sm">{t('report.entityType')}</dt>
                  <dd className="text-fg">{translateDynamic(t, 'entityType', report.entity_type)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted text-sm">{t('report.entityId')}</dt>
                  <dd className="text-fg font-mono text-sm break-all" dir="ltr">{report.entity_id}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted text-sm">{t('report.reason')}</dt>
                  <dd className="text-fg">{translateDynamic(t, 'reason', report.reason)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted text-sm">{t('report.reporterId')}</dt>
                  <dd className="text-fg font-mono text-sm break-all" dir="ltr">{report.reporter_id || t('report.anonymous')}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted text-sm">{t('report.created')}</dt>
                  <dd className="text-fg">
                    <time dateTime={report.created_at}>{formatDate(report.created_at, locale, true)}</time>
                  </dd>
                </div>
              </dl>

              {report.description && (
                <div className="mt-6 pt-6 border-t border-border">
                  <h2 className="text-fg-muted text-sm mb-2">{t('report.description')}</h2>
                  <p className="text-fg whitespace-pre-wrap" dir="auto" data-testid="report-description">{report.description}</p>
                </div>
              )}

              {report.moderator_notes && (
                <div className="mt-6 pt-6 border-t border-border">
                  <h2 className="text-fg-muted text-sm mb-2">{t('report.moderatorNotes')}</h2>
                  <p className="text-fg whitespace-pre-wrap" dir="auto" data-testid="moderator-notes">{report.moderator_notes}</p>
                </div>
              )}

              {report.action && (
                <div className="mt-6 pt-6 border-t border-border">
                  <h2 className="text-fg-muted text-sm mb-2">{t('report.actionTaken')}</h2>
                  <p className="text-fg" data-testid="action-taken" data-action={report.action}>
                    {translateDynamic(t, 'action', report.action)}
                  </p>
                  {report.resolved_at && (
                    <p className="text-fg-subtle text-sm mt-1">
                      {t('report.resolvedOn', { date: formatDate(report.resolved_at, locale, true) })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            {report.status === 'pending' || report.status === 'reviewing' ? (
              <ReportActions reportId={report.id} />
            ) : (
              <div className={cardClass} data-testid="report-closed">
                <h2 className="text-lg font-semibold text-fg mb-4">{t('report.closedTitle')}</h2>
                <p className="text-fg-muted">{t('report.closedDescription', { status: statusLabel })}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
