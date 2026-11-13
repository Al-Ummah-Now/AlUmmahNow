import {
  getVitalsSummary,
  formatVital,
  VITALS_DAYS,
  VITALS_DEVICES,
  VITALS_ENVS,
  VITALS_KINDS,
  VITALS_LOCALES,
  VITALS_METRICS,
  type VitalsEnv,
  type VitalsLocale,
  type VitalsMetric,
  type VitalsRating,
  type VitalsSummary,
  type VitalsValue,
} from '@/lib/api/vitals';
import { AdminApiError } from '@/lib/api/errors';
import { getAdminSession } from '@/lib/auth';
import { canReadOps } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, type MessageKey, type Translator } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The "good" limit per metric (web.dev, at p75), shown under each headline number */
const GOOD_LIMIT: Record<VitalsMetric, number> = { LCP: 2500, CLS: 0.1, INP: 200 };

const RATING_CLASS: Record<VitalsRating, string> = {
  good: 'bg-chip-resolved-bg text-chip-resolved-fg',
  needs_improvement: 'bg-chip-pending-bg text-chip-pending-fg',
  poor: 'bg-danger-bg text-danger-fg',
};

function RatingChip({ rating, t }: { rating: VitalsRating; t: Translator }) {
  return (
    <span className={`px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap ${RATING_CLASS[rating]}`} data-testid="vitals-rating" data-rating={rating}>
      {t(`vitalsPage.ratings.${rating}` as MessageKey)}
    </span>
  );
}

/** One p75 in a table cell: the value, its rating, and a mark when the sample is small */
function Cell({ metric, value, t, locale }: { metric: VitalsMetric; value?: VitalsValue; t: Translator; locale: string }) {
  if (!value) return <span className="text-fg-muted">{t('vitalsPage.noValue')}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" title={t('vitalsPage.loads', { count: value.samples })}>
      <span className="tabular-nums" dir="ltr">{formatVital(metric, value.p75, locale)}</span>
      <RatingChip rating={value.rating} t={t} />
      {value.few && (
        <span className="text-fg-muted" aria-label={t('vitalsPage.few')} title={t('vitalsPage.few')} data-testid="vitals-few">*</span>
      )}
    </span>
  );
}

/**
 * Web vitals (docs/operations/rum.md, wiki AUN-SEO phase 4): field LCP, CLS and INP of the videos
 * site at p75, from the sampled, cookieless beacons apps/web writes to Analytics Engine. Whole site,
 * then per page kind × device. Aggregates only, cached 5 minutes by admin-api. Admins (ops:read).
 */
export default async function WebVitalsPage({ searchParams }: PageProps) {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canReadOps(session?.user.role)) return <ErrorAlert testId="vitals-no-access">{t('vitalsPage.noAccess')}</ErrorAlert>;

  const params = await searchParams;
  const pick = <T extends string | number>(raw: unknown, list: readonly T[], fallback: T): T =>
    (list as readonly unknown[]).find((v) => String(v) === raw) as T | undefined ?? fallback;
  const env = pick<VitalsEnv>(params.env, VITALS_ENVS, 'production');
  const days = pick<number>(params.days, VITALS_DAYS, 7);
  const siteLocale = pick<VitalsLocale>(params.locale, VITALS_LOCALES, 'all');

  let summary: VitalsSummary | null = null;
  let loadError = '';
  try {
    summary = await getVitalsSummary(env, days, siteLocale);
  } catch (error) {
    logger.error('[vitals] Failed to load the web vitals', { error: error instanceof Error ? error.message : String(error) });
    loadError = error instanceof AdminApiError && error.status === 503 ? t('vitalsPage.notConfigured') : t('vitalsPage.loadFailed');
  }
  const label = (group: 'kinds' | 'devices', value: string, known: readonly string[]) =>
    known.includes(value) ? t(`vitalsPage.${group}.${value}` as MessageKey) : value;

  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('vitalsPage.title')}</h1>
        <p className="text-fg-muted mt-1">{t('vitalsPage.subtitle')}</p>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" data-testid="vitals-filters">
        <label className="flex flex-col gap-1 text-sm text-fg">
          {t('vitalsPage.environment')}
          <select name="env" defaultValue={env} className={fieldClass} data-testid="vitals-env">
            {VITALS_ENVS.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg">
          {t('vitalsPage.window')}
          <select name="days" defaultValue={String(days)} className={fieldClass} data-testid="vitals-days">
            {VITALS_DAYS.map((d) => (
              <option key={d} value={d}>{t(`vitalsPage.days${d}` as MessageKey)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg">
          {t('vitalsPage.language')}
          <select name="locale" defaultValue={siteLocale} className={fieldClass} data-testid="vitals-locale">
            {VITALS_LOCALES.map((l) => (
              <option key={l} value={l}>{t(`vitalsPage.locales.${l}` as MessageKey)}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={secondaryButtonClass}>{t('vitalsPage.show')}</button>
      </form>

      {loadError && <ErrorAlert testId="vitals-load-error">{loadError}</ErrorAlert>}
      {summary && (
        <>
          <section className="mb-6" aria-labelledby="vitals-overall-title" data-testid="vitals-overall">
            <h2 id="vitals-overall-title" className="text-xl font-semibold text-fg mb-3">{t('vitalsPage.overall')}</h2>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {VITALS_METRICS.map((metric) => {
                const v = summary!.overall[metric];
                return (
                  <div key={metric} className={`${cardClass} !p-4 flex flex-col gap-1`} data-testid={`vitals-overall-${metric}`}>
                    <dt className="text-sm text-fg">
                      <span className="font-medium">{t(`vitalsPage.metrics.${metric}` as MessageKey)}</span>
                      <span className="block text-fg-muted">{t(`vitalsPage.metricHints.${metric}` as MessageKey)}</span>
                    </dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      {v ? (
                        <>
                          <span className="text-2xl font-semibold text-fg tabular-nums" dir="ltr">{formatVital(metric, v.p75, locale)}</span>
                          <RatingChip rating={v.rating} t={t} />
                        </>
                      ) : (
                        <span className="text-2xl font-semibold text-fg-muted">{t('vitalsPage.noValue')}</span>
                      )}
                    </dd>
                    <dd className="text-xs text-fg-muted">
                      {t('vitalsPage.target', { value: formatVital(metric, GOOD_LIMIT[metric], locale) })}
                      {v && <> · {t('vitalsPage.loads', { count: v.samples })}</>}
                      {v?.few && <> · {t('vitalsPage.few')}</>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>

          <section aria-labelledby="vitals-pages-title" data-testid="vitals-pages">
            <h2 id="vitals-pages-title" className="text-xl font-semibold text-fg mb-1">{t('vitalsPage.byPage')}</h2>
            <p className="text-sm text-fg-muted mb-3 max-w-3xl">{t('vitalsPage.help')}</p>
            {summary.rows.length === 0 ? (
              <p className="text-fg-muted" data-testid="vitals-empty">{t('vitalsPage.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start text-fg-muted border-b border-border">
                      <th scope="col" className="py-2 pe-4 text-start">{t('vitalsPage.page')}</th>
                      <th scope="col" className="py-2 pe-4 text-start">{t('vitalsPage.device')}</th>
                      {VITALS_METRICS.map((m) => (
                        <th key={m} scope="col" className="py-2 pe-4 text-start">
                          <abbr title={t(`vitalsPage.metrics.${m}` as MessageKey)} className="no-underline">{m}</abbr>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((r) => (
                      <tr key={`${r.kind}|${r.device}`} className="border-b border-border" data-testid="vitals-row" data-kind={r.kind} data-device={r.device}>
                        <th scope="row" className="py-2 pe-4 text-start font-normal">{label('kinds', r.kind, VITALS_KINDS)}</th>
                        <td className="py-2 pe-4">{label('devices', r.device, VITALS_DEVICES)}</td>
                        {VITALS_METRICS.map((m) => (
                          <td key={m} className="py-2 pe-4">
                            <Cell metric={m} value={r.metrics[m]} t={t} locale={locale} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-fg-muted mt-2">* {t('vitalsPage.few')}</p>
              </div>
            )}
            <p className="text-xs text-fg-muted mt-3">{t('vitalsPage.generatedAt', { time: formatDate(summary.generatedAt, locale, true) })}</p>
          </section>
        </>
      )}
    </div>
  );
}
