import { STATUS_COMPONENTS } from '@al-ummah/shared-types';
import { getStatusOverview } from '@/lib/api/status';
import type { StatusOverview } from '@/lib/api/status-types';
import { AdminApiError } from '@/lib/api/errors';
import { getAdminSession } from '@/lib/auth';
import { canReadOps } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { DeletedIncidents, IncidentCard, NewIncidentForm } from './StatusAdmin';
import { publicStatusUrl } from './model';

export const dynamic = 'force-dynamic';

const STATE_CLASS: Record<string, string> = {
  operational: 'text-success-fg',
  degraded: 'text-warning-fg',
  partial: 'text-warning-fg',
  major: 'text-danger-fg',
};


/**
 * Status (docs/status-page/README.md): what the public status page's checks see now, and the
 * incidents and scheduled maintenance admins post there (en + ar). Admins and super admins.
 */
export default async function StatusAdminPage() {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canReadOps(session?.user.role)) return <ErrorAlert testId="status-no-access">{t('statusPage.noAccess')}</ErrorAlert>;

  let overview: StatusOverview | null = null;
  let loadError = '';
  try {
    overview = await getStatusOverview();
  } catch (error) {
    logger.error('[status] Failed to load the overview', { error: error instanceof Error ? error.message : String(error) });
    loadError = error instanceof AdminApiError && error.status === 503 ? t('statusPage.notConfigured') : t('statusPage.loadFailed');
  }
  const percent = (v: number) => new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const name = (id: string) => STATUS_COMPONENTS.find((c) => c.id === id)?.[locale === 'ar' ? 'ar' : 'en'] ?? id;

  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('statusPage.title')}</h1>
        <p className="text-fg-muted mt-1">{t('statusPage.subtitle')}</p>
        <p className="mt-1">
          <a className={linkClass} href={publicStatusUrl()} target="_blank" rel="noopener noreferrer" data-testid="status-public-link">{t('statusPage.openPublic')}</a>
        </p>
      </div>
      {loadError && <ErrorAlert testId="status-load-error">{loadError}</ErrorAlert>}
      {overview && (
        <>
          <NewIncidentForm />

          <section className="mb-6" aria-labelledby="status-open-title" data-testid="status-open">
            <h2 id="status-open-title" className="text-xl font-semibold text-fg mb-3">{t('statusPage.open')}</h2>
            {overview.open.length ? overview.open.map((i) => <IncidentCard key={i.id} incident={i} open />) : <p className="text-fg-muted" data-testid="status-open-empty">{t('statusPage.openEmpty')}</p>}
          </section>

          <section className={`${cardClass} mb-6`} aria-labelledby="status-checks-title" data-testid="status-checks">
            <h2 id="status-checks-title" className="text-lg font-semibold text-fg mb-1">{t('statusPage.checks.title')}</h2>
            <p className="text-sm text-fg-muted mb-3">{t('statusPage.checks.note')}</p>
            {overview.checks.length === 0 && <p className="text-fg-muted mb-3">{t('statusPage.checks.empty')}</p>}
            {(['public', 'internal'] as const).map((group) => (
              <div key={group} className="overflow-x-auto mb-4" data-testid={`status-checks-${group}`}>
                <h3 className="font-semibold text-fg mt-2">{t(`statusPage.checks.${group}`)}</h3>
                <p className="text-sm text-fg-muted mb-2">{t(`statusPage.checks.${group}Note`)}</p>
                <table className="w-full text-sm">
                  <caption className="sr-only">{t(`statusPage.checks.${group}`)}</caption>
                  <thead>
                    <tr className="text-fg-muted">
                      <th scope="col" className="p-2 text-start font-medium">{t('statusPage.checks.component')}</th>
                      <th scope="col" className="p-2 text-start font-medium">{t('statusPage.checks.state')}</th>
                      <th scope="col" className="p-2 text-start font-medium">{t('statusPage.checks.since')}</th>
                      <th scope="col" className="p-2 text-end font-medium">{t('statusPage.checks.uptime')}</th>
                      <th scope="col" className="p-2 text-start font-medium">{t('statusPage.checks.detail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STATUS_COMPONENTS.filter((c) => c.public === (group === 'public')).map((c) => {
                      const row = overview!.checks.find((x) => x.component === c.id);
                      const up = overview!.uptime90?.[c.id];
                      return (
                        <tr key={c.id} className="border-t border-border" data-testid="status-check-row" data-component={c.id} data-public={c.public ? 'true' : 'false'} data-state={row?.state ?? 'none'}>
                          <th scope="row" className="p-2 text-start font-normal text-fg">{name(c.id)}</th>
                          <td className={`p-2 font-medium ${row ? STATE_CLASS[row.state] : 'text-fg-muted'}`}>{row ? t(`statusPage.states.${row.state}` as MessageKey) : '—'}</td>
                          <td className="p-2 whitespace-nowrap text-fg-muted">{row ? formatDate(row.since, locale, true) : '—'}</td>
                          <td className="p-2 text-end tabular-nums text-fg-muted">{typeof up === 'number' ? percent(up) : '—'}</td>
                          <td className="p-2 text-fg-muted break-words" dir="ltr">{row?.detail ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </section>

          <section className="mb-6" aria-labelledby="status-recent-title" data-testid="status-recent">
            <h2 id="status-recent-title" className="text-xl font-semibold text-fg mb-3">{t('statusPage.recent')}</h2>
            {overview.recent.length ? overview.recent.map((i) => <IncidentCard key={i.id} incident={i} open={false} />) : <p className="text-fg-muted">{t('statusPage.recentEmpty')}</p>}
          </section>

          <section className={cardClass} aria-labelledby="status-deleted-title" data-testid="status-deleted">
            <h2 id="status-deleted-title" className="text-lg font-semibold text-fg mb-3">{t('statusPage.deletedTitle')}</h2>
            <DeletedIncidents items={overview.deleted} />
          </section>
        </>
      )}
    </div>
  );
}
