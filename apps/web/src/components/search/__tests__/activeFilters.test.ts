import { DEFAULT_SEARCH_FILTERS, hasActiveSearchFilters } from '../activeFilters';

describe('hasActiveSearchFilters', () => {
  it('is false for the default filters (default sort order is not a filter)', () => {
    expect(hasActiveSearchFilters(DEFAULT_SEARCH_FILTERS)).toBe(false);
    expect(hasActiveSearchFilters({})).toBe(false);
  });

  it.each([
    ['category', { category: 'quran-recitation' }],
    ['language', { language: 'ar' as const }],
    ['duration', { duration: 'short' as const }],
    ['date from', { dateFrom: '2026-01-01' }],
    ['date to', { dateTo: '2026-01-31' }],
    ['sort by', { sortBy: 'views' as const }],
    ['ascending order', { sortOrder: 'asc' as const }],
  ])('is true when %s is set', (_label, change) => {
    expect(hasActiveSearchFilters({ ...DEFAULT_SEARCH_FILTERS, ...change })).toBe(true);
  });
});
