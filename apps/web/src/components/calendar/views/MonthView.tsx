/**
 * MonthView Component
 *
 * Calendar month view with dual Gregorian/Hijri date display
 */

'use client';

import React, { useMemo, useCallback } from 'react';
import { Calendar, dateFnsLocalizer, View, NavigateAction } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS, ar as arSA } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import '../calendar.css';
import { useLanguage } from '@/hooks/useLanguage';
import { CustomMonthDateHeader } from '../shared/CustomHeaders';
import { EventWrapper, CalendarEventData } from '../shared/EventWrapper';

interface MonthViewProps {
  events: CalendarEventData[];
  currentDate: Date;
  onNavigate: (date: Date, view: View, action: NavigateAction) => void;
  onEventClick: (videoId: string) => void;
  isRTL?: boolean;
}

export function MonthView({
  events,
  currentDate,
  onNavigate,
  onEventClick,
  isRTL = false,
}: MonthViewProps) {
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
    <div className="calendar-container min-h-[1000px]" dir={isRTL ? 'rtl' : 'ltr'}>
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        view="month"
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
        }}
        style={{ height: '100%' }}
        popup
        selectable={false}
        className="scheduled-video-calendar"
      />
    </div>
  );
}
