/**
 * EventWrapper Component
 *
 * Wraps CalendarEvent for use in react-big-calendar
 */

'use client';

import React from 'react';
import { CalendarEvent } from '../../scheduled-videos/CalendarEvent';
import type { VideoObject } from '@/interfaces';

export interface CalendarEventData {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: VideoObject;
}

interface EventWrapperProps {
  event: CalendarEventData;
  onClick: (videoId: string) => void;
  locale: 'en' | 'ar';
}

export const EventWrapper: React.FC<EventWrapperProps> = ({ event, onClick, locale }) => {
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
