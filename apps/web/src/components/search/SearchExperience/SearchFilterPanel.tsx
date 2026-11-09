'use client';

/**
 * Search filters (Story 29.8): result-type chips, a filter panel that is a
 * bottom sheet on small screens and an inline panel from md up, and removable
 * chips for active filters. Changes apply immediately (URL state).
 */

import React, { useEffect, useId, useRef } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type { SearchEntityType } from '@al-ummah/shared-types';
import { VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import {
  SEARCH_DATES,
  SEARCH_DURATIONS,
  SEARCH_LANGUAGES,
  SEARCH_SORTS,
  SEARCH_TYPES,
  SearchFilterKey,
  SearchUrlState,
  activeFilterKeys,
} from '@/lib/search/url-state';
import { categoryLabel, dateLabel, durationLabel, filterChipLabel, languageLabel, sortLabel, typeLabel } from './labels';

const chipBase = 'inline-flex items-center gap-1 shrink-0 rounded-full px-3 h-9 text-sm font-medium border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const chipOn = 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white';
const chipOff = 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-800';

interface ChipProps {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}

function Chip({ selected, onClick, children, testId }: ChipProps) {
  return (
    <button type="button" aria-pressed={selected} data-testid={testId} onClick={onClick} className={`${chipBase} ${selected ? chipOn : chipOff}`}>
      {children}
    </button>
  );
}

export function SearchTypeChips({ state, onChange }: { state: SearchUrlState; onChange: (type?: SearchEntityType) => void }) {
  const { t } = useLanguage();
  return (
    <div role="group" aria-label={t.search.resultType} className="flex overflow-x-auto [scrollbar-width:none] border-b border-gray-200 dark:border-gray-700">
      <button type="button" className="tab-item" aria-pressed={!state.type} data-active={!state.type} onClick={() => onChange(undefined)} data-testid="search-type-all">{typeLabel(t.search, undefined)}</button>
      {SEARCH_TYPES.map(type => (
        <button type="button" key={type} className="tab-item" aria-pressed={state.type === type} data-active={state.type === type} onClick={() => onChange(type)} data-testid={`search-type-${type}`}>
          {typeLabel(t.search, type)}
        </button>
      ))}
    </div>
  );
}

interface FilterPanelProps {
  state: SearchUrlState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<SearchUrlState>) => void;
  onClear: () => void;
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function SearchFilterButton({ state, open, onOpenChange }: Pick<FilterPanelProps, 'state' | 'open' | 'onOpenChange'>) {
  const { t } = useLanguage();
  const count = activeFilterKeys(state).length + (state.sort !== 'relevance' ? 1 : 0);
  return (
    <button
      type="button"
      data-testid="search-filters-toggle"
      aria-expanded={open}
      aria-controls="search-filter-panel"
      onClick={() => onOpenChange(!open)}
      className={`${chipBase} ${open || count > 0 ? chipOn : chipOff}`}
    >
      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
      <span>{t.search.filters}</span>
      {count > 0 && (
        <span data-testid="search-filters-count" className="ms-1 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-blue-600 px-1 text-xs text-white">{count}</span>
      )}
    </button>
  );
}

export function SearchFilterPanel({ state, open, onOpenChange, onChange, onClear }: FilterPanelProps) {
  const { t, lang } = useLanguage();
  const panelRef = useRef<HTMLDivElement>(null);
  const categoryId = useId();
  const videoOnly = !state.type || state.type === 'video';

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden="true" onClick={() => onOpenChange(false)} />
      <div
        id="search-filter-panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-label={t.search.filters}
        data-testid="search-filter-panel"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white dark:bg-gray-900 p-4 pb-6 shadow-2xl space-y-5 focus:outline-none md:static md:z-auto md:max-h-none md:rounded-lg md:border md:border-gray-200 md:dark:border-gray-700 md:shadow-none md:mt-3"
      >
        <div className="flex items-center justify-between md:hidden">
          <span className="mx-auto h-1.5 w-10 rounded-full bg-gray-300 dark:bg-gray-600" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t.search.filters}</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t.search.closeFilters}
            className="p-2 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <FilterGroup title={t.search.uploadDate}>
            <Chip selected={!state.date} onClick={() => onChange({ date: undefined })}>{dateLabel(t.search, undefined)}</Chip>
            {SEARCH_DATES.map(date => (
              <Chip key={date} selected={state.date === date} onClick={() => onChange({ date })} testId={`search-filter-date-${date}`}>{dateLabel(t.search, date)}</Chip>
            ))}
          </FilterGroup>

          {videoOnly && (
            <FilterGroup title={t.search.duration}>
              <Chip selected={!state.duration} onClick={() => onChange({ duration: undefined })}>{durationLabel(t.search, undefined)}</Chip>
              {SEARCH_DURATIONS.map(duration => (
                <Chip key={duration} selected={state.duration === duration} onClick={() => onChange({ duration })} testId={`search-filter-duration-${duration}`}>
                  {durationLabel(t.search, duration)}
                </Chip>
              ))}
            </FilterGroup>
          )}

          <FilterGroup title={t.search.language}>
            <Chip selected={!state.language} onClick={() => onChange({ language: undefined })}>{languageLabel(t.search, undefined)}</Chip>
            {SEARCH_LANGUAGES.map(language => (
              <Chip key={language} selected={state.language === language} onClick={() => onChange({ language })} testId={`search-filter-language-${language}`}>
                {languageLabel(t.search, language)}
              </Chip>
            ))}
          </FilterGroup>

          <div className="space-y-2">
            <label htmlFor={categoryId} className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.search.category}</label>
            <select
              id={categoryId}
              data-testid="search-filter-category"
              value={state.category ?? ''}
              onChange={event => onChange({ category: event.target.value || undefined })}
              className="w-full h-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <option value="">{t.search.allCategories}</option>
              {VIDEO_CATEGORIES.map(category => (
                <option key={category.value} value={category.value}>{categoryLabel(category.value, lang, category.value)}</option>
              ))}
            </select>
          </div>

          <FilterGroup title={t.search.sortBy}>
            {SEARCH_SORTS.map(sort => (
              <Chip key={sort} selected={state.sort === sort} onClick={() => onChange({ sort })} testId={`search-sort-${sort}`}>{sortLabel(t.search, sort)}</Chip>
            ))}
          </FilterGroup>

          <label className="flex items-center gap-3 self-end cursor-pointer text-sm text-gray-800 dark:text-gray-100">
            <input
              type="checkbox"
              data-testid="search-filter-verified"
              checked={state.verified}
              onChange={event => onChange({ verified: event.target.checked })}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500"
            />
            {t.search.verifiedOnly}
          </label>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClear}
            data-testid="search-filters-clear"
            className="flex-1 md:flex-none h-11 px-5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {t.search.clearFilters}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 md:hidden h-11 px-5 rounded-full bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {t.search.showResults}
          </button>
        </div>
      </div>
    </>
  );
}

export function ActiveFilterChips({
  state,
  channelName,
  onRemove,
}: {
  state: SearchUrlState;
  channelName?: string;
  onRemove: (key: SearchFilterKey) => void;
}) {
  const { t, lang } = useLanguage();
  const keys = activeFilterKeys(state);
  if (keys.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t.search.activeFilters}>
      {keys.map(key => {
        const label = filterChipLabel(t.search, key, state, lang, channelName);
        return (
          <li key={key}>
            <button
              type="button"
              data-testid={`active-filter-${key}`}
              onClick={() => onRemove(key)}
              aria-label={t.search.removeFilter.replace('{name}', label)}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-900/40 px-3 h-8 text-sm text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span dir="auto">{label}</span>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
