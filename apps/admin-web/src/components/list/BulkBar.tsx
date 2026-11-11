'use client';

/**
 * The floating bulk bar: shown while rows are selected, it stays at the bottom
 * of the screen as the list scrolls. It says how many are selected, holds the
 * list's bulk actions (children) and a way to clear the selection, and
 * announces the count politely.
 */
import { useLanguage } from '@/i18n/I18nProvider';
import { linkClass } from '@/components/ui';

export function BulkBar({ count, label, selectedText, onClear, children, extra, testId, countTestId }: { count: number; label: string; selectedText: string; onClear: () => void; children: React.ReactNode; extra?: React.ReactNode; testId: string; countTestId?: string }) {
  const { t } = useLanguage();
  return (
    <div
      role="region"
      aria-label={label}
      hidden={count === 0}
      className="sticky bottom-4 z-20 mt-4 bg-surface border border-border rounded-lg shadow-lg p-3 flex flex-col gap-3"
      data-testid={testId}
      data-count={count}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg me-2" aria-live="polite" data-testid={countTestId}>
          {selectedText}
        </span>
        {children}
        <button type="button" className={`${linkClass} text-sm ms-auto`} onClick={onClear} data-testid={`${testId}-clear`}>
          {t('list.clearSelection')}
        </button>
      </div>
      {extra}
    </div>
  );
}
