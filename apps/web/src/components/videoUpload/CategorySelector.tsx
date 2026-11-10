'use client';

/**
 * CategorySelector Component
 *
 * Dropdown to select video category with bilingual (EN/AR) labels.
 * Displays Islamic-specific categories for content organization.
 * With an AI suggestion: marks an AI-preselected value as a suggestion the
 * uploader can change, and offers the top options when the AI is not sure.
 */

import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { useLanguage } from '@/hooks/useLanguage';
import { Folder, ChevronDown, Sparkles, Loader2 } from 'lucide-react';
import { VideoCategory, VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import { isKnownCategory, suggestionOptions, type CategorySuggestionView } from '@/lib/category-suggestion/form';

interface CategorySelectorProps {
  id?: string;
  value?: VideoCategory;
  onChange: (category?: VideoCategory) => void;
  required?: boolean;
  disabled?: boolean;
  /** AI suggestion for the form's text, if any */
  suggestion?: CategorySuggestionView | null;
  /** The current value is the AI's preselection, not yet confirmed */
  aiSelected?: boolean;
  /** A suggestion is being worked out */
  suggesting?: boolean;
  /** Offer "Keep" to confirm an AI-set category as the uploader's (edit form, batch rows) */
  onConfirm?: () => void;
  /** Label instead of "Video Category" */
  label?: string;
  /** Helper line under the picker (replaces the default one) */
  hint?: string;
  /** data-testid of the select (default "category-select") */
  testId?: string;
  /** Smaller label and no default helper text (batch rows) */
  compact?: boolean;
}

export function CategorySelector({
  id = 'video-category-select',
  value,
  onChange,
  required = false,
  disabled = false,
  suggestion = null,
  aiSelected = false,
  suggesting = false,
  onConfirm,
  label,
  hint,
  testId = 'category-select',
  compact = false,
}: CategorySelectorProps) {
  const { isRTL } = useLanguage();
  const labelOf = (v: string) => {
    const found = VIDEO_CATEGORIES.find((c) => c.value === v);
    return found ? (isRTL ? found.label.ar : found.label.en) : v;
  };
  const options = suggestionOptions(suggestion);
  // Not sure enough to preselect: offer the top options (when nothing is chosen yet, or the AI's choice is shown)
  const offerOptions = !aiSelected && !value && !!suggestion?.lowConfidence && options.length > 0;
  const confidence = aiSelected && suggestion?.confidence != null && suggestion.preselect === value ? Math.round(suggestion.confidence * 100) : null;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    onChange(selectedValue ? (selectedValue as VideoCategory) : undefined);
  };

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <label htmlFor={id} className={`block font-medium text-foreground ${compact ? 'text-xs' : 'text-sm'}`}>
        <span className="flex items-center gap-2">
          <Folder className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} aria-hidden="true" />
          {label ?? (isRTL ? 'تصنيف الفيديو' : 'Video Category')}
          {required && <span className="text-red-500">*</span>}
        </span>
      </label>

      <div className="relative">
        <ThemedSelectField
          id={id}
          data-testid={testId}
          value={value || ''}
          onChange={handleChange}
          disabled={disabled}
          required={required}
          className="
            w-full
            px-4
            py-2
            pr-10
            rtl:pl-10
            rtl:pr-4
            border
            border-gray-300
            dark:border-gray-600
            rounded-lg
            bg-white
            dark:bg-gray-800
            text-gray-900
            dark:text-gray-100
            focus:ring-2
            focus:ring-primary
            focus:border-transparent
            disabled:opacity-50
            disabled:cursor-not-allowed
            appearance-none
          "
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          <option value="">
            {isRTL ? 'اختر تصنيف...' : 'Select a category...'}
          </option>
          {VIDEO_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>
              {isRTL ? category.label.ar : category.label.en}
            </option>
          ))}
        </ThemedSelectField>

        <ChevronDown className="absolute right-3 rtl:left-3 rtl:right-auto top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
      </div>

      {aiSelected && value && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary" data-testid="category-ai-suggested" data-category={value} role="status">
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          {isRTL ? 'اقترحه الذكاء الاصطناعي، ويمكنك تغييره' : 'Suggested by AI. You can change it'}
          {confidence !== null && (
            <span className="font-normal text-muted-foreground">
              {isRTL ? `(ثقة ${confidence}٪)` : `(${confidence}% confident)`}
            </span>
          )}
          {onConfirm && (
            <button type="button" onClick={onConfirm} disabled={disabled} className="ms-2 underline underline-offset-2 hover:no-underline disabled:opacity-50" data-testid="category-ai-keep">
              {isRTL ? 'اعتماده' : 'Keep it'}
            </button>
          )}
        </p>
      )}

      {suggesting && !value && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="category-ai-loading" role="status">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          {isRTL ? 'يقترح الذكاء الاصطناعي تصنيفًا…' : 'AI is suggesting a category…'}
        </p>
      )}

      {offerOptions && (
        <div className="space-y-1.5" data-testid="category-ai-options">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            {isRTL ? 'لم يتأكد الذكاء الاصطناعي. هل هو أحد هذه التصنيفات؟' : 'AI is not sure. Is it one of these?'}
          </p>
          <div className="flex flex-wrap gap-2">
            {options.map((o) => (
              <button
                key={o.category}
                type="button"
                disabled={disabled}
                onClick={() => isKnownCategory(o.category) && onChange(o.category)}
                className="px-3 py-1 rounded-full border border-border text-sm text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                data-testid="category-ai-option"
                data-category={o.category}
              >
                {labelOf(o.category)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Helper Text */}
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : value && !aiSelected && !compact && (
        <p className="text-xs text-muted-foreground">
          {isRTL
            ? 'يساعد التصنيف المشاهدين في العثور على المحتوى'
            : 'Category helps viewers find your content'}
        </p>
      )}
    </div>
  );
}
