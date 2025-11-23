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
import type { ViewType, CalendarType } from '../utils/dateFormatters';
import { Loader, AlertCircle, CalendarIcon } from 'lucide-react';

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
  calendarType: CalendarType;
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
 * ScheduledVideoCalendar Component
 */
export function ScheduledVideoCalendar({
  videos,
  calendarType: _calendarType,
  viewType,
  currentDate,
  onNavigate,
  onEventClick,
  isLoading = false,
  error = null,
  className = '',
}: ScheduledVideoCalendarProps) {
  const { t, locale } = useLanguage();

  // Transform videos to calendar events
  const events = useMemo(() => {
    return videos
      .map(transformVideoToCalendarEvent)
      .filter((event): event is CalendarEventData => event !== null);
  }, [videos]);

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

  // Handle event selection
  const handleSelectEvent = useCallback(
    (event: CalendarEventData) => {
      onEventClick(event.id);
    },
    [onEventClick]
  );

  // Custom toolbar (we hide it since we use CalendarControls)
  const CustomToolbar = () => null;

  // Loading state
  if (isLoading) {
    return (
      <div className={`flex flex-col items-center justify-center py-24 ${className}`}>
        <Loader className="animate-spin text-blue-600 mb-4" size={48} />
        <p className="text-gray-600 dark:text-gray-400">
          {(t.schedule?.calendar?.loadingEvents) ?? "Loading events..."}
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-8 ${className}`}>
        <div className="flex items-start space-x-3">
          <AlertCircle className="text-red-600 dark:text-red-400 flex-shrink-0 mt-1" size={24} />
          <div>
            <h3 className="font-semibold text-red-900 dark:text-red-100 mb-2">
              {(t.schedule?.calendar?.errorLoadingEvents) ?? "Error loading events"}
            </h3>
            <p className="text-sm text-red-700 dark:text-red-200">
              {error.message || (t.schedule?.calendar?.unknownError ?? "Unknown error")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (events.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-24 bg-gray-50 dark:bg-gray-800 rounded-lg ${className}`}>
        <CalendarIcon className="text-gray-400 mb-4" size={64} />
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          {(t.schedule?.calendar?.noScheduledVideos) ?? "No scheduled videos"}
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          {(t.schedule?.calendar?.noScheduledVideosThisPeriod) ?? "No videos for this period"}
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 ${className}`}>
      <div className="calendar-container" style={{ height: '700px' }}>
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
          components={{
            toolbar: CustomToolbar,
            event: EventComponent,
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
          min-height: 120px;
        }

        .scheduled-video-calendar .rbc-event-label {
          display: none;
        }

        /* Responsive adjustments */
        @media (max-width: 768px) {
          .scheduled-video-calendar .rbc-month-row {
            min-height: 80px;
          }

          .scheduled-video-calendar .rbc-header {
            padding: 4px 2px;
            font-size: 0.875rem;
          }
        }
      `}</style>
    </div>
  );
}
