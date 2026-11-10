'use client';

/**
 * The end of a channel tab's list: loads the next page as it scrolls into
 * view, with a visible "Load more" button for keyboards, screen readers and
 * browsers without IntersectionObserver. A failed page says so and retries on
 * the same button; nothing is drawn once every page is shown.
 */
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useLanguage } from '@/hooks/useLanguage';

interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
  onLoadMore: () => void;
}

export function LoadMore({ hasMore, loading, failed, onLoadMore }: LoadMoreProps) {
  const { t } = useLanguage();
  // Auto-loading pauses after a failure: the button retries
  const triggerRef = useInfiniteScroll({ hasMore, onLoadMore, enabled: hasMore && !loading && !failed, rootMargin: '400px' });
  if (!hasMore) return null;
  return (
    <div ref={triggerRef} className="flex flex-col items-center gap-2 py-6" data-testid="tab-load-more">
      {failed && (
        <p role="alert" className="text-sm text-[var(--fanous-color-text-secondary)]">
          {t.common.error}
        </p>
      )}
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading}
        aria-busy={loading}
        className="rounded-full border border-border px-5 py-2 text-sm font-semibold text-[var(--fanous-color-text-primary)] hover:bg-[color-mix(in_srgb,var(--fanous-color-primary)_12%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-primary)] disabled:opacity-60"
      >
        {loading ? t.common.loading : failed ? t.common.retry : t.common.loadMore || t.common.viewAll}
      </button>
    </div>
  );
}
