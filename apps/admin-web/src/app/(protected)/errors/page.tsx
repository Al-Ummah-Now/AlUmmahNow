import Link from 'next/link';
import { getProcessingErrors } from '@/lib/api/admin';
import type { ProcessingErrorsResponse } from '@/lib/api/types';
import { getAdminSession } from '@/lib/auth';
import { canUseProcessing } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { ISSUE_LABEL, ourStatusLabel } from '../processing/labels';

export const dynamic = 'force-dynamic';

const thClass = 'text-start px-4 py-3 text-fg-muted font-medium whitespace-nowrap';
const tdClass = 'px-4 py-3 align-top text-sm';

/**
 * Failures that need an admin: uploads that failed or were flagged (needs
 * re-upload, stalled) and processing checks that dead-lettered after their
 * retries. Each links to Processing health, where it can be synced, retried
 * or marked failed.
 */
export default async function ErrorsPage() {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canUseProcessing(session?.user.role)) {
    return <ErrorAlert testId="errors-no-access">{t('errorsPage.noAccess')}</ErrorAlert>;
  }

  let data: ProcessingErrorsResponse | null = null;
  try {
    data = await getProcessingErrors();
  } catch (e) {
    logger.error('[errors] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-fg">{t('errorsPage.title')}</h1>
        <p className="text-fg-muted mt-1">{t('errorsPage.subtitle')}</p>
      </div>
      {!data && <ErrorAlert testId="errors-error">{t('errorsPage.loadFailed')}</ErrorAlert>}

      {data && (
        <section aria-labelledby="errors-videos">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="errors-videos" className="text-xl font-semibold text-fg">{t('errorsPage.videosTitle')}</h2>
            <Link href="/processing?status=failed" className={linkClass}>{t('errorsPage.openProcessing')}</Link>
          </div>
          {data.videos.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="errors-videos-empty">{t('errorsPage.videosEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="errors-videos">
                <caption className="sr-only">{t('errorsPage.videosTitle')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('errorsPage.colWhen')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colVideo')}</th>
                    <th className={thClass} scope="col">{t('processing.colOurs')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.videos.map((v) => {
                    const when = v.processingIssue?.at || v.dateModified;
                    return (
                      <tr key={v.id} className="border-b border-border last:border-0" data-video-id={v.id}>
                        <td className={tdClass}>{when ? formatDate(when, locale, true) : '—'}</td>
                        <td className={tdClass}>
                          <div className="font-medium text-fg">{v.title || v.id}</div>
                          <div className="text-fg-muted text-xs" dir="ltr">{v.id}</div>
                        </td>
                        <td className={tdClass}>
                          {v.processingIssue ? t(ISSUE_LABEL[v.processingIssue.kind]) : ourStatusLabel(t, v.uploadStatus)}
                        </td>
                        <td className={tdClass}>{v.processingIssue?.reason || t('errorsPage.noReason')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data && (
        <section aria-labelledby="errors-dead">
          <h2 id="errors-dead" className="text-xl font-semibold text-fg mb-3">{t('errorsPage.deadTitle')}</h2>
          {data.deadLetters.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="errors-dead-empty">{t('errorsPage.deadEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="errors-dead">
                <caption className="sr-only">{t('errorsPage.deadCaption')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('errorsPage.colWhen')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colVideo')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colReason')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colAttempts')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deadLetters.map((d) => (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className={tdClass}>{formatDate(d.receivedAt, locale, true)}</td>
                      <td className={tdClass} dir="ltr">{d.videoId ?? '—'}</td>
                      <td className={tdClass}>{d.failureReason || t('errorsPage.noReason')}</td>
                      <td className={tdClass}>{d.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
