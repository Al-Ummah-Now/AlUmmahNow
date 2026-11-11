'use client';

/**
 * A list's saved views ("All", "Processing", "Failed", ...) as a row of tabs
 * with counts. A view is a set of filters in the URL (lib/list/params.ts), so
 * these are buttons that change the filters, with aria-current on the one the
 * URL matches. Counts load on their own; a count that matters (failures) can
 * take the "bad" tone.
 */
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';

export interface SavedViewTab {
  id: string;
  label: string;
  /** undefined while loading, null when it could not be read. */
  count?: number | null;
  /** Shown in the danger colours when the count is above zero. */
  alertWhenNonZero?: boolean;
  countTestId?: string;
}

export function SavedViews({ views, active, onSelect, label, testId }: { views: SavedViewTab[]; active: string | null; onSelect: (id: string) => void; label: string; testId: string }) {
  const { locale } = useLanguage();
  return (
    <nav aria-label={label} className="mb-4 -mx-1 overflow-x-auto" data-testid={testId}>
      <ul className="flex gap-1 px-1 border-b border-border min-w-max">
        {views.map((view) => {
          const current = view.id === active;
          const alert = view.alertWhenNonZero && !!view.count;
          return (
            <li key={view.id}>
              <button
                type="button"
                onClick={() => onSelect(view.id)}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex items-center gap-2 px-3 py-2 -mb-px border-b-2 text-sm font-medium rounded-t focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  current ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg hover:border-border'
                }`}
                data-testid={`saved-view-${view.id}`}
                data-view={view.id}
              >
                {view.label}
                <span
                  className={`min-w-6 rounded-full px-2 py-0.5 text-xs tabular-nums text-center ${alert ? 'bg-danger-bg text-danger-fg' : 'bg-surface-2 text-fg-muted'}`}
                  data-testid={view.countTestId}
                  data-count={typeof view.count === 'number' ? view.count : undefined}
                  aria-busy={view.count === undefined ? true : undefined}
                >
                  {typeof view.count === 'number' ? formatNumber(view.count, locale) : view.count === null ? '–' : <span className="inline-block h-3 w-4 animate-pulse rounded bg-border align-middle" aria-hidden="true" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
