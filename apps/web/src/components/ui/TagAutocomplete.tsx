'use client';

/**
 * A tag field that suggests the creator's existing tags as they type.
 * single: one tag at a time (picked or Enter adds it through onAdd);
 * list: a comma-separated field where the tag after the last comma is
 * completed. Any text is still allowed: suggestions never block a new tag.
 */

import { useMemo } from 'react';
import { Tag } from 'lucide-react';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { lastTagSegment, replaceLastTag, splitTagList, unusedTags } from '@/lib/search/tags';

interface TagAutocompleteProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Known tags, most used first */
  tags: ReadonlyArray<string>;
  /** Tags already on the item (not suggested again) */
  used?: ReadonlyArray<string>;
  mode?: 'single' | 'list';
  /** single mode: add this tag */
  onAdd?: (tag: string) => void;
  label: string;
  placeholder?: string;
  inputId?: string;
  testId?: string;
  inputClassName?: string;
  className?: string;
  describedBy?: string;
}

export function TagAutocomplete({
  value, onValueChange, tags, used = [], mode = 'single', onAdd, label, placeholder, inputId, testId, inputClassName, className, describedBy,
}: TagAutocompleteProps) {
  const list = mode === 'list';
  const options = useMemo<AutocompleteOption[]>(() => {
    const taken = list ? [...used, ...splitTagList(value).slice(0, -1)] : used;
    return unusedTags(tags, taken).map((tag) => ({ id: `tag:${tag}`, label: tag, icon: <Tag className="h-4 w-4" />, value: tag }));
  }, [tags, used, list, value]);

  return (
    <Autocomplete
      className={className}
      value={value}
      onValueChange={onValueChange}
      options={options}
      queryOf={list ? lastTagSegment : undefined}
      maxOptions={8}
      hideNoMatches
      onSelect={(option) => {
        const tag = option.value as string;
        if (list) onValueChange(replaceLastTag(value, tag));
        else onAdd?.(tag);
      }}
      onSubmit={list ? undefined : () => onAdd?.(value)}
      label={label}
      inputId={inputId}
      testId={testId}
      inputProps={{ placeholder: placeholder ?? label, 'aria-describedby': describedBy, maxLength: list ? 500 : 50 }}
      inputClassName={inputClassName}
    />
  );
}
