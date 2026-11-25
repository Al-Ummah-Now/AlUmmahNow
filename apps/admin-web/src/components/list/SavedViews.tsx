'use client';

/**
 * A list's saved views ("All", "Processing", "Failed", ...) as a row of tabs
 * with counts. A view is a set of filters in the URL (lib/list/params.ts), so
 * these are buttons that change the filters, with aria-current on the one the
 * URL matches. Counts load on their own; a count that matters (failures) can
 * take the "bad" tone.
 *
 * One row: the views that fit, the rest under "More" (PriorityTabs; owner rule: a strip never wraps
 * or cuts a label). A view with nothing in it is left out, except the first and the current one.
 */
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';
import { PriorityTabs } from '@/components/PriorityTabs';
import { shownViews } from '@/lib/list/shown-views';

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
    <PriorityTabs
      label={label}
      testId={testId}
      className="mb-4 border-b border-border"
      rowClassName="gap-1"
      tabClassName="inline-flex items-center gap-2 whitespace-nowrap px-3 py-2 -mb-px border-b-2 text-sm font-medium rounded-t focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      currentClassName="border-accent text-fg"
      idleClassName="border-transparent text-fg-muted hover:text-fg hover:border-border"
      tabTestIdPrefix="saved-view-"
      currentButtons
      onSelect={onSelect}
      tabs={shownViews(views, (view) => view.id === active).map((view) => ({
        id: view.id,
        label: view.label,
        current: view.id === active,
        extraKey: String(view.count),
        extra: (
          <span
            className={`min-w-6 rounded-full px-2 py-0.5 text-xs tabular-nums text-center ${view.alertWhenNonZero && !!view.count ? 'bg-danger-bg text-danger-fg' : 'bg-surface-2 text-fg-muted'}`}
            data-testid={view.countTestId}
            data-count={typeof view.count === 'number' ? view.count : undefined}
            aria-busy={view.count === undefined ? true : undefined}
          >
            {typeof view.count === 'number' ? formatNumber(view.count, locale) : view.count === null ? '–' : <span className="inline-block h-3 w-4 animate-pulse rounded bg-border align-middle" aria-hidden="true" />}
          </span>
        ),
      }))}
    />
  );
}
