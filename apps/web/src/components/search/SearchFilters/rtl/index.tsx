"use client";
import React from "react";
import { SearchFilters as SearchFiltersType } from "@/lib/api/types";
import { useLanguage } from "@/hooks/useLanguage";
import { hasActiveSearchFilters } from "../../activeFilters";

interface SearchFiltersProps {
  filters: SearchFiltersType;
  onFiltersChange: (filters: SearchFiltersType) => void;
  onApplyFilters: () => void;
  onClearFilters: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const SearchFilters: React.FC<SearchFiltersProps> = ({
  filters,
  onFiltersChange,
  onApplyFilters,
  onClearFilters,
  isOpen,
  onToggle,
}) => {
  const { t } = useLanguage();

  const categories = [
    { value: '', label: t.search.allCategories },
    { value: 'islamic-lectures', label: t.search.islamicLectures },
    { value: 'quran-recitation', label: t.search.quranRecitation },
    { value: 'islamic-history', label: t.search.islamicHistory },
    { value: 'prayer-guidance', label: t.search.prayerGuidance },
    { value: 'islamic-stories', label: t.search.islamicStories },
    { value: 'scholarly-discussions', label: t.search.scholarlyDiscussions },
  ];

  const durations = [
    { value: 'all', label: t.search.anyDuration },
    { value: 'short', label: t.search.short },
    { value: 'medium', label: t.search.medium },
    { value: 'long', label: t.search.long },
  ];

  const sortOptions = [
    { value: 'relevance', label: t.search.relevance },
    { value: 'date', label: t.search.uploadDateSort },
    { value: 'views', label: t.search.viewCount },
    { value: 'likes', label: t.search.likes },
  ];

  const updateFilter = (key: keyof SearchFiltersType, value: string) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const hasActiveFilters = hasActiveSearchFilters(filters);

  return (
    <div className="relative" dir="rtl">
      {/* Filter Toggle Button */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="search-filters-panel"
        data-testid="search-filters-toggle"
        className={`flex items-center gap-2 px-4 py-2 border rounded-md transition-colors ${
          hasActiveFilters
            ? 'border-blue-500 bg-blue-50 text-blue-700'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.207A1 1 0 013 6.586V4z" />
        </svg>
        {t.search.filters}
        {hasActiveFilters && (
          <span className="bg-blue-500 text-white rounded-full px-2 py-0.5 text-xs">
            {t.search.active}
          </span>
        )}
      </button>

      {/* Filter Panel */}
      {isOpen && (
        <div id="search-filters-panel" data-testid="search-filters-panel" className="absolute top-full left-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-300 rounded-lg shadow-lg p-4 z-50">
          <div className="space-y-4">
            {/* Category Filter */}
            <div>
              <label htmlFor="search-filter-category" className="block text-sm font-medium text-gray-700 mb-2">
                {t.search.category}
              </label>
              <select
                  id="search-filter-category"
                value={filters.category || ''}
                onChange={(e) => updateFilter('category', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                dir="rtl"
              >
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Language Filter */}
            <div>
              <label htmlFor="search-filter-language" className="block text-sm font-medium text-gray-700 mb-2">
                {t.search.language}
              </label>
              <select
                  id="search-filter-language"
                value={filters.language || 'all'}
                onChange={(e) => updateFilter('language', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                dir="rtl"
              >
                <option value="all">{t.search.allLanguages}</option>
                <option value="en">{t.search.english}</option>
                <option value="ar">{t.search.arabic}</option>
              </select>
            </div>

            {/* Duration Filter */}
            <div>
              <label htmlFor="search-filter-duration" className="block text-sm font-medium text-gray-700 mb-2">
                {t.search.duration}
              </label>
              <select
                  id="search-filter-duration"
                value={filters.duration || 'all'}
                onChange={(e) => updateFilter('duration', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                dir="rtl"
              >
                {durations.map((dur) => (
                  <option key={dur.value} value={dur.value}>
                    {dur.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.search.uploadDate}
              </label>
              <div className="space-y-2">
                <input
                  type="date"
                  value={filters.dateFrom || ''}
                  aria-label={t.search.dateFrom}
                  onChange={(e) => updateFilter('dateFrom', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t.search.dateFrom}
                  dir="rtl"
                />
                <input
                  type="date"
                  value={filters.dateTo || ''}
                  aria-label={t.search.dateTo}
                  onChange={(e) => updateFilter('dateTo', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t.search.dateTo}
                  dir="rtl"
                />
              </div>
            </div>

            {/* Sort Options */}
            <div>
              <label htmlFor="search-filter-sort" className="block text-sm font-medium text-gray-700 mb-2">
                {t.search.sortBy}
              </label>
              <div className="flex gap-2">
                <select
                  id="search-filter-sort"
                  value={filters.sortBy || 'relevance'}
                  onChange={(e) => updateFilter('sortBy', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  dir="rtl"
                >
                  {sortOptions.map((sort) => (
                    <option key={sort.value} value={sort.value}>
                      {sort.label}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.sortOrder || 'desc'}
                  aria-label={t.search.sortBy}
                  data-testid="search-filter-sort-order"
                  onChange={(e) => updateFilter('sortOrder', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  dir="rtl"
                >
                  <option value="desc">{t.search.descending}</option>
                  <option value="asc">{t.search.ascending}</option>
                </select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onApplyFilters}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                {t.search.applyFilters}
              </button>
              <button
                type="button"
                onClick={onClearFilters}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
              >
                {t.search.clear}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchFilters;
