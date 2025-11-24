/**
 * CalendarControls Component (LTR)
 *
 * Provides navigation controls and settings for the calendar view
 * including time span selection (month/week/day) and calendar type (Gregorian/Hijri).
 */

'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import type { ViewType } from '../utils/dateFormatters';
import { formatDualCalendarHeader } from '../utils/dateFormatters';

interface CalendarControlsProps {
  currentDate: Date;
  viewType: ViewType;
  onViewTypeChange: (viewType: ViewType) => void;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
  onNavigateToday: () => void;
  className?: string;
}

export function CalendarControls({
  currentDate,
  viewType,
  onViewTypeChange,
  onNavigatePrevious,
  onNavigateNext,
  onNavigateToday,
  className = '',
}: CalendarControlsProps) {
  const { t, locale } = useLanguage();

  const headerText = formatDualCalendarHeader(currentDate, viewType, locale);

  return (
    <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${className}`}>
      {/* Left Section: Navigation + Header */}
      <div className="flex items-center gap-3">
        {/* Navigation Buttons */}
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

        {/* Today Button */}
        <button
          onClick={onNavigateToday}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {(t.schedule?.calendar?.today) ?? "Today"}
        </button>

        {/* Current Period Header */}
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white ml-2 min-w-[280px] transition-all duration-200">
          {headerText}
        </h2>
      </div>

      {/* Right Section: View Type */}
      <div className="flex flex-wrap items-center gap-3">
        {/* View Type Selector */}
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600">
          <button
            onClick={() => onViewTypeChange('month')}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-s-lg transition-colors
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

          <button
            onClick={() => onViewTypeChange('week')}
            className={`
              px-3 py-1.5 text-sm font-medium border-s border-e border-gray-300 dark:border-gray-600 transition-colors
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
            onClick={() => onViewTypeChange('day')}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-e-lg transition-colors
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
        </div>
      </div>
    </div>
  );
}
