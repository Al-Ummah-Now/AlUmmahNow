import type { SearchFilters } from '@/lib/api/types';

/** The filters the search page starts with (and returns to on "Clear"). */
export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  category: '',
  language: 'all',
  duration: 'all',
  sortBy: 'relevance',
  sortOrder: 'desc',
};

/**
 * True when any filter differs from its default. The default sort order
 * ("desc") is not a filter the user chose, so it must not count: treating every
 * non-empty value as active showed the "Active" badge and the "Active filters:"
 * row before the user touched anything.
 */
export function hasActiveSearchFilters(filters: SearchFilters): boolean {
  return Boolean(
    filters.category ||
      (filters.language && filters.language !== 'all') ||
      (filters.duration && filters.duration !== 'all') ||
      filters.dateFrom ||
      filters.dateTo ||
      (filters.sortBy && filters.sortBy !== 'relevance') ||
      filters.sortOrder === 'asc'
  );
}
