'use client';

/**
 * Search input with typeahead suggestions (from the search index) and the
 * private on-device history when the input is empty (Story 29.8).
 * Direction-aware through logical CSS properties; rendered inside the
 * LTR/RTL search page variants.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Clock, Search, X } from 'lucide-react';
import type { SearchSuggestion } from '@al-ummah/shared-types';
import { getSearchSuggestions } from '@/lib/api/videos';
import type { SearchHistoryEntry } from '@/lib/search/history';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (query?: string) => void;
  onSelectCategory?: (category: string) => void;
  history: SearchHistoryEntry[];
  onRemoveHistory: (query: string) => void;
  onClearHistory: () => void;
  autoFocus?: boolean;
}

type Option =
  | { kind: 'history'; text: string }
  | { kind: 'suggestion'; text: string; suggestion: SearchSuggestion };

export function SearchBar({ value, onChange, onSubmit, onSelectCategory, history, onRemoveHistory, onClearHistory, autoFocus }: SearchBarProps) {
  const { t } = useLanguage();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  // Marks the input interactive once hydrated (used by E2E tests to avoid typing into server HTML).
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const typing = value.trim().length >= 2;

  useEffect(() => {
    if (!typing) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await getSearchSuggestions(value, 6);
        if (!cancelled) setSuggestions(results);
      } catch (error) {
        logger.warn('[SearchBar] Suggestions failed', { error });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, typing]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);

  const options: Option[] = typing
    ? suggestions.map(s => ({ kind: 'suggestion' as const, text: s.text, suggestion: s }))
    : history.slice(0, 8).map(h => ({ kind: 'history' as const, text: h.query }));
  const showList = open && (options.length > 0 || (!typing && history.length === 0));

  const choose = (option: Option) => {
    setOpen(false);
    setActive(-1);
    if (option.kind === 'suggestion' && option.suggestion.type === 'category' && onSelectCategory) {
      const category = option.suggestion.metadata?.category;
      if (typeof category === 'string') {
        onChange('');
        onSelectCategory(category);
        return;
      }
    }
    onChange(option.text);
    onSubmit(option.text);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive(i => Math.min(i + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(i => Math.max(i - 1, -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && active >= 0 && options[active]) {
        choose(options[active]);
      } else {
        setOpen(false);
        onSubmit();
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <form
        role="search"
        onSubmit={event => {
          event.preventDefault();
          setOpen(false);
          onSubmit();
        }}
        className="flex items-stretch"
      >
        <label htmlFor={`${listId}-input`} className="sr-only">{t.search.searchInputLabel}</label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" aria-hidden="true" />
          <input
            ref={inputRef}
            id={`${listId}-input`}
            data-testid="search-input"
            data-ready={ready ? 'true' : undefined}
            type="search"
            dir="auto"
            autoFocus={autoFocus}
            autoComplete="off"
            enterKeyHint="search"
            role="combobox"
            aria-expanded={showList}
            aria-controls={`${listId}-list`}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
            value={value}
            placeholder={t.search.searchPlaceholder}
            onChange={event => {
              onChange(event.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            // autoFocus can focus the input before hydration, so a click on an already focused input opens the list too
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className="w-full h-11 ps-10 pe-10 rounded-s-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                inputRef.current?.focus();
              }}
              aria-label={t.search.clear}
              data-testid="search-input-clear"
              className="absolute end-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <button
          type="submit"
          data-testid="search-submit"
          className="h-11 px-5 rounded-e-full bg-gray-800 text-white hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {t.search.searchButton}
        </button>
      </form>

      {showList && (
        <div className="absolute inset-x-0 top-full mt-1 z-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
          {!typing && (
            <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1 text-xs text-gray-500 dark:text-gray-400">
              <span>{t.search.recentSearches}</span>
              {history.length > 0 && (
                <button
                  type="button"
                  data-testid="search-history-clear"
                  onClick={onClearHistory}
                  className="font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                >
                  {t.search.clearSearchHistory}
                </button>
              )}
            </div>
          )}
          {!typing && history.length === 0 && (
            <p className="px-4 pb-3 pt-1 text-sm text-gray-500 dark:text-gray-400">{t.search.historyEmpty}</p>
          )}
          <ul id={`${listId}-list`} role="listbox" aria-label={typing ? t.search.suggestionsLabel : t.search.recentSearches} className="max-h-80 overflow-y-auto py-1">
            {options.map((option, index) => (
              <li
                key={`${option.kind}-${option.text}-${index}`}
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={index === active}
                data-testid={option.kind === 'history' ? 'search-history-item' : 'search-suggestion'}
                className={`flex items-center gap-3 px-4 py-2 cursor-pointer text-sm ${index === active ? 'bg-blue-50 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                onPointerDown={event => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                {option.kind === 'history'
                  ? <Clock className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  : <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />}
                <span dir="auto" className="flex-1 truncate text-gray-800 dark:text-gray-100">{option.text}</span>
                {option.kind === 'history' && (
                  <button
                    type="button"
                    aria-label={t.search.removeFromHistory.replace('{query}', option.text)}
                    data-testid="search-history-remove"
                    onPointerDown={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemoveHistory(option.text);
                    }}
                    className="p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!typing && (
            <p className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800">{t.search.historyPrivacyNote}</p>
          )}
        </div>
      )}
    </div>
  );
}
