import Link from 'next/link';
import { VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import { getCategorySuggestionStats, listCategorySuggestions } from '@/lib/api/admin';
import type { CategorySuggestionList, CategorySuggestionQueue, CategorySuggestionStats } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import { formatNumber } from '@/i18n/translate';
import { CategorySuggestionsReview } from '@/components/CategorySuggestionsReview';
import { categoryLabel } from '@/lib/category-label';
import { ErrorAlert, cardClass, fieldClass, linkClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { CategorizeSettings, CategoryBackfill } from './CategorizeControls';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const VIEWS: CategorySuggestionQueue[] = ['review', 'needs_category', 'flagged', 'reviewed', 'all'];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CategorySuggestionsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const { t, locale } = await getI18n();
  const view: CategorySuggestionQueue = VIEWS.includes(raw.view as CategorySuggestionQueue) ? (raw.view as CategorySuggestionQueue) : 'review';
  const category = typeof raw.category === 'string' && VIDEO_CATEGORIES.some((c) => c.value === raw.category) ? raw.category : undefined;
  const page = Math.max(1, Number(raw.page) || 1);
  // Deep link to one video (e.g. from a video page)
  const videoId = typeof raw.video === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(raw.video) ? raw.video : undefined;

  let list: CategorySuggestionList | null = null;
  let stats: CategorySuggestionStats | null = null;
  try {
    [list, stats] = await Promise.all([
      listCategorySuggestions({ view, category, videoId, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      getCategorySuggestionStats(),
    ]);
  } catch (e) {
    logger.error('[category-suggestions] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }

  const n = (v: number) => formatNumber(v, locale);
  const href = (next: { view?: string; page?: number }) => {
    const q = new URLSearchParams();
    q.set('view', next.view ?? view);
    if (category && !next.view) q.set('category', category);
    if (videoId) q.set('video', videoId);
    if (next.page && next.page > 1) q.set('page', String(next.page));
    return `/category-suggestions?${q.toString()}`;
  };
  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-fg">{t('categorySuggestions.title')}</h1>
        <p className="text-fg-muted mt-1 max-w-3xl">{t('categorySuggestions.subtitle')}</p>
      </div>

      {!list && <ErrorAlert testId="category-load-error">{t('categorySuggestions.loadError')}</ErrorAlert>}

      {stats && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className={`${cardClass} lg:col-span-2`} aria-labelledby="explore-stats-title" data-testid="category-explore-stats">
            <h2 id="explore-stats-title" className="font-semibold text-fg">{t('categorySuggestions.exploreTitle')}</h2>
            <p className="text-sm text-fg-muted mt-1">{t('categorySuggestions.exploreHint')}</p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {stats.byCategory.map((c) => (
                <li key={c.category} className="flex justify-between gap-3 border border-border rounded px-3 py-2" data-testid="category-explore-row" data-category={c.category} data-videos={c.videos}>
                  <span className="text-fg">{categoryLabel(c.category, locale)}</span>
                  <span className="text-end text-sm">
                    <span className="block text-fg">{t('categorySuggestions.exploreVideos', { count: n(c.videos) })}</span>
                    {c.aiUnreviewed > 0 && <span className="block text-fg-muted">{t('categorySuggestions.exploreUnreviewed', { count: n(c.aiUnreviewed) })}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {stats.publicUncategorized > 0 && (
              <p className="text-sm text-fg-muted mt-3" data-testid="category-uncategorized" data-count={stats.publicUncategorized}>
                {t('categorySuggestions.exploreUncategorized', { count: n(stats.publicUncategorized) })}
              </p>
            )}
          </section>
          <section className={cardClass} aria-labelledby="categorize-usage-title" data-testid="categorize-usage">
            <div className="flex flex-wrap justify-between gap-2">
              <h2 id="categorize-usage-title" className="font-semibold text-fg">{t('categorySuggestions.usageTitle')}</h2>
              <span className={stats.config.enabled ? 'text-fg' : 'text-fg-muted'} data-testid="categorize-enabled-state" data-enabled={String(stats.config.enabled)}>
                {stats.config.enabled ? t('categorySuggestions.usageOn') : t('categorySuggestions.usageOff')}
              </span>
            </div>
            <p className="text-fg-muted mt-2" dir="auto">
              {t('categorySuggestions.usageLine', {
                neurons: n(Math.round(stats.usage.neurons)),
                cap: n(stats.config.dailyNeuronCap),
                calls: n(stats.usage.calls),
                usd: stats.usage.usd.toFixed(4),
              })}
            </p>
            {stats.config.dailyNeuronCap > 0 && (
              <div className="mt-2 h-2 bg-surface-2 rounded" role="presentation">
                <div className="h-2 bg-accent rounded" style={{ width: `${Math.min(100, (stats.usage.neurons / stats.config.dailyNeuronCap) * 100)}%` }} />
              </div>
            )}
          </section>
        </div>
      )}

      <nav aria-label={t('categorySuggestions.tabs')} className="flex flex-wrap gap-2 border-b border-border">
        {VIEWS.map((v) => {
          const active = v === view;
          return (
            <Link
              key={v}
              href={href({ view: v })}
              aria-current={active ? 'page' : undefined}
              className={`px-3 py-2 -mb-px border-b-2 ${active ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}
              data-testid={`category-tab-${v}`}
            >
              {t(`categorySuggestions.view_${v}`)}
              {stats && <span className="ms-2 text-xs rounded bg-surface-2 px-1.5 py-0.5" data-testid={`category-tab-count-${v}`}>{n(stats.views[v] ?? 0)}</span>}
            </Link>
          );
        })}
      </nav>
      <p className="text-sm text-fg-muted -mt-3">{t(`categorySuggestions.viewHint_${view}`)}</p>

      <form method="GET" action="/category-suggestions" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value={view} />
        {videoId && <input type="hidden" name="video" value={videoId} />}
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          {t('categorySuggestions.filterCategory')}
          <select name="category" defaultValue={category ?? ''} className={fieldClass} data-testid="category-filter">
            <option value="">{t('categorySuggestions.anyCategory')}</option>
            {VIDEO_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label[locale] ?? c.label.en}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={secondaryButtonClass}>{t('categorySuggestions.filter')}</button>
      </form>

      {list && <CategorySuggestionsReview key={`${view}-${category ?? ''}-${videoId ?? ''}-${page}`} items={list.items} view={view} canEdit={list.canEdit} />}

      {list && totalPages > 1 && (
        <div className="flex items-center gap-4 text-sm">
          {page > 1 && <Link className={linkClass} href={href({ page: page - 1 })}>{t('categorySuggestions.prev')}</Link>}
          <span className="text-fg-muted">{t('categorySuggestions.pageOf', { page: n(page), total: n(totalPages) })}</span>
          {page < totalPages && <Link className={linkClass} href={href({ page: page + 1 })}>{t('categorySuggestions.next')}</Link>}
        </div>
      )}

      {stats?.canEdit && (
        <div className="grid gap-6 lg:grid-cols-2">
          <CategorizeSettings initial={stats.config} />
          <CategoryBackfill />
        </div>
      )}
    </div>
  );
}
