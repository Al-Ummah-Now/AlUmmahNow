"use client";

import React, { useState, useEffect } from 'react';
import { Calendar, Clock, X, AlertCircle, Info } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export interface ScheduleData {
  scheduledPublishDate: string; // ISO 8601 UTC
  timezone: string;             // IANA timezone
  notifyOnPublish: boolean;
}

interface ScheduleDateTimeSelectorProps {
  onScheduleChange: (schedule: ScheduleData | null) => void;
  disabled?: boolean;
  initialSchedule?: ScheduleData;
  minDate?: Date;
  maxDate?: Date;
  className?: string;
}

export const ScheduleDateTimeSelector: React.FC<ScheduleDateTimeSelectorProps> = ({
  onScheduleChange,
  disabled = false,
  initialSchedule,
  minDate,
  maxDate,
  className = '',
}) => {
  const { t } = useI18n();

  const [isScheduled, setIsScheduled] = useState<boolean>(!!initialSchedule);
  const [dateTimeValue, setDateTimeValue] = useState<string>('');
  const [timezone, setTimezone] = useState<string>('');
  const [notifyOnPublish, setNotifyOnPublish] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  // Get user's timezone on mount
  useEffect(() => {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(userTimezone);

    if (initialSchedule) {
      // Convert UTC to local datetime-local format
      const scheduledDate = new Date(initialSchedule.scheduledPublishDate);
      const localDateTime = formatDateTimeLocal(scheduledDate);
      setDateTimeValue(localDateTime);
      setNotifyOnPublish(initialSchedule.notifyOnPublish);
    }
  }, [initialSchedule]);

  // Format date for datetime-local input (YYYY-MM-DDTHH:MM)
  const formatDateTimeLocal = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Get minimum datetime (5 minutes from now)
  const getMinDateTime = (): string => {
    const min = minDate || new Date(Date.now() + 5 * 60 * 1000);
    return formatDateTimeLocal(min);
  };

  // Get maximum datetime (1 year from now)
  const getMaxDateTime = (): string => {
    const max = maxDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return formatDateTimeLocal(max);
  };

  // Validate and update schedule
  const handleDateTimeChange = (value: string) => {
    setDateTimeValue(value);
    setError('');

    if (!value) {
      onScheduleChange(null);
      return;
    }

    try {
      // Convert local datetime to UTC
      const localDate = new Date(value);
      const now = new Date();
      const minTime = minDate || new Date(now.getTime() + 5 * 60 * 1000);
      const maxTime = maxDate || new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      // Validate
      if (isNaN(localDate.getTime())) {
        setError(t.schedule?.invalidScheduleTime || 'Invalid schedule time');
        onScheduleChange(null);
        return;
      }

      if (localDate < minTime) {
        setError(t.schedule?.minimumScheduleTime || 'Videos must be scheduled at least 5 minutes in advance');
        onScheduleChange(null);
        return;
      }

      if (localDate > maxTime) {
        setError(t.schedule?.maximumScheduleTime || 'Videos cannot be scheduled more than 1 year in advance');
        onScheduleChange(null);
        return;
      }

      // Convert to UTC ISO string
      const utcDateTime = localDate.toISOString();

      onScheduleChange({
        scheduledPublishDate: utcDateTime,
        timezone,
        notifyOnPublish,
      });
    } catch (err) {
      console.error('Error parsing datetime:', err);
      setError(t.schedule?.invalidScheduleTime || 'Invalid schedule time');
      onScheduleChange(null);
    }
  };

  const handleToggleSchedule = (scheduled: boolean) => {
    setIsScheduled(scheduled);
    setError('');

    if (!scheduled) {
      setDateTimeValue('');
      onScheduleChange(null);
    } else if (dateTimeValue) {
      handleDateTimeChange(dateTimeValue);
    }
  };

  const handleClearSchedule = () => {
    setDateTimeValue('');
    setError('');
    onScheduleChange(null);
  };

  const handleNotifyChange = (notify: boolean) => {
    setNotifyOnPublish(notify);
    if (dateTimeValue) {
      const localDate = new Date(dateTimeValue);
      onScheduleChange({
        scheduledPublishDate: localDate.toISOString(),
        timezone,
        notifyOnPublish: notify,
      });
    }
  };

  // Format preview date
  const getPreviewDate = (): string => {
    if (!dateTimeValue) return '';
    try {
      const date = new Date(dateTimeValue);
      return date.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Schedule Toggle */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t.schedule?.schedulingOptions || 'Scheduling Options'}
        </label>

        <div className="space-y-2">
          {/* Publish Immediately */}
          <label className="flex items-center p-3 border rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700">
            <input
              type="radio"
              name="publishOption"
              checked={!isScheduled}
              onChange={() => handleToggleSchedule(false)}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
            />
            <div className="ml-3">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {t.schedule?.publishImmediately || 'Publish immediately'}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t.schedule?.publishNow || 'Publish now'}
              </div>
            </div>
          </label>

          {/* Schedule for Later */}
          <label className="flex items-center p-3 border rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700">
            <input
              type="radio"
              name="publishOption"
              checked={isScheduled}
              onChange={() => handleToggleSchedule(true)}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
            />
            <div className="ml-3">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {t.schedule?.scheduleLater || 'Schedule for later'}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t.schedule?.selectDateTime || 'Select date and time'}
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Date/Time Picker - Only show when scheduled */}
      {isScheduled && (
        <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          {/* DateTime Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t.schedule?.dateAndTime || 'Date and Time'}
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <Calendar size={18} className="text-gray-400" />
              </div>
              <input
                type="datetime-local"
                value={dateTimeValue}
                onChange={(e) => handleDateTimeChange(e.target.value)}
                min={getMinDateTime()}
                max={getMaxDateTime()}
                disabled={disabled}
                className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                required
              />
              {dateTimeValue && !disabled && (
                <button
                  type="button"
                  onClick={handleClearSchedule}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Clear date"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          {/* Timezone Display */}
          <div className="flex items-start space-x-2 text-xs text-gray-600 dark:text-gray-400">
            <Clock size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              {t.schedule?.timezone || 'Timezone'}: <span className="font-medium">{timezone}</span>
            </span>
          </div>

          {/* Preview */}
          {dateTimeValue && !error && (
            <div className="flex items-start space-x-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
              <Info size={16} className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-900 dark:text-blue-100">
                <div className="font-medium mb-1">{t.schedule?.videoWillBePublished || 'This video will be published on'}:</div>
                <div className="text-xs">{getPreviewDate()}</div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-start space-x-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-md">
              <AlertCircle size={16} className="text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <span className="text-sm text-red-900 dark:text-red-100">{error}</span>
            </div>
          )}

          {/* Notify Subscribers */}
          <div className="flex items-center pt-2 border-t border-gray-200 dark:border-gray-700">
            <input
              type="checkbox"
              id="notifyOnPublish"
              checked={notifyOnPublish}
              onChange={(e) => handleNotifyChange(e.target.checked)}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label
              htmlFor="notifyOnPublish"
              className="ml-2 block text-sm text-gray-700 dark:text-gray-300"
            >
              {t.schedule?.notifyOnPublish || 'Notify subscribers when published'}
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
