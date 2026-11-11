import Link from '@/components/AppLink';
import { getAiConfig, getAiUsage, listAiSignals } from '@/lib/api/admin';
import type { AiConfigView, AiSignalList, AiUsageView } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import { formatDate, formatNumber, translateDynamic } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, linkClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const REVIEW = ['pending', 'agreed', 'disagreed', 'n/a'] as const;
const DECISIONS = ['would_flag', 'would_hide', 'flag', 'hide', 'skipped', 'none'] as const;
const LANGUAGES = ['ar', 'en', 'other'] as const;
const SURFACES = ['video_comment', 'community_post', 'post_comment', 'video_metadata'] as const;

const thClass = 'text-start px-4 py-3 text-fg-muted font-medium whitespace-nowrap';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pick<T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

export default async function AiModerationPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const { t, locale } = await getI18n();
  // Default view: what reviewers need to look at
  const review_status = raw.review_status === 'any' ? undefined : pick(raw.review_status, REVIEW) ?? 'pending';
  const decision = pick(raw.decision, DECISIONS);
  const language = pick(raw.language, LANGUAGES);
  const surface = pick(raw.surface, SURFACES);
  const page = Math.max(1, Number(raw.page) || 1);

  let data: AiSignalList | null = null;
  let usage: AiUsageView | null = null;
  let config: AiConfigView | null = null;
  let failed = false;
  try {
    [data, usage, config] = await Promise.all([
      listAiSignals({ review_status, decision, language, surface, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      getAiUsage(1),
      getAiConfig(),
    ]);
  } catch (e) {
    failed = true;
    logger.error('[ai-moderation] Failed to load signals', { error: e instanceof Error ? e.message : String(e) });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 0;
  const href = (p: number) => {
    const q = new URLSearchParams();
    q.set('review_status', review_status ?? 'any');
    if (decision) q.set('decision', decision);
    if (language) q.set('language', language);
    if (surface) q.set('surface', surface);
    if (p > 1) q.set('page', String(p));
    return `/moderation/ai?${q.toString()}`;
  };

  const select = (name: string, label: string, value: string | undefined, options: readonly string[], prefix: string, anyValue = '') => (
    <label className="flex flex-col gap-1 text-sm text-fg-muted">
      {label}
      <select name={name} defaultValue={value ?? anyValue} className={fieldClass}>
        <option value={anyValue}>{t('ai.any')}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {translateDynamic(t, prefix, o)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-fg">{t('ai.title')}</h1>
          <p className="text-fg-muted mt-1">{t('ai.subtitle')}</p>
          {data && (
            <p className="text-fg-muted mt-1" data-testid="ai-total" data-total={data.total}>
              {t('ai.totalCount', { count: data.total })}
            </p>
          )}
        </div>
        <Link href="/moderation/ai/settings" className={secondaryButtonClass} data-testid="ai-settings-link">
          {t('ai.settingsLink')}
        </Link>
      </div>

      {failed && <ErrorAlert testId="ai-error">{t('errors.loadReports')}</ErrorAlert>}

      {usage && config && (
        <section className={`${cardClass} mb-6`} aria-label={t('ai.usageTitle')} data-testid="ai-usage">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="font-semibold text-fg">{t('ai.usageTitle')}</h2>
            <span className={config.enabled ? 'text-fg' : 'text-fg-muted'} data-testid="ai-enabled" data-enabled={String(config.enabled)}>
              {config.enabled ? t('ai.usageOn') : t('ai.usageOff')}
            </span>
          </div>
          <p className="text-fg-muted mt-2" dir="auto">
            {t('ai.usageToday', {
              neurons: formatNumber(Math.round(usage.today.neurons), locale),
              cap: formatNumber(usage.dailyNeuronCap ?? 0, locale),
              usd: usage.today.usd.toFixed(4),
            })}
          </p>
          {usage.dailyNeuronCap ? (
            <div className="mt-2 h-2 bg-surface-2 rounded" role="presentation">
              <div className="h-2 bg-accent rounded" style={{ width: `${Math.min(100, (usage.today.neurons / usage.dailyNeuronCap) * 100)}%` }} />
            </div>
          ) : null}
        </section>
      )}

      <form method="GET" action="/moderation/ai" aria-label={t('ai.filtersLabel')} className="flex flex-wrap items-end gap-3 mb-6">
        {select('review_status', t('ai.filterReview'), review_status, REVIEW, 'aiReview', 'any')}
        {select('decision', t('ai.filterDecision'), decision, DECISIONS, 'aiDecision')}
        {select('language', t('ai.filterLanguage'), language, LANGUAGES, 'aiLanguage')}
        {select('surface', t('ai.filterSurface'), surface, SURFACES, 'aiSurface')}
        <button type="submit" className={primaryButtonClass}>{t('ai.applyFilters')}</button>
        <Link href="/moderation/ai" className={linkClass}>{t('ai.clearFilters')}</Link>
      </form>

      <p className="text-sm text-fg-subtle mb-3">{t('ai.shadowHint')}</p>

      {data && data.signals.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-8 text-center text-fg-muted" data-testid="ai-empty">
          {t('ai.noSignals')}
        </div>
      )}

      {data && data.signals.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-x-auto">
          <table className="w-full" data-testid="ai-table">
            <caption className="sr-only">{t('ai.tableCaption')}</caption>
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className={thClass}>{t('ai.colCategory')}</th>
                <th scope="col" className={thClass}>{t('ai.colScore')}</th>
                <th scope="col" className={thClass}>{t('ai.colDecision')}</th>
                <th scope="col" className={thClass}>{t('ai.colLanguage')}</th>
                <th scope="col" className={thClass}>{t('ai.colSurface')}</th>
                <th scope="col" className={thClass}>{t('ai.colReview')}</th>
                <th scope="col" className={thClass}>{t('ai.colDate')}</th>
                <th scope="col" className={thClass}>{t('ai.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.signals.map((s) => (
                <tr key={s.id} className="hover:bg-surface-hover" data-testid="ai-row" data-signal-id={s.id} data-decision={s.decision}>
                  <td className="px-4 py-3 text-fg">{s.top_category ? translateDynamic(t, 'aiCategory', s.top_category) : '—'}</td>
                  <td className="px-4 py-3 text-fg-muted" dir="ltr">{s.top_score === null ? '—' : s.top_score.toFixed(2)}</td>
                  <td className="px-4 py-3 text-fg-muted">
                    {translateDynamic(t, 'aiDecision', s.decision)}
                    {s.skip_reason && <span className="block text-xs text-fg-subtle">{translateDynamic(t, 'aiSkip', s.skip_reason)}</span>}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{s.language ? translateDynamic(t, 'aiLanguage', s.language) : '—'}</td>
                  <td className="px-4 py-3 text-fg-muted">{translateDynamic(t, 'aiSurface', s.surface)}</td>
                  <td className="px-4 py-3 text-fg-muted">{translateDynamic(t, 'aiReview', s.review_status)}</td>
                  <td className="px-4 py-3 text-fg-muted text-sm whitespace-nowrap">
                    <time dateTime={s.created_at}>{formatDate(s.created_at, locale, true)}</time>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/moderation/ai/${encodeURIComponent(s.id)}`} className={linkClass} aria-label={t('ai.viewSignal', { id: s.id.slice(0, 8) })}>
                      {t('ai.view')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav aria-label={t('moderation.paginationLabel')} className="flex justify-center items-center gap-2 mt-6">
          {page > 1 && <Link href={href(page - 1)} className={secondaryButtonClass} rel="prev">{t('moderation.previous')}</Link>}
          <span className="px-4 py-2 text-fg-muted" aria-current="page">{t('moderation.pageOf', { page, total: totalPages })}</span>
          {page < totalPages && <Link href={href(page + 1)} className={secondaryButtonClass} rel="next">{t('moderation.next')}</Link>}
        </nav>
      )}
    </div>
  );
}
