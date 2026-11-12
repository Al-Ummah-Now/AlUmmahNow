/**
 * DayView Component
 *
 * Calendar day view with dual Gregorian/Hijri date display
 */

'use client';

import React, { useMemo, useCallback } from 'react';
import { Calendar as BigCalendar, dateFnsLocalizer, View, NavigateAction } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS, ar as arSA } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import '../calendar.css';
import { useLanguage } from '@/hooks/useLanguage';
import { CustomWeekHeader } from '../shared/CustomHeaders';
import { EventWrapper, RowEventWrapper, CalendarEventData } from '../shared/EventWrapper';
import { TimeGutterHeader } from '../shared/TimeComponents';
import { formatTime } from '../utils/dateFormatters';

// Type cast to fix React 19 compatibility issue with react-big-calendar
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Calendar = BigCalendar as any;

interface DayViewProps {
  events: CalendarEventData[];
  currentDate: Date;
  onNavigate: (date: Date, view: View, action: NavigateAction) => void;
  onEventClick: (videoId: string) => void;
  isRTL?: boolean;
}

export function DayView({
  events,
  currentDate,
  onNavigate,
  onEventClick,
  isRTL = false,
}: DayViewProps) {
  const { locale } = useLanguage();

  // Setup date-fns localizer with proper locale
  const localizer = useMemo(() => {
    const dateFnsLocale = locale === 'ar' ? arSA : enUS;
    return dateFnsLocalizer({
      format: (date: Date, formatStr: string) => format(date, formatStr, { locale: dateFnsLocale }),
      parse: (dateStr: string, formatStr: string) => parse(dateStr, formatStr, new Date(), { locale: dateFnsLocale }),
      startOfWeek: (date: Date) => startOfWeek(date, { locale: dateFnsLocale }),
      getDay: (date: Date) => getDay(date),
      locales: {
        'en': enUS,
        'ar': arSA,
      },
    });
  }, [locale]);

  // Custom time formatting - show full time with minutes for each slot
  // Hide event time range (position indicates time, tooltip shows details)
  const formats = useMemo(() => ({
    timeGutterFormat: (date: Date) => formatTime(date, locale, false, false),
    eventTimeRangeFormat: () => '',
  }), [locale]);

  // Custom event component renderer
  const EventComponent = useCallback(
    ({ event }: { event: CalendarEventData }) => (
      <EventWrapper event={event} onClick={onEventClick} locale={locale} />
    ),
    [onEventClick, locale]
  );

  // Custom day header renderer (uses week header style)
  const DayHeader = useCallback(
    ({ date, label }: { date: Date; label: string }) => (
      <CustomWeekHeader date={date} label={label} />
    ),
    []
  );

  // Custom time gutter header renderer
  const CustomTimeGutterHeader = useCallback(
    () => <TimeGutterHeader />,
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
    <div className="calendar-container calendar-day-view h-[900px]" dir={isRTL ? 'rtl' : 'ltr'}>
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        view="day"
        onView={() => {}} // View is controlled externally
        date={currentDate}
        onNavigate={onNavigate}
        onSelectEvent={handleSelectEvent}
        rtl={isRTL}
        step={5}
        timeslots={3}
        formats={formats}
        components={{
          toolbar: CustomToolbar,
          event: EventComponent,
          eventWrapper: RowEventWrapper,
          day: {
            header: DayHeader,
          },
          timeGutterHeader: CustomTimeGutterHeader,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React 19 compatibility
        } as any}
        style={{ height: '100%' }}
        popup
        selectable={false}
        className="scheduled-video-calendar scheduled-video-calendar-day"
      />
    </div>
  );
}
