/**
 * ScheduledVideoCalendar Component (LTR)
 *
 * Main calendar component that displays scheduled videos using react-big-calendar.
 * Supports Gregorian and Hijri calendars, multiple view types (month/week/day),
 * and integrates with CalendarEvent component for event rendering.
 */

'use client';

import React, { useMemo, useCallback } from 'react';
import { Calendar, momentLocalizer, View, NavigateAction } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { CalendarEvent } from '../../scheduled-videos/CalendarEvent';
import { useLanguage } from '@/hooks/useLanguage';
import type { VideoObject } from '@/interfaces';
import type { ViewType } from '../utils/dateFormatters';
import { Loader, AlertCircle } from 'lucide-react';
import { gregorianToHijri } from '../utils/hijriConverter';
import { formatNumber } from '../utils/dateFormatters';

// Setup the localizer for react-big-calendar
const localizer = momentLocalizer(moment);

interface CalendarEventData {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: VideoObject;
}

export interface ScheduledVideoCalendarProps {
  videos: VideoObject[];
  viewType: ViewType;
  currentDate: Date;
  onNavigate: (date: Date, view: View, action: NavigateAction) => void;
  onEventClick: (videoId: string) => void;
  isLoading?: boolean;
  error?: Error | null;
  className?: string;
}

/**
 * Transform VideoObject to CalendarEventData
 */
function transformVideoToCalendarEvent(video: VideoObject): CalendarEventData | null {
  const scheduledDate = (video as any).scheduledPublishDate;

  if (!scheduledDate) {
    return null;
  }

  const startDate = new Date(scheduledDate);
  // Default duration: 1 hour (can be adjusted based on video duration if available)
  const duration = video.duration || 3600; // in seconds
  const endDate = new Date(startDate.getTime() + duration * 1000);

  return {
    id: video.id,
    title: video.title,
    start: startDate,
    end: endDate,
    resource: video,
  };
}

/**
 * Custom Event Component for react-big-calendar
 */
interface EventWrapperProps {
  event: CalendarEventData;
  onClick: (videoId: string) => void;
  locale: 'en' | 'ar';
}

const EventWrapper: React.FC<EventWrapperProps> = ({ event, onClick, locale }) => {
  return (
    <CalendarEvent
      id={event.id}
      title={event.title}
      thumbnailUrl={event.resource.thumbnailUrl}
      scheduledDate={event.start}
      onClick={onClick}
      locale={locale}
      className="h-full"
    />
  );
};

/**
 * Custom Month Date Header Component - Shows dual calendar dates
 */
interface CustomMonthDateHeaderProps {
  date: Date;
  label: string;
}

const CustomMonthDateHeader: React.FC<CustomMonthDateHeaderProps> = ({ date }) => {
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

const CustomWeekHeader: React.FC<CustomWeekHeaderProps> = ({ date }) => {
  const { locale } = useLanguage();
  const gregorianDay = date.getDate();
  const hijriDate = gregorianToHijri(date);

  // Get weekday using moment with proper locale
  const weekday = moment(date).format('ddd');

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

/**
 * ScheduledVideoCalendar Component
 */
export function ScheduledVideoCalendar({
  videos,
  viewType,
  currentDate,
  onNavigate,
  onEventClick,
  isLoading = false,
  error = null,
  className = '',
}: ScheduledVideoCalendarProps) {
  const { t, locale, isRTL } = useLanguage();

  // Set moment locale for proper weekday/month names
  React.useEffect(() => {
    moment.locale(locale);
  }, [locale]);

  // Transform videos to calendar events
  const events = useMemo(() => {
    // Show empty events while loading or on error
    if (isLoading || error) {
      return [];
    }
    return videos
      .map(transformVideoToCalendarEvent)
      .filter((event): event is CalendarEventData => event !== null);
  }, [videos, isLoading, error]);

  // Map viewType to react-big-calendar View
  const calendarView: View = useMemo(() => {
    const viewMap: Record<ViewType, View> = {
      month: 'month',
      week: 'week',
      day: 'day',
    };
    return viewMap[viewType];
  }, [viewType]);

  // Custom event component renderer
  const EventComponent = useCallback(
    ({ event }: { event: CalendarEventData }) => (
      <EventWrapper event={event} onClick={onEventClick} locale={locale} />
    ),
    [onEventClick, locale]
  );

  // Custom month date header renderer
  const MonthDateHeader = useCallback(
    ({ date, label }: { date: Date; label: string }) => (
      <CustomMonthDateHeader date={date} label={label} />
    ),
    []
  );

  // Custom week header renderer
  const WeekHeader = useCallback(
    ({ date, label }: { date: Date; label: string }) => (
      <CustomWeekHeader date={date} label={label} />
    ),
    []
  );

  // Handle event selection
  const handleSelectEvent = useCallback(
    (event: CalendarEventData) => {
      onEventClick(event.id);
    },
    [onEventClick]
  );

  // Custom toolbar (we hide it since we use CalendarControls)
  const CustomToolbar = () => null;

  return (
    <div className={`${className}`}>
      {/* Error banner - shows above calendar */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <h4 className="font-medium text-red-900 dark:text-red-100 text-sm">
                {(t.schedule?.calendar?.errorLoadingEvents) ?? "Error loading events"}
              </h4>
              <p className="text-xs text-red-700 dark:text-red-200 mt-1">
                {error.message || (t.schedule?.calendar?.unknownError ?? "Unknown error")}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 relative`}>
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-lg">
            <div className="flex flex-col items-center">
              <Loader className="animate-spin text-blue-600 mb-2" size={32} />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {(t.schedule?.calendar?.loadingEvents) ?? "Loading events..."}
              </p>
            </div>
          </div>
        )}

        <div className="calendar-container" style={{ height: '900px' }} dir={isRTL ? 'rtl' : 'ltr'}>
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          view={calendarView}
          onView={() => {}} // View is controlled externally
          date={currentDate}
          onNavigate={onNavigate}
          onSelectEvent={handleSelectEvent}
          rtl={isRTL}
          components={{
            toolbar: CustomToolbar,
            event: EventComponent,
            month: {
              dateHeader: MonthDateHeader,
            },
            week: {
              header: WeekHeader,
            },
            day: {
              header: WeekHeader,
            },
          }}
          style={{ height: '100%' }}
          popup
          selectable={false}
          // Customize calendar styling
          className="scheduled-video-calendar"
        />
      </div>

      {/* Custom Styles for Calendar */}
      <style jsx global>{`
        .scheduled-video-calendar .rbc-event {
          background: transparent !important;
          border: none !important;
          padding: 2px !important;
        }

        .scheduled-video-calendar .rbc-event-content {
          padding: 0 !important;
        }

        .scheduled-video-calendar .rbc-today {
          background-color: rgba(59, 130, 246, 0.1);
        }

        .scheduled-video-calendar .rbc-header {
          padding: 8px 4px;
          font-weight: 600;
          color: rgb(55, 65, 81);
          border-bottom: 1px solid rgb(229, 231, 235);
        }

        .dark .scheduled-video-calendar .rbc-header {
          color: rgb(229, 231, 235);
          border-bottom-color: rgb(55, 65, 81);
        }

        .scheduled-video-calendar .rbc-off-range {
          color: rgb(156, 163, 175);
        }

        .scheduled-video-calendar .rbc-off-range-bg {
          background-color: rgb(249, 250, 251);
        }

        .dark .scheduled-video-calendar .rbc-off-range-bg {
          background-color: rgb(31, 41, 55);
        }

        .scheduled-video-calendar .rbc-month-view,
        .scheduled-video-calendar .rbc-time-view {
          border: 1px solid rgb(229, 231, 235);
          border-radius: 0.5rem;
        }

        .dark .scheduled-video-calendar .rbc-month-view,
        .dark .scheduled-video-calendar .rbc-time-view {
          border-color: rgb(55, 65, 81);
        }

        .scheduled-video-calendar .rbc-day-bg,
        .scheduled-video-calendar .rbc-time-slot {
          border-color: rgb(229, 231, 235);
        }

        .dark .scheduled-video-calendar .rbc-day-bg,
        .dark .scheduled-video-calendar .rbc-time-slot {
          border-color: rgb(55, 65, 81);
        }

        .scheduled-video-calendar .rbc-time-header {
          border-color: rgb(229, 231, 235);
        }

        .dark .scheduled-video-calendar .rbc-time-header {
          border-color: rgb(55, 65, 81);
        }

        .scheduled-video-calendar .rbc-time-content {
          border-top: 1px solid rgb(229, 231, 235);
        }

        .dark .scheduled-video-calendar .rbc-time-content {
          border-top-color: rgb(55, 65, 81);
        }

        .scheduled-video-calendar .rbc-current-time-indicator {
          background-color: rgb(239, 68, 68);
        }

        /* Month view event spacing */
        .scheduled-video-calendar .rbc-month-row {
          min-height: 140px;
        }

        .scheduled-video-calendar .rbc-event-label {
          display: none;
        }

        /* Responsive adjustments */
        @media (max-width: 768px) {
          .scheduled-video-calendar .rbc-month-row {
            min-height: 100px;
          }

          .scheduled-video-calendar .rbc-header {
            padding: 4px 2px;
            font-size: 0.875rem;
          }
        }
      `}</style>
      </div>
    </div>
  );
}
