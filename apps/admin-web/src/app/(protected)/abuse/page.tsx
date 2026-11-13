import { getAbuseSummary, ABUSE_ENVS, ABUSE_KINDS, type AbuseEnv, type AbuseSummary } from '@/lib/api/abuse';
import { AdminApiError } from '@/lib/api/errors';
import { getAdminSession } from '@/lib/auth';
import { canReadOps } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const HOURS = [24, 168] as const;

/**
 * Abuse (docs/features/bot-protection.md): Cloudflare Turnstile outcomes and rate-limit refusals
 * per endpoint, from the Analytics Engine counters every Worker writes. Aggregates only, cached
 * 5 minutes by admin-api; no D1. Admins (ops:read).
 */
export default async function AbusePage({ searchParams }: PageProps) {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canReadOps(session?.user.role)) return <ErrorAlert testId="abuse-no-access">{t('abusePage.noAccess')}</ErrorAlert>;

  const params = await searchParams;
  const envParam = typeof params.env === 'string' ? params.env : 'production';
  const env: AbuseEnv = (ABUSE_ENVS as string[]).includes(envParam) ? (envParam as AbuseEnv) : 'production';
  const hours = params.hours === '168' ? 168 : 24;

  let summary: AbuseSummary | null = null;
  let loadError = '';
  try {
    summary = await getAbuseSummary(env, hours);
  } catch (error) {
    logger.error('[abuse] Failed to load the counters', { error: error instanceof Error ? error.message : String(error) });
    loadError = error instanceof AdminApiError && error.status === 503 ? t('abusePage.notConfigured') : t('abusePage.loadFailed');
  }
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  const kindLabel = (kind: string) =>
    (ABUSE_KINDS as readonly string[]).includes(kind) ? t(`abusePage.kinds.${kind}` as MessageKey) : kind;

  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('abusePage.title')}</h1>
        <p className="text-fg-muted mt-1">{t('abusePage.subtitle', { hours })}</p>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" data-testid="abuse-filters">
        <label className="flex flex-col gap-1 text-sm text-fg">
          {t('abusePage.environment')}
          <select name="env" defaultValue={env} className={fieldClass} data-testid="abuse-env">
            {ABUSE_ENVS.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg">
          {t('abusePage.window')}
          <select name="hours" defaultValue={String(hours)} className={fieldClass} data-testid="abuse-hours">
            {HOURS.map((h) => (
              <option key={h} value={h}>{t(h === 24 ? 'abusePage.hours24' : 'abusePage.hours168')}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={secondaryButtonClass}>{t('abusePage.show')}</button>
      </form>

      {loadError && <ErrorAlert testId="abuse-load-error">{loadError}</ErrorAlert>}
      {summary && (
        <>
          <section className="mb-6" aria-labelledby="abuse-totals-title" data-testid="abuse-totals">
            <h2 id="abuse-totals-title" className="text-xl font-semibold text-fg mb-3">{t('abusePage.totals')}</h2>
            <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {ABUSE_KINDS.map((kind) => (
                <div key={kind} className={`${cardClass} !p-4`} data-testid={`abuse-total-${kind}`}>
                  <dt className="text-sm text-fg-muted">{kindLabel(kind)}</dt>
                  <dd className="text-2xl font-semibold text-fg tabular-nums">{number(summary!.totals[kind] ?? 0)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="abuse-endpoints-title" data-testid="abuse-endpoints">
            <h2 id="abuse-endpoints-title" className="text-xl font-semibold text-fg mb-3">{t('abusePage.byEndpoint')}</h2>
            {summary.rows.length === 0 ? (
              <p className="text-fg-muted" data-testid="abuse-empty">{t('abusePage.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start text-fg-muted border-b border-border">
                      <th scope="col" className="py-2 pe-4 text-start">{t('abusePage.endpoint')}</th>
                      <th scope="col" className="py-2 pe-4 text-start">{t('abusePage.app')}</th>
                      <th scope="col" className="py-2 pe-4 text-start">{t('abusePage.kind')}</th>
                      <th scope="col" className="py-2 text-end">{t('abusePage.count')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((r) => (
                      <tr key={`${r.app}|${r.endpoint}|${r.kind}`} className="border-b border-border" data-testid="abuse-row">
                        <td className="py-2 pe-4 font-mono" dir="ltr">{r.endpoint}</td>
                        <td className="py-2 pe-4">{r.app}</td>
                        <td className="py-2 pe-4">{kindLabel(r.kind)}</td>
                        <td className="py-2 text-end tabular-nums">{number(r.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-fg-muted mt-3">{t('abusePage.generatedAt', { time: formatDate(summary.generatedAt, locale, true) })}</p>
          </section>
        </>
      )}
    </div>
  );
}
