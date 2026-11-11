'use client';

/**
 * Previous / page x of y / next for a numbered list, changing `page` in the
 * URL (useListParams). The old page stays on screen until the new one arrives.
 */
import { useLanguage } from '@/i18n/I18nProvider';

const pagerClass =
  'px-4 py-2 bg-surface border border-border text-fg rounded hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60 disabled:cursor-not-allowed';

export function ListPager({ page, pageSize, total, onPage, busy = false }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; busy?: boolean }) {
  const { t } = useLanguage();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1 && page <= 1) return null;
  return (
    <nav aria-label={t('content.pagination')} className="flex justify-center items-center gap-2 mt-6" aria-busy={busy || undefined}>
      {page > 1 && (
        <button type="button" className={pagerClass} onClick={() => onPage(page - 1)} data-testid="list-page-prev">
          {t('content.previous')}
        </button>
      )}
      <span className="px-4 py-2 text-fg-muted" aria-current="page" data-testid="page-indicator">
        {t('content.pageOf', { page, total: pages })}
      </span>
      {page < pages && (
        <button type="button" className={pagerClass} onClick={() => onPage(page + 1)} data-testid="list-page-next">
          {t('content.next')}
        </button>
      )}
    </nav>
  );
}
