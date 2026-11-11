/**
 * Category picker as a live autocomplete (the shared combobox): type in
 * either language, pick from the matches; all categories show on focus.
 */
'use client';

import React, { useMemo, useState } from 'react';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { useLanguage } from '@/hooks/useLanguage';
import { VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import { inputClass } from './RenameFields';

interface CategoryAutocompleteProps {
  value: string;
  onChange: (category: string) => void;
  label: string;
  inputId: string;
  placeholder?: string;
  testId?: string;
}

export function CategoryAutocomplete({ value, onChange, label, inputId, placeholder, testId = 'category-autocomplete' }: CategoryAutocompleteProps) {
  const { lang } = useLanguage();
  const ui = lang === 'ar' ? 'ar' : 'en';
  const options = useMemo<AutocompleteOption[]>(() => VIDEO_CATEGORIES.map((c) => ({
    id: c.value,
    label: c.label[ui],
    keywords: [c.label.en, c.label.ar, c.value],
    selected: c.value === value,
  })), [ui, value]);
  const labelOf = (id: string) => options.find((o) => o.id === id)?.label ?? '';
  const [text, setText] = useState(labelOf(value));
  // A new pick (or page language) shows its label: adjusted while rendering
  const [shownFor, setShownFor] = useState({ value, ui });
  if (shownFor.value !== value || shownFor.ui !== ui) {
    setShownFor({ value, ui });
    setText(labelOf(value));
  }

  return (
    <Autocomplete
      value={text}
      onValueChange={(next) => {
        setText(next);
        if (value && next !== labelOf(value)) onChange('');
      }}
      options={options}
      emptyOptions={options}
      minChars={0}
      maxOptions={VIDEO_CATEGORIES.length}
      onSelect={(option) => {
        setText(option.label);
        onChange(option.id);
      }}
      label={label}
      inputId={inputId}
      testId={testId}
      inputClassName={inputClass}
      inputProps={{ placeholder, autoComplete: 'off' }}
      optionTestId={(o) => `${testId}-option-${o.id}`}
    />
  );
}

export default CategoryAutocomplete;
