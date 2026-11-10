/**
 * CalendarControls Component (RTL)
 *
 * RTL variant for calendar navigation controls and settings.
 */

'use client';

import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import type { ViewType, CalendarType } from '../../utils/dateFormatters';
import { formatCalendarHeader } from '../../utils/dateFormatters';

interface CalendarControlsRTLProps {
  currentDate: Date;
  viewType: ViewType;
  calendarType: CalendarType;
  onViewTypeChange: (viewType: ViewType) => void;
  onCalendarTypeChange: (calendarType: CalendarType) => void;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
  onNavigateToday: () => void;
  className?: string;
}

export function CalendarControlsRTL({
  currentDate,
  viewType,
  calendarType,
  onViewTypeChange,
  onCalendarTypeChange,
  onNavigatePrevious,
  onNavigateNext,
  onNavigateToday,
  className = '',
}: CalendarControlsRTLProps) {
  const { t, locale } = useLanguage();

  const headerText = formatCalendarHeader(currentDate, viewType, calendarType, locale);

  return (
    <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${className}`}>
      {/* Right Section: View Type + Calendar Type */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Calendar Type Selector */}
        <ThemedSelectField
          value={calendarType}
          onChange={(e) => onCalendarTypeChange(e.target.value as CalendarType)}
          className="px-3 py-1.5 text-sm font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label={(t.schedule?.calendar?.calendarType) ?? "Calendar Type"}
        >
          <option value="gregorian">{(t.schedule?.calendar?.gregorian) ?? "Gregorian"}</option>
          <option value="hijri">{(t.schedule?.calendar?.hijri) ?? "Hijri"}</option>
        </ThemedSelectField>

        {/* View Type Selector */}
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600">
          <button
            onClick={() => onViewTypeChange('day')}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-r-lg transition-colors
              ${
                viewType === 'day'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }
            `}
            aria-pressed={viewType === 'day'}
          >
            {(t.schedule?.calendar?.day) ?? "Day"}
          </button>

          <button
            onClick={() => onViewTypeChange('week')}
            className={`
              px-3 py-1.5 text-sm font-medium border-x border-gray-300 dark:border-gray-600 transition-colors
              ${
                viewType === 'week'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }
            `}
            aria-pressed={viewType === 'week'}
          >
            {(t.schedule?.calendar?.week) ?? "Week"}
          </button>

          <button
            onClick={() => onViewTypeChange('month')}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-l-lg transition-colors
              ${
                viewType === 'month'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }
            `}
            aria-pressed={viewType === 'month'}
          >
            {(t.schedule?.calendar?.month) ?? "Month"}
          </button>
        </div>
      </div>

      {/* Left Section: Header + Navigation + Today Button */}
      <div className="flex flex-wrap items-center gap-3 min-w-0 max-w-full">
        {/* Current Period Header */}
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white me-2 sm:min-w-[280px] transition-all duration-200">
          {headerText}
        </h2>

        {/* Today Button */}
        <button
          onClick={onNavigateToday}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {(t.schedule?.calendar?.today) ?? "Today"}
        </button>

        {/* Navigation Buttons (reversed for RTL) */}
        <div className="flex items-center gap-1">
          <button
            onClick={onNavigatePrevious}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label={(t.schedule?.calendar?.previous) ?? "Previous"}
          >
            <ChevronLeft size={20} className="text-gray-700 dark:text-gray-300" />
          </button>

          <button
            onClick={onNavigateNext}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label={(t.schedule?.calendar?.next) ?? "Next"}
          >
            <ChevronRight size={20} className="text-gray-700 dark:text-gray-300" />
          </button>
        </div>
      </div>
    </div>
  );
}
