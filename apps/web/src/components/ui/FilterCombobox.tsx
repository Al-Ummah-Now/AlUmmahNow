'use client';

/**
 * A list filter with suggestions: typing filters the list on the page (the
 * caller filters with lib/search/match) and suggests matching items under the
 * input. Picking a suggestion opens that item (`onPick`) or, without
 * `onPick`, filters by its full title. Enter just keeps the filter.
 */

import { useMemo, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { useLanguage } from '@/hooks/useLanguage';

export interface FilterItem {
  id: string;
  label: string;
  subtitle?: string;
  thumbnailUrl?: string;
  thumbnailShape?: AutocompleteOption['thumbnailShape'];
  keywords?: Array<string | null | undefined>;
}

interface FilterComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  items: FilterItem[];
  onPick?: (item: FilterItem) => void;
  label: string;
  placeholder?: string;
  testId?: string;
  clearTestId?: string;
  clearLabel?: string;
  inputClassName?: string;
  className?: string;
  icon?: ReactNode;
}

export function FilterCombobox({
  value, onValueChange, items, onPick, label, placeholder, testId, clearTestId, clearLabel, inputClassName, className, icon,
}: FilterComboboxProps) {
  const { t } = useLanguage();
  const options = useMemo<AutocompleteOption[]>(() => items.map((item) => ({
    id: item.id,
    label: item.label,
    subtitle: item.subtitle,
    thumbnailUrl: item.thumbnailUrl,
    thumbnailShape: item.thumbnailShape,
    keywords: item.keywords,
    value: item,
  })), [items]);

  return (
    <Autocomplete
      className={className}
      value={value}
      onValueChange={onValueChange}
      options={options}
      maxOptions={8}
      onSelect={(option) => {
        const item = option.value as FilterItem;
        if (onPick) onPick(item);
        else onValueChange(item.label);
      }}
      label={label}
      testId={testId}
      inputProps={{ type: 'search', placeholder: placeholder ?? label, enterKeyHint: 'search' }}
      inputClassName={inputClassName}
    >
      {icon ?? <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden="true" />}
      {value && (
        <button
          type="button"
          onClick={() => onValueChange('')}
          data-testid={clearTestId}
          aria-label={clearLabel ?? t.search.clear}
          className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </Autocomplete>
  );
}
