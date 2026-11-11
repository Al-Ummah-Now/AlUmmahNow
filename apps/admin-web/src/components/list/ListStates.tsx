'use client';

/**
 * What a list shows when it has no rows to show: skeleton rows while the
 * first page loads, a helpful empty state (with the way out: clear the
 * filters), and the shared FriendlyError, reported once with its reference,
 * when the list could not be read.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { FriendlyError } from '@/components/FriendlyError';
import { reportError } from '@/lib/errors/reporter';
import { AdminClientError } from '@/lib/list/api-client';
import { smallButtonClass } from '@/components/content/parts';

export function SkeletonRows({ rows = 6, testId = 'list-skeleton' }: { rows?: number; testId?: string }) {
  const { t } = useLanguage();
  return (
    <div className="bg-surface border border-border rounded-lg divide-y divide-border" role="status" aria-label={t('list.loading')} data-testid={testId}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-4" aria-hidden="true">
          <span className="h-4 w-4 rounded bg-surface-2 animate-pulse" />
          <span className="h-12 w-20 rounded bg-surface-2 animate-pulse" />
          <span className="flex-1 space-y-2">
            <span className="block h-4 w-2/3 rounded bg-surface-2 animate-pulse" />
            <span className="block h-3 w-1/3 rounded bg-surface-2 animate-pulse" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Nothing matched. With filters on, say so and offer to clear them; without, say what will appear here. */
export function ListEmpty({ title, body, filtered, onClear }: { title: string; body?: string; filtered: boolean; onClear?: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="bg-surface border border-border rounded-lg p-8 text-center" data-testid="content-empty">
      <p className="text-fg font-medium">{filtered ? t('list.emptyFilteredTitle') : title}</p>
      <p className="text-fg-muted text-sm mt-1">{filtered ? t('list.emptyFilteredBody') : body}</p>
      {filtered && onClear && (
        <button type="button" className={`${smallButtonClass} mt-4`} onClick={onClear} data-testid="list-empty-clear">
          {t('list.clearFilters')}
        </button>
      )}
    </div>
  );
}

/** The list could not be read: FriendlyError with its reference (reported once), and Try again. */
export function ListError({ error, onRetry, testId }: { error: unknown; onRetry: () => void; testId?: string }) {
  const { locale } = useLanguage();
  const status = error instanceof AdminClientError ? error.status : 0;
  const [reference, setReference] = useState<string | undefined>(undefined);
  useEffect(() => {
    setReference(reportError(error, { shown: true, status, extra: { where: 'list' } }));
  }, [error, status]);
  const kind = status === 401 ? 'session' : status === 0 ? 'offline' : 'generic';
  return (
    <div data-testid={testId}>
      <FriendlyError locale={locale} kind={kind} reference={reference} onRetry={onRetry} inline />
    </div>
  );
}
