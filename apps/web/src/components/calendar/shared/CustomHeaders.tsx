/**
 * Custom Header Components
 *
 * Custom date headers for calendar views showing dual Gregorian/Hijri dates
 */

'use client';

import React from 'react';
import { format } from 'date-fns';
import { enUS, ar as arSA } from 'date-fns/locale';
import { useLanguage } from '@/hooks/useLanguage';
import { gregorianToHijri } from '../utils/hijriConverter';
import { formatNumber } from '../utils/dateFormatters';

/**
 * Custom Month Date Header Component - Shows dual calendar dates
 */
interface CustomMonthDateHeaderProps {
  date: Date;
  label: string;
}

export const CustomMonthDateHeader: React.FC<CustomMonthDateHeaderProps> = ({ date }) => {
  const { locale } = useLanguage();
  const gregorianDay = date.getDate();
  const hijriDate = gregorianToHijri(date);

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="text-sm font-semibold text-gray-900 dark:text-white">
        {formatNumber(gregorianDay, locale)}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {formatNumber(hijriDate.day, locale)}
      </div>
    </div>
  );
};

/**
 * Custom Week/Day Header Component - Shows dual calendar dates
 */
interface CustomWeekHeaderProps {
  date: Date;
  label: string;
}

export const CustomWeekHeader: React.FC<CustomWeekHeaderProps> = ({ date }) => {
  const { locale } = useLanguage();
  const gregorianDay = date.getDate();
  const hijriDate = gregorianToHijri(date);

  // Get weekday using date-fns with proper locale
  const dateFnsLocale = locale === 'ar' ? arSA : enUS;
  const weekday = format(date, 'EEE', { locale: dateFnsLocale });

  return (
    <div className="flex flex-col items-center justify-center h-full py-2">
      <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
        {weekday}
      </div>
      <div className="text-sm font-semibold text-gray-900 dark:text-white">
        {formatNumber(gregorianDay, locale)}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {formatNumber(hijriDate.day, locale)}
      </div>
    </div>
  );
};
