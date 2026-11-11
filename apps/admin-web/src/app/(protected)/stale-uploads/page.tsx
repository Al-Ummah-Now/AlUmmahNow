import Link from '@/components/AppLink';
import { getStaleUploads } from '@/lib/api/admin';
import type { StaleUploadsResponse } from '@/lib/api/types';
import { getAdminSession } from '@/lib/auth';
import { canUseStaleUploads } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, cardClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { FILTER_LABEL, STALE_FILTERS, parseStaleFilter, statusQuery, TYPE_LABEL } from './labels';
import { ReaperPanel } from './ReaperPanel';
import { StaleUploadsTable } from './StaleUploadsTable';
import { LiveRefresh } from '@/components/LiveRefresh';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const thClass = 'text-start px-4 py-3 text-fg-muted font-medium whitespace-nowrap';
const tdClass = 'px-4 py-3 align-top text-sm';

/**
 * Stale uploads: upload placeholders whose bytes never arrived and Bunny
 * videos without a record, found by the upload reaper (api-videos
 * lib/uploads/reaper.ts). Delete now / Keep / Retry and the reaper's mode go
 * through admin-api (videos:uploads + audit) and queue the work.
 */
export default async function StaleUploadsPage({ searchParams }: PageProps) {
  const filter = parseStaleFilter((await searchParams).status);
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canUseStaleUploads(session?.user.role)) {
    return <ErrorAlert testId="stale-uploads-no-access">{t('staleUploads.noAccess')}</ErrorAlert>;
  }

  let data: StaleUploadsResponse | null = null;
  try {
    data = await getStaleUploads(statusQuery(filter));
  } catch (e) {
    logger.error('[stale-uploads] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }
  const now = Date.now();

  return (
    <div className="space-y-8">
      <LiveRefresh topics={['uploads']} />
      <div>
        <h1 className="text-3xl font-bold text-fg">{t('staleUploads.title')}</h1>
        <p className="text-fg-muted mt-1 max-w-3xl">{t('staleUploads.subtitle')}</p>
      </div>

      {!data && <ErrorAlert testId="stale-uploads-error">{t('staleUploads.loadFailed')}</ErrorAlert>}

      {data && <ReaperPanel config={data.config} sweep={data.sweep} locale={locale} />}

      {data && (
        <section aria-labelledby="stale-items">
          <h2 id="stale-items" className="sr-only">{t('staleUploads.tableCaption')}</h2>
          <nav aria-label={t('staleUploads.filterLabel')} className="mb-4">
            <ul className="flex flex-wrap gap-2">
              {STALE_FILTERS.map((f) => {
                const active = f === filter;
                const count = f === 'open' || f === 'all' ? undefined : data!.counts[f as keyof typeof data.counts];
                return (
                  <li key={f}>
                    <Link
                      href={f === 'open' ? '/stale-uploads' : `/stale-uploads?status=${f}`}
                      aria-current={active ? 'page' : undefined}
                      data-testid={`stale-filter-${f}`}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                        active ? 'bg-accent text-on-accent border-accent' : 'bg-surface text-fg border-border hover:bg-surface-hover'
                      }`}
                    >
                      {t(FILTER_LABEL[f])}
                      {count !== undefined && <span className="tabular-nums opacity-80">{count}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <StaleUploadsTable items={data.items} locale={locale} now={now} />
        </section>
      )}

      {data && (
        <section aria-labelledby="stale-deletes">
          <h2 id="stale-deletes" className="text-xl font-semibold text-fg mb-3">{t('staleUploads.deletesTitle')}</h2>
          {data.audit.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="stale-deletes-empty">{t('staleUploads.deletesEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="stale-deletes">
                <caption className="sr-only">{t('staleUploads.deletesTitle')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('staleUploads.colWhen')}</th>
                    <th className={thClass} scope="col">{t('staleUploads.colVideo')}</th>
                    <th className={thClass} scope="col">{t('staleUploads.colType')}</th>
                    <th className={thClass} scope="col">{t('staleUploads.colBy')}</th>
                    <th className={thClass} scope="col">{t('staleUploads.colMode')}</th>
                    <th className={thClass} scope="col">{t('staleUploads.colResult')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((row) => (
                    <tr key={row.key} className="border-b border-border last:border-0">
                      <td className={tdClass}>{formatDate(row.at, locale, true)}</td>
                      <td className={tdClass} dir="ltr">{row.videoId}</td>
                      <td className={tdClass}>{t(TYPE_LABEL[row.target])}</td>
                      <td className={tdClass} dir="auto">{row.actor}</td>
                      <td className={tdClass}>{row.force ? t('staleUploads.deleteNow') : row.mode === 'live' ? t('staleUploads.modeLive') : t('staleUploads.modeDryRun')}</td>
                      <td className={tdClass}>
                        {row.state !== 'done' ? t('staleUploads.resultStarted') : row.bunnyDeleted ? t('staleUploads.resultDone') : t('staleUploads.resultMarked')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data && (
        <section aria-labelledby="stale-dead">
          <h2 id="stale-dead" className="text-xl font-semibold text-fg mb-3">{t('staleUploads.deadTitle')}</h2>
          {data.deadLetters.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="stale-dead-empty">{t('staleUploads.deadEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="stale-dead">
                <caption className="sr-only">{t('staleUploads.deadTitle')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('staleUploads.colWhen')}</th>
                    <th className={thClass} scope="col">{t('staleUploads.colVideo')}</th>
                    <th className={thClass} scope="col">{t('staleUploads.colReason')}</th>
                    <th className={thClass} scope="col">{t('staleUploads.colAttempts')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deadLetters.map((d) => (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className={tdClass}>{formatDate(d.receivedAt, locale, true)}</td>
                      <td className={tdClass} dir="ltr">{d.videoId ?? '—'}</td>
                      <td className={tdClass}>{d.failureReason || '—'}</td>
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
