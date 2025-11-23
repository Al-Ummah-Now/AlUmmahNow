/**
 * CalendarControls Component
 * Controls for calendar view (time span and calendar type)
 */

'use client';

import React from 'react';

export type TimeSpan = 'month' | 'week' | 'day';
export type CalendarType = 'gregorian' | 'hijri';

export interface CalendarControlsProps {
  timeSpan: TimeSpan;
  calendarType: CalendarType;
  onTimeSpanChange: (timeSpan: TimeSpan) => void;
  onCalendarTypeChange: (calendarType: CalendarType) => void;
  locale?: 'en' | 'ar';
  className?: string;
}

const TIME_SPAN_LABELS = {
  en: {
    month: 'Month',
    week: 'Week',
    day: 'Day',
  },
  ar: {
    month: 'شهر',
    week: 'أسبوع',
    day: 'يوم',
  },
};

const CALENDAR_TYPE_LABELS = {
  en: {
    gregorian: 'Gregorian',
    hijri: 'Hijri',
  },
  ar: {
    gregorian: 'ميلادي',
    hijri: 'هجري',
  },
};

export function CalendarControls({
  timeSpan,
  calendarType,
  onTimeSpanChange,
  onCalendarTypeChange,
  locale = 'en',
  className = '',
}: CalendarControlsProps) {
  const timeSpanLabels = TIME_SPAN_LABELS[locale];
  const calendarTypeLabels = CALENDAR_TYPE_LABELS[locale];
  const isRTL = locale === 'ar';

  return (
    <div
      className={`flex flex-col sm:flex-row gap-4 ${className}`}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Time Span Controls */}
      <div className="flex gap-2" role="group" aria-label="Time span selector">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 self-center">
          {locale === 'en' ? 'View:' : 'عرض:'}
        </span>
        {(['month', 'week', 'day'] as const).map((span) => (
          <button
            key={span}
            type="button"
            onClick={() => onTimeSpanChange(span)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              timeSpan === span
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
            aria-pressed={timeSpan === span}
            aria-label={`${timeSpanLabels[span]} view`}
          >
            {timeSpanLabels[span]}
          </button>
        ))}
      </div>

      {/* Calendar Type Toggle */}
      <div className="flex gap-2" role="group" aria-label="Calendar type selector">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 self-center">
          {locale === 'en' ? 'Calendar:' : 'التقويم:'}
        </span>
        {(['gregorian', 'hijri'] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onCalendarTypeChange(type)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              calendarType === type
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
            aria-pressed={calendarType === type}
            aria-label={`${calendarTypeLabels[type]} calendar`}
          >
            {calendarTypeLabels[type]}
          </button>
        ))}
      </div>
    </div>
  );
}
