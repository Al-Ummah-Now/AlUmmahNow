/**
 * ScheduledVideoCalendar Component (LTR)
 *
 * Main calendar component that displays scheduled videos.
 * Delegates rendering to specialized view components (MonthView, WeekView, DayView).
 */

'use client';

import React, { useMemo } from 'react';
import { View, NavigateAction } from 'react-big-calendar';
import type { VideoObject } from '@/interfaces';
import type { ViewType } from '../utils/dateFormatters';
import { Loader, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { MonthView } from '../views/MonthView';
import { WeekView } from '../views/WeekView';
import { DayView } from '../views/DayView';
import type { CalendarEventData } from '../shared/EventWrapper';

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
  const { t } = useLanguage();

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

  // Render appropriate view component
  const renderView = () => {
    switch (viewType) {
      case 'month':
        return (
          <MonthView
            events={events}
            currentDate={currentDate}
            onNavigate={onNavigate}
            onEventClick={onEventClick}
            isRTL={false}
          />
        );
      case 'week':
        return (
          <WeekView
            events={events}
            currentDate={currentDate}
            onNavigate={onNavigate}
            onEventClick={onEventClick}
            isRTL={false}
          />
        );
      case 'day':
        return (
          <DayView
            events={events}
            currentDate={currentDate}
            onNavigate={onNavigate}
            onEventClick={onEventClick}
            isRTL={false}
          />
        );
    }
  };

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

        {renderView()}
      </div>
    </div>
  );
}
