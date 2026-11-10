'use client';

/**
 * Self-contained review of AI category suggestions: a table of videos with the
 * AI's suggestion, confidence and options, bulk accept / change-to, and Retry
 * for flagged ones. Used by /category-suggestions; the admin Videos pages can
 * host it as-is (it only needs a list from admin-api /api/category-suggestions).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import { acceptCategorySuggestions, retryCategorySuggestions, setVideoCategories } from '@/lib/api/admin';
import type { ActionResult } from '@/lib/api/errors';
import type { CategoryBulkResult, CategorySuggestionItem, CategorySuggestionQueue } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic, type Translator } from '@/i18n/translate';
import type { Locale } from '@/i18n/config';
import { ErrorAlert, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

export function categoryLabel(value: string | null | undefined, locale: Locale): string | null {
  if (!value) return null;
  const found = VIDEO_CATEGORIES.find((c) => c.value === value);
  return found ? found.label[locale] ?? found.label.en : value;
}

const pct = (confidence: number | null) => (confidence === null ? null : Math.round(confidence * 100));

function summarize(t: Translator, results: CategoryBulkResult[]): { ok: string | null; skipped: string | null } {
  const done = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const reasons = [...new Set(failed.map((r) => translateDynamic(t, 'categorySuggestions', `error_${r.error ?? 'unknown'}`).replace(/^error_/, '')))];
  return {
    ok: done ? t('categorySuggestions.resultOk', { count: done }) : null,
    skipped: failed.length ? t('categorySuggestions.resultSkipped', { count: failed.length, reasons: reasons.join(', ') }) : null,
  };
}

export function CategorySuggestionsReview({
  items,
  view,
  canEdit,
}: {
  items: CategorySuggestionItem[];
  view: CategorySuggestionQueue;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: string | null; skipped: string | null } | null>(null);

  const ids = items.map((i) => i.videoId);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function run(label: string, action: (videoIds: string[]) => Promise<ActionResult<{ results: CategoryBulkResult[] }>>, videoIds: string[]) {
    if (!videoIds.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action(videoIds);
      if (!result.ok) {
        logger.warn('[category-suggestions] Action refused', { label, status: result.status });
        setError(t('categorySuggestions.actionFailed'));
        return;
      }
      setNotice(summarize(t, result.data.results));
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      logger.error('[category-suggestions] Action failed', { label, error: e instanceof Error ? e.message : String(e) });
      setError(t('categorySuggestions.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  const chosen = [...selected];
  const flaggedView = view === 'flagged';

  return (
    <div data-testid="category-review" data-view={view}>
      {!canEdit && <p className="text-fg-muted mb-4" data-testid="category-readonly">{t('categorySuggestions.readOnly')}</p>}
      {error && <ErrorAlert testId="category-action-error">{error}</ErrorAlert>}
      {notice && (
        <div role="status" className="mb-4 text-sm" data-testid="category-action-result">
          {notice.ok && <p className="text-fg">{notice.ok}</p>}
          {notice.skipped && <p className="text-fg-muted">{notice.skipped}</p>}
        </div>
      )}

      {canEdit && items.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 mb-4" aria-label={t('categorySuggestions.selected', { count: chosen.length })}>
          <span className="text-sm text-fg-muted self-center" data-testid="category-selected-count">
            {t('categorySuggestions.selected', { count: chosen.length })}
          </span>
          {flaggedView ? (
            <button type="button" className={primaryButtonClass} disabled={busy || !chosen.length} onClick={() => run('retry', retryCategorySuggestions, chosen)} data-testid="category-retry-selected">
              {busy ? t('categorySuggestions.working') : t('categorySuggestions.retry')}
            </button>
          ) : (
            <button type="button" className={primaryButtonClass} disabled={busy || !chosen.length} onClick={() => run('accept', acceptCategorySuggestions, chosen)} data-testid="category-accept-selected">
              {busy ? t('categorySuggestions.working') : t('categorySuggestions.accept')}
            </button>
          )}
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            {t('categorySuggestions.changeTo')}
            <select value={target} onChange={(e) => setTarget(e.target.value)} className={fieldClass} data-testid="category-change-select">
              <option value="">—</option>
              {VIDEO_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label[locale] ?? c.label.en}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy || !chosen.length || !target}
            onClick={() => run('set', (videoIds) => setVideoCategories(videoIds, target), chosen)}
            data-testid="category-change-apply"
          >
            {t('categorySuggestions.apply')}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-fg-muted" data-testid="category-empty">{t('categorySuggestions.empty')}</p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                {canEdit && (
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      aria-label={t('categorySuggestions.selectAll')}
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(ids))}
                      data-testid="category-select-all"
                    />
                  </th>
                )}
                <th className="text-start px-4 py-3 text-fg-muted font-medium">{t('categorySuggestions.colVideo')}</th>
                <th className="text-start px-4 py-3 text-fg-muted font-medium">{t('categorySuggestions.colSuggestion')}</th>
                <th className="text-start px-4 py-3 text-fg-muted font-medium">{t('categorySuggestions.colCurrent')}</th>
                <th className="text-start px-4 py-3 text-fg-muted font-medium">{t('categorySuggestions.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const title = item.video?.title ?? t('categorySuggestions.untitled');
                const confidence = pct(item.confidence);
                const current = categoryLabel(item.video?.category, locale);
                return (
                  <tr key={item.videoId} className="border-t border-border align-top" data-testid="category-row" data-video-id={item.videoId}>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={t('categorySuggestions.selectVideo', { title })}
                          checked={selected.has(item.videoId)}
                          onChange={() => toggle(item.videoId)}
                          data-testid="category-select"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex gap-3 items-start">
                        {item.video?.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.video.thumbnailUrl} alt="" className="w-24 aspect-video object-cover rounded bg-surface-2 shrink-0" loading="lazy" />
                        ) : (
                          <div className="w-24 aspect-video rounded bg-surface-2 shrink-0" aria-hidden="true" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-fg break-words" dir="auto">{title}</p>
                          {item.video?.channelName && <p className="text-fg-muted" dir="auto">{item.video.channelName}</p>}
                          {item.video?.isPublic === false && <p className="text-fg-muted text-xs">{t('categorySuggestions.private')}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {item.category ? (
                        <>
                          <p className="font-medium text-fg" data-testid="category-suggested" data-category={item.category}>
                            {categoryLabel(item.category, locale)}
                          </p>
                          {confidence !== null && (
                            <div className="mt-1">
                              <span className="text-fg-muted">{t('categorySuggestions.confidence', { value: confidence })}</span>
                              <div className="mt-1 h-1.5 w-24 bg-surface-2 rounded" role="presentation">
                                <div className="h-1.5 bg-accent rounded" style={{ width: `${confidence}%` }} />
                              </div>
                            </div>
                          )}
                          {item.options.length > 1 && (
                            <div className="mt-2 flex flex-wrap gap-1" aria-label={t('categorySuggestions.options')}>
                              {item.options.slice(1).map((o) => (
                                <span key={o.category} className="px-2 py-0.5 rounded bg-surface-2 text-fg-muted text-xs">
                                  {categoryLabel(o.category, locale)} · {pct(o.confidence)}%
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-fg" data-testid="category-current" data-category={item.video?.category ?? ''}>
                        {current ?? t('categorySuggestions.noCategory')}
                      </p>
                      {current && item.video?.categorySource && (
                        <p className="text-fg-muted text-xs" data-testid="category-source" data-source={item.video.categorySource}>
                          {translateDynamic(t, 'categorySuggestions', `source_${item.video.categorySource}`)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-fg" data-testid="category-status" data-status={item.status}>
                        {item.outcome === 'accepted' || item.outcome === 'changed'
                          ? t(`categorySuggestions.outcome_${item.outcome}`)
                          : translateDynamic(t, 'categorySuggestions', `status_${item.status}`)}
                      </p>
                      {item.lastError && <p className="text-danger-fg text-xs break-words" dir="ltr">{item.lastError}</p>}
                      {item.attempts > 1 && <p className="text-fg-muted text-xs">{t('categorySuggestions.attempts', { count: item.attempts })}</p>}
                      {canEdit && flaggedView && (
                        <button type="button" className={`${secondaryButtonClass} mt-2`} disabled={busy} onClick={() => run('retry', retryCategorySuggestions, [item.videoId])} data-testid="category-retry">
                          {t('categorySuggestions.retry')}
                        </button>
                      )}
                      {canEdit && !flaggedView && item.category && item.status === 'done' && item.outcome === 'pending' && (
                        <button type="button" className={`${secondaryButtonClass} mt-2`} disabled={busy} onClick={() => run('accept', acceptCategorySuggestions, [item.videoId])} data-testid="category-accept">
                          {t('categorySuggestions.accept')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
