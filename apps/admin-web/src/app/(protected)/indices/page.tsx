import { getIndexStatus } from '@/lib/api/admin';
import type { IndexStats } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import { formatDate, formatNumber } from '@/i18n/translate';
import { ErrorAlert, cardClass } from '@/components/ui';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const thClass = 'text-start px-4 sm:px-6 py-3 text-fg-muted font-medium whitespace-nowrap';

export default async function IndicesPage() {
  const { t, locale } = await getI18n();
  let stats: IndexStats | null = null;
  let failed = false;

  try {
    stats = await getIndexStatus();
  } catch (e) {
    failed = true;
    logger.error('[indices] Failed to load index status', { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-fg">{t('indices.title')}</h1>
        <p className="text-fg-muted mt-2">{t('indices.subtitle')}</p>
      </div>

      {failed && <ErrorAlert testId="indices-error">{t('errors.loadIndices')}</ErrorAlert>}

      {stats && (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
            <div className={cardClass} data-testid="indices-total-videos">
              <dt className="text-fg-muted text-sm font-medium">{t('indices.totalVideos')}</dt>
              <dd className="text-3xl font-bold text-fg mt-2" data-value={stats.totalVideos}>
                {formatNumber(stats.totalVideos, locale)}
              </dd>
            </div>
          </dl>

          {stats.indices.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="indices-empty">
              {t('indices.none')}
            </div>
          ) : (
            // Focusable so keyboard users can scroll the table on narrow screens
            <div
              className="bg-surface border border-border rounded-lg overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              role="region"
              aria-label={t('indices.tableCaption')}
              tabIndex={0}
            >
              <table className="w-full" data-testid="indices-table">
                <caption className="sr-only">{t('indices.tableCaption')}</caption>
                <thead className="bg-surface-2">
                  <tr>
                    <th scope="col" className={thClass}>{t('indices.colName')}</th>
                    <th scope="col" className={thClass}>{t('indices.colCount')}</th>
                    <th scope="col" className={thClass}>{t('indices.colUpdated')}</th>
                    <th scope="col" className={thClass}>{t('indices.colState')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stats.indices.map((index) => (
                    <tr key={index.name} data-testid="index-row" data-index={index.name}>
                      <td className="px-4 sm:px-6 py-4 font-mono text-sm text-fg" dir="ltr">{index.name}</td>
                      <td className="px-4 sm:px-6 py-4 text-fg">{formatNumber(index.count, locale)}</td>
                      <td className="px-4 sm:px-6 py-4 text-fg-muted text-sm whitespace-nowrap">
                        <time dateTime={index.lastUpdated}>{formatDate(index.lastUpdated, locale, true)}</time>
                      </td>
                      <td className="px-4 sm:px-6 py-4">
                        <span
                          className={`px-2 py-1 rounded text-sm font-medium ${
                            index.stale
                              ? 'bg-chip-pending-bg text-chip-pending-fg'
                              : 'bg-chip-resolved-bg text-chip-resolved-fg'
                          }`}
                        >
                          {index.stale ? t('indices.stale') : t('indices.fresh')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
