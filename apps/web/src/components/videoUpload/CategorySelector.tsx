'use client';

/**
 * CategorySelector Component
 *
 * Dropdown to select video category with bilingual (EN/AR) labels.
 * Displays Islamic-specific categories for content organization.
 */

import { useLanguage } from '@/hooks/useLanguage';
import { Folder, ChevronDown } from 'lucide-react';
import { VideoCategory, VIDEO_CATEGORIES } from '@al-ummah/shared-types';

interface CategorySelectorProps {
  value?: VideoCategory;
  onChange: (category?: VideoCategory) => void;
  required?: boolean;
  disabled?: boolean;
}

export function CategorySelector({
  value,
  onChange,
  required = false,
  disabled = false,
}: CategorySelectorProps) {
  const { isRTL } = useLanguage();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    onChange(selectedValue ? (selectedValue as VideoCategory) : undefined);
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        <span className="flex items-center gap-2">
          <Folder className="w-4 h-4" />
          {isRTL ? 'تصنيف الفيديو' : 'Video Category'}
          {required && <span className="text-red-500">*</span>}
        </span>
      </label>

      <div className="relative">
        <select
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
        </select>

        <ChevronDown className="absolute right-3 rtl:left-3 rtl:right-auto top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
      </div>

      {/* Helper Text */}
      {value && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {isRTL
            ? 'يساعد التصنيف المشاهدين في العثور على المحتوى'
            : 'Category helps viewers find your content'}
        </p>
      )}
    </div>
  );
}
